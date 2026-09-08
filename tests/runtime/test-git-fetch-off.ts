import { strict as assert } from "node:assert";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { GitRefresher } from "../../src/runtime/git.js";

test("turning off auto-fetch cancels a running network child while local refresh remains available", { skip: process.platform === "win32" }, async () => {
	const directory = mkdtempSync(join(tmpdir(), "glance-fetch-off-"));
	const previousPath = process.env.PATH;
	const config = defaultConfig().git; config.changes = "marker";
	let snapshots = 0;
	const refresher = new GitRefresher(() => config, () => directory, () => snapshots++);
	try {
		const executable = join(directory, "git");
		writeFileSync(executable, `#!/bin/sh
case "$2" in
status) printf '# branch.oid 0123456789012345678901234567890123456789\\0# branch.head main\\0# branch.upstream origin/main\\0' ;;
for-each-ref) printf 'origin\\0refs/heads/main\\0refs/remotes/origin/main\\n' ;;
fetch) touch fetch-started; sleep 1; touch fetch-finished ;;
esac
`);
		chmodSync(executable, 0o700);
		process.env.PATH = `${directory}:${previousPath}`;
		refresher.schedule(true);
		const deadline = Date.now() + 5000;
		while (!existsSync(join(directory, "fetch-started")) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
		assert.ok(existsSync(join(directory, "fetch-started")));
		const before = snapshots;
		config.autoFetch = false; refresher.schedule(true);
		await new Promise(resolve => setTimeout(resolve, 1200));
		assert.equal(existsSync(join(directory, "fetch-finished")), false);
		assert.ok(snapshots > before, "local status keeps working after network work is disabled");
	} finally {
		refresher.dispose();
		process.env.PATH = previousPath;
		rmSync(directory, { recursive: true, force: true });
	}
});
