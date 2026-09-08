import { strict as assert } from "node:assert";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitRemoteRefresh } from "../../src/runtime/git-remote.js";
import { runGit } from "../../src/runtime/git-command.js";
import { collectGitSnapshot } from "../../src/runtime/git.js";
import { parseGitStatus } from "../../src/runtime/git-snapshot.js";
import { defaultConfig } from "../../src/config/model.js";

test("background fetch backs off after failure, never overlaps, and cancellation cannot refresh state", async () => {
	let now = 0, fetches = 0, updates = 0;
	let release: (() => void) | undefined;
	let signal: AbortSignal | undefined;
	const remote = new GitRemoteRefresh(() => updates++, {
		now: () => now,
		command: async (_cwd, args, options) => {
			if (args[0] === "for-each-ref") return { ok: true, stdout: "origin\0refs/heads/main\0refs/remotes/origin/main", stderr: "" };
			fetches++;
			if (fetches === 3) {
				signal = options.signal;
				await new Promise<void>(resolve => { release = resolve; });
			}
			return { ok: fetches === 3, stdout: "", stderr: "offline" };
		},
	});
	const snapshot = parseGitStatus("# branch.head topic\n# branch.upstream origin/main\n");
	await remote.refresh("/repo", snapshot);
	now = 59_999; await remote.refresh("/repo", snapshot); assert.equal(fetches, 1);
	now = 60_000; await remote.refresh("/repo", snapshot); assert.equal(fetches, 2);
	now = 179_999; await remote.refresh("/repo", snapshot); assert.equal(fetches, 2);
	now = 180_000;
	const pending = remote.refresh("/repo", snapshot);
	await Promise.resolve();
	await remote.refresh("/repo", snapshot);
	assert.equal(fetches, 3);
	remote.dispose();
	assert.equal(signal?.aborted, true);
	release!(); await pending;
	assert.equal(updates, 0);
});

test("fetch updates upstream counts from a local bare remote without changing HEAD, files or FETCH_HEAD", async () => {
	const dir = mkdtempSync(join(tmpdir(), "glance-remote-integration-"));
	const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "core.hooksPath=/dev/null", ...args], { encoding: "utf8", stdio: "pipe" }).trim();
	try {
		const publisher = join(dir, "publisher"), remote = join(dir, "remote.git"), local = join(dir, "local");
		mkdirSync(publisher);
		git(publisher, "init", "-qb", "release");
		git(publisher, "init", "--bare", remote);
		writeFileSync(join(publisher, "file.txt"), "initial\n");
		git(publisher, "add", ".");
		const commit = () => git(publisher, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qam", "change");
		commit(); git(publisher, "push", remote, "release");
		git(dir, "clone", "-q", "-o", "team", "-b", "release", remote, local);
		const originalHead = git(local, "rev-parse", "HEAD");
		const fetchHead = join(local, ".git", "FETCH_HEAD");
		writeFileSync(fetchHead, "leave user fetch state alone\n");
		writeFileSync(join(publisher, "file.txt"), "later\n"); commit(); git(publisher, "push", remote, "release");
		const before = await collectGitSnapshot(local, defaultConfig().git);
		assert.equal(before.behind, 0);
		let changed = 0;
		const refresh = new GitRemoteRefresh(() => changed++);
		await refresh.refresh(local, before);
		assert.equal(changed, 1);
		const after = await collectGitSnapshot(local, defaultConfig().git);
		assert.equal(after.behind, 1);
		assert.equal(git(local, "rev-parse", "HEAD"), originalHead);
		assert.equal(readFileSync(join(local, "file.txt"), "utf8"), "initial\n");
		assert.equal(readFileSync(fetchHead, "utf8"), "leave user fetch state alone\n");
		refresh.dispose();
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("network Git has no controlling terminal, prompt helpers are noninteractive, and timeout kills its group", { skip: process.platform === "win32" }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "glance-git-isolation-"));
	const previousPath = process.env.PATH;
	try {
		const fake = join(dir, "git");
		writeFileSync(fake, '#!/bin/sh\nprintf "%s %s %s" "$GIT_TERMINAL_PROMPT" "$GCM_INTERACTIVE" "$SSH_ASKPASS_REQUIRE"\nif (: </dev/tty) 2>/dev/null; then echo " tty"; else echo " isolated"; fi\n', { mode: 0o700 });
		process.env.PATH = `${dir}:${previousPath}`;
		const result = await runGit(dir, ["fetch"], { network: true, timeoutMs: 1000 });
		assert.equal(result.ok, true);
		assert.match(result.stdout, /0 Never never isolated/);
		writeFileSync(fake, '#!/bin/sh\nsleep 2\ntouch should-not-exist\n', { mode: 0o700 });
		const start = Date.now();
		const stopped = await runGit(dir, [dir], { network: true, timeoutMs: 30 });
		assert.equal(stopped.ok, false);
		assert.ok(Date.now() - start < 1500);
		await new Promise(resolve => setTimeout(resolve, 2100));
		assert.equal(existsSync(join(dir, "should-not-exist")), false);
	} finally {
		process.env.PATH = previousPath;
		rmSync(dir, { recursive: true, force: true });
	}
});
