import type { ModelSpeedMeasurement, ModelSpeedUsage } from "../types.js";

export interface ModelStreamSample {
	/** Timestamp immediately before sending the provider request. */
	startedAtMs: number;
	/** Timestamp of the completed assistant message. */
	endedAtMs: number;
	/** Full request duration, excluding blocking UI prompts. */
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
 * Calculate effective output throughput across completed model requests.
 * Provider output minus reported reasoning is divided by full request time,
 * including initial latency and thinking. Tool waits and blocking UI prompts
 * are excluded. Chunk timing and content are not used to estimate tokens.
 */
export function calculateModelSpeed(input: CalculateModelSpeedInput): ModelSpeedMeasurement | undefined {
	const usage = emptyUsage();
	let startedAtMs = Number.POSITIVE_INFINITY;
	let endedAtMs = Number.NEGATIVE_INFINITY;
	let elapsedMs = 0;

	for (const stream of input.streams) {
		if (!isAssistantMessage(stream.message)) continue;
		if (invalidStopReason(stream.message.stopReason)) return undefined;
		const reportedUsage = stream.message.usage;
		if (!isRecord(reportedUsage)
			|| typeof reportedUsage.output !== "number"
			|| !Number.isFinite(reportedUsage.output) || reportedUsage.output < 0) return undefined;
		if (reportedUsage.reasoning !== undefined && (
			typeof reportedUsage.reasoning !== "number"
			|| !Number.isFinite(reportedUsage.reasoning)
			|| reportedUsage.reasoning < 0 || reportedUsage.reasoning > reportedUsage.output
		)) return undefined;

		const parts = normalizeUsage(reportedUsage);
		const measuredOutput = parts.output - parts.reasoning;

		const spanMs = stream.endedAtMs - stream.startedAtMs;
		if (
			!Number.isFinite(stream.startedAtMs)
			|| !Number.isFinite(stream.endedAtMs)
			|| !Number.isFinite(stream.elapsedMs)
			|| !Number.isFinite(spanMs)
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
	const tokensPerSecond = usage.output / (elapsedMs / 1000);
	if (!Number.isFinite(elapsedMs) || !Number.isFinite(tokensPerSecond)) return undefined;

	return {
		startedAtMs,
		endedAtMs,
		elapsedMs,
		tokensPerSecond,
		usage,
	};
}
