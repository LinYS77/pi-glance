import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getSettingsRows } from "../../src/settings/catalog.js";
import { paneHarness, keys as k } from "../support/pane-harness.js";

test("Activity offers one display choice and five retained effect controls, inactive in Text", () => {
	const h = paneHarness();
	try {
		h.press(k.tab, k.tab);
		assert.match(h.text(), /\[ Activity \]/);
		assert.deepEqual(getSettingsRows(h.config, "working").map(r => r.label), ["Display mode", "Effect area", "Sweep speed", "Effect color", "Compaction / summary speed", "Retry blink rate"]);
		assert.match(h.text(), /Display mode\s+Text/);
		assert.equal(h.pending(), 0);
		h.press(k.down, k.down, k.right);
		assert.match(h.text(), /48 cols\/s/);
		assert.match(h.text(), /Used in Sweep mode/);
		assert.equal(h.pending(), 0, "editing stored effect parameters must not turn Text into Sweep");
		h.press("s");
		const done = h.completion(); assert.ok(done?.action === "save");
		assert.equal(done.config.editor.activityMode, "text");
		assert.equal(done.config.editor.workingSweepSpeed, 48);
	} finally { h.pane.dispose(); }
});

test("fractional fields have their own steps, limits and local confirmation/cancellation", () => {
	const h = paneHarness();
	try {
		h.press(k.tab, k.tab, ...Array(4).fill(k.down), k.enter, "1.35", k.enter);
		assert.match(h.text(), /1\.35× · 63\.45 cols\/s/);
		h.press(k.right); assert.match(h.text(), /1\.40×/);
		h.press(k.enter, "0.2", k.enter);
		assert.match(h.text(), /0\.25 to 2/);
		h.press(k.esc); assert.match(h.text(), /1\.40×/);
		h.press(k.down, k.enter, "0.75", k.enter, k.right);
		assert.match(h.text(), /1\.00 Hz/);
		h.press(k.enter, "1.234", k.enter);
		assert.match(h.text(), /2 decimals/);
		h.press(k.esc, "s");
		const done = h.completion(); assert.ok(done?.action === "save");
		assert.equal(done.config.editor.summarySpeedMultiplier, 1.4);
		assert.equal(done.config.editor.retryBlinkHz, 1);
		assert.equal(done.config.editor.activityMode, "text");
		assert.equal(h.config.editor.summarySpeedMultiplier, 0.5);
	} finally { h.pane.dispose(); }
});

test("Activity previews follow the field and chosen mode, with transient scenarios and no hidden clock", () => {
	const h = paneHarness();
	try {
		h.press(k.tab, k.tab);
		assert.match(h.text(), /Preview · Example · Text · Working/);
		assert.equal(h.pending(), 0);
		h.press("p"); assert.match(h.text(), /Text · Compacting/);
		assert.match(h.text(), /No changes/);
		h.press(k.right); h.text(); assert.equal(h.pending(), 1);
		h.press(...Array(4).fill(k.down));
		assert.match(h.text(), /Sweep · Compacting · 23\.5 cols\/s/);
		h.press(k.down); assert.match(h.text(), /Sweep · Retrying · 0\.50 Hz/);
		const bright = h.pane.render(180).at(-1);
		h.advance(1000); const normal = h.pane.render(180).at(-1);
		assert.notEqual(bright, normal);
		h.advance(1000); assert.equal(h.pane.render(180).at(-1), bright);
		h.press("p"); assert.match(h.text(), /Idle with draft/); assert.equal(h.pending(), 0);
		h.press("p", k.right); assert.match(h.text(), /Sweep · Working/);
		h.height(12); h.text(); assert.equal(h.pending(), 0);
		h.advance(5000); h.height(40); h.text(); assert.equal(h.pending(), 1);
		h.press(...Array(5).fill(k.up), k.left); h.text(); assert.equal(h.pending(), 0);
		h.press("s"); assert.equal(h.pending(), 0);
		const done = h.completion(); assert.ok(done?.action === "save");
		assert.equal(done.config.editor.activityMode, "text");
		assert.equal(done.config.editor.retryBlinkHz, 0.75);
		assert.ok(!JSON.stringify(done.config).includes("preview"));
	} finally { h.pane.dispose(); }
});
