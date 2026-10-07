import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { createGlanceRuntime } from "../../src/runtime/runtime.js";
import type { GlanceConfig } from "../../src/types.js";

interface TestContext {
	ctx: ExtensionCommandContext;
	getRenderRequests(): number;
}

import type { RuntimeHarnessRuntime as RuntimeRecord } from "../support/runtime-harness.js";
import type { ModelSpeedMeasurement as ModelSpeedExpectation, GlanceState } from "../../src/types.js";

function cloneConfig(config: GlanceConfig): GlanceConfig {
	return JSON.parse(JSON.stringify(config)) as GlanceConfig;
}

function assistant(output: number, extras: Record<string, unknown> = {}, stopReason = "stop", responseId?: string): Record<string, unknown> {
	return {
		role: "assistant",
		content: [],
		api: "openai-completions",
		provider: "test-provider",
		model: "test-model",
		responseId,
		stopReason,
		timestamp: 1,
		usage: {
			input: 0,
			output,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: output,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			...extras,
		},
	};
}

function toolResult(toolCallId: string, usage: Record<string, unknown>): Record<string, unknown> {
	return { role: "toolResult", toolCallId, toolName: "nested-model", content: [], isError: false, timestamp: 1, usage };
}

function messageEnd(message: unknown): unknown {
	return { type: "message_end", message };
}

function createContext(): TestContext {
	let renderRequests = 0;
	let currentEditorFactory: unknown;
	const fakeTui = { requestRender: () => renderRequests++ };
	const fakeTheme = {};
	const ctx = {
		mode: "tui",
		hasUI: true,
		isIdle: () => true,
		cwd: "/repo",
		model: { id: "test-model", provider: "test-provider", contextWindow: 200_000 },
		modelRegistry: { getAvailable: () => [{ provider: "test-provider", id: "test-model" }] },
		sessionManager: {
			getCwd: () => "/repo",
			getLeafId: () => null,
			getEntry: () => undefined,
			getEntries: () => [],
			getBranch: () => [],
		},
		ui: {
			setWorkingVisible: (_visible: boolean) => {},
			setFooter: (factory: unknown) => {
				if (factory) (factory as (tui: unknown, theme: unknown) => unknown)(fakeTui, fakeTheme);
			},
			setEditorComponent: (factory: unknown) => {
				currentEditorFactory = factory;
			},
			getEditorComponent: () => currentEditorFactory,
			notify: (_message: string, _type?: string) => {},
		},
		getContextUsage: () => ({ tokens: 42, contextWindow: 200_000, percent: 0.021 }),
	} as unknown as ExtensionCommandContext;
	return { ctx, getRenderRequests: () => renderRequests };
}

function createRuntime(nowValues: number[]): { runtime: RuntimeRecord; capturedStates: GlanceState[]; getRemainingNowReads(): number } {
	const capturedStates: GlanceState[] = [];
	const pendingNowValues = [...nowValues];
	const config = defaultConfig();
	const adapters = {
		getThinkingLevel: () => "max",
		loadConfigSync: () => ({ config: cloneConfig(config), status: "loaded" as const, writable: true }),
		loadConfig: async () => ({ config: cloneConfig(config), status: "loaded" as const, writable: true }),
		saveConfig: async (_config: GlanceConfig) => {},
		showPane: async (_initial: GlanceConfig, _ctx: ExtensionCommandContext, previewState?: GlanceState) => {
			assert.ok(previewState);
			capturedStates.push(structuredClone(previewState));
			return { action: "cancel" as const };
		},
		createGitRefresher: () => ({ schedule: (_immediate?: boolean) => {}, dispose: () => {} }),
		scheduleSweepFrame: () => () => {},
		nowMs: () => {
			assert.ok(pendingNowValues.length > 0, "runtime should read injected time only at request/completion and blocking UI boundaries");
			return pendingNowValues.shift()!;
		},
	};
	return {
		runtime: createGlanceRuntime(adapters) as RuntimeRecord,
		capturedStates,
		getRemainingNowReads: () => pendingNowValues.length,
	};
}

async function captureState(runtime: RuntimeRecord, test: TestContext, capturedStates: GlanceState[]): Promise<GlanceState> {
	await runtime.commands.openPane("", test.ctx);
	const state = capturedStates.at(-1);
	assert.ok(state);
	return state;
}

function slots(state: GlanceState): GlanceState["throughput"] {
	return state.throughput;
}

function expectedTurn(elapsedMs: number, outputTokens: number): ModelSpeedExpectation {
	return { elapsedMs, outputTokens, tokensPerSecond: outputTokens / (elapsedMs / 1000) };
}

await test("message_end should expose provisional model speed with the current-run slot", async () => {
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([1_000, 2_250]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(40, {}, "stop", "basic")), test.ctx);
	const expected = expectedTurn(1_250, 40);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: expected }, "message_end should expose provisional model speed with the current-run slot");

	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: expected }, "agent_end should remain provisional because retry or continuation may still follow");

	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: expected, currentRun: null }, "agent_settled should be the only final model-speed boundary");
	assert.equal(getRemainingNowReads(), 0, "settlement should not add task wall time to model speed");
});

await test("text, tool-call and reasoning output use the full request duration without changing billing", async () => {
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([1_000, 2_500]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);

	await runtime.events.messageEnd(messageEnd(assistant(100, { reasoning: 20, totalTokens: 100 }, "toolUse", "mixed")), test.ctx);
	const expected = expectedTurn(1_500, 100);
	const state = await captureState(runtime, test, capturedStates);
	assert.deepEqual(slots(state), { lastRun: null, currentRun: expected }, "all reported output enters the request average exactly once");
	assert.deepEqual(state.usage, { input: 0, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0 }, "the billed ledger still counts the same complete provider output");
	assert.equal(getRemainingNowReads(), 0, "one completed request reads only its start and end clocks");
});

await test("runtime should exclude blocking extension UI prompt spans from provisional model speed", async () => {
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([1_000, 2_000, 5_000, 6_000]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	const renderBeforePrompt = test.getRenderRequests();
	runtime.events.uiPromptStart({ type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm", title: "Continue?" }, test.ctx);
	runtime.events.uiPromptEnd({ type: "ui_prompt_end", reason: "ui_prompt", kind: "confirm", title: "Continue?" }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(50, {}, "stop", "prompt-split")), test.ctx);
	const expected = expectedTurn(2_000, 50);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: expected }, "runtime should exclude blocking extension UI prompt spans from provisional model speed");
	assert.equal(test.getRenderRequests() - renderBeforePrompt, 1, "blocking UI spans do not invent a Glance animation or a model-speed render");
	assert.equal(getRemainingNowReads(), 0, "output updates delivered inside a UI prompt span should not consume the model-speed clock");
});

await test("failed attempt should not create trusted or provisional speed", async () => {
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 3_000, 4_000]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(5, { input: 10, cost: { total: 1 } }, "error", "failed")), test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: null }, "failed attempt should not create trusted or provisional speed");

	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(40, { input: 20, cost: { total: 2 } }, "stop", "retry-success")), test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	const state = await captureState(runtime, test, capturedStates);
	assert.deepEqual(slots(state), { lastRun: expectedTurn(1_000, 40), currentRun: null }, "successful retry should finalize only its measurable successful response");
	assert.deepEqual(state.usage, { input: 30, output: 45, cacheRead: 0, cacheWrite: 0, cost: 3 }, "billed-session usage should still include both failed and successful provider calls");
});

await test("recoverable length response should be provisional until Pi announces compaction retry", async () => {
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 2_000, 3_000, 4_000]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(100, { input: 1, cost: { total: 1 } }, "length", "truncated")), test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	assert.ok(slots(await captureState(runtime, test, capturedStates)).currentRun, "recoverable length response should be provisional until Pi announces compaction retry");

	await runtime.events.sessionCompact(
		{
			type: "session_compact",
			compactionEntry: { type: "compaction", id: "compact-1", usage: { input: 7, output: 8, cost: { total: 0.5 } } },
			fromExtension: false,
			reason: "overflow",
			willRetry: true,
		},
		test.ctx,
	);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: null }, "compaction retry should retract the truncated response speed before replacement");

	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(30, { input: 2, cost: { total: 0.3 } }, "stop", "replacement")), test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	const state = await captureState(runtime, test, capturedStates);
	assert.deepEqual(slots(state), { lastRun: expectedTurn(1_000, 30), currentRun: null }, "settled speed should contain the replacement response, not the recoverable truncated response");
	assert.deepEqual(state.usage, { input: 10, output: 138, cacheRead: 0, cacheWrite: 0, cost: 1.8 }, "complete session usage should retain truncated response, compaction, and replacement billing");
});

await test("first core run should remain provisional while a continuation can be queued", async () => {
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 2_000, 5_000, 6_000]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(20, {}, "toolUse", "first")), test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	const first = expectedTurn(1_000, 20);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: first }, "first core run should remain provisional while a continuation can be queued");

	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: first }, "queued continuation agent_start should preserve prior model calls");
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(60, {}, "stop", "second")), test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	assert.deepEqual(
		slots(await captureState(runtime, test, capturedStates)),
		{ lastRun: expectedTurn(2_000, 80), currentRun: null },
		"queued follow-up calls should aggregate under one settled-run measurement while excluding their gap",
	);
});

await test("toolResult usage and turn lifecycle alone should not synthesize model speed without assistant stream timing", async () => {
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([1_000]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	await runtime.events.messageEnd(
		messageEnd(toolResult("nested-1", { input: 4, output: 5, cacheRead: 6, cacheWrite: 7, totalTokens: 22, cost: { total: 0.8 } })),
		test.ctx,
	);
	await runtime.events.turnEnd({ type: "turn_end", turnIndex: 0, message: assistant(0), toolResults: [] }, test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	const state = await captureState(runtime, test, capturedStates);
	assert.deepEqual(slots(state), { lastRun: null, currentRun: null }, "toolResult usage and turn lifecycle alone should not synthesize model speed without assistant stream timing");
	assert.deepEqual(state.usage, { input: 4, output: 5, cacheRead: 6, cacheWrite: 7, cost: 0.8 }, "usage-bearing tools should still enter the complete billed-session ledger");
	assert.equal(getRemainingNowReads(), 1, "non-assistant and lifecycle events should not consume request clocks");
});

await test("weighted multiple requests include reasoning-only output and duration but not long tool gaps", async () => {
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([0, 3_000, 63_000, 64_000]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(80, { reasoning: 80 }, "toolUse", "reasoning-only")), test.ctx);
	await runtime.events.toolExecutionEnd({ type: "tool_execution_end" }, test.ctx);
	await runtime.events.turnStart({ type: "turn_start" }, test.ctx);
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(120, {}, "stop", "answer")), test.ctx);
	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), {
		lastRun: expectedTurn(4_000, 200), currentRun: null,
	});
	assert.equal(getRemainingNowReads(), 0);
});

await test("fresh runs and invalid settled runs clear stale rates and duplicate settlement is silent", async () => {
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([0, 4_000, 10_000, 11_000]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(120, {}, "stop", "old")), test.ctx);
	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	assert.equal(slots(await captureState(runtime, test, capturedStates)).lastRun?.tokensPerSecond, 30);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: null });
	runtime.events.providerRequest({ type: "before_provider_request", payload: {} }, test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(30, {}, "toolUse", "valid-part")), test.ctx);
	assert.ok(slots(await captureState(runtime, test, capturedStates)).currentRun);
	// Missing request hook after one valid completion invalidates the entire run.
	await runtime.events.messageEnd(messageEnd(assistant(30, {}, "stop", "missing-boundary")), test.ctx);
	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: null });
	const beforeDuplicate = test.getRenderRequests();
	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	assert.equal(test.getRenderRequests(), beforeDuplicate);
	assert.equal(getRemainingNowReads(), 0);
});

console.log("✓ runtime model-speed checks passed");
