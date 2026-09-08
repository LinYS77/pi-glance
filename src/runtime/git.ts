import { runGit } from "./git-command.js";
import { GitRemoteRefresh } from "./git-remote.js";
import { emptyGitSnapshot, parseGitDiffStat, parseGitStatus } from "./git-snapshot.js";
import type { GitConfig, GitSnapshot } from "../types.js";

const GIT_ARGS = ["status", "--porcelain=v2", "--branch", "-z"] as const;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const MIN_POLL_INTERVAL_MS = 1000;
const NO_REPO_RETRY_MS = 30_000;

export async function collectGitSnapshot(cwd: string, config: GitConfig, signal?: AbortSignal): Promise<GitSnapshot> {
	const deadline = Date.now() + config.timeoutMs;
	const command = (args: readonly string[], input?: string) => runGit(cwd, args, {
		timeoutMs: Math.max(1, deadline - Date.now()), signal, input,
	});
	const detailed = config.changes === "summary";
	const status = await command([...GIT_ARGS, `--untracked-files=${detailed ? "all" : "normal"}`]);
	if (!status.ok) {
		const failed = emptyGitSnapshot();
		// A transient failure is not evidence that a previously detected repo vanished.
		if (!status.stderr.includes("not a git repository")) failed.stale = true;
		return failed;
	}
	const snapshot = parseGitStatus(status.stdout);
	if (!detailed) {
		delete snapshot.summary;
		return snapshot;
	}
	if (!snapshot.dirty || !(snapshot.staged || snapshot.unstaged || snapshot.conflicts)) return snapshot;
	let base = "HEAD";
	if (!snapshot.sha) {
		const tree = await command(["hash-object", "-t", "tree", "--stdin"], "");
		if (!tree.ok) return snapshot;
		base = tree.stdout.trim();
	}
	if (Date.now() >= deadline || signal?.aborted) return snapshot;
	const diff = await command(["diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv", base, "--"]);
	const lines = diff.ok ? parseGitDiffStat(diff.stdout) : undefined;
	if (lines && snapshot.summary) snapshot.summary = { ...snapshot.summary, ...lines };
	return snapshot;
}

export function nextGitRefreshDelay(snapshot: GitSnapshot, config: GitConfig): number {
	if (!snapshot.repo) return NO_REPO_RETRY_MS;
	return Math.max(MIN_POLL_INTERVAL_MS, config.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
}

interface GitRefresherOptions {
	canFetch?: () => boolean;
	collect?: (cwd: string, config: GitConfig, signal?: AbortSignal) => Promise<GitSnapshot>;
	setTimer?: (callback: () => void, delay: number) => NodeJS.Timeout;
}

export class GitRefresher {
	private timer: NodeJS.Timeout | undefined;
	private timerDue = 0;
	private inFlight = false;
	private pending = false;
	private disposed = false;
	private pendingImmediate = false;
	private active?: AbortController;
	private remote?: GitRemoteRefresh;
	private lastGood?: { cwd: string; snapshot: GitSnapshot };
	private readonly canFetch: () => boolean;
	private readonly collect: NonNullable<GitRefresherOptions["collect"]>;
	private readonly setTimer: (callback: () => void, delay: number) => NodeJS.Timeout;

	constructor(
		private readonly getConfig: () => GitConfig,
		private readonly getCwd: () => string | undefined,
		private readonly onSnapshot: (cwd: string, snapshot: GitSnapshot) => void,
		options: GitRefresherOptions = {},
	) {
		this.canFetch = options.canFetch ?? (() => true);
		this.collect = options.collect ?? collectGitSnapshot;
		this.setTimer = options.setTimer ?? setTimeout;
	}

	dispose(): void {
		this.disposed = true;
		this.active?.abort();
		this.remote?.dispose();
		this.clearTimer();
	}

	schedule(immediate = false): void {
		if (this.disposed) return;
		if (!this.getConfig().autoFetch || !this.canFetch()) {
			this.remote?.dispose();
			this.remote = undefined;
		}
		if (this.inFlight) {
			this.pending = true;
			this.pendingImmediate ||= immediate;
			this.clearTimer();
			return;
		}
		this.scheduleAfter(immediate ? 0 : this.getConfig().refreshDebounceMs);
	}

	private clearTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.timerDue = 0;
	}

	private scheduleAfter(delay: number): void {
		const due = Date.now() + delay;
		// A burst may bring a refresh forward, but must not postpone it forever.
		if (this.timer && this.timerDue <= due) return;
		this.clearTimer();
		this.timerDue = due;
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
		this.active = new AbortController();
		let snapshot: GitSnapshot | undefined;
		try {
			try {
				snapshot = await this.collect(cwd, this.getConfig(), this.active.signal);
			} catch {
				snapshot = { ...emptyGitSnapshot(), stale: true };
			}
			if (snapshot.stale && this.lastGood?.cwd === cwd) snapshot = { ...this.lastGood.snapshot, stale: true };
			else if (snapshot.repo) this.lastGood = { cwd, snapshot };
			else this.lastGood = undefined;
			if (!this.disposed) {
				this.onSnapshot(cwd, snapshot);
				if (this.getCwd() === cwd && this.getConfig().autoFetch && this.canFetch()) {
					this.remote ??= new GitRemoteRefresh(() => this.schedule(true));
					void this.remote.refresh(cwd, snapshot);
				}
			}
		} finally {
			this.active = undefined;
			this.inFlight = false;
			if (this.disposed) return;
			if (this.pending) {
				this.pending = false;
				const delay = this.pendingImmediate ? 0 : this.getConfig().refreshDebounceMs;
				this.pendingImmediate = false;
				this.scheduleAfter(delay);
			} else if (snapshot) {
				this.scheduleAfter(nextGitRefreshDelay(snapshot, this.getConfig()));
			}
		}
	}
}
