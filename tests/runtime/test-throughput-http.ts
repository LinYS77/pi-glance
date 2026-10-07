import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { RuntimeRefreshSession } from "../../src/runtime/refresh-session.js";

// Real Pi events and the built-in OpenAI Responses transport/parser. Only the
// HTTP peer and monotonic clock are local; no model calls or personal resources.
const cases = [
	{ name: "initial latency", output: 120, reasoning: 0, elapsedMs: 4_000, rate: 30, retry: false, text: true },
	{ name: "buffered output including reasoning", output: 1_000, reasoning: 900, elapsedMs: 10_000, rate: 100, retry: false, text: true },
	{ name: "reasoning-only output", output: 900, reasoning: 900, elapsedMs: 10_000, rate: 90, retry: false, text: false },
	{ name: "provider-internal retry time", output: 120, reasoning: 0, elapsedMs: 10_000, rate: 12, retry: true, text: true },
] as const;

function event(type: string, at: number, fields: Record<string, unknown>): string {
	return `event: ${type}\ndata: ${JSON.stringify({ type, glanceTestTimeMs: at, ...fields })}\n\n`;
}

function completeResponse(res: ServerResponse, scenario: typeof cases[number]): void {
	const end = scenario.elapsedMs;
	const item = { id: "msg_demo", type: "message", status: "completed", role: "assistant",
		content: [{ type: "output_text", text: "DEMO response", annotations: [] }] };
	const output = scenario.text ? [item] : [];
	let body = event("response.created", end - 1_000, { response: { id: "resp_demo", status: "in_progress", output: [] } });
	if (scenario.text) {
		body += event("response.output_item.added", end - 1_000, { output_index: 0, item: { ...item, status: "in_progress", content: [] } });
		body += event("response.content_part.added", end - 1_000, { output_index: 0, content_index: 0,
			part: { type: "output_text", text: "", annotations: [] } });
		body += event("response.output_text.delta", end, { output_index: 0, content_index: 0, delta: "DEMO response" });
		body += event("response.output_item.done", end, { output_index: 0, item });
	}
	body += event("response.completed", end, { response: { id: "resp_demo", status: "completed", output,
		usage: { input_tokens: 100, output_tokens: scenario.output,
			output_tokens_details: { reasoning_tokens: scenario.reasoning }, total_tokens: 100 + scenario.output } } });
	res.writeHead(200, { "content-type": "text/event-stream" });
	res.end(body); // Intentionally buffered: chunk delivery must not determine throughput.
}

for (const scenario of cases) test(`native HTTP throughput counts ${scenario.name}`, { timeout: 20_000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), "glance-throughput-http-"));
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	let abortTimer: ReturnType<typeof setTimeout> | undefined;
	let now = 0, attempts = 0, requestEvents = 0, assistantEnds = 0;
	const config = defaultConfig();
	const tracked = new RuntimeRefreshSession({
		getConfig: () => config, ensureConfig: async () => config, getThinkingLevel: () => "off",
		nowMs: () => now, requestRender: () => {}, scheduleGitRefresh: () => {},
	});
	const server = createServer((req, res) => {
		req.resume();
		attempts++;
		if (scenario.retry && attempts === 1) {
			now = 3_000;
			res.writeHead(500, { "content-type": "application/json", "retry-after-ms": "1" });
			res.end(JSON.stringify({ error: { message: "DEMO transient failure", type: "server_error" } }));
			return;
		}
		completeResponse(res, scenario);
	});
	// Node's test runner isolates this file in its own process. Keep loopback HTTP
	// out of any developer proxy, and restore both spellings on success or failure.
	const proxyBypass = { NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy };
	process.env.NO_PROXY = process.env.no_proxy = "localhost,127.0.0.1";
	t.after(async () => {
		clearTimeout(abortTimer);
		session?.dispose();
		server.closeAllConnections();
		try {
			if (server.listening) {
				await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
			}
		} finally {
			for (const [key, value] of Object.entries(proxyBypass)) {
				if (value === undefined) delete process.env[key]; else process.env[key] = value;
			}
			await rm(root, { recursive: true, force: true });
		}
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, cacheWarming: "off",
		retry: { enabled: false, provider: { maxRetries: scenario.retry ? 1 : 0, timeoutMs: 5_000 } } });
	const loader = new DefaultResourceLoader({
		cwd: root, agentDir: root, settingsManager, noExtensions: true, noSkills: true,
		noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: [pi => {
			pi.registerProvider("glance-throughput-http", {
				api: "openai-responses", baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "DEMO-not-a-credential",
				models: [{ id: "local", name: "DEMO local HTTP", reasoning: false, input: ["text"], contextWindow: 200_000,
					maxTokens: 2_000, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }],
			});
			pi.on("session_start", (_event, ctx) => { tracked.sessionStart(ctx); });
			pi.on("agent_start", () => tracked.agentStart());
			pi.on("turn_start", (_event, ctx) => tracked.turnStart(ctx));
			pi.on("before_provider_request", () => { requestEvents++; tracked.providerRequest(); });
			pi.on("provider_stream_event", event => {
				const data = event.data;
				if (typeof data === "object" && data !== null && "glanceTestTimeMs" in data && typeof data.glanceTestTimeMs === "number") {
					now = data.glanceTestTimeMs;
				}
			});
			pi.on("message_end", (event, ctx) => {
				if (event.message.role === "assistant") assistantEnds++;
				return tracked.messageEnd(event, ctx);
			});
			pi.on("agent_settled", (_event, ctx) => tracked.agentSettled(ctx));
		}],
	});
	await loader.reload();
	const modelRuntime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null,
		modelsStorePath: join(root, "models-store.json"), allowModelNetwork: false, refreshOnCreate: false });
	({ session } = await createAgentSession({
		cwd: root, agentDir: root, modelRuntime, resourceLoader: loader, settingsManager,
		sessionManager: SessionManager.inMemory(root), noTools: "all",
	}));
	const model = modelRuntime.getModel("glance-throughput-http", "local");
	assert.ok(model);
	await session.setModel(model);
	await session.bindExtensions({});
	abortTimer = setTimeout(() => { void session?.abort(); }, 10_000);
	await session.prompt("DEMO local transport test");
	const message = session.messages.filter(message => message.role === "assistant").at(-1);
	assert.ok(message);
	assert.equal(message.stopReason, "stop", message.errorMessage);
	assert.equal(message.usage.output, scenario.output, "Pi maps the complete provider output without deducting reasoning");
	assert.equal(message.usage.reasoning, scenario.reasoning);
	assert.equal(attempts, scenario.retry ? 2 : 1);
	assert.equal(requestEvents, 1, "SDK-internal HTTP retries do not expose a second request-start event");
	assert.equal(assistantEnds, 1);
	const state = tracked.getState();
	assert.ok(state);
	assert.equal(state.throughput.currentRun, null, "settlement finalizes the average");
	assert.equal(state.throughput.lastRun?.outputTokens, scenario.output);
	assert.equal(state.throughput.lastRun?.elapsedMs, scenario.elapsedMs);
	assert.equal(state.throughput.lastRun?.tokensPerSecond, scenario.rate);
	assert.equal(state.usage.output, scenario.output, "the billed ledger is unchanged");
	assert.equal(state.usage.cost, message.usage.cost.total, "cost still follows provider billing");
});
