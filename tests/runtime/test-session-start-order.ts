import { createRuntimeTestContext } from "../support/runtime-harness.js";
import piGlance from "../../index.js";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type CapturedHandler = (event: unknown, ctx: ExtensionContext) => unknown;

interface CapturedPi {
	api: ExtensionAPI;
	handlers: Map<string, CapturedHandler>;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function createPi(): CapturedPi {
	const handlers = new Map<string, CapturedHandler>();
	const api = {
		on: (event: string, handler: CapturedHandler) => {
			handlers.set(event, handler);
		},
		registerCommand: () => undefined,
		getThinkingLevel: () => "off",
	} as unknown as ExtensionAPI;
	return { api, handlers };
}

function getHandler(pi: CapturedPi, event: string): CapturedHandler {
	const handler = pi.handlers.get(event);
	assert.ok(handler, `expected ${event} handler to be registered`);
	return handler;
}

async function main(): Promise<void> {
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = await mkdtemp(join(tmpdir(), "pi-glance-session-start-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;

	try {

		const enabledPi = createPi();
		piGlance(enabledPi.api);
		assert.ok(enabledPi.handlers.has("thinking_level_select"), "entry point should register Pi /thinking selection notifications");
		assert.ok(enabledPi.handlers.has("ui_prompt_start"), "entry point should register Pi ui_prompt_start notifications");
		assert.ok(enabledPi.handlers.has("ui_prompt_end"), "entry point should register Pi ui_prompt_end notifications");
		const { ctx: enabledContext, surfaceCalls: enabledCalls } = createRuntimeTestContext({ cwd: process.cwd(), trusted: false, persistent: false });
		const enabledResult = getHandler(enabledPi, "session_start")({ type: "session_start" }, enabledContext);

		assert.equal(isPromiseLike(enabledResult), false, "session_start should be synchronous for default enabled config");
		assert.equal(enabledCalls[0], "setFooter:install", "default enabled TUI config should synchronously claim the footer before handler returns");
		assert.equal(enabledCalls[1], "setEditorComponent:install", "default enabled TUI config should synchronously claim the editor before handler returns");

		await getHandler(enabledPi, "session_shutdown")({ type: "session_shutdown" }, enabledContext);

		for (const mode of ["rpc", "json", "print"] as const) {
			const nonTuiPi = createPi();
			piGlance(nonTuiPi.api);
			const { ctx, surfaceCalls: nonTuiCalls } = createRuntimeTestContext({ mode, trusted: false, persistent: false });
			const nonTuiResult = getHandler(nonTuiPi, "session_start")({ type: "session_start" }, ctx);
			assert.equal(isPromiseLike(nonTuiResult), false, `${mode} session_start should stay synchronous for default enabled config`);
			assert.deepEqual(nonTuiCalls, [], `${mode} session_start should not install or clear TUI footer/editor`);
		}

		await mkdir(join(agentDir, "pi-glance"), { recursive: true });
		await writeFile(join(agentDir, "pi-glance", "config.json"), `${JSON.stringify({ enabled: false })}\n`, "utf8");

		const disabledPi = createPi();
		piGlance(disabledPi.api);
		const { ctx: disabledContext, surfaceCalls: disabledCalls } = createRuntimeTestContext({ trusted: false, persistent: false });
		const disabledResult = getHandler(disabledPi, "session_start")({ type: "session_start" }, disabledContext);

		assert.equal(isPromiseLike(disabledResult), false, "session_start should also be synchronous for disabled config");
		assert.deepEqual(disabledCalls, [], "disabled startup leaves both editor and footer slots untouched");
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(agentDir, { recursive: true, force: true });
	}
}

await main();
console.log("✓ session_start synchronous input-surface claim checks passed");
