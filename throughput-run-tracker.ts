import { calculateTurnThroughput, type ModelStreamSample } from "./throughput.js";
import type { TurnThroughput } from "./types.js";

export type ThroughputClock = () => number;

export type ThroughputRunStateIntent =
	| { kind: "none" }
	| { kind: "set-current-run"; currentRun: TurnThroughput }
	| { kind: "clear-current-run" }
	| { kind: "set-last-turn-and-clear-current-run"; lastTurn: TurnThroughput };

const NONE_INTENT: ThroughputRunStateIntent = { kind: "none" };

interface ActiveModelStream {
	startedAtMs: number;
	lastTextDeltaAtMs: number;
	textElapsedMs: number;
	textSegmentStartedAtMs: number | null;
	latestMessage: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

interface AssistantLikeMessage extends Record<string, unknown> {
	role: "assistant";
	stopReason?: unknown;
}

function isAssistantMessage(value: unknown): value is AssistantLikeMessage {
	return isRecord(value) && value.role === "assistant";
}

function isTextDeltaEvent(value: unknown): boolean {
	return isRecord(value) && value.type === "text_delta";
}

function isInvalidStopReason(value: unknown): boolean {
	return value === "error" || value === "aborted";
}

function closeTextSegment(stream: ActiveModelStream): void {
	if (stream.textSegmentStartedAtMs === null) return;
	const segmentElapsedMs = stream.lastTextDeltaAtMs - stream.textSegmentStartedAtMs;
	if (Number.isFinite(segmentElapsedMs) && segmentElapsedMs > 0) stream.textElapsedMs += segmentElapsedMs;
	stream.textSegmentStartedAtMs = null;
}

function lastAssistantMessage(messages: unknown): unknown {
	if (!Array.isArray(messages)) return undefined;
	for (const message of Array.from(messages).reverse()) {
		if (isAssistantMessage(message)) return message;
	}
	return undefined;
}

export class ThroughputRunTracker {
	private running = false;
	private activeStream: ActiveModelStream | null = null;
	private completedStreams: ModelStreamSample[] = [];
	private runInvalid = false;

	start(): ThroughputRunStateIntent {
		this.running = true;
		this.activeStream = null;
		this.completedStreams = [];
		this.runInvalid = false;
		return { kind: "clear-current-run" };
	}

	/** Record active visible-text timing; rendering remains event-driven at message_end. */
	messageUpdate(message: unknown, assistantMessageEvent: unknown, nowMs: ThroughputClock): ThroughputRunStateIntent {
		if (!this.running || this.runInvalid || !isAssistantMessage(message)) return NONE_INTENT;

		if (!isTextDeltaEvent(assistantMessageEvent)) {
			if (this.activeStream) closeTextSegment(this.activeStream);
			return NONE_INTENT;
		}

		const eventAtMs = nowMs();
		if (!Number.isFinite(eventAtMs)) return NONE_INTENT;

		if (!this.activeStream) {
			this.activeStream = {
				startedAtMs: eventAtMs,
				lastTextDeltaAtMs: eventAtMs,
				textElapsedMs: 0,
				textSegmentStartedAtMs: eventAtMs,
				latestMessage: message,
			};
			return NONE_INTENT;
		}

		if (this.activeStream.textSegmentStartedAtMs === null) {
			this.activeStream.textSegmentStartedAtMs = eventAtMs;
		}
		this.activeStream.lastTextDeltaAtMs = eventAtMs;
		this.activeStream.latestMessage = message;
		return NONE_INTENT;
	}

	private finalizeActiveStream(message: unknown): void {
		if (!this.activeStream) return;
		closeTextSegment(this.activeStream);
		this.completedStreams.push({
			startedAtMs: this.activeStream.startedAtMs,
			endedAtMs: this.activeStream.lastTextDeltaAtMs,
			elapsedMs: this.activeStream.textElapsedMs,
			message,
		});
		this.activeStream = null;
	}

	messageEnd(message: unknown): ThroughputRunStateIntent {
		if (!this.running || !isAssistantMessage(message)) return NONE_INTENT;
		if (isInvalidStopReason(message.stopReason)) {
			this.runInvalid = true;
			this.activeStream = null;
			return { kind: "clear-current-run" };
		}
		if (!this.activeStream) return NONE_INTENT;

		this.finalizeActiveStream(message);
		const currentRun = calculateTurnThroughput({ streams: this.completedStreams });
		return currentRun ? { kind: "set-current-run", currentRun } : { kind: "clear-current-run" };
	}

	finish(messages: unknown): ThroughputRunStateIntent {
		if (!this.running) {
			this.reset();
			return { kind: "clear-current-run" };
		}

		try {
			const finalAssistant = lastAssistantMessage(messages);
			if (this.runInvalid || (isRecord(finalAssistant) && isInvalidStopReason(finalAssistant.stopReason))) {
				return { kind: "clear-current-run" };
			}
			if (this.activeStream) this.finalizeActiveStream(finalAssistant ?? this.activeStream.latestMessage);

			const lastTurn = calculateTurnThroughput({ streams: this.completedStreams });
			return lastTurn ? { kind: "set-last-turn-and-clear-current-run", lastTurn } : { kind: "clear-current-run" };
		} finally {
			this.reset();
		}
	}

	reset(): ThroughputRunStateIntent {
		this.running = false;
		this.activeStream = null;
		this.completedStreams = [];
		this.runInvalid = false;
		return NONE_INTENT;
	}
}
