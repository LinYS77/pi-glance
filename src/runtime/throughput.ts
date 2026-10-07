import type { ModelSpeedMeasurement } from "../types.js";

export interface ModelRequestSample {
	/** Timestamp immediately before sending the provider request. */
	startedAtMs: number;
	/** Timestamp of the completed assistant message. */
	endedAtMs: number;
	/** Full request duration, excluding blocking UI prompts. */
	elapsedMs: number;
	/** Final authoritative assistant message for provider usage. */
	message: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Calculate average output throughput across completed model requests.
 * Pi usage.output already includes reasoning; count it exactly once over full
 * observed request time, including latency, thinking and hidden provider retries.
 * Tool waits and blocking UI prompts are excluded. No tokens are estimated.
 */
export function calculateModelSpeed(requests: readonly ModelRequestSample[]): ModelSpeedMeasurement | undefined {
	let outputTokens = 0;
	let elapsedMs = 0;

	for (const request of requests) {
		const message = request.message;
		if (!isRecord(message) || message.role !== "assistant") continue;
		if (message.stopReason === "error" || message.stopReason === "aborted") return undefined;
		const usage = message.usage;
		if (!isRecord(usage) || typeof usage.output !== "number"
			|| !Number.isFinite(usage.output) || usage.output < 0) return undefined;

		const spanMs = request.endedAtMs - request.startedAtMs;
		if (
			!Number.isFinite(request.startedAtMs)
			|| !Number.isFinite(request.endedAtMs)
			|| !Number.isFinite(request.elapsedMs)
			|| !Number.isFinite(spanMs)
			|| spanMs <= 0
			|| request.elapsedMs <= 0
			|| request.elapsedMs > spanMs
		) {
			return undefined;
		}

		outputTokens += usage.output;
		elapsedMs += request.elapsedMs;
	}

	if (outputTokens <= 0 || elapsedMs <= 0) return undefined;
	const tokensPerSecond = outputTokens / (elapsedMs / 1000);
	if (!Number.isFinite(elapsedMs) || !Number.isFinite(tokensPerSecond)) return undefined;

	return { outputTokens, elapsedMs, tokensPerSecond };
}
