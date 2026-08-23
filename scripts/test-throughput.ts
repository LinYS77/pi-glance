import { strict as assert } from "node:assert";

interface ThroughputUsageExpectation {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	assistantMessages: number;
}

interface ModelSpeedExpectation {
	startedAtMs: number;
	endedAtMs: number;
	elapsedMs: number;
	tokensPerSecond: number;
	usage: ThroughputUsageExpectation;
}

type ModelStreamSample = {
	startedAtMs: number;
	endedAtMs: number;
	elapsedMs: number;
	message: unknown;
};

type CalculateModelSpeed = (input: { streams: readonly ModelStreamSample[] }) => unknown;

const throughputModule = (await import("../throughput.js")) as Record<string, unknown>;
assert.equal(typeof throughputModule.calculateModelSpeed, "function", "throughput.ts should export calculateModelSpeed");
const calculateModelSpeed = throughputModule.calculateModelSpeed as CalculateModelSpeed;

function assistant(usage?: Record<string, unknown>, stopReason = "stop"): unknown {
	return { role: "assistant", stopReason, usage };
}

function user(): unknown {
	return { role: "user", usage: { output: 999 } };
}

function stream(message: unknown, startedAtMs: number, endedAtMs: number, elapsedMs = endedAtMs - startedAtMs): ModelStreamSample {
	return { startedAtMs, endedAtMs, elapsedMs, message };
}

function expectTurn(actual: unknown, expected: ModelSpeedExpectation, message: string): void {
	assert.deepEqual(actual, expected, message);
}

function expectUndefined(streams: readonly ModelStreamSample[], message: string): void {
	assert.equal(calculateModelSpeed({ streams }), undefined, message);
}

expectTurn(
	calculateModelSpeed({ streams: [stream(assistant({ output: 50, totalTokens: 50 }), 1_000, 3_500)] }),
	{
		startedAtMs: 1_000,
		endedAtMs: 3_500,
		elapsedMs: 2_500,
		tokensPerSecond: 20,
		usage: { input: 0, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 50, assistantMessages: 1 },
	},
	"one measured assistant output stream should calculate provider output tokens per active second",
);

expectTurn(
	calculateModelSpeed({
		streams: [
			stream(assistant({ input: 10, output: 20, cacheRead: 3, cacheWrite: 4, totalTokens: 37 }), 0, 1_000),
			stream(assistant({ input: 5, output: 30, cacheRead: 7, cacheWrite: 8, totalTokens: 50 }), 4_000, 4_500),
		],
	}),
	{
		startedAtMs: 0,
		endedAtMs: 4_500,
		elapsedMs: 1_500,
		tokensPerSecond: 100 / 3,
		usage: { input: 15, output: 50, cacheRead: 10, cacheWrite: 12, totalTokens: 87, assistantMessages: 2 },
	},
	"settled-run speed should sum per-call active durations while excluding tool and inter-call gaps",
);

expectTurn(
	calculateModelSpeed({
		streams: [stream(assistant({ input: 1, output: 100, reasoning: 60, totalTokens: 101 }), 0, 1_000)],
	}),
	{
		startedAtMs: 0,
		endedAtMs: 1_000,
		elapsedMs: 1_000,
		tokensPerSecond: 40,
		usage: { input: 1, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 101, assistantMessages: 1 },
	},
	"provider-reported reasoning should be removed from the model-speed numerator",
);

expectTurn(
	calculateModelSpeed({
		streams: [
			stream(assistant({ output: 50, reasoning: 50, totalTokens: 50 }), Number.NaN, Number.NaN, Number.NaN),
			stream(assistant({ output: 30, totalTokens: 30 }), 2_000, 3_000),
		],
	}),
	{
		startedAtMs: 2_000,
		endedAtMs: 3_000,
		elapsedMs: 1_000,
		tokensPerSecond: 30,
		usage: { input: 0, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 30, assistantMessages: 1 },
	},
	"reasoning-only calls should not require non-reasoning output timing",
);

expectTurn(
	calculateModelSpeed({
		streams: [
			stream(user(), 0, 10_000),
			stream(assistant({ output: 20, totalTokens: 20 }), 100, 1_100),
		],
	}),
	{
		startedAtMs: 100,
		endedAtMs: 1_100,
		elapsedMs: 1_000,
		tokensPerSecond: 20,
		usage: { input: 0, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 20, assistantMessages: 1 },
	},
	"non-assistant records should never enter model-speed usage",
);

for (const [streams, message] of [
	[[], "no model streams should be unknown"],
	[[stream(assistant(), 0, 1_000)], "missing provider usage should be unknown"],
	[[stream(assistant({ output: 0 }), 0, 1_000)], "zero non-reasoning output should be unknown"],
	[[stream(assistant({ output: 20 }), 1_000, 1_000, 0)], "one-timestamp output should be unknown"],
	[[stream(assistant({ output: 20 }), 2_000, 1_000, -1_000)], "negative timing should be unknown"],
	[[stream(assistant({ output: 20 }), 0, 1_000, 1_001)], "active duration larger than its observed span should be rejected"],
	[[stream(assistant({ output: 20 }), Number.NaN, 1_000, 500)], "non-finite timestamps should be rejected"],
	[[stream(assistant({ output: 20 }, "error"), 0, 1_000)], "errored assistant calls should not become trusted speed"],
	[[stream(assistant({ output: 20 }, "aborted"), 0, 1_000)], "aborted assistant calls should not become trusted speed"],
] as const) {
	expectUndefined(streams, message);
}

expectTurn(
	calculateModelSpeed({
		streams: [
			stream(
				assistant({ input: -10, output: Number.NaN, reasoning: Number.POSITIVE_INFINITY, cacheRead: -1, cacheWrite: Number.NEGATIVE_INFINITY }),
				0,
				1_000,
			),
			stream(assistant({ input: 2.9, output: 20.4, reasoning: 0.4, cacheRead: 3.5, cacheWrite: 4.1 }), 2_000, 3_000),
		],
	}),
	{
		startedAtMs: 2_000,
		endedAtMs: 3_000,
		elapsedMs: 1_000,
		tokensPerSecond: 20,
		usage: { input: 2.9, output: 20, cacheRead: 3.5, cacheWrite: 4.1, totalTokens: 30.9, assistantMessages: 1 },
	},
	"invalid usage fields should normalize without estimating from message or delta content",
);

const originalDateNow = Date.now;
try {
	Date.now = () => {
		throw new Error("pure model-speed calculation must only use supplied timestamps");
	};
	expectTurn(
		calculateModelSpeed({ streams: [stream(assistant({ output: 40, totalTokens: 40, content: "never tokenize me" }), 10, 2_010)] }),
		{
			startedAtMs: 10,
			endedAtMs: 2_010,
			elapsedMs: 2_000,
			tokensPerSecond: 20,
			usage: { input: 0, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 40, assistantMessages: 1 },
		},
		"calculation should remain clock-independent and content-independent",
	);
} finally {
	Date.now = originalDateNow;
}

console.log("✓ model-speed calculation checks passed");
