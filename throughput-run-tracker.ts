import { calculateModelSpeed, type ModelStreamSample } from "./throughput.js";
import type { ModelSpeedMeasurement } from "./types.js";

export type ModelSpeedClock = () => number;

export type ModelSpeedStateIntent =
	| { kind: "none" }
	| { kind: "set-current-run"; currentRun: ModelSpeedMeasurement }
	| { kind: "clear-current-run" }
	| { kind: "set-last-run-and-clear-current-run"; lastRun: ModelSpeedMeasurement };

const NONE_INTENT: ModelSpeedStateIntent = { kind: "none" };

interface ActiveModelStream {
	startedAtMs: number;
	lastOutputAtMs: number;
	outputElapsedMs: number;
	outputSegmentStartedAtMs: number | null;
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

function eventType(value: unknown): unknown {
	return isRecord(value) ? value.type : undefined;
}

function isOutputDelta(value: unknown): boolean {
	const type = eventType(value);
	return type === "text_delta" || type === "toolcall_delta";
}

function isThinkingEvent(value: unknown): boolean {
	const type = eventType(value);
	return type === "thinking_start" || type === "thinking_delta" || type === "thinking_end";
}

function isInvalidStopReason(value: unknown): boolean {
	return value === "error" || value === "aborted";
}

function closeOutputSegment(stream: ActiveModelStream): void {
	if (stream.outputSegmentStartedAtMs === null) return;
	const segmentElapsedMs = stream.lastOutputAtMs - stream.outputSegmentStartedAtMs;
	if (!Number.isFinite(segmentElapsedMs) || segmentElapsedMs < 0) stream.timingInvalid = true;
	else stream.outputElapsedMs += segmentElapsedMs;
	stream.outputSegmentStartedAtMs = null;
}

function messageKey(message: AssistantLikeMessage): string | undefined {
	return typeof message.responseId === "string" && message.responseId ? `assistant:${message.responseId}` : undefined;
}

export class ModelSpeedRunTracker {
	private running = false;
	private activeStream: ActiveModelStream | null = null;
	private completedStreams: ModelStreamSample[] = [];
	private pendingFailure = false;
	private completedMessageObjects = new WeakSet<object>();
	private completedMessageKeys = new Set<string>();

	/** Start a logical Pi run, or resume the same run after retry/continuation. */
	start(): ModelSpeedStateIntent {
		if (this.running) {
			this.activeStream = null;
			this.pendingFailure = false;
			return NONE_INTENT;
		}
		this.running = true;
		this.activeStream = null;
		this.completedStreams = [];
		this.pendingFailure = false;
		this.completedMessageObjects = new WeakSet<object>();
		this.completedMessageKeys = new Set<string>();
		return { kind: "clear-current-run" };
	}

	/** Record timestamps only; rendering remains event-driven at message_end. */
	messageUpdate(message: unknown, assistantMessageEvent: unknown, nowMs: ModelSpeedClock): ModelSpeedStateIntent {
		if (!this.running || this.pendingFailure || !isAssistantMessage(message)) return NONE_INTENT;
		if (isThinkingEvent(assistantMessageEvent)) {
			if (this.activeStream) closeOutputSegment(this.activeStream);
			return NONE_INTENT;
		}
		if (!isOutputDelta(assistantMessageEvent)) return NONE_INTENT;

		const eventAtMs = nowMs();
		if (!this.activeStream) {
			this.activeStream = {
				startedAtMs: eventAtMs,
				lastOutputAtMs: eventAtMs,
				outputElapsedMs: 0,
				outputSegmentStartedAtMs: eventAtMs,
				timingInvalid: !Number.isFinite(eventAtMs),
			};
			return NONE_INTENT;
		}

		if (!Number.isFinite(eventAtMs) || eventAtMs < this.activeStream.lastOutputAtMs) {
			this.activeStream.timingInvalid = true;
		}
		if (this.activeStream.outputSegmentStartedAtMs === null) {
			this.activeStream.outputSegmentStartedAtMs = eventAtMs;
		}
		this.activeStream.lastOutputAtMs = eventAtMs;
		return NONE_INTENT;
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

	private finalizeActiveStream(message: AssistantLikeMessage): ModelStreamSample {
		const stream = this.activeStream;
		this.activeStream = null;
		if (!stream) {
			return { startedAtMs: Number.NaN, endedAtMs: Number.NaN, elapsedMs: Number.NaN, message };
		}
		closeOutputSegment(stream);
		return {
			startedAtMs: stream.startedAtMs,
			endedAtMs: stream.lastOutputAtMs,
			elapsedMs: stream.timingInvalid ? Number.NaN : stream.outputElapsedMs,
			message,
		};
	}

	private currentIntent(): ModelSpeedStateIntent {
		const currentRun = calculateModelSpeed({ streams: this.completedStreams });
		return currentRun ? { kind: "set-current-run", currentRun } : { kind: "clear-current-run" };
	}

	messageEnd(message: unknown): ModelSpeedStateIntent {
		if (!this.running || !isAssistantMessage(message) || !this.claimMessage(message)) return NONE_INTENT;
		if (isInvalidStopReason(message.stopReason)) {
			this.pendingFailure = true;
			this.activeStream = null;
			return { kind: "clear-current-run" };
		}

		this.pendingFailure = false;
		this.completedStreams.push(this.finalizeActiveStream(message));
		return this.currentIntent();
	}

	/** Remove the recoverable response that Pi will replace after compaction. */
	compactionRetry(willRetry: boolean): ModelSpeedStateIntent {
		if (!this.running || !willRetry) return NONE_INTENT;
		this.pendingFailure = true;
		this.activeStream = null;
		const latest = this.completedStreams.at(-1);
		if (latest && isAssistantMessage(latest.message) && latest.message.stopReason === "length") {
			this.completedStreams.pop();
		}
		return this.currentIntent();
	}

	/** Finalize only after Pi guarantees no retry, compaction, or continuation remains. */
	settle(): ModelSpeedStateIntent {
		if (!this.running) return { kind: "clear-current-run" };
		try {
			if (this.pendingFailure) return { kind: "clear-current-run" };
			const lastRun = calculateModelSpeed({ streams: this.completedStreams });
			return lastRun ? { kind: "set-last-run-and-clear-current-run", lastRun } : { kind: "clear-current-run" };
		} finally {
			this.reset();
		}
	}

	reset(): ModelSpeedStateIntent {
		this.running = false;
		this.activeStream = null;
		this.completedStreams = [];
		this.pendingFailure = false;
		this.completedMessageObjects = new WeakSet<object>();
		this.completedMessageKeys = new Set<string>();
		return NONE_INTENT;
	}
}
