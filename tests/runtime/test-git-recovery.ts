import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GitRefresher } from "../../src/runtime/git.js";
import { parseGitStatus, emptyGitSnapshot } from "../../src/runtime/git-snapshot.js";
import { defaultConfig } from "../../src/config/model.js";
import type { GitSnapshot } from "../../src/types.js";

test("a transient Git failure retains the previous branch, a successful retry clears stale, and another cwd cannot inherit it", async () => {
	const config = defaultConfig().git; config.autoFetch = false;
	const good = parseGitStatus("# branch.head main\n1 .M N... 100644 100644 100644 a b file\n");
	const results = [good, { ...emptyGitSnapshot(), stale: true }, good, { ...emptyGitSnapshot(), stale: true }];
	const seen: GitSnapshot[] = [];
	let cwd = "/one", timer: (() => void) | undefined;
	const refresher = new GitRefresher(() => config, () => cwd, (_cwd, snapshot) => seen.push(snapshot), {
		collect: async () => results.shift()!,
		setTimer: callback => { timer = callback; return { unref() {} } as unknown as NodeJS.Timeout; },
	});
	async function fire() { const next = timer!; timer = undefined; next(); await new Promise<void>(resolve => setImmediate(resolve)); }
	refresher.schedule(true); await fire();
	assert.equal(seen[0]!.branch, "main");
	await fire(); assert.equal(seen[1]!.branch, "main"); assert.equal(seen[1]!.stale, true);
	await fire(); assert.equal(seen[2]!.stale, undefined);
	cwd = "/two"; await fire(); assert.equal(seen[3]!.repo, false); assert.equal(seen[3]!.branch, null);
	refresher.dispose();
});

test("disposing a local Git collection aborts its public signal and suppresses completion", async () => {
	const config = defaultConfig().git; config.autoFetch = false;
	let task: (() => void) | undefined, signal: AbortSignal | undefined, complete: (() => void) | undefined, delivered = 0;
	const refresher = new GitRefresher(() => config, () => "/repo", () => delivered++, {
		collect: async (_cwd, _config, active) => { signal = active; await new Promise<void>(resolve => complete = resolve); return emptyGitSnapshot(); },
		setTimer: callback => { task = callback; return { unref() {} } as unknown as NodeJS.Timeout; },
	});
	refresher.schedule(true); task!();
	refresher.dispose(); assert.equal(signal?.aborted, true);
	complete!(); await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(delivered, 0);
});
