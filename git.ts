import { execFile } from "node:child_process";
import type { GitConfig, GitSnapshot } from "./types.js";

const GIT_ARGS = ["--no-optional-locks", "status", "--porcelain=v2", "--branch", "--show-stash"] as const;
const GIT_MAX_BUFFER = 512 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const MIN_POLL_INTERVAL_MS = 1000;
const NO_REPO_RETRY_MS = 30_000;

import { emptyGitSnapshot, parseGitStatus } from "./git-snapshot.js";

export function collectGitSnapshot(cwd: string, config: GitConfig): Promise<GitSnapshot> {
	return new Promise((resolve) => {
		execFile("git", [...GIT_ARGS], { cwd, timeout: config.timeoutMs, maxBuffer: GIT_MAX_BUFFER }, (error, stdout) => {
			resolve(error ? emptyGitSnapshot("unknown") : parseGitStatus(stdout));
		});
	});
}

export function nextGitRefreshDelay(snapshot: GitSnapshot, config: GitConfig): number {
	if (!snapshot.repo) return NO_REPO_RETRY_MS;
	return Math.max(MIN_POLL_INTERVAL_MS, config.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
}

interface GitRefresherOptions {
	collect?: (cwd: string, config: GitConfig) => Promise<GitSnapshot>;
	setTimer?: (callback: () => void, delay: number) => NodeJS.Timeout;
}

export class GitRefresher {
	private timer: NodeJS.Timeout | undefined;
	private inFlight = false;
	private pending = false;
	private disposed = false;
	private readonly collect: (cwd: string, config: GitConfig) => Promise<GitSnapshot>;
	private readonly setTimer: (callback: () => void, delay: number) => NodeJS.Timeout;

	constructor(
		private readonly getConfig: () => GitConfig,
		private readonly getCwd: () => string | undefined,
		private readonly onSnapshot: (cwd: string, snapshot: GitSnapshot) => void,
		options: GitRefresherOptions = {},
	) {
		this.collect = options.collect ?? collectGitSnapshot;
		this.setTimer = options.setTimer ?? setTimeout;
	}

	dispose(): void {
		this.disposed = true;
		this.clearTimer();
	}

	schedule(immediate = false): void {
		if (this.disposed) return;
		if (this.inFlight) {
			this.pending = true;
			this.clearTimer();
			return;
		}
		this.scheduleAfter(immediate ? 0 : this.getConfig().refreshDebounceMs);
	}

	private clearTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	private scheduleAfter(delay: number): void {
		this.clearTimer();
		this.timer = this.setTimer(() => {
			this.timer = undefined;
			void this.refresh();
		}, delay);
		this.timer.unref?.();
	}

	private async refresh(): Promise<void> {
		if (this.disposed) return;
		if (this.inFlight) {
			this.pending = true;
			return;
		}

		const cwd = this.getCwd();
		if (!cwd) return;

		this.inFlight = true;
		let snapshot: GitSnapshot | undefined;
		try {
			snapshot = await this.collect(cwd, this.getConfig());
			if (!this.disposed) this.onSnapshot(cwd, snapshot);
		} finally {
			this.inFlight = false;
			if (this.disposed) return;
			if (this.pending) {
				this.pending = false;
				this.scheduleAfter(0);
			} else if (snapshot) {
				this.scheduleAfter(nextGitRefreshDelay(snapshot, this.getConfig()));
			}
		}
	}
}
