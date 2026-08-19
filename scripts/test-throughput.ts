import { strict as assert } from "node:assert";

interface ThroughputUsageExpectation {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	assistantMessages: number;
}

interface TurnThroughputExpectation {
	startedAtMs: number;
	endedAtMs: number;
	elapsedMs: number;
	tokensPerSecond: number;
	usage: ThroughputUsageExpectation;
}

type CalculateTurnThroughput = (input: {
	streams: readonly { startedAtMs: number; endedAtMs: number; message: unknown }[];
}) => unknown;

const modulePath = "../throughput.js";
let throughputModule: Record<string, unknown>;
try {
	throughputModule = (await import(modulePath)) as Record<string, unknown>;
} catch (error) {
	assert.fail(`throughput.ts should export calculateTurnThroughput; import failed: ${(error as Error).message}`);
}

assert.equal(typeof throughputModule.calculateTurnThroughput, "function", "throughput.ts should export calculateTurnThroughput");
const calculateTurnThroughput = throughputModule.calculateTurnThroughput as CalculateTurnThroughput;

function assistant(usage?: Record<string, unknown>, stopReason = "stop"): unknown {
	return { role: "assistant", stopReason, usage };
}

function user(): unknown {
	return { role: "user", usage: { output: 999 } };
}

function stream(message: unknown, startedAtMs: number, endedAtMs: number): { startedAtMs: number; endedAtMs: number; message: unknown } {
	return { startedAtMs, endedAtMs, message };
}

function expectTurn(actual: unknown, expected: TurnThroughputExpectation, message: string): void {
	assert.deepEqual(actual, expected, message);
}

function expectUndefined(input: Parameters<CalculateTurnThroughput>[0], message: string): void {
	assert.equal(calculateTurnThroughput(input), undefined, message);
}

expectTurn(
	calculateTurnThroughput({ streams: [stream(assistant({ output: 50 }), 1_000, 3_500)] }),
	{
		startedAtMs: 1_000,
		endedAtMs: 3_500,
		elapsedMs: 2_500,
		tokensPerSecond: 20,
		usage: {
			input: 0,
			output: 50,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 50,
			assistantMessages: 1,
		},
	},
	"one active model stream should calculate output tokens per stream second",
);

expectTurn(
	calculateTurnThroughput({
		streams: [
			stream(assistant({ input: 10, output: 20, cacheRead: 3, cacheWrite: 4, totalTokens: 37 }), 0, 1_000),
			stream(assistant({ input: 5, output: 30, cacheRead: 7, cacheWrite: 8, totalTokens: 50 }), 2_000, 2_500),
		],
	}),
	{
		startedAtMs: 0,
		endedAtMs: 2_500,
		elapsedMs: 1_500,
		tokensPerSecond: 100 / 3,
		usage: {
			input: 15,
			output: 50,
			cacheRead: 10,
			cacheWrite: 12,
			totalTokens: 87,
			assistantMessages: 2,
		},
	},
	"multiple model streams should sum active stream durations and exclude the gap between responses",
);

expectTurn(
	calculateTurnThroughput({
		streams: [
			stream(user(), 0, 10_000),
			stream(assistant({ output: 20 }), 100, 1_100),
		],
	}),
	{
		startedAtMs: 100,
		endedAtMs: 1_100,
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
	"non-assistant stream records should be ignored",
);

expectTurn(
	calculateTurnThroughput({
		streams: [stream(assistant({ input: 1, output: 100, reasoning: 60, totalTokens: 101 }), 0, 1_000)],
	}),
	{
		startedAtMs: 0,
		endedAtMs: 1_000,
		elapsedMs: 1_000,
		tokensPerSecond: 40,
		usage: {
			input: 1,
			output: 40,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 101,
			assistantMessages: 1,
		},
	},
	"model speed should use provider-reported visible output and exclude its reasoning subset",
);

for (const [input, message] of [
	[
		{ streams: [stream(assistant(), 0, 1_000)] },
		"assistant streams with missing usage should be invalid instead of falling back to content length",
	],
	[
		{ streams: [stream(assistant({ output: 0 }), 0, 1_000)] },
		"assistant output=0 should be invalid and hide the segment",
	],
	[
		{ streams: [] },
		"no assistant streams should be invalid",
	],
	[
		{ streams: [stream(assistant({ output: 50 }), 1_000, 1_000)] },
		"zero stream duration should be invalid",
	],
	[
		{ streams: [stream(assistant({ output: 50 }), 2_000, 1_000)] },
		"negative stream duration should be invalid",
	],
	[
		{ streams: [stream(assistant({ output: 20 }), 0, 0), stream(assistant({ output: 30 }), 1_000, 2_000)] },
		"a positive-output stream without measurable text time should invalidate the aggregate instead of silently dropping its tokens",
	],
] as const) {
	expectUndefined(input, message);
}

expectTurn(
	calculateTurnThroughput({
		streams: [
			stream(
				assistant({
					input: -10,
					output: Number.NaN,
					cacheRead: Number.NEGATIVE_INFINITY,
					cacheWrite: -5,
					totalTokens: Number.POSITIVE_INFINITY,
				}),
				0,
				1_000,
			),
			stream(assistant({ input: 2.9, output: 20.4, cacheRead: 3.5, cacheWrite: 4.1 }), 2_000, 3_000),
		],
	}),
	{
		startedAtMs: 0,
		endedAtMs: 3_000,
		elapsedMs: 2_000,
		tokensPerSecond: 10.2,
		usage: {
			input: 2.9,
			output: 20.4,
			cacheRead: 3.5,
			cacheWrite: 4.1,
			totalTokens: 30.9,
			assistantMessages: 2,
		},
	},
	"non-finite and negative usage values should normalize to zero while finite values are preserved",
);

for (const stopReason of ["error", "aborted"] as const) {
	expectUndefined(
		{
			streams: [
				stream(assistant({ output: 20 }, "stop"), 0, 1_000),
				stream(assistant({ output: 20 }, stopReason), 2_000, 3_000),
			],
		},
		`last assistant stopReason=${stopReason} should invalidate the complete model-speed measurement`,
	);
}

const originalDateNow = Date.now;
try {
	Date.now = () => {
		throw new Error("calculateTurnThroughput must use injected stream timestamps, not Date.now()");
	};
	expectTurn(
		calculateTurnThroughput({
			streams: [stream(assistant({ output: 40, totalTokens: 40, content: "do not tokenize this" }), 10, 2_010)],
		}),
		{
			startedAtMs: 10,
			endedAtMs: 2_010,
			elapsedMs: 2_000,
			tokensPerSecond: 20,
			usage: {
				input: 0,
				output: 40,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 40,
				assistantMessages: 1,
			},
		},
		"pure model-speed calculation should use injected stream timestamps and never tokenize content",
	);
} finally {
	Date.now = originalDateNow;
}

console.log("✓ model-speed calculation checks passed");
