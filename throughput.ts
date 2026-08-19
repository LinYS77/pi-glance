import type { TurnThroughput, TurnThroughputUsage } from "./types.js";

export interface ModelStreamSample {
	startedAtMs: number;
	endedAtMs: number;
	/** Sum of contiguous text-stream intervals; omitted means ended-started. */
	elapsedMs?: number;
	message: unknown;
}

export interface CalculateTurnThroughputInput {
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

function emptyUsage(): TurnThroughputUsage {
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
 * Calculate visible model generation speed from completed assistant text-stream
 * windows.
 *
 * The denominator is the sum of contiguous text-stream intervals for each
 * response. Each interval starts at a `text_delta` and closes when the text
 * stream is interrupted; time before visible text starts, reasoning/thinking,
 * tool execution, and gaps between model responses are intentionally excluded.
 *
 * The numerator uses provider-reported output tokens minus the provider's
 * reasoning subset when available. No text or delta content is tokenized.
 */
export function calculateTurnThroughput(input: CalculateTurnThroughputInput): TurnThroughput | undefined {
	const usage = emptyUsage();
	let startedAtMs = Number.POSITIVE_INFINITY;
	let endedAtMs = Number.NEGATIVE_INFINITY;
	let elapsedMs = 0;
	let lastAssistant: AssistantLikeMessage | undefined;

	for (const stream of input.streams) {
		if (!isAssistantMessage(stream.message)) continue;
		lastAssistant = stream.message;
		const parts = normalizeUsage(stream.message.usage);
		const visibleOutput = Math.max(0, parts.output - parts.reasoning);
		const streamElapsedMs = typeof stream.elapsedMs === "number" ? stream.elapsedMs : stream.endedAtMs - stream.startedAtMs;
		if (!Number.isFinite(stream.startedAtMs) || !Number.isFinite(stream.endedAtMs)) {
			if (visibleOutput > 0) return undefined;
			continue;
		}
		if (!Number.isFinite(streamElapsedMs) || streamElapsedMs <= 0) {
			if (visibleOutput > 0) return undefined;
			continue;
		}

		startedAtMs = Math.min(startedAtMs, stream.startedAtMs);
		endedAtMs = Math.max(endedAtMs, stream.endedAtMs);
		elapsedMs += streamElapsedMs;
		usage.assistantMessages++;
		usage.input += parts.input;
		usage.output += visibleOutput;
		usage.cacheRead += parts.cacheRead;
		usage.cacheWrite += parts.cacheWrite;
		usage.totalTokens += parts.totalTokens;
	}

	if (!lastAssistant) return undefined;
	if (invalidStopReason(lastAssistant.stopReason)) return undefined;
	if (usage.output <= 0 || elapsedMs <= 0) return undefined;

	return {
		startedAtMs,
		endedAtMs,
		elapsedMs,
		tokensPerSecond: usage.output / (elapsedMs / 1000),
		usage,
	};
}
