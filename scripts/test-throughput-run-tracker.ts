import { strict as assert } from "node:assert";
import type { ThroughputClock, ThroughputRunStateIntent as ExportedThroughputRunStateIntent } from "../throughput-run-tracker.js";

interface TurnThroughputExpectation {
	startedAtMs: number;
	endedAtMs: number;
	elapsedMs: number;
	tokensPerSecond: number;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
		assistantMessages: number;
	};
}

type ThroughputRunStateIntent =
	| { kind: "none" }
	| { kind: "set-current-run"; currentRun: TurnThroughputExpectation }
	| { kind: "clear-current-run" }
	| { kind: "set-last-turn-and-clear-current-run"; lastTurn: TurnThroughputExpectation };

interface ThroughputRunTrackerInstance {
	start(): ThroughputRunStateIntent;
	messageUpdate(message: unknown, assistantMessageEvent: unknown, nowMs: ThroughputClock): ThroughputRunStateIntent;
	messageEnd(message: unknown): ThroughputRunStateIntent;
	finish(messages: unknown): ThroughputRunStateIntent;
	reset(): ThroughputRunStateIntent;
}

const _typeExportCheck: ExportedThroughputRunStateIntent = { kind: "none" };
assert.equal(_typeExportCheck.kind, "none", "ThroughputRunStateIntent should remain a compile-time-only export");

let trackerModule: Record<string, unknown>;
try {
	trackerModule = (await import("../throughput-run-tracker.js")) as Record<string, unknown>;
} catch (error) {
	assert.fail(`throughput-run-tracker.ts should export ThroughputRunTracker; import failed: ${(error as Error).message}`);
}

assert.equal(typeof trackerModule.ThroughputRunTracker, "function", "throughput-run-tracker.ts should export ThroughputRunTracker");
const ThroughputRunTracker = trackerModule.ThroughputRunTracker as new () => ThroughputRunTrackerInstance;

function tracker(): ThroughputRunTrackerInstance {
	return new ThroughputRunTracker();
}

function assistant(output: number, extras: Record<string, unknown> = {}, stopReason = "stop"): unknown {
	return { role: "assistant", stopReason, usage: { output, totalTokens: output, ...extras } };
}

function user(): unknown {
	return { role: "user", usage: { output: 99 } };
}

function textDelta(): unknown {
	return { type: "text_delta" };
}

function thinkingDelta(): unknown {
	return { type: "thinking_delta" };
}

function clock(value: number): ThroughputClock {
	return () => value;
}

function throwingClock(message = "tracker should not read the clock on this path"): ThroughputClock {
	return () => {
		throw new Error(message);
	};
}

function expectTurn(actual: TurnThroughputExpectation, expected: TurnThroughputExpectation, message: string): void {
	assert.deepEqual(actual, expected, message);
}

function expectCurrent(intent: ThroughputRunStateIntent, expected: TurnThroughputExpectation, message: string): void {
	assert.equal(intent.kind, "set-current-run", message);
	expectTurn((intent as Extract<ThroughputRunStateIntent, { kind: "set-current-run" }>).currentRun, expected, message);
}

function expectFinal(intent: ThroughputRunStateIntent, expected: TurnThroughputExpectation, message: string): void {
	assert.equal(intent.kind, "set-last-turn-and-clear-current-run", message);
	expectTurn((intent as Extract<ThroughputRunStateIntent, { kind: "set-last-turn-and-clear-current-run" }>).lastTurn, expected, message);
}

{
	const run = tracker();
	assert.deepEqual(run.start(), { kind: "clear-current-run" }, "start should reset model-stream lifecycle state");
}

{
	const run = tracker();
	assert.deepEqual(run.messageUpdate(assistant(40), textDelta(), throwingClock()), { kind: "none" }, "updates before start should be ignored without reading the clock");
}

{
	const run = tracker();
	run.start();
	assert.deepEqual(run.messageUpdate(user(), textDelta(), throwingClock()), { kind: "none" }, "non-assistant updates should be ignored without reading the clock");
	assert.deepEqual(run.messageUpdate(assistant(40), thinkingDelta(), throwingClock()), { kind: "none" }, "thinking updates should be ignored without reading the clock");
	run.messageUpdate(assistant(40), textDelta(), clock(1_000));
	run.messageUpdate(assistant(40), textDelta(), clock(2_250));
	expectCurrent(
		run.messageEnd(assistant(40)),
		{
			startedAtMs: 1_000,
			endedAtMs: 2_250,
			elapsedMs: 1_250,
			tokensPerSecond: 32,
			usage: {
				input: 0,
				output: 40,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 40,
				assistantMessages: 1,
			},
		},
		"completed assistant text stream should set a provisional model-speed measurement",
	);
}

{
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	run.messageUpdate(assistant(20), textDelta(), clock(2_000));
	run.messageEnd(assistant(20));
	run.messageUpdate(assistant(60, { input: 7, cacheWrite: 5 }), textDelta(), clock(4_000));
	run.messageUpdate(assistant(60, { input: 7, cacheWrite: 5 }), textDelta(), clock(5_000));
	expectCurrent(
		run.messageEnd(assistant(60, { input: 7, cacheWrite: 5 })),
		{
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
		"multiple assistant text streams should exclude the gap between model calls from the denominator",
	);
}

{
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(100, { reasoning: 60, totalTokens: 100 }), textDelta(), clock(1_000));
	run.messageUpdate(assistant(100, { reasoning: 60, totalTokens: 100 }), textDelta(), clock(2_000));
	expectCurrent(
		run.messageEnd(assistant(100, { reasoning: 60, totalTokens: 100 })),
		{
			startedAtMs: 1_000,
			endedAtMs: 2_000,
			elapsedMs: 1_000,
			tokensPerSecond: 40,
			usage: {
				input: 0,
				output: 40,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 100,
				assistantMessages: 1,
			},
		},
		"reasoning tokens should be excluded from visible model-speed output",
	);
}

{
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(50), textDelta(), clock(1_000));
	run.messageUpdate(assistant(50), textDelta(), clock(2_000));
	assert.deepEqual(run.messageUpdate(assistant(50), thinkingDelta(), throwingClock()), { kind: "none" }, "thinking gaps should close text timing without reading the clock");
	run.messageUpdate(assistant(50), textDelta(), clock(5_000));
	run.messageUpdate(assistant(50), textDelta(), clock(6_000));
	expectCurrent(
		run.messageEnd(assistant(50)),
		{
			startedAtMs: 1_000,
			endedAtMs: 6_000,
			elapsedMs: 2_000,
			tokensPerSecond: 25,
			usage: {
				input: 0,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 50,
				assistantMessages: 1,
			},
		},
		"thinking intervals between text deltas should be excluded from the denominator",
	);
}

{
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	run.messageUpdate(assistant(20), textDelta(), clock(2_000));
	run.messageEnd(assistant(20));
	expectFinal(
		run.finish([assistant(20)]),
		{
			startedAtMs: 1_000,
			endedAtMs: 2_000,
			elapsedMs: 1_000,
			tokensPerSecond: 20,
			usage: {
				input: 0,
				output: 20,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 20,
				assistantMessages: 1,
			},
		},
		"finish should finalize completed text streams without reading task wall-clock time",
	);
	assert.deepEqual(run.finish([assistant(1)]), { kind: "clear-current-run" }, "finish after reset should be a no-op");
}

{
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	run.messageUpdate(assistant(20), textDelta(), clock(2_000));
	assert.deepEqual(run.messageEnd(assistant(20, {}, "error")), { kind: "clear-current-run" }, "an errored final assistant stream should hide the provisional measurement");
	assert.deepEqual(run.finish([assistant(20, {}, "error")]), { kind: "clear-current-run" }, "an errored final stream should not produce a trusted final measurement");
}

{
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	run.messageUpdate(assistant(20), textDelta(), clock(2_000));
	assert.deepEqual(run.reset(), { kind: "none" }, "reset should clear model-stream state only");
	assert.deepEqual(run.messageEnd(assistant(20)), { kind: "none" }, "messageEnd after reset should be ignored");
	assert.deepEqual(run.finish([assistant(20)]), { kind: "clear-current-run" }, "finish after reset should clear currentRun only");
}

console.log("✓ model-speed tracker checks passed");
