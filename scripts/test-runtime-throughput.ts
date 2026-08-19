import { strict as assert } from "node:assert";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../config.js";
import { createGlanceRuntime } from "../runtime.js";
import type { GlanceConfig } from "../types.js";

interface TestContext {
	ctx: ExtensionCommandContext;
	getRenderRequests(): number;
}

interface RuntimeRecord {
	events: Record<string, (event: unknown, ctx: ExtensionCommandContext) => unknown>;
	commands: { openPane(args: string, ctx: ExtensionCommandContext): Promise<void> };
}

function cloneConfig(config: GlanceConfig): GlanceConfig {
	return JSON.parse(JSON.stringify(config)) as GlanceConfig;
}

function assistant(output: number, extras: Record<string, unknown> = {}, stopReason = "stop"): unknown {
	return {
		role: "assistant",
		provider: "test-provider",
		model: "test-model",
		stopReason,
		usage: { output, totalTokens: output, ...extras },
	};
}

function user(): unknown {
	return { role: "user", content: "hello" };
}

function update(message: unknown): unknown {
	return {
		message,
		assistantMessageEvent: { type: "text_delta", delta: "x" },
	};
}

function createContext(): TestContext {
	let renderRequests = 0;
	const fakeTui = { requestRender: () => renderRequests++ };
	const fakeTheme = {};
	const ctx = {
		mode: "tui",
		hasUI: true,
		cwd: "/repo",
		model: { id: "test-model", provider: "test-provider", contextWindow: 200_000 },
		modelRegistry: {
			getAvailable: () => [{ provider: "test-provider", id: "test-model" }],
		},
		sessionManager: {
			getCwd: () => "/repo",
			getEntries: () => [],
			getBranch: () => [],
		},
		ui: {
			setFooter: (factory: unknown) => {
				if (factory) (factory as (tui: unknown, theme: unknown) => unknown)(fakeTui, fakeTheme);
			},
			setEditorComponent: (_factory: unknown) => {},
			notify: (_message: string, _type?: string) => {},
		},
		getContextUsage: () => ({ tokens: 42, contextWindow: 200_000, percent: 0.021 }),
	} as unknown as ExtensionCommandContext;
	return { ctx, getRenderRequests: () => renderRequests };
}

function createRuntime(nowValues: number[]): { runtime: RuntimeRecord; capturedStates: unknown[]; getRemainingNowReads(): number } {
	const capturedStates: unknown[] = [];
	const pendingNowValues = [...nowValues];
	const config = defaultConfig();
	const adapters = {
		getThinkingLevel: () => "max",
		loadConfigSync: () => cloneConfig(config),
		loadConfig: async () => cloneConfig(config),
		saveConfig: async (_config: GlanceConfig) => {},
		showPane: async (_initial: GlanceConfig, _ctx: ExtensionCommandContext, previewState?: unknown) => {
			capturedStates.push(JSON.parse(JSON.stringify(previewState)) as unknown);
			return { action: "cancel" as const };
		},
		createGitRefresher: () => ({ schedule: (_immediate?: boolean) => {}, dispose: () => {} }),
		nowMs: () => {
			assert.ok(pendingNowValues.length > 0, "runtime should only read injected time for assistant message updates");
			return pendingNowValues.shift()!;
		},
	};
	return {
		runtime: createGlanceRuntime(adapters) as unknown as RuntimeRecord,
		capturedStates,
		getRemainingNowReads: () => pendingNowValues.length,
	};
}

async function captureState(runtime: RuntimeRecord, test: TestContext, capturedStates: unknown[]): Promise<unknown> {
	await runtime.commands.openPane("", test.ctx);
	return capturedStates.at(-1);
}

function throughputSlots(state: unknown): { lastTurn?: unknown; currentRun?: unknown } {
	return ((state as { throughput?: { lastTurn?: unknown; currentRun?: unknown } } | undefined)?.throughput ?? {}) as { lastTurn?: unknown; currentRun?: unknown };
}

function assertSlots(state: unknown, expected: { lastTurn: unknown; currentRun: unknown }, message: string): void {
	assert.deepEqual(throughputSlots(state), expected, message);
}

function expectedTurn(startedAtMs: number, endedAtMs: number, elapsedMs: number, output: number): unknown {
	return {
		startedAtMs,
		endedAtMs,
		elapsedMs,
		tokensPerSecond: output / (elapsedMs / 1000),
		usage: {
			input: 0,
			output,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: output,
			assistantMessages: 1,
		},
	};
}

{
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([1_000, 2_250]);
	runtime.events.sessionStart({}, test.ctx);
	runtime.events.agentStart({}, test.ctx);
	runtime.events.messageUpdate(update(assistant(40)), test.ctx);
	runtime.events.messageUpdate(update(assistant(40)), test.ctx);
	assert.equal(getRemainingNowReads(), 0, "assistant message updates should consume the injected stream timestamps");
	await runtime.events.messageEnd({ message: Object.assign({}, assistant(40), { responseId: "r1" }) }, test.ctx);
	assertSlots(
		await captureState(runtime, test, capturedStates),
		{
			lastTurn: null,
			currentRun: expectedTurn(1_000, 2_250, 1_250, 40),
		},
		"completed assistant stream should show provisional model speed before agent_end",
	);

	await runtime.events.agentEnd({ messages: [assistant(40)] }, test.ctx);
	assertSlots(
		await captureState(runtime, test, capturedStates),
		{
			lastTurn: expectedTurn(1_000, 2_250, 1_250, 40),
			currentRun: null,
		},
		"agent_end should finalize model speed without adding task wall time",
	);
}

{
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([1_000, 2_000, 4_000, 5_000]);
	runtime.events.sessionStart({}, test.ctx);
	runtime.events.agentStart({}, test.ctx);
	runtime.events.messageUpdate(update(assistant(20)), test.ctx);
	runtime.events.messageUpdate(update(assistant(20)), test.ctx);
	await runtime.events.messageEnd({ message: assistant(20) }, test.ctx);
	runtime.events.messageUpdate(update(assistant(60, { input: 7, cacheWrite: 5 })), test.ctx);
	runtime.events.messageUpdate(update(assistant(60, { input: 7, cacheWrite: 5 })), test.ctx);
	await runtime.events.messageEnd({ message: assistant(60, { input: 7, cacheWrite: 5 }) }, test.ctx);
	assert.equal(getRemainingNowReads(), 0, "multi-response stream timestamps should all be consumed");
	assertSlots(
		await captureState(runtime, test, capturedStates),
		{
			lastTurn: null,
			currentRun: {
				startedAtMs: 1_000,
				endedAtMs: 5_000,
				elapsedMs: 2_000,
				tokensPerSecond: 40,
				usage: {
					input: 7,
					output: 80,
					cacheRead: 0,
					cacheWrite: 5,
					totalTokens: 80,
					assistantMessages: 2,
				},
			},
		},
		"multiple model streams should exclude the inter-turn gap from model speed",
	);
}

{
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([1_000]);
	runtime.events.sessionStart({}, test.ctx);
	runtime.events.agentStart({}, test.ctx);
	runtime.events.messageUpdate({ message: user() }, test.ctx);
	await runtime.events.messageEnd({ message: user() }, test.ctx);
	assert.equal(getRemainingNowReads(), 1, "non-assistant message events should not read the model stream clock");
	assertSlots(await captureState(runtime, test, capturedStates), { lastTurn: null, currentRun: null }, "non-assistant events should not create model speed");
}

{
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 2_000]);
	runtime.events.sessionStart({}, test.ctx);
	runtime.events.agentStart({}, test.ctx);
	runtime.events.messageUpdate(update(assistant(20)), test.ctx);
	runtime.events.messageUpdate(update(assistant(20)), test.ctx);
	await runtime.events.messageEnd({ message: assistant(20, {}, "error") }, test.ctx);
	await runtime.events.agentEnd({ messages: [assistant(20, {}, "error")] }, test.ctx);
	assertSlots(await captureState(runtime, test, capturedStates), { lastTurn: null, currentRun: null }, "errored model streams should not leave a trusted speed value");
}

{
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([]);
	runtime.events.sessionStart({}, test.ctx);
	runtime.events.agentStart({}, test.ctx);
	assertSlots(await captureState(runtime, test, capturedStates), { lastTurn: null, currentRun: null }, "agent_start should clear stale current model speed");
	await runtime.events.turnEnd({ turnIndex: 0, message: assistant(40), toolResults: [] }, test.ctx);
	assertSlots(await captureState(runtime, test, capturedStates), { lastTurn: null, currentRun: null }, "turn_end alone should not synthesize a model speed measurement");
}

console.log("✓ runtime model-speed checks passed");
