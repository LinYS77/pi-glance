import { strict as assert } from "node:assert";
import { calculateModelSpeed, type ModelRequestSample } from "../../src/runtime/throughput.js";

function request(output: unknown, startedAtMs: number, endedAtMs: number, elapsedMs = endedAtMs - startedAtMs): ModelRequestSample {
	return { startedAtMs, endedAtMs, elapsedMs, message: { role: "assistant", usage: { output } } };
}

// Lifecycle, retries, reasoning and weighting are covered through the tracker
// and real SDK. Keep the calculator's untrusted numeric boundaries here.
for (const [requests, label] of [
	[[], "no completed requests"],
	[[request(0, 0, 1_000)], "zero total output"],
	[[request(20, 1_000, 1_000, 0)], "zero duration"],
	[[request(20, 2_000, 1_000, -1_000)], "reversed duration"],
	[[request(20, 0, 1_000, 1_001)], "active time exceeds the observed span"],
	[[request(20, -Number.MAX_VALUE, Number.MAX_VALUE, 1_000)], "overflowed span"],
	[[request(20, Number.NaN, 1_000, 500)], "invalid start"],
	[[request(20, 0, Infinity, 500)], "invalid end"],
	[[request(20, 0, 1_000, Number.NaN)], "invalid elapsed time"],
	[[request(20, 0, 1_000, -1)], "negative elapsed time"],
	[[request(Number.MAX_VALUE, 0, 1_000), request(Number.MAX_VALUE, 1_000, 2_000)], "overflowed output sum"],
	[[request(20, 0, Number.MAX_VALUE), request(20, 0, Number.MAX_VALUE)], "overflowed elapsed sum"],
] as const) {
	assert.equal(calculateModelSpeed(requests), undefined, label);
}

assert.deepEqual(
	calculateModelSpeed([request(20.4, 2_000, 3_000)]),
	{ outputTokens: 20.4, elapsedMs: 1_000, tokensPerSecond: 20.4 },
	"preserve provider output precision; rounding belongs to display",
);

console.log("✓ throughput numeric boundary checks passed");
