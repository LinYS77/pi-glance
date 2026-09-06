export type ScheduleSweepFrame = (callback: () => void, delayMs: number) => () => void;

export interface WorkingSweepOptions {
	nowMs(): number;
	ownsEditor(): boolean;
	requestRender(): void;
	setWorkingVisible(visible: boolean): void;
	schedule?: ScheduleSweepFrame;
}

const FRAME_INTERVAL_MS = 1000 / 30;

const scheduleFrame: ScheduleSweepFrame = (callback, delayMs) => {
	const timer = setTimeout(callback, delayMs);
	timer.unref();
	return () => clearTimeout(timer);
};

/** A display-only clock. Never reads usage or schedules Git work. */
export class WorkingSweep {
	private attached = false;
	private running = false;
	private waiting = false;
	private startedAt = 0;
	private generation = 0;
	private cancelFrame?: () => void;

	constructor(private readonly options: WorkingSweepOptions) {}

	attach(running = false, waiting = false): void {
		if (this.attached || !this.options.ownsEditor()) return;
		this.waiting = waiting;
		this.attached = true;
		this.options.setWorkingVisible(false);
		if (running) this.start();
	}

	elapsedMs(): number | undefined {
		return this.attached && this.running && !this.waiting && this.options.ownsEditor()
			? Math.max(0, this.options.nowMs() - this.startedAt)
			: undefined;
	}

	start(): void {
		if (!this.attached || this.running) return;
		this.running = true;
		this.startedAt = this.options.nowMs();
		this.update();
	}

	setWaiting(waiting: boolean): void {
		if (!this.attached || this.waiting === waiting) return;
		this.waiting = waiting;
		if (!waiting) this.startedAt = this.options.nowMs();
		if (this.running) this.update();
	}

	settle(): void {
		if (!this.running) return;
		this.running = false;
		this.update();
	}

	dispose(): void {
		this.stopClock();
		this.running = false;
		this.waiting = false;
		if (!this.attached) return;
		this.attached = false;
		this.options.setWorkingVisible(true);
	}

	private stopClock(): void {
		this.generation++;
		this.cancelFrame?.();
		this.cancelFrame = undefined;
	}

	private update(): void {
		this.stopClock();
		if (!this.options.ownsEditor()) {
			this.dispose();
			return;
		}
		const generation = this.generation;
		this.options.requestRender();
		if (generation === this.generation && this.running && !this.waiting) this.queueFrame();
	}

	private queueFrame(): void {
		const generation = this.generation;
		this.cancelFrame = (this.options.schedule ?? scheduleFrame)(() => {
			if (generation !== this.generation) return;
			this.cancelFrame = undefined;
			if (!this.options.ownsEditor()) {
				this.dispose();
				return;
			}
			this.options.requestRender();
			if (generation === this.generation && this.attached && this.running && !this.waiting) this.queueFrame();
		}, FRAME_INTERVAL_MS);
	}
}
