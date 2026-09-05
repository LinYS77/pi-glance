import type { ModelSpeedMeasurement, ModelSpeedUsage } from "../types.js";

export interface ModelStreamSample {
	/** First observed non-reasoning output delta timestamp. */
	startedAtMs: number;
	/** Last observed non-reasoning output delta timestamp. */
	endedAtMs: number;
	/** Sum of measured non-reasoning output-stream intervals. */
	elapsedMs: number;
	/** Final authoritative assistant message for provider usage. */
	message: unknown;
}

export interface CalculateModelSpeedInput {
	streams: readonly ModelStreamSample[];
}

interface AssistantLikeMessage {
	role: "assistant";
	stopReason?: unknown;
	usage?: unknown;
}

interface NormalizedUsageParts {
	input: number;
	output: number;
	reasoning: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isAssistantMessage(value: unknown): value is AssistantLikeMessage {
	return isRecord(value) && value.role === "assistant";
}

function normalizeNonNegativeNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeUsage(value: unknown): NormalizedUsageParts {
	const usage = isRecord(value) ? value : {};
	const input = normalizeNonNegativeNumber(usage.input);
	const output = normalizeNonNegativeNumber(usage.output);
	const reasoning = Math.min(output, normalizeNonNegativeNumber(usage.reasoning));
	const cacheRead = normalizeNonNegativeNumber(usage.cacheRead);
	const cacheWrite = normalizeNonNegativeNumber(usage.cacheWrite);
	const totalTokens = Object.hasOwn(usage, "totalTokens")
		? normalizeNonNegativeNumber(usage.totalTokens)
		: input + output + cacheRead + cacheWrite;
	return { input, output, reasoning, cacheRead, cacheWrite, totalTokens };
}

function invalidStopReason(stopReason: unknown): boolean {
	return stopReason === "error" || stopReason === "aborted";
}

function emptyUsage(): ModelSpeedUsage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		assistantMessages: 0,
	};
}

/**
 * Calculate observed model generation speed from completed assistant output
 * streams. The numerator is provider-reported output minus its reported
 * reasoning subset. The denominator is measured non-reasoning output-stream
 * time across text and tool-call deltas. No message or delta content is
 * tokenized.
 */
export function calculateModelSpeed(input: CalculateModelSpeedInput): ModelSpeedMeasurement | undefined {
	const usage = emptyUsage();
	let startedAtMs = Number.POSITIVE_INFINITY;
	let endedAtMs = Number.NEGATIVE_INFINITY;
	let elapsedMs = 0;

	for (const stream of input.streams) {
		if (!isAssistantMessage(stream.message)) continue;
		if (invalidStopReason(stream.message.stopReason)) return undefined;

		const parts = normalizeUsage(stream.message.usage);
		const measuredOutput = Math.max(0, parts.output - parts.reasoning);
		if (measuredOutput <= 0) continue;

		const spanMs = stream.endedAtMs - stream.startedAtMs;
		if (
			!Number.isFinite(stream.startedAtMs)
			|| !Number.isFinite(stream.endedAtMs)
			|| !Number.isFinite(stream.elapsedMs)
			|| spanMs <= 0
			|| stream.elapsedMs <= 0
			|| stream.elapsedMs > spanMs
		) {
			return undefined;
		}

		startedAtMs = Math.min(startedAtMs, stream.startedAtMs);
		endedAtMs = Math.max(endedAtMs, stream.endedAtMs);
		elapsedMs += stream.elapsedMs;
		usage.assistantMessages++;
		usage.input += parts.input;
		usage.output += measuredOutput;
		usage.cacheRead += parts.cacheRead;
		usage.cacheWrite += parts.cacheWrite;
		usage.totalTokens += parts.totalTokens;
	}

	if (usage.output <= 0 || elapsedMs <= 0) return undefined;

	return {
		startedAtMs,
		endedAtMs,
		elapsedMs,
		tokensPerSecond: usage.output / (elapsedMs / 1000),
		usage,
	};
}
