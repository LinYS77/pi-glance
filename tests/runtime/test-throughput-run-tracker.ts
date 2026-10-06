import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ModelSpeedRunTracker, type ModelSpeedClock, type ModelSpeedStateIntent } from "../../src/runtime/throughput-run-tracker.js";
import type { ModelSpeedMeasurement, ModelSpeedUsage } from "../../src/types.js";

function assistant(output: number, extras: Record<string, unknown> = {}, stopReason = "stop", responseId?: string): unknown {
	return { role: "assistant", responseId, stopReason, usage: { output, totalTokens: output, ...extras } };
}
const clock = (value: number): ModelSpeedClock => () => value;
const throwingClock: ModelSpeedClock = () => { throw new Error("this path must not read the clock"); };
const unknownFinal = { kind: "set-last-run-and-clear-current-run", lastRun: null };
function measurement(startedAtMs: number, endedAtMs: number, elapsedMs: number, output: number, options: Partial<ModelSpeedUsage> = {}): ModelSpeedMeasurement {
	return {
		startedAtMs, endedAtMs, elapsedMs, tokensPerSecond: output / (elapsedMs / 1000),
		usage: { input: 0, output, cacheRead: 0, cacheWrite: 0, totalTokens: output, assistantMessages: 1, ...options },
	};
}
function expectCurrent(intent: ModelSpeedStateIntent, expected: ModelSpeedMeasurement): void {
	assert.deepEqual(intent, { kind: "set-current-run", currentRun: expected });
}
function expectFinal(run: ModelSpeedRunTracker, expected: ModelSpeedMeasurement): void {
	assert.deepEqual(run.settle(), { kind: "set-last-run-and-clear-current-run", lastRun: expected });
}
function response(run: ModelSpeedRunTracker, message: unknown, start: number, end: number): ModelSpeedStateIntent {
	run.requestStart(clock(start));
	return run.messageEnd(message, clock(end));
}

await test("fresh agent_start clears both rate slots; continuation preserves completed calls", () => {
	const run = new ModelSpeedRunTracker();
	assert.deepEqual(run.start(), unknownFinal);
	assert.deepEqual(run.start(), { kind: "none" });
	response(run, assistant(40), 1_000, 2_250);
	expectFinal(run, measurement(1_000, 2_250, 1_250, 40));
	assert.deepEqual(run.start(), unknownFinal);
});

await test("events outside a run and non-assistant events ignore the clock", () => {
	const run = new ModelSpeedRunTracker();
	run.requestStart(throwingClock);
	assert.deepEqual(run.messageUpdate(assistant(40), { type: "text_delta" }, throwingClock), { kind: "none" });
	assert.deepEqual(run.messageEnd(assistant(40), throwingClock), { kind: "none" });
	run.start();
	assert.deepEqual(run.messageEnd({ role: "user" }, throwingClock), { kind: "none" });
});

await test("message_end is provisional and only settle finalizes; duplicate settle is harmless", () => {
	const run = new ModelSpeedRunTracker(); run.start();
	const expected = measurement(1_000, 2_250, 1_250, 40);
	expectCurrent(response(run, assistant(40, {}, "stop", "basic"), 1_000, 2_250), expected);
	expectFinal(run, expected);
	assert.deepEqual(run.settle(), { kind: "clear-current-run" });
});

await test("initial latency, thinking and chunk bursts are included, independent of chunk count", () => {
	for (const chunks of [[], [4_999], [1_500, 2_000, 4_998, 4_999]]) {
		const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(1_000));
		const message = assistant(140, { reasoning: 20 }, "toolUse", "burst");
		for (const type of ["thinking_start", "thinking_delta", "thinking_end", "text_end", "toolcall_start"]) {
			assert.deepEqual(run.messageUpdate(message, { type }, throwingClock), { kind: "none" });
		}
		for (const at of chunks) {
			run.messageUpdate(message, { type: "text_delta" }, clock(at));
			run.messageUpdate(message, { type: "toolcall_delta" }, clock(at));
		}
		expectCurrent(run.messageEnd(message, clock(5_000)), measurement(1_000, 5_000, 4_000, 120, { totalTokens: 140 }));
		expectFinal(run, measurement(1_000, 5_000, 4_000, 120, { totalTokens: 140 }));
	}
});

await test("thinking between output spans still contributes full request time", () => {
	const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(1_000));
	for (const type of ["text_delta", "thinking_delta", "text_delta"]) run.messageUpdate(assistant(50), { type }, throwingClock);
	expectCurrent(run.messageEnd(assistant(50), clock(6_000)), measurement(1_000, 6_000, 5_000, 50));
});

await test("zero or one toolcall delta works using final provider usage", () => {
	for (const count of [0, 1]) {
		const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(0));
		const message = { ...(assistant(120, {}, "toolUse") as object),
			content: [{ type: "toolCall", id: "tool-1", name: "example", arguments: {} }] };
		for (let i = 0; i < count; i++) run.messageUpdate(message, { type: "toolcall_delta" }, throwingClock);
		expectCurrent(run.messageEnd(message, clock(4_000)), measurement(0, 4_000, 4_000, 120));
	}
});

await test("blocking UI pauses exclude only the prompt span; duplicate boundaries are coalesced", () => {
	const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(1_000));
	run.uiPromptEnd(throwingClock);
	run.uiPromptStart(clock(2_000)); run.uiPromptStart(throwingClock);
	run.messageUpdate(assistant(50), { type: "text_delta" }, throwingClock);
	run.uiPromptEnd(clock(5_000)); run.uiPromptEnd(throwingClock);
	expectCurrent(run.messageEnd(assistant(50), clock(6_000)), measurement(1_000, 6_000, 2_000, 50));
});

await test("a request under a pre-opened prompt starts active timing only at resume", () => {
	const run = new ModelSpeedRunTracker(); run.uiPromptStart(throwingClock); run.start();
	run.requestStart(clock(1_000)); run.uiPromptEnd(clock(61_000));
	expectCurrent(run.messageEnd(assistant(120), clock(65_000)), measurement(1_000, 65_000, 4_000, 120));
});

await test("completion while UI is paused excludes the remaining paused span", () => {
	const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(0));
	run.uiPromptStart(clock(1_000));
	expectCurrent(run.messageEnd(assistant(30), clock(61_000)), measurement(0, 61_000, 1_000, 30));
});

await test("weighted continuation average excludes long tool gaps rather than averaging rates", () => {
	const run = new ModelSpeedRunTracker(); run.start();
	response(run, assistant(60, {}, "toolUse", "first"), 0, 1_000);
	assert.deepEqual(run.start(), { kind: "none" });
	const expected = measurement(0, 64_000, 4_000, 120, { assistantMessages: 2 });
	expectCurrent(response(run, assistant(60, {}, "stop", "second"), 61_000, 64_000), expected);
	expectFinal(run, expected);
});

await test("reasoning-only requests contribute their full durations to the denominator", () => {
	const run = new ModelSpeedRunTracker(); run.start();
	assert.deepEqual(response(run, assistant(80, { reasoning: 80 }, "stop", "thinking"), 0, 3_000), { kind: "clear-current-run" });
	const expected = measurement(0, 5_000, 4_000, 120, { totalTokens: 200, assistantMessages: 2 });
	expectCurrent(response(run, assistant(120, {}, "stop", "answer"), 4_000, 5_000), expected);
	expectFinal(run, expected);
});

await test("retry excludes the failed request and backoff but retains earlier completed requests", () => {
	const run = new ModelSpeedRunTracker(); run.start();
	response(run, assistant(20, {}, "toolUse", "before-retry"), 1_000, 2_000);
	assert.deepEqual(response(run, assistant(5, {}, "error", "failed"), 3_000, 4_000), { kind: "clear-current-run" });
	assert.deepEqual(run.start(), { kind: "none" });
	const expected = measurement(1_000, 64_000, 2_000, 80, { assistantMessages: 2 });
	expectCurrent(response(run, assistant(60, {}, "stop", "recovered"), 63_000, 64_000), expected);
	expectFinal(run, expected);
});

await test("compaction retry retracts length response without counting summary/backoff", () => {
	const run = new ModelSpeedRunTracker(); run.start();
	response(run, assistant(10, {}, "toolUse", "first"), 1_000, 2_000);
	response(run, assistant(100, {}, "length", "truncated"), 3_000, 4_000);
	assert.deepEqual(run.compactionRetry(false), { kind: "none" });
	expectCurrent(run.compactionRetry(true), measurement(1_000, 2_000, 1_000, 10));
	run.start(); response(run, assistant(30, {}, "stop", "replacement"), 65_000, 66_000);
	expectFinal(run, measurement(1_000, 66_000, 2_000, 40, { assistantMessages: 2 }));
});

await test("unrecovered errors or aborts clear final and provisional rates", () => {
	for (const reason of ["error", "aborted"]) {
		const run = new ModelSpeedRunTracker(); run.start();
		response(run, assistant(20), 0, 1_000);
		assert.deepEqual(response(run, assistant(5, {}, reason), 2_000, 3_000), { kind: "clear-current-run" });
		assert.deepEqual(run.settle(), unknownFinal);
	}
});

await test("missing request boundary stays unknown even with deltas or earlier valid requests", () => {
	const run = new ModelSpeedRunTracker(); run.start(); response(run, assistant(30), 0, 1_000);
	run.messageUpdate(assistant(20), { type: "text_delta" }, throwingClock);
	assert.deepEqual(run.messageEnd(assistant(20), throwingClock), { kind: "clear-current-run" });
	assert.deepEqual(run.settle(), unknownFinal);
});

await test("duplicate response IDs or identical objects never add samples or consume clocks", () => {
	for (const hasId of [true, false]) {
		const run = new ModelSpeedRunTracker(); run.start();
		const message = assistant(20, {}, "stop", hasId ? "dedupe" : undefined);
		response(run, message, 1_000, 2_000);
		assert.deepEqual(run.messageEnd(hasId ? { ...(message as object) } : message, throwingClock), { kind: "none" });
		expectFinal(run, measurement(1_000, 2_000, 1_000, 20));
	}
});

await test("repeated pre-request callback retains the earliest boundary", () => {
	const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(0)); run.requestStart(throwingClock);
	expectCurrent(run.messageEnd(assistant(120), clock(4_000)), measurement(0, 4_000, 4_000, 120));
});

await test("invalid clocks, zero or reversed durations invalidate the run", () => {
	for (const [start, end] of [[1, 1], [2, 1], [Number.NaN, 4_000], [0, Infinity]]) {
		const run = new ModelSpeedRunTracker(); run.start();
		assert.deepEqual(response(run, assistant(20), start, end), { kind: "clear-current-run" });
		assert.deepEqual(run.settle(), unknownFinal);
	}
	const regressedRun = new ModelSpeedRunTracker(); regressedRun.start();
	response(regressedRun, assistant(20), 1_000, 2_000);
	assert.deepEqual(response(regressedRun, assistant(20), 1_500, 2_500), { kind: "clear-current-run" });
	assert.deepEqual(regressedRun.settle(), unknownFinal);
	const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(0));
	run.uiPromptStart(clock(2_000)); run.uiPromptEnd(clock(1_000));
	assert.deepEqual(run.messageEnd(assistant(20), clock(4_000)), { kind: "clear-current-run" });
	assert.deepEqual(run.settle(), unknownFinal);
});

await test("invalid/missing provider output cannot be replaced by content estimates", () => {
	for (const usage of [undefined, {}, { output: NaN }, { output: -1 }, { output: 20, reasoning: Infinity }]) {
		const run = new ModelSpeedRunTracker(); run.start();
		assert.deepEqual(response(run, { role: "assistant", content: [{ type: "text", text: "not tokens" }], usage }, 0, 4_000), { kind: "clear-current-run" });
		assert.deepEqual(run.settle(), unknownFinal);
	}
});

await test("unfinished request cannot settle an earlier provisional aggregate", () => {
	const run = new ModelSpeedRunTracker(); run.start(); response(run, assistant(30), 0, 1_000);
	run.requestStart(clock(2_000));
	assert.deepEqual(run.settle(), unknownFinal);
});

await test("reset clears lifecycle and UI pause without publishing a visible intent", () => {
	const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(0)); run.uiPromptStart(clock(1));
	assert.deepEqual(run.reset(), { kind: "none" });
	assert.deepEqual(run.messageEnd(assistant(20), throwingClock), { kind: "none" });
	assert.deepEqual(run.settle(), { kind: "clear-current-run" });
	run.start(); response(run, assistant(20), 1_000, 2_000);
	expectFinal(run, measurement(1_000, 2_000, 1_000, 20));
});

console.log("✓ model-speed run tracker checks passed");
