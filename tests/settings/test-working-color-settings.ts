import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { getSettingsRows } from "../../src/settings/catalog.js";
import { paneHarness, keys as k } from "../support/pane-harness.js";
import { stripAnsi } from "../support/surface-test-harness.js";

function frame(lines: string[]): string[] {
	const first = lines.findIndex(line => stripAnsi(line).trimStart().startsWith("╭"));
	const last = lines.findIndex(line => stripAnsi(line).trimStart().startsWith("╰"));
	assert.ok(first >= 0 && last > first);
	return lines.slice(first, last + 1);
}

test("Working has a theme-aware color picker with live preview, confirm and cancel", () => {
	const h = paneHarness();
	try {
		const row = getSettingsRows(h.config, "working").find(row => row.id === "working.color");
		assert.ok(row && row.kind === "choice");
		assert.equal(row.value, "Theme default");
		assert.deepEqual(row.options.map(o => o.label), ["Theme default", "Amber", "Rose", "Violet", "Blue", "Teal", "Mint", "Coral", "Copper"]);
		h.press(k.backTab, k.backTab, k.down, k.down);
		h.advance(1200);
		const before = frame(h.pane.render(100));
		h.press(k.enter, k.down);
		const preview = frame(h.pane.render(100));
		assert.notDeepEqual(preview, before);
		assert.deepEqual(preview.map(stripAnsi), before.map(stripAnsi));
		assert.equal(h.pending(), 1, "changing color must not duplicate or restart the clock");
		h.press(k.esc);
		assert.deepEqual(frame(h.pane.render(100)), before, "cancel restores color at the same beam position");
		h.press(k.enter, k.down, k.enter, "s");
		const saved = h.completion(); assert.ok(saved?.action === "save");
		assert.equal(saved.config.editor.workingSweepColor, "amber");
		assert.equal(h.config.editor.workingSweepColor, "theme");
		assert.equal(h.pending(), 0);
	} finally { h.pane.dispose(); }
});

test("color can be configured while animation is off without starting a clock", () => {
	const h = paneHarness();
	try {
		h.press(k.backTab, k.backTab, k.right, k.right, k.down, k.down);
		assert.equal(h.pending(), 0);
		assert.match(h.text(), /Turn animation on to preview colors/);
		h.press(k.enter, k.down, k.down, k.down, k.down, k.enter, "s");
		const saved = h.completion(); assert.ok(saved?.action === "save");
		assert.equal(saved.config.editor.workingSweepColor, "blue");
		assert.equal(saved.config.editor.workingSweep, "off");
		assert.equal(h.pending(), 0);
	} finally { h.pane.dispose(); }
});

test("the last color stays reachable and saves correctly when the picker must scroll", () => {
	const h = paneHarness();
	try {
		h.height(18);
		h.press(k.backTab, k.backTab, k.down, k.down, k.enter);
		h.text(64);
		h.press(...Array(8).fill(k.down));
		assert.match(h.text(64), /→\s+Copper/);
		const lines = h.pane.render(64);
		assert.ok(lines.length <= 16);
		for (const line of lines) assert.ok(visibleWidth(line) <= 64);
		h.press(k.enter, "s");
		const saved = h.completion(); assert.ok(saved?.action === "save");
		assert.equal(saved.config.editor.workingSweepColor, "copper");
		assert.equal(h.config.editor.workingSweepColor, "theme");
		assert.equal(h.pending(), 0);
	} finally { h.pane.dispose(); }
});
