import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getSettingsRows } from "../../src/settings/catalog.js";
import { defaultConfig } from "../../src/config/model.js";
import { paneHarness, keys as k } from "../support/pane-harness.js";

test("top-level sections do not repeat their tab as a second heading", () => {
	const h = paneHarness();
	try {
		const lines = h.text().split("\n");
		assert.equal(lines.filter(line => line.trim() === "Appearance").length, 0);
		assert.ok(lines.some(line => line.includes("[ Appearance ]")));
		h.press(k.tab, k.enter);
		assert.ok(h.text().split("\n").some(line => line.trim() === "Status line / Git"));
	} finally { h.pane.dispose(); }
});

test("derived activity values stay in the hint instead of making the row too wide", () => {
	const rows = getSettingsRows(defaultConfig(), "working");
	assert.deepEqual(rows.map(row => row.label), ["Display mode", "Effect area", "Sweep speed", "Effect color", "Summary multiplier", "Retry blink"]);
	const summary = rows.find(row => row.id === "activity.summarySpeed");
	assert.ok(summary);
	assert.equal(summary.value, "0.50×");
	assert.match(summary.hint, /23\.5 cols\/s/);
	const h = paneHarness();
	try {
		h.press(k.tab, k.tab, ...Array(4).fill(k.down));
		assert.match(h.text(40), /Summary multiplier/);
		assert.match(h.text(40), /0\.50×/);
		assert.match(h.text(40), /Stored setting\. Used in Sweep mode/);
	} finally { h.pane.dispose(); }
});

test("palette and preview source are explicit without implying a Pi theme change", () => {
	const h = paneHarness();
	try {
		assert.match(h.text(), /Preview · Live/);
		h.press(k.down, k.enter, k.down);
		assert.match(h.text(), /Preview · Light palette · Live/);
		assert.match(h.text(), /Does not change Pi's theme/);
	} finally { h.pane.dispose(); }
});

test("input settings show an example draft and the configured stash shortcut", () => {
	const h = paneHarness();
	try {
		h.press(k.tab, k.tab, k.tab, k.down, k.down);
		assert.match(h.text(), /Example draft/);
		h.press(k.down);
		assert.match(h.text(), /Example shortcut · alt\+s/);
	} finally { h.pane.dispose(); }
});

test("extension details describe the preview as a lower read-only output", () => {
	const config = defaultConfig();
	const statuses = new Map([["worker", "Working"]]);
	const h = paneHarness(config, { getExtensionStatuses: () => statuses });
	try {
		h.press(k.tab, ...Array(5).fill(k.down), k.enter);
		assert.match(h.text(), /Live, read-only setStatus\(\) output/);
		assert.match(h.text(), /The preview below may omit publisher text/);
	} finally { h.pane.dispose(); }
});
