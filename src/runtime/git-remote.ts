import { runGit } from "./git-command.js";
import type { GitSnapshot } from "../types.js";

const FETCH_INTERVAL = 5 * 60_000;
const FETCH_TIMEOUT = 10_000;

/** One active upstream at a time. Local polling continues while network IO runs. */
export class GitRemoteRefresh {
	private controller?: AbortController;
	private target = "";
	private nextAttempt = 0;
	private failures = 0;
	private disposed = false;
	private readonly command: typeof runGit;
	private readonly now: () => number;

	constructor(private readonly onFetched: () => void, options: { command?: typeof runGit; now?: () => number } = {}) {
		this.command = options.command ?? runGit;
		this.now = options.now ?? Date.now;
	}

	dispose(): void {
		this.disposed = true;
		this.controller?.abort();
	}

	async refresh(cwd: string, snapshot: GitSnapshot): Promise<void> {
		if (this.disposed) return;
		const target = `${cwd}\0${snapshot.branch}\0${snapshot.upstream}`;
		if (this.target !== target) {
			this.controller?.abort();
			this.controller = undefined;
			this.target = target;
			this.nextAttempt = 0;
			this.failures = 0;
		}
		if (!snapshot.repo || snapshot.stale || !snapshot.branch || !snapshot.upstream || this.controller || this.now() < this.nextAttempt) return;
		const controller = new AbortController();
		this.controller = controller;
		let ok = false;
		try {
			const options = { timeoutMs: FETCH_TIMEOUT, signal: controller.signal };
			const refs = await this.command(cwd, ["for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)", `refs/heads/${snapshot.branch}`], options);
			const [remote, source, destination] = refs.stdout.trimEnd().split("\0");
			if (!refs.ok || !remote || remote === "." || !source?.startsWith("refs/heads/") || !destination?.startsWith("refs/remotes/") || controller.signal.aborted) return;
			const result = await this.command(cwd, [
				"fetch", "--quiet", "--no-tags", "--no-recurse-submodules", "--no-auto-maintenance",
				"--no-write-fetch-head", "--refmap=", "--", remote, `+${source}:${destination}`,
			], { ...options, network: true });
			ok = result.ok;
		} catch {
			// Offline and credential failures are not interactive notifications.
		} finally {
			if (this.controller === controller) {
				this.controller = undefined;
				this.failures = ok ? 0 : Math.min(6, this.failures + 1);
				this.nextAttempt = this.now() + (ok ? FETCH_INTERVAL : Math.min(30 * 60_000, 60_000 * 2 ** (this.failures - 1)));
				if (ok && !this.disposed && !controller.signal.aborted) this.onFetched();
			}
		}
	}
}
