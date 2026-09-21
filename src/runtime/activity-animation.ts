import type { ActivityAnimation, ActivityKind, GlanceConfig } from "../types.js";

export type ScheduleActivityFrame = (callback: () => void, delayMs: number) => () => void;
export interface ActivityMotion { kind: "sweep" | "blink"; rate: number }

export function activityMotion(config: GlanceConfig, kind: ActivityKind | undefined): ActivityMotion | undefined {
	if (!config.enabled || config.editor.activityMode !== "sweep" || !kind) return undefined;
	if (kind === "retry") return { kind: "blink", rate: config.editor.retryBlinkHz };
	return { kind: "sweep", rate: config.editor.workingSweepSpeed * (kind === "working" ? 1 : config.editor.summarySpeedMultiplier) };
}

const scheduleFrame: ScheduleActivityFrame = (callback, delay) => {
	const timer = setTimeout(callback, delay); timer.unref();
	return () => clearTimeout(timer);
};

/** One display clock: distance for sweeps, complete cycles for retry blinking. */
export class ActivityClock {
	private motion?: ActivityMotion;
	private active = false;
	private position = 0;
	private lastTime = 0;
	private generation = 0;
	private cancelFrame?: () => void;
	private disposed = false;

	constructor(private readonly options: {
		getMotion(): ActivityMotion | undefined;
		isPaused(): boolean;
		requestRender(): void;
		nowMs?: () => number;
		schedule?: ScheduleActivityFrame;
	}) {}

	sync(): void {
		if (this.disposed) return;
		const next = this.options.getMotion();
		const active = next !== undefined && !this.options.isPaused();
		const now = (this.options.nowMs ?? (() => performance.now()))();
		if (this.active && this.motion) this.position += Math.max(0, now - this.lastTime) * this.motion.rate / 1000;
		if (next?.kind !== this.motion?.kind) this.position = 0;
		if (next?.kind !== this.motion?.kind || next?.rate !== this.motion?.rate || active !== this.active) this.stopClock();
		this.lastTime = now;
		this.motion = next;
		this.active = active;
		if (active && !this.cancelFrame) this.queueFrame();
	}

	frame(): ActivityAnimation | undefined {
		this.sync();
		if (!this.active || !this.motion) return undefined;
		return this.motion.kind === "sweep"
			? { kind: "sweep", elapsedMs: this.position / this.motion.rate * 1000, speed: this.motion.rate }
			: { kind: "blink", bright: this.position % 1 < 0.5 };
	}

	dispose(): void {
		this.disposed = true;
		this.active = false;
		this.motion = undefined;
		this.stopClock();
	}

	private stopClock(): void {
		this.generation++;
		this.cancelFrame?.();
		this.cancelFrame = undefined;
	}

	private queueFrame(): void {
		const generation = this.generation;
		const delay = this.motion?.kind === "blink"
			? Math.max(1, (0.5 - this.position % 0.5) / this.motion.rate * 1000) : 1000 / 30;
		this.cancelFrame = (this.options.schedule ?? scheduleFrame)(() => {
			if (generation !== this.generation || this.disposed) return;
			this.cancelFrame = undefined;
			this.sync();
			if (!this.disposed && !this.options.isPaused()) this.options.requestRender();
		}, delay);
	}
}
