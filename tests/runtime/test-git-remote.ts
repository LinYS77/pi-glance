import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GitRemoteRefresh } from "../../src/runtime/git-remote.js";
import { parseGitStatus } from "../../src/runtime/git-snapshot.js";

test("background fetch targets the actual upstream, refreshes local facts and respects its interval", async () => {
	let now = 0, refreshed = 0;
	const calls: string[][] = [];
	const remote = new GitRemoteRefresh(() => refreshed++, {
		now: () => now,
		command: async (_cwd, args, options) => {
			calls.push([...args]);
			if (args[0] === "for-each-ref") return { ok: true, stdout: "team\0refs/heads/release\0refs/remotes/team/release\n", stderr: "" };
			assert.equal(options.network, true);
			assert.ok(args.includes("team"));
			assert.ok(args.includes("+refs/heads/release:refs/remotes/team/release"));
			return { ok: true, stdout: "", stderr: "" };
		},
	});
	const snapshot = parseGitStatus("# branch.head feature\n# branch.upstream team/release\n");
	await remote.refresh("/repo", snapshot);
	assert.equal(refreshed, 1);
	await remote.refresh("/repo", snapshot);
	assert.equal(calls.length, 2);
	now = 5 * 60_000;
	await remote.refresh("/repo", snapshot);
	assert.equal(refreshed, 2);
	remote.dispose();
	await remote.refresh("/repo", snapshot);
	assert.equal(refreshed, 2);
});
