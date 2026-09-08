import { spawn } from "node:child_process";

export interface GitCommandResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

/** Bounded, cancellable Git IO. Network commands cannot inherit Pi's terminal. */
export function runGit(
	cwd: string,
	args: readonly string[],
	options: { timeoutMs: number; signal?: AbortSignal; network?: boolean; input?: string },
): Promise<GitCommandResult> {
	if (options.signal?.aborted) return Promise.resolve({ ok: false, stdout: "", stderr: "cancelled" });
	return new Promise(resolve => {
		const detached = process.platform !== "win32";
		const child = spawn("git", ["--no-optional-locks", ...args], {
			cwd, detached, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env, LC_ALL: "C",
				...(options.network ? {
					GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", SSH_ASKPASS_REQUIRE: "never",
					GIT_ASKPASS: "git", SSH_ASKPASS: "git",
				} : {}),
			},
		});
		const stdout: Buffer[] = [], stderr: Buffer[] = [];
		let bytes = 0, stopped = false, settled = false;
		const kill = () => {
			stopped = true;
			try {
				if (detached && child.pid) process.kill(-child.pid, "SIGKILL");
				else if (child.pid) {
					const terminator = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
					terminator.on("error", () => { child.kill("SIGKILL"); });
					terminator.unref();
				} else child.kill("SIGKILL");
			} catch { /* Already exited. */ }
		};
		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
			resolve({ ok: ok && !stopped, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
		};
		const abort = () => { kill(); finish(false); };
		const timer = setTimeout(abort, Math.max(1, options.timeoutMs));
		options.signal?.addEventListener("abort", abort, { once: true });
		const receive = (target: Buffer[]) => (chunk: Buffer) => {
			if (stopped || settled) return;
			bytes += chunk.length;
			if (bytes > 2 * 1024 * 1024) abort();
			else target.push(chunk);
		};
		child.stdout.on("data", receive(stdout));
		child.stderr.on("data", receive(stderr));
		child.on("error", () => finish(false));
		child.on("close", code => finish(code === 0));
		child.stdin.on("error", () => {});
		child.stdin.end(options.input);
	});
}
