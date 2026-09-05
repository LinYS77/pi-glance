import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ModelSpeedRunTracker, type ModelSpeedClock, type ModelSpeedStateIntent } from "../src/runtime/throughput-run-tracker.js";
import type { ModelSpeedMeasurement as ModelSpeedExpectation, ModelSpeedUsage as ThroughputUsageExpectation } from "../src/types.js";

function tracker(): ModelSpeedRunTracker {
	return new ModelSpeedRunTracker();
}

function assistant(output: number, extras: Record<string, unknown> = {}, stopReason = "stop", responseId?: string): unknown {
	return {
		role: "assistant",
		responseId,
		stopReason,
		usage: { output, totalTokens: output, ...extras },
	};
}

function user(): unknown {
	return { role: "user" };
}

function textDelta(): unknown {
	return { type: "text_delta" };
}

function toolCallDelta(): unknown {
	return { type: "toolcall_delta" };
}

function thinkingDelta(): unknown {
	return { type: "thinking_delta" };
}

function event(type: string): unknown {
	return { type };
}

function clock(value: number): ModelSpeedClock {
	return () => value;
}

function throwingClock(message = "tracker should not read the clock on this path"): ModelSpeedClock {
	return () => {
		throw new Error(message);
	};
}

function measurement(startedAtMs: number, endedAtMs: number, elapsedMs: number, output: number, options: Partial<ThroughputUsageExpectation> = {}): ModelSpeedExpectation {
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

function expectCurrent(intent: ModelSpeedStateIntent, expected: ModelSpeedExpectation, message: string): void {
	assert.equal(intent.kind, "set-current-run", message);
	assert.deepEqual((intent as Extract<ModelSpeedStateIntent, { kind: "set-current-run" }>).currentRun, expected, message);
}

function expectFinal(intent: ModelSpeedStateIntent, expected: ModelSpeedExpectation, message: string): void {
	assert.equal(intent.kind, "set-last-run-and-clear-current-run", message);
	assert.deepEqual((intent as Extract<ModelSpeedStateIntent, { kind: "set-last-run-and-clear-current-run" }>).lastRun, expected, message);
}

await test("first agent_start should begin one logical settled run", async () => {
	const run = tracker();
	assert.deepEqual(run.start(), { kind: "clear-current-run" }, "first agent_start should begin one logical settled run");
	assert.deepEqual(run.start(), { kind: "none" }, "retry or queued-continuation agent_start should resume rather than reset the logical run");
});

await test("updates before agent_start should be ignored without clock reads", async () => {
	const run = tracker();
	assert.deepEqual(run.messageUpdate(assistant(40), textDelta(), throwingClock()), { kind: "none" }, "updates before agent_start should be ignored without clock reads");
	assert.deepEqual(run.messageUpdate(user(), textDelta(), throwingClock()), { kind: "none" }, "non-assistant updates should be ignored without clock reads");
});

await test("duplicate settle after reset should only clear provisional state", async () => {
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(40), textDelta(), clock(1_000));
	run.messageUpdate(assistant(40), textDelta(), clock(2_250));
	const expected = measurement(1_000, 2_250, 1_250, 40);
	expectCurrent(run.messageEnd(assistant(40, {}, "stop", "basic")), expected, "message_end should publish a provisional model-speed checkpoint");
	expectFinal(run.settle(), expected, "agent_settled should promote the checkpoint to the trusted final value");
	assert.deepEqual(run.settle(), { kind: "clear-current-run" }, "duplicate settle after reset should only clear provisional state");
});

await test("text boundaries should not require clock reads", async () => {
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(100), textDelta(), clock(1_000));
	run.messageUpdate(assistant(100), textDelta(), clock(1_500));
	assert.deepEqual(run.messageUpdate(assistant(100), event("text_end"), throwingClock()), { kind: "none" }, "text boundaries should not require clock reads");
	assert.deepEqual(run.messageUpdate(assistant(100), event("toolcall_start"), throwingClock()), { kind: "none" }, "tool-call boundaries should not require clock reads");
	run.messageUpdate(assistant(100), toolCallDelta(), clock(2_000));
	run.messageUpdate(assistant(100), toolCallDelta(), clock(2_500));
	expectCurrent(
		run.messageEnd(assistant(100, { reasoning: 20, totalTokens: 100 }, "toolUse", "mixed")),
		measurement(1_000, 2_500, 1_500, 80, { totalTokens: 100 }),
		"mixed text/tool-call responses should time both non-reasoning output forms and subtract reported reasoning",
	);
});

await test("thinking events should close output timing without reading their content or a clock", async () => {
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(50), textDelta(), clock(1_000));
	run.messageUpdate(assistant(50), textDelta(), clock(2_000));
	assert.deepEqual(run.messageUpdate(assistant(50), thinkingDelta(), throwingClock()), { kind: "none" }, "thinking events should close output timing without reading their content or a clock");
	run.messageUpdate(assistant(50), textDelta(), clock(5_000));
	run.messageUpdate(assistant(50), textDelta(), clock(6_000));
	expectCurrent(
		run.messageEnd(assistant(50, {}, "stop", "split")),
		measurement(1_000, 6_000, 2_000, 50),
		"reasoning intervals between visible output spans should be excluded from active output time",
	);
});

{
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(50), textDelta(), clock(1_000));
	run.messageUpdate(assistant(50), textDelta(), clock(2_000));
	run.uiPromptStart();
	run.messageUpdate(assistant(50), textDelta(), throwingClock("output delivered while a UI prompt is active should not be timed"));
	run.uiPromptStart();
	run.uiPromptEnd();
	run.messageUpdate(assistant(50), textDelta(), clock(5_000));
	run.messageUpdate(assistant(50), textDelta(), clock(6_000));
	expectCurrent(
		run.messageEnd(assistant(50, {}, "stop", "prompt-split")),
		measurement(1_000, 6_000, 2_000, 50),
		"blocking extension UI prompt spans should be excluded from active output time",
	);
}

{
	const run = tracker();
	run.uiPromptStart();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), throwingClock("a prompt opened before agent_start should still pause model-speed timing"));
	run.uiPromptEnd();
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	run.messageUpdate(assistant(20), textDelta(), clock(2_000));
	expectCurrent(
		run.messageEnd(assistant(20, {}, "stop", "pre-opened-prompt")),
		measurement(1_000, 2_000, 1_000, 20),
		"agent runs begun under an existing UI prompt should remain paused until ui_prompt_end",
	);
}

{
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(30), toolCallDelta(), clock(1_000));
	run.messageUpdate(assistant(30), toolCallDelta(), clock(2_000));
	expectCurrent(
		run.messageEnd(assistant(30, {}, "toolUse", "tool-only")),
		measurement(1_000, 2_000, 1_000, 30),
		"tool-call-only responses should have defined model speed when tool-call deltas are measurable",
	);
}

await test("queued continuation should not reset completed model calls", async () => {
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	run.messageUpdate(assistant(20), textDelta(), clock(2_000));
	run.messageEnd(assistant(20, {}, "toolUse", "first-call"));
	assert.deepEqual(run.start(), { kind: "none" }, "queued continuation should not reset completed model calls");
	run.messageUpdate(assistant(60), textDelta(), clock(5_000));
	run.messageUpdate(assistant(60), textDelta(), clock(6_000));
	const expected = measurement(1_000, 6_000, 2_000, 80, { totalTokens: 80, assistantMessages: 2 });
	expectCurrent(run.messageEnd(assistant(60, {}, "stop", "second-call")), expected, "continuations should aggregate calls but exclude inter-call waiting");
	expectFinal(run.settle(), expected, "queued follow-ups should finalize only at the one agent_settled boundary");
});

await test("a failed attempt should clear the provisional aggregate while retry status is unresolved", async () => {
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	run.messageUpdate(assistant(20), textDelta(), clock(2_000));
	run.messageEnd(assistant(20, {}, "toolUse", "pre-retry"));
	run.messageUpdate(assistant(5), textDelta(), clock(3_000));
	run.messageUpdate(assistant(5), textDelta(), clock(4_000));
	assert.deepEqual(run.messageEnd(assistant(5, {}, "error", "failed")), { kind: "clear-current-run" }, "a failed attempt should clear the provisional aggregate while retry status is unresolved");
	assert.deepEqual(run.start(), { kind: "none" }, "automatic retry agent_start should resume accumulated successful calls");
	run.messageUpdate(assistant(60), textDelta(), clock(5_000));
	run.messageUpdate(assistant(60), textDelta(), clock(6_000));
	const expected = measurement(1_000, 6_000, 2_000, 80, { totalTokens: 80, assistantMessages: 2 });
	expectCurrent(run.messageEnd(assistant(60, {}, "stop", "retry-success")), expected, "successful retry should exclude the failed stream but retain earlier successful calls");
	expectFinal(run.settle(), expected, "a recovered retry should become trusted only when Pi settles");
});

{
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(10), textDelta(), clock(1_000));
	run.messageUpdate(assistant(10), textDelta(), clock(2_000));
	run.messageEnd(assistant(10, {}, "toolUse", "before-length"));
	run.messageUpdate(assistant(100), textDelta(), clock(3_000));
	run.messageUpdate(assistant(100), textDelta(), clock(4_000));
	run.messageEnd(assistant(100, {}, "length", "truncated"));
	expectCurrent(
		run.compactionRetry(true),
		measurement(1_000, 2_000, 1_000, 10),
		"overflow compaction retry should remove the truncated length response from provisional speed",
	);
	run.start();
	run.messageUpdate(assistant(30), textDelta(), clock(5_000));
	run.messageUpdate(assistant(30), textDelta(), clock(6_000));
	const expected = measurement(1_000, 6_000, 2_000, 40, { totalTokens: 40, assistantMessages: 2 });
	run.messageEnd(assistant(30, {}, "stop", "after-compact"));
	expectFinal(run.settle(), expected, "compaction retry should finalize the replacement response, not the discarded truncated one");
}

await test("aborted output should not remain provisional", async () => {
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	run.messageUpdate(assistant(20), textDelta(), clock(2_000));
	assert.deepEqual(run.messageEnd(assistant(20, {}, "aborted", "abort")), { kind: "clear-current-run" }, "aborted output should not remain provisional");
	assert.deepEqual(run.settle(), { kind: "clear-current-run" }, "an unrecovered failure should never replace the previous trusted final value");
});

await test("provider output without measurable output deltas should remain unknown", async () => {
	const run = tracker();
	run.start();
	assert.deepEqual(run.messageEnd(assistant(20, {}, "stop", "unmeasured")), { kind: "clear-current-run" }, "provider output without measurable output deltas should remain unknown");
	assert.deepEqual(run.settle(), { kind: "clear-current-run" }, "unmeasured positive output should not become a final rate");
});

await test("one output timestamp cannot define a duration", async () => {
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	assert.deepEqual(run.messageEnd(assistant(20, {}, "stop", "single-delta")), { kind: "clear-current-run" }, "one output timestamp cannot define a duration");
});

await test("duplicate responseId should not add an unmeasured duplicate sample", async () => {
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	run.messageUpdate(assistant(20), textDelta(), clock(2_000));
	const finalMessage = assistant(20, {}, "stop", "dedupe");
	const expected = measurement(1_000, 2_000, 1_000, 20);
	expectCurrent(run.messageEnd(finalMessage), expected, "first final responseId should be accepted");
	assert.deepEqual(run.messageEnd(assistant(999, {}, "stop", "dedupe")), { kind: "none" }, "duplicate responseId should not add an unmeasured duplicate sample");
	expectFinal(run.settle(), expected, "duplicate message_end should leave the original measurement intact");
});

await test("non-monotonic output timestamps should invalidate the response", async () => {
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), clock(2_000));
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	assert.deepEqual(run.messageEnd(assistant(20, {}, "stop", "clock-regression")), { kind: "clear-current-run" }, "non-monotonic output timestamps should invalidate the response");
});

await test("reset should clear lifecycle facts without a visible intent", async () => {
	const run = tracker();
	run.start();
	run.messageUpdate(assistant(20), textDelta(), clock(1_000));
	assert.deepEqual(run.reset(), { kind: "none" }, "reset should clear lifecycle facts without a visible intent");
	assert.deepEqual(run.messageEnd(assistant(20, {}, "stop", "after-reset")), { kind: "none" }, "message_end after reset should be ignored");
	assert.deepEqual(run.settle(), { kind: "clear-current-run" }, "settle after reset should only clear provisional state");
});

console.log("✓ model-speed run tracker checks passed");
