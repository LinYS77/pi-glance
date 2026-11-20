import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Type } from "typebox";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { RuntimeRefreshSession } from "../../src/runtime/refresh-session.js";

// Run actual Pi request, tool, warming and settlement events; only the provider and clock are local.
for (const warmAt of ["tool", "context", "stream", "idle"] as const) test(`Pi cache warming during ${warmAt} preserves throughput request boundaries`, async () => {
	const root = await mkdtemp(join(tmpdir(), "glance-throughput-host-"));
	const config = defaultConfig();
	let now = 0, primaryCalls = 0, warmingCalls = 0, requestEvents = 0;
	let completeWarm!: () => void;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const warmed = new Promise<void>((resolve, reject) => {
		completeWarm = resolve;
		timeout = setTimeout(() => reject(new Error(`Pi did not complete cache warming during ${warmAt}`)), 10_000);
	});
	const tracked = new RuntimeRefreshSession({
		getConfig: () => config, ensureConfig: async () => config, getThinkingLevel: () => "off",
		nowMs: () => now, requestRender: () => {}, scheduleGitRefresh: () => {},
	});
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	let startContext: ExtensionContext | undefined;
	let unsubscribe: (() => void) | undefined;
	try {
		const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, cacheWarming: warmAt === "idle" ? "idle" : "streaming", retry: { enabled: false } });
		const cacheLifetime = warmAt === "idle" ? 11 : 10.001;
		const loader = new DefaultResourceLoader({
			cwd: root, agentDir: root, settingsManager, noExtensions: true, noSkills: true,
			noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [pi => {
				pi.registerProvider("glance-throughput-test", {
					api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "DEMO-not-a-credential",
					models: [{ id: "local", name: "DEMO local", reasoning: false, input: ["text"], contextWindow: 200_000,
						maxTokens: 128, cost: { input: 10, output: 1, cacheRead: 0.01, cacheWrite: 0 }, promptCache: { short: cacheLifetime, long: cacheLifetime } }],
					streamSimple(model, _context, options) {
						const stream = createAssistantMessageEventStream();
						const warm = options?.maxTokens === 1;
						const call = warm ? ++warmingCalls : ++primaryCalls;
						now = warm ? (warmAt === "stream" ? 1_500 : 3_000) : call === 1 ? 1_000 : 6_000;
						const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
							content: [], stopReason: "pending", timestamp: Date.now(), usage: { input: 20_000, output: warm ? 1 : call === 1 ? 20 : 60,
								cacheRead: 0, cacheWrite: 0, totalTokens: 20_000, cost: { input: 0.2, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.2 } } };
						void (async () => {
							try {
								await options?.onPayload?.({ demo: true }, model);
								stream.push({ type: "start", partial: message });
								if (warmAt === "stream" && !warm && call === 1) await warmed;
								if (!warm && call === 1 && warmAt !== "idle") {
									message.content = [{ type: "toolCall", id: "wait-1", name: "wait_for_warm", arguments: {} }];
									message.stopReason = "toolUse";
								} else { message.content = [{ type: "text", text: "DEMO response" }]; message.stopReason = "stop"; }
								now = warm ? (warmAt === "stream" ? 1_600 : 3_500) : call === 1 ? 2_000 : 7_000;
								stream.push({ type: "done", reason: message.stopReason, message }); stream.end();
								if (warm && warmAt !== "idle") completeWarm();
							} catch (error) {
								message.stopReason = "error"; message.errorMessage = String(error);
								stream.push({ type: "error", reason: "error", error: message }); stream.end();
							}
						})();
						return stream;
					},
				});
				pi.on("cache_warming_decision", () => ({ action: warmingCalls === 0 ? "warm" : "stop" }));
				pi.on("context", async () => { if (warmAt === "context" && primaryCalls === 1) await warmed; });
				pi.on("session_start", (_event, ctx) => { startContext = ctx; tracked.sessionStart(ctx); });
				pi.on("agent_start", () => tracked.agentStart());
				pi.on("turn_start", (_event, ctx) => tracked.turnStart(ctx));
				pi.on("before_provider_request", () => { requestEvents++; tracked.providerRequest(); });
				pi.on("message_end", (event, ctx) => tracked.messageEnd(event, ctx));
				pi.on("agent_settled", (_event, ctx) => tracked.agentSettled(ctx));
			}],
		});
		await loader.reload();
		const modelRuntime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null,
			modelsStorePath: join(root, "models-store.json"), allowModelNetwork: false, refreshOnCreate: false });
		({ session } = await createAgentSession({
			cwd: root, agentDir: root, modelRuntime, resourceLoader: loader, settingsManager,
			sessionManager: SessionManager.inMemory(root), tools: ["wait_for_warm"],
			customTools: [{ name: "wait_for_warm", label: "DEMO wait", description: "Wait for local cache replay",
				parameters: Type.Object({}),
				execute: async () => { if (warmAt === "tool") await warmed; return { content: [{ type: "text", text: "DEMO tool complete" }], details: undefined }; } }],
		}));
		const model = modelRuntime.getModel("glance-throughput-test", "local");
		assert.ok(model);
		await session.setModel(model);
		await session.bindExtensions({});
		session.setActiveToolsByName(["wait_for_warm"]);
		if (warmAt === "idle") {
			unsubscribe = session.subscribe(event => {
				if (event.type === "entry_appended" && event.entry.type === "usage" && event.entry.kind === "cache_warm") completeWarm();
			});
		}
		await session.prompt("DEMO local test");
		if (warmAt === "idle") {
			assert.ok(startContext);
			assert.equal(primaryCalls, 1);
			assert.equal(warmingCalls, 0, "the first run settles before the replay");
			const before = structuredClone(tracked.getState()!);
			assert.equal(before.throughput.lastRun?.tokensPerSecond, 20);
			await warmed;
			const after = tracked.ensureState(startContext);
			assert.equal(after.usage.output, before.usage.output + 1);
			assert.equal(after.usage.cost, before.usage.cost + 0.2, "read the actual persisted replay bill");
			const billed = structuredClone(after.usage);
			assert.deepEqual(tracked.ensureState(startContext).usage, billed, "repeated draws do not double-count");
			assert.deepEqual(after.context, before.context);
			assert.deepEqual(after.throughput, before.throughput);
			await session.prompt("DEMO next foreground run");
			assert.equal(primaryCalls, 2);
			assert.equal(warmingCalls, 1);
			assert.equal(requestEvents, 3);
			assert.equal(tracked.getState()?.throughput.lastRun?.tokensPerSecond, 60);
			return;
		}
		assert.equal(primaryCalls, 2);
		assert.equal(warmingCalls, 1);
		assert.equal(requestEvents, 3, "Pi's warming callback shares the public request event");
		const rate = tracked.getState()?.throughput.lastRun;
		if (warmAt === "tool") {
			assert.equal(rate?.outputTokens, 80);
			assert.equal(rate?.elapsedMs, 2_000, "two 1s primary requests, excluding the tool wait and warm replay");
			assert.equal(rate?.tokensPerSecond, 40);
		} else {
			assert.equal(rate, null, "overlapping callbacks have no public request ID: show unknown");
		}
	} finally {
		clearTimeout(timeout);
		unsubscribe?.();
		session?.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
