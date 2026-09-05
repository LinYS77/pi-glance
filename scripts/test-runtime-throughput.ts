import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../config.js";
import { createGlanceRuntime } from "../runtime.js";
import type { GlanceConfig } from "../types.js";

interface TestContext {
	ctx: ExtensionCommandContext;
	getRenderRequests(): number;
}

import type { RuntimeHarnessRuntime as RuntimeRecord } from "./runtime-harness.js";
import type { ModelSpeedMeasurement as ModelSpeedExpectation, GlanceState } from "../types.js";

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

function messageUpdate(message: unknown, type: string): unknown {
	return { type: "message_update", message, assistantMessageEvent: { type } };
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
		cwd: "/repo",
		model: { id: "test-model", provider: "test-provider", contextWindow: 200_000 },
		modelRegistry: { getAvailable: () => [{ provider: "test-provider", id: "test-model" }] },
		sessionManager: {
			getCwd: () => "/repo",
			getEntries: () => [],
			getBranch: () => [],
		},
		ui: {
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
		nowMs: () => {
			assert.ok(pendingNowValues.length > 0, "runtime should read injected time only for text/tool-call output deltas");
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

function expectedTurn(startedAtMs: number, endedAtMs: number, elapsedMs: number, output: number, options: Partial<ModelSpeedExpectation["usage"]> = {}): ModelSpeedExpectation {
	return {
		startedAtMs,
		endedAtMs,
		elapsedMs,
		tokensPerSecond: output / (elapsedMs / 1000),
		usage: {
			input: options.input ?? 0,
			output,
			cacheRead: options.cacheRead ?? 0,
			cacheWrite: options.cacheWrite ?? 0,
			totalTokens: options.totalTokens ?? output,
			assistantMessages: options.assistantMessages ?? 1,
		},
	};
}

await test("message_end should expose provisional model speed with the current-run slot", async () => {
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([1_000, 2_250]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(40), "text_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(40), "text_delta"), test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(40, {}, "stop", "basic")), test.ctx);
	const expected = expectedTurn(1_000, 2_250, 1_250, 40);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: expected }, "message_end should expose provisional model speed with the current-run slot");

	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: expected }, "agent_end should remain provisional because retry or continuation may still follow");

	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: expected, currentRun: null }, "agent_settled should be the only final model-speed boundary");
	assert.equal(getRemainingNowReads(), 0, "settlement should not add task wall time to model speed");
});

await test("mixed text/tool-call output should use one aligned non-reasoning numerator and output-stream denominator", async () => {
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([1_000, 1_500, 2_000, 2_500]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	const partial = assistant(100);
	runtime.events.messageUpdate(messageUpdate(partial, "text_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(partial, "text_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(partial, "text_end"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(partial, "toolcall_start"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(partial, "toolcall_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(partial, "toolcall_delta"), test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(100, { reasoning: 20, totalTokens: 100 }, "toolUse", "mixed")), test.ctx);
	const expected = expectedTurn(1_000, 2_500, 1_500, 80, { totalTokens: 100 });
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: expected }, "mixed text/tool-call output should use one aligned non-reasoning numerator and output-stream denominator");
	assert.equal(getRemainingNowReads(), 0, "text/tool-call boundary events should not read timing clocks");
});

await test("runtime should exclude blocking extension UI prompt spans from provisional model speed", async () => {
	const test = createContext();
	const { runtime, capturedStates, getRemainingNowReads } = createRuntime([1_000, 2_000, 5_000, 6_000]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	const partial = assistant(50);
	runtime.events.messageUpdate(messageUpdate(partial, "text_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(partial, "text_delta"), test.ctx);
	const renderBeforePrompt = test.getRenderRequests();
	runtime.events.uiPromptStart({ type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm", title: "Continue?" }, test.ctx);
	runtime.events.messageUpdate(messageUpdate(partial, "text_delta"), test.ctx);
	runtime.events.uiPromptEnd({ type: "ui_prompt_end", reason: "ui_prompt", kind: "confirm", title: "Continue?" }, test.ctx);
	runtime.events.messageUpdate(messageUpdate(partial, "text_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(partial, "text_delta"), test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(50, {}, "stop", "prompt-split")), test.ctx);
	const expected = expectedTurn(1_000, 6_000, 2_000, 50);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: expected }, "runtime should exclude blocking extension UI prompt spans from provisional model speed");
	assert.equal(test.getRenderRequests() - renderBeforePrompt, 1, "UI prompt lifecycle should stay render-silent until model speed becomes visible at message_end");
	assert.equal(getRemainingNowReads(), 0, "output updates delivered inside a UI prompt span should not consume the model-speed clock");
});

await test("failed attempt should not create trusted or provisional speed", async () => {
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 2_000, 3_000, 4_000]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(5), "text_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(5), "text_delta"), test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(5, { input: 10, cost: { total: 1 } }, "error", "failed")), test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: null }, "failed attempt should not create trusted or provisional speed");

	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(40), "text_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(40), "text_delta"), test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(40, { input: 20, cost: { total: 2 } }, "stop", "retry-success")), test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	const state = await captureState(runtime, test, capturedStates);
	assert.deepEqual(slots(state), { lastRun: expectedTurn(3_000, 4_000, 1_000, 40, { input: 20 }), currentRun: null }, "successful retry should finalize only its measurable successful response");
	assert.deepEqual(state.usage, { input: 30, output: 45, cacheRead: 0, cacheWrite: 0, cost: 3 }, "billed-session usage should still include both failed and successful provider calls");
});

await test("recoverable length response should be provisional until Pi announces compaction retry", async () => {
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 2_000, 3_000, 4_000]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(100), "text_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(100), "text_delta"), test.ctx);
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
	runtime.events.messageUpdate(messageUpdate(assistant(30), "text_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(30), "text_delta"), test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(30, { input: 2, cost: { total: 0.3 } }, "stop", "replacement")), test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	const state = await captureState(runtime, test, capturedStates);
	assert.deepEqual(slots(state), { lastRun: expectedTurn(3_000, 4_000, 1_000, 30, { input: 2 }), currentRun: null }, "settled speed should contain the replacement response, not the recoverable truncated response");
	assert.deepEqual(state.usage, { input: 10, output: 138, cacheRead: 0, cacheWrite: 0, cost: 1.8 }, "complete session usage should retain truncated response, compaction, and replacement billing");
});

await test("first core run should remain provisional while a continuation can be queued", async () => {
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 2_000, 5_000, 6_000]);
	runtime.events.sessionStart({ type: "session_start" }, test.ctx);
	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(20), "text_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(20), "text_delta"), test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(20, {}, "toolUse", "first")), test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	const first = expectedTurn(1_000, 2_000, 1_000, 20);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: first }, "first core run should remain provisional while a continuation can be queued");

	runtime.events.agentStart({ type: "agent_start" }, test.ctx);
	assert.deepEqual(slots(await captureState(runtime, test, capturedStates)), { lastRun: null, currentRun: first }, "queued continuation agent_start should preserve prior model calls");
	runtime.events.messageUpdate(messageUpdate(assistant(60), "text_delta"), test.ctx);
	runtime.events.messageUpdate(messageUpdate(assistant(60), "text_delta"), test.ctx);
	await runtime.events.messageEnd(messageEnd(assistant(60, {}, "stop", "second")), test.ctx);
	await runtime.events.agentEnd({ type: "agent_end", messages: [] }, test.ctx);
	runtime.events.agentSettled({ type: "agent_settled" }, test.ctx);
	assert.deepEqual(
		slots(await captureState(runtime, test, capturedStates)),
		{ lastRun: expectedTurn(1_000, 6_000, 2_000, 80, { totalTokens: 80, assistantMessages: 2 }), currentRun: null },
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
	assert.equal(getRemainingNowReads(), 1, "non-assistant and lifecycle events should not consume model-stream clocks");
});

console.log("✓ runtime model-speed checks passed");
