import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ModelSpeedRunTracker, type ModelSpeedClock, type ModelSpeedStateIntent } from "../../src/runtime/throughput-run-tracker.js";
import type { ModelSpeedMeasurement } from "../../src/types.js";

function assistant(output: number, extras: Record<string, unknown> = {}, stopReason = "stop", responseId?: string): unknown {
	return { role: "assistant", responseId, stopReason, usage: { output, totalTokens: output, ...extras } };
}
const clock = (value: number): ModelSpeedClock => () => value;
const throwingClock: ModelSpeedClock = () => { throw new Error("this path must not read the clock"); };
const unknownFinal = { kind: "set-last-run-and-clear-current-run", lastRun: null };
function measurement(elapsedMs: number, outputTokens: number): ModelSpeedMeasurement {
	return { elapsedMs, outputTokens, tokensPerSecond: outputTokens / (elapsedMs / 1000) };
}
function expectCurrent(intent: ModelSpeedStateIntent, expected: ModelSpeedMeasurement): void {
	assert.deepEqual(intent, { kind: "set-current-run", currentRun: expected });
}
function expectFinal(run: ModelSpeedRunTracker, expected: ModelSpeedMeasurement): void {
	assert.deepEqual(run.settle(), { kind: "set-last-run-and-clear-current-run", lastRun: expected });
}
function response(run: ModelSpeedRunTracker, message: unknown, start: number, end: number): ModelSpeedStateIntent {
	run.turnStart();
	run.requestStart(clock(start));
	return run.messageEnd(message, clock(end));
}

await test("reasoning metadata does not change or invalidate reported output throughput", () => {
	for (const reasoning of [undefined, 0, 900, 1_000, 1_001, -1, Number.NaN, Infinity, "900", null]) {
		const run = new ModelSpeedRunTracker(); run.start();
		const expected = measurement(10_000, 1_000);
		expectCurrent(response(run, assistant(1_000, { reasoning }), 0, 10_000), expected);
		expectFinal(run, expected);
	}
});

await test("fresh agent_start clears both rate slots; continuation preserves completed calls", () => {
	const run = new ModelSpeedRunTracker();
	assert.deepEqual(run.start(), unknownFinal);
	assert.deepEqual(run.start(), { kind: "none" });
	response(run, assistant(40), 1_000, 2_250);
	expectFinal(run, measurement(1_250, 40));
	assert.deepEqual(run.start(), unknownFinal);
});

await test("events outside a run and non-assistant events ignore the clock", () => {
	const run = new ModelSpeedRunTracker();
	run.requestStart(throwingClock);
	assert.deepEqual(run.messageEnd(assistant(40), throwingClock), { kind: "none" });
	run.start();
	assert.deepEqual(run.messageEnd({ role: "user" }, throwingClock), { kind: "none" });
});

await test("message_end is provisional and only settle finalizes; duplicate settle is harmless", () => {
	const run = new ModelSpeedRunTracker(); run.start();
	const expected = measurement(1_250, 40);
	expectCurrent(response(run, assistant(40, {}, "stop", "basic"), 1_000, 2_250), expected);
	expectFinal(run, expected);
	assert.deepEqual(run.settle(), { kind: "clear-current-run" });
});

await test("blocking UI pauses exclude only the prompt span; duplicate boundaries are coalesced", () => {
	const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(1_000));
	run.uiPromptEnd(throwingClock);
	run.uiPromptStart(clock(2_000)); run.uiPromptStart(throwingClock);
	run.uiPromptEnd(clock(5_000)); run.uiPromptEnd(throwingClock);
	expectCurrent(run.messageEnd(assistant(50), clock(6_000)), measurement(2_000, 50));
});

await test("a request under a pre-opened prompt starts active timing only at resume", () => {
	const run = new ModelSpeedRunTracker(); run.uiPromptStart(throwingClock); run.start();
	run.requestStart(clock(1_000)); run.uiPromptEnd(clock(61_000));
	expectCurrent(run.messageEnd(assistant(120), clock(65_000)), measurement(4_000, 120));
});

await test("completion while UI is paused excludes the remaining paused span", () => {
	const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(0));
	run.uiPromptStart(clock(1_000));
	expectCurrent(run.messageEnd(assistant(30), clock(61_000)), measurement(1_000, 30));
});

await test("weighted continuation average excludes long tool gaps rather than averaging rates", () => {
	const run = new ModelSpeedRunTracker(); run.start();
	response(run, assistant(60, {}, "toolUse", "first"), 0, 1_000);
	assert.deepEqual(run.start(), { kind: "none" });
	const expected = measurement(4_000, 120);
	expectCurrent(response(run, assistant(60, {}, "stop", "second"), 61_000, 64_000), expected);
	expectFinal(run, expected);
});

await test("session-level retry excludes the failed request and backoff but retains earlier completed requests", () => {
	const run = new ModelSpeedRunTracker(); run.start();
	response(run, assistant(20, {}, "toolUse", "before-retry"), 1_000, 2_000);
	assert.deepEqual(response(run, assistant(5, {}, "error", "failed"), 3_000, 4_000), { kind: "clear-current-run" });
	assert.deepEqual(run.start(), { kind: "none" });
	const expected = measurement(2_000, 80);
	expectCurrent(response(run, assistant(60, {}, "stop", "recovered"), 63_000, 64_000), expected);
	expectFinal(run, expected);
});

await test("compaction retry retracts length response without counting summary/backoff", () => {
	const run = new ModelSpeedRunTracker(); run.start();
	response(run, assistant(10, {}, "toolUse", "first"), 1_000, 2_000);
	response(run, assistant(100, {}, "length", "truncated"), 3_000, 4_000);
	assert.deepEqual(run.compactionRetry(false), { kind: "none" });
	expectCurrent(run.compactionRetry(true), measurement(1_000, 10));
	run.start(); response(run, assistant(30, {}, "stop", "replacement"), 65_000, 66_000);
	expectFinal(run, measurement(2_000, 40));
});

await test("unrecovered errors or aborts clear final and provisional rates", () => {
	for (const reason of ["error", "aborted"]) {
		const run = new ModelSpeedRunTracker(); run.start();
		response(run, assistant(20), 0, 1_000);
		assert.deepEqual(response(run, assistant(5, {}, reason), 2_000, 3_000), { kind: "clear-current-run" });
		assert.deepEqual(run.settle(), unknownFinal);
	}
});

await test("missing request boundary invalidates earlier valid requests", () => {
	const run = new ModelSpeedRunTracker(); run.start(); response(run, assistant(30), 0, 1_000);
	assert.deepEqual(run.messageEnd(assistant(20), throwingClock), { kind: "clear-current-run" });
	assert.deepEqual(run.settle(), unknownFinal);
});

await test("duplicate response IDs or identical objects never add samples or consume clocks", () => {
	for (const hasId of [true, false]) {
		const run = new ModelSpeedRunTracker(); run.start();
		const message = assistant(20, {}, "stop", hasId ? "dedupe" : undefined);
		response(run, message, 1_000, 2_000);
		assert.deepEqual(run.messageEnd(hasId ? { ...(message as object) } : message, throwingClock), { kind: "none" });
		expectFinal(run, measurement(1_000, 20));
	}
});

await test("ambiguous overlapping request callbacks show unknown rather than guessing a boundary", () => {
	const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(0)); run.requestStart(throwingClock);
	assert.deepEqual(run.messageEnd(assistant(120), clock(4_000)), { kind: "clear-current-run" });
	assert.deepEqual(run.settle(), unknownFinal);
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
	for (const usage of [undefined, {}, { output: NaN }, { output: -1 }, { output: Infinity }, { output: "20" }]) {
		const run = new ModelSpeedRunTracker(); run.start();
		assert.deepEqual(response(run, { role: "assistant", content: [{ type: "text", text: "not tokens" }], usage }, 0, 4_000), { kind: "clear-current-run" });
		assert.deepEqual(run.settle(), unknownFinal);
	}
});

await test("unfinished request cannot settle an earlier provisional aggregate", () => {
	const run = new ModelSpeedRunTracker(); run.start(); response(run, assistant(30), 0, 1_000);
	run.turnStart(); run.requestStart(clock(2_000));
	assert.deepEqual(run.settle(), unknownFinal);
});

await test("reset clears lifecycle and UI pause without publishing a visible intent", () => {
	const run = new ModelSpeedRunTracker(); run.start(); run.requestStart(clock(0)); run.uiPromptStart(clock(1));
	run.reset();
	assert.deepEqual(run.messageEnd(assistant(20), throwingClock), { kind: "none" });
	assert.deepEqual(run.settle(), { kind: "clear-current-run" });
	run.start(); response(run, assistant(20), 1_000, 2_000);
	expectFinal(run, measurement(1_000, 20));
});

console.log("✓ model-speed run tracker checks passed");
