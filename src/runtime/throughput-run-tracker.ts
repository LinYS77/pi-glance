import { calculateModelSpeed, type ModelRequestSample } from "./throughput.js";
import type { ModelSpeedMeasurement } from "../types.js";

export type ModelSpeedClock = () => number;

export type ModelSpeedStateIntent =
	| { kind: "none" }
	| { kind: "set-current-run"; currentRun: ModelSpeedMeasurement }
	| { kind: "clear-current-run" }
	| { kind: "set-last-run-and-clear-current-run"; lastRun: ModelSpeedMeasurement | null };

const NONE_INTENT: ModelSpeedStateIntent = { kind: "none" };

interface ActiveModelRequest {
	startedAtMs: number;
	activeStartedAtMs: number | null;
	lastBoundaryAtMs: number;
	elapsedMs: number;
	timingInvalid: boolean;
}

interface AssistantLikeMessage extends Record<string, unknown> {
	role: "assistant";
	responseId?: unknown;
	stopReason?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isAssistantMessage(value: unknown): value is AssistantLikeMessage {
	return isRecord(value) && value.role === "assistant";
}

function isInvalidStopReason(value: unknown): boolean {
	return value === "error" || value === "aborted";
}

function closeActiveInterval(request: ActiveModelRequest, nowMs: number): void {
	if (!Number.isFinite(nowMs) || nowMs < request.lastBoundaryAtMs) request.timingInvalid = true;
	request.lastBoundaryAtMs = nowMs;
	if (request.activeStartedAtMs === null) return;
	const elapsedMs = nowMs - request.activeStartedAtMs;
	if (!Number.isFinite(elapsedMs) || elapsedMs < 0) request.timingInvalid = true;
	else request.elapsedMs += elapsedMs;
	request.activeStartedAtMs = null;
}

function messageKey(message: AssistantLikeMessage): string | undefined {
	return typeof message.responseId === "string" && message.responseId ? `assistant:${message.responseId}` : undefined;
}

export class ModelSpeedRunTracker {
	private running = false;
	private awaitingResponse = false;
	private activeRequest: ActiveModelRequest | null = null;
	private completedRequests: ModelRequestSample[] = [];
	private pendingFailure = false;
	private uiPromptActive = false;
	private completedMessageObjects = new WeakSet<object>();
	private completedMessageKeys = new Set<string>();

	/** Start a logical Pi run, or resume it after retry/continuation. */
	start(): ModelSpeedStateIntent {
		this.awaitingResponse = true;
		if (this.running) {
			this.activeRequest = null;
			this.pendingFailure = false;
			return NONE_INTENT;
		}
		this.running = true;
		this.activeRequest = null;
		this.completedRequests = [];
		this.pendingFailure = false;
		this.completedMessageObjects = new WeakSet<object>();
		this.completedMessageKeys = new Set<string>();
		// Never present the previous run as a measurement of this run.
		return { kind: "set-last-run-and-clear-current-run", lastRun: null };
	}

	/** Pi also reuses the request hook for cache warming during tool/continuation gaps. */
	turnStart(): void {
		if (this.running) this.awaitingResponse = true;
	}

	/** Called before the provider request, not after headers or the first chunk. */
	requestStart(nowMs: ModelSpeedClock): void {
		if (!this.running || !this.awaitingResponse || this.pendingFailure) return;
		if (this.activeRequest) {
			// Public request events have no correlation ID. A replay overlapping a
			// foreground request cannot be paired reliably, so do not invent a rate.
			this.activeRequest.timingInvalid = true;
			return;
		}
		const startedAtMs = nowMs();
		const previousEndMs = this.completedRequests.at(-1)?.endedAtMs;
		this.activeRequest = {
			startedAtMs,
			activeStartedAtMs: this.uiPromptActive ? null : startedAtMs,
			lastBoundaryAtMs: startedAtMs,
			elapsedMs: 0,
			timingInvalid: !Number.isFinite(startedAtMs)
				|| (previousEndMs !== undefined && startedAtMs < previousEndMs),
		};
	}

	/** Exclude Pi's coalesced blocking extension UI prompt span. */
	uiPromptStart(nowMs: ModelSpeedClock): void {
		if (this.uiPromptActive) return;
		this.uiPromptActive = true;
		if (this.activeRequest) closeActiveInterval(this.activeRequest, nowMs());
	}

	uiPromptEnd(nowMs: ModelSpeedClock): void {
		if (!this.uiPromptActive) return;
		this.uiPromptActive = false;
		if (this.activeRequest) {
			const resumedAtMs = nowMs();
			if (!Number.isFinite(resumedAtMs) || resumedAtMs < this.activeRequest.lastBoundaryAtMs) {
				this.activeRequest.timingInvalid = true;
			}
			this.activeRequest.lastBoundaryAtMs = resumedAtMs;
			this.activeRequest.activeStartedAtMs = resumedAtMs;
		}
	}

	private claimMessage(message: AssistantLikeMessage): boolean {
		const key = messageKey(message);
		if (key) {
			if (this.completedMessageKeys.has(key)) return false;
			this.completedMessageKeys.add(key);
			return true;
		}
		if (this.completedMessageObjects.has(message)) return false;
		this.completedMessageObjects.add(message);
		return true;
	}

	private finalizeActiveRequest(message: AssistantLikeMessage, nowMs: ModelSpeedClock): ModelRequestSample {
		const request = this.activeRequest;
		this.activeRequest = null;
		if (!request) {
			return { startedAtMs: Number.NaN, endedAtMs: Number.NaN, elapsedMs: Number.NaN, message };
		}
		const endedAtMs = nowMs();
		closeActiveInterval(request, endedAtMs);
		return {
			startedAtMs: request.startedAtMs,
			endedAtMs,
			elapsedMs: request.timingInvalid ? Number.NaN : request.elapsedMs,
			message,
		};
	}

	private currentIntent(): ModelSpeedStateIntent {
		const currentRun = calculateModelSpeed(this.completedRequests);
		return currentRun ? { kind: "set-current-run", currentRun } : { kind: "clear-current-run" };
	}

	messageEnd(message: unknown, nowMs: ModelSpeedClock): ModelSpeedStateIntent {
		if (!this.running || !isAssistantMessage(message) || !this.claimMessage(message)) return NONE_INTENT;
		this.awaitingResponse = false;
		if (isInvalidStopReason(message.stopReason)) {
			this.pendingFailure = true;
			this.activeRequest = null;
			return { kind: "clear-current-run" };
		}
		this.pendingFailure = false;
		this.completedRequests.push(this.finalizeActiveRequest(message, nowMs));
		return this.currentIntent();
	}

	/** Remove a truncated response that Pi will replace after compaction. */
	compactionRetry(willRetry: boolean): ModelSpeedStateIntent {
		if (!this.running || !willRetry) return NONE_INTENT;
		this.awaitingResponse = false;
		this.pendingFailure = true;
		this.activeRequest = null;
		const latest = this.completedRequests.at(-1);
		if (latest && isAssistantMessage(latest.message) && latest.message.stopReason === "length") {
			this.completedRequests.pop();
		}
		return this.currentIntent();
	}

	/** Finalize only when no retry, compaction, or continuation remains. */
	settle(): ModelSpeedStateIntent {
		if (!this.running) return { kind: "clear-current-run" };
		try {
			const lastRun = this.pendingFailure || this.activeRequest
				? undefined : calculateModelSpeed(this.completedRequests);
			return { kind: "set-last-run-and-clear-current-run", lastRun: lastRun ?? null };
		} finally {
			this.resetRunState();
		}
	}

	private resetRunState(): void {
		this.running = false;
		this.awaitingResponse = false;
		this.activeRequest = null;
		this.completedRequests = [];
		this.pendingFailure = false;
		this.completedMessageObjects = new WeakSet<object>();
		this.completedMessageKeys = new Set<string>();
	}

	reset(): void {
		this.resetRunState();
		this.uiPromptActive = false;
	}
}
