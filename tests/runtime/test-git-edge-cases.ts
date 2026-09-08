import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { collectGitSnapshot } from "../../src/runtime/git.js";
import { parseGitDiffStat } from "../../src/runtime/git-snapshot.js";

function repository() {
	const root = mkdtempSync(join(tmpdir(), "glance-git-cases-"));
	const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=/dev/null", ...args], { stdio: "pipe" });
	git("init", "-qb", "main");
	const commit = () => git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");
	return { root, git, commit, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("unborn repositories, rename paths and binary files retain accurate file counts", async () => {
	const r = repository();
	try {
		const config = defaultConfig().git;
		writeFileSync(join(r.root, "first.txt"), "one\ntwo\n"); r.git("add", ".");
		writeFileSync(join(r.root, "first.txt"), "one\ntwo\nthree\n");
		const unborn = await collectGitSnapshot(r.root, config);
		assert.equal(unborn.sha, null);
		assert.deepEqual(unborn.summary, { files: 1, additions: 3, deletions: 0 });
		r.git("add", "."); r.commit();
		const name = "new\nname\tfile.txt";
		r.git("mv", "first.txt", name);
		writeFileSync(join(r.root, name), "one\ntwo\nthree\nfour\n");
		const rename = await collectGitSnapshot(r.root, config);
		assert.deepEqual(rename.summary, { files: 1, additions: 1, deletions: 0 });
		assert.equal(rename.staged, 1); assert.equal(rename.unstaged, 1);
		writeFileSync(join(r.root, "binary"), Buffer.from([0, 1, 2])); r.git("add", ".");
		const binary = await collectGitSnapshot(r.root, config);
		assert.deepEqual(binary.summary, { files: 2, additions: null, deletions: null });
	} finally { r.close(); }
});

test("numstat skips rename paths even if a filename looks like another statistics record", () => {
	assert.deepEqual(parseGitDiffStat("2\t1\t\0old\x00999\t888\tfake\0"), { additions: 2, deletions: 1 });
	assert.equal(parseGitDiffStat("-\t-\tbinary\0"), undefined);
	assert.equal(parseGitDiffStat("2\t1\t\0missing-path\0"), undefined);
});

test("linked worktrees use their own status and no user diff driver is executed", async () => {
	const r = repository();
	const linked = r.root + "-linked";
	try {
		writeFileSync(join(r.root, "file.txt"), "old\n"); r.git("add", "."); r.commit();
		r.git("worktree", "add", "-qb", "topic", linked);
		const marker = join(r.root, "driver-ran");
		r.git("config", "diff.external", `touch ${marker}`);
		writeFileSync(join(linked, "file.txt"), "new\nextra\n");
		const snapshot = await collectGitSnapshot(linked, defaultConfig().git);
		assert.equal(snapshot.branch, "topic");
		assert.deepEqual(snapshot.summary, { files: 1, additions: 2, deletions: 1 });
		assert.equal(existsSync(marker), false);
		assert.equal((await collectGitSnapshot(r.root, defaultConfig().git)).status, "clean");
	} finally { rmSync(linked, { recursive: true, force: true }); r.close(); }
});
