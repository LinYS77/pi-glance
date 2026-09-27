import { strict as assert } from "node:assert";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { GlanceConfig } from "../../src/types.js";
import { paneHarness, keys as k } from "../support/pane-harness.js";

test("failed save keeps the draft and selected row for retry, closing only after persistence succeeds", async () => {
	const attempts: GlanceConfig[] = [];
	const options = {
		previewNowMs: () => 0,
		commit: async (config: GlanceConfig) => {
			attempts.push(config);
			return attempts.length === 1
				? { status: "failed" as const, message: "DEMO disk unavailable" }
				: { status: "saved" as const };
		},
	};
	const h = paneHarness(undefined, options);
	try {
		h.press(k.tab, k.tab, k.down, k.down, k.right, "s");
		await setImmediate();
		assert.equal(h.completion(), undefined, "a rejected commit does not destroy the editing session");
		assert.match(h.text(), /DEMO disk unavailable/);
		assert.match(h.text(), /› Sweep speed \*\s+‹ 48 cols\/s ›/);
		h.press("s"); await setImmediate();
		const result = h.completion();
		assert.ok(result?.action === "save");
		assert.equal(result.config.editor.workingSweepSpeed, 48);
		assert.deepEqual(attempts[1], attempts[0], "retry submits the retained draft");
		assert.equal(h.config.editor.workingSweepSpeed, 47, "editing does not mutate the active config");
	} finally { h.pane.dispose(); }
});

test("pending migration is visible and can be saved without changing the draft", async () => {
	let saved: GlanceConfig | undefined;
	const h = paneHarness(undefined, { persistence: { writable: true, notice: "Upgrade ready" },
		commit: async config => { saved = config; return { status: "saved" }; } });
	try {
		assert.match(h.text(), /Upgrade ready/);
		h.press("s"); await setImmediate();
		assert.deepEqual(saved, h.config);
		assert.equal(h.completion()?.action, "save");
	} finally { h.pane.dispose(); }
});

test("saving exposes only close, prevents duplicate submissions, and ignores a late completion after close", async () => {
	let resolve!: (result: { status: "saved" }) => void;
	let attempts = 0;
	const pending = new Promise<{ status: "saved" }>(done => { resolve = done; });
	const h = paneHarness(undefined, { commit: () => { attempts++; return pending; } });
	try {
		h.press("s", "s", k.space);
		assert.match(h.text(), /Saving/);
		assert.doesNotMatch(h.text(), /Save & close|\[R\] Reset/);
		assert.match(h.text(), /\[Ctrl\+C\] Close/);
		assert.equal(attempts, 1);
		h.press("\x03");
		const renders = h.renders();
		resolve({ status: "saved" }); await setImmediate();
		assert.deepEqual(h.completion(), { action: "cancel" });
		assert.equal(h.renders(), renders);
		assert.equal(h.pending(), 0);
	} finally { h.pane.dispose(); }
});

test("read-only settings explain the restriction in the pane and never submit a draft", async () => {
	let attempts = 0;
	const h = paneHarness(undefined, {
		commit: async () => { attempts++; return { status: "saved" }; },
		...{ persistence: { writable: false, diagnostic: "DEMO future configuration; fix the file and /reload." } },
	});
	try {
		assert.match(h.text(), /Read-only/);
		assert.match(h.text(), /DEMO future configuration/);
		assert.doesNotMatch(h.text(), /Save & close/);
		h.press(k.tab, k.tab, k.down, k.down, k.right, "s"); await setImmediate();
		assert.equal(attempts, 0);
		assert.equal(h.completion(), undefined);
		assert.match(h.text(), /48 cols\/s/, "read-only configuration still allows a non-persistent preview");
	} finally { h.pane.dispose(); }
});
