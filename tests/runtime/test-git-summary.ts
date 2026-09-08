import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { collectGitSnapshot } from "../../src/runtime/git.js";

test("Summary counts each changed file once and measures net tracked lines, including a nested untracked directory", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "glance-summary-"));
	const git = (...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "core.hooksPath=/dev/null", ...args], { stdio: "pipe" });
	try {
		git("init", "-q");
		writeFileSync(join(cwd, "a.txt"), "old\nkeep\n");
		git("add", ".");
		git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");
		writeFileSync(join(cwd, "a.txt"), "intermediate\nkeep\n");
		git("add", ".");
		writeFileSync(join(cwd, "a.txt"), "new\nkeep\nextra\n");
		mkdirSync(join(cwd, "new"));
		writeFileSync(join(cwd, "new", "x.txt"), "untracked\n");
		writeFileSync(join(cwd, "new", "y.txt"), "untracked\n");
		git("config", "status.showUntrackedFiles", "no");
		const snapshot = await collectGitSnapshot(cwd, defaultConfig().git);
		assert.equal(snapshot.staged, 1);
		assert.equal(snapshot.unstaged, 1);
		assert.equal(snapshot.untracked, 2);
		assert.deepEqual(Reflect.get(snapshot, "summary"), { files: 3, additions: 2, deletions: 1 });
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
