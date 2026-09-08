import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig, configToText, configFromText } from "../../src/config/model.js";
import { getSettingsRows, getThemeCatalogForSlot, SETTINGS_SECTIONS, type SettingsSectionId } from "../../src/settings/catalog.js";
import { SEGMENT_IDS, type SegmentId } from "../../src/segments/registry.js";

test("four sections have stable, user-facing labels and one home for each setting", () => {
	const config = defaultConfig();
	assert.deepEqual(SETTINGS_SECTIONS.map(s => s.label), ["Appearance", "Status line", "Working", "Input"]);
	assert.deepEqual(getSettingsRows(config, "appearance").map(row => [row.label, row.value]), [
		["Glance", "On"], ["Light palette", "Light"], ["Dark palette", "Dark"], ["Icons", "Nerd Font"],
		["Workspace label", "Smart path"],
	]);
	assert.deepEqual(getSettingsRows(config, "input").map(row => [row.label, row.value]), [
		["Editor height", "3 rows"], ["Space above editor", "1 row"], ["Prompt stash", "On"], ["Stash shortcut", "alt+s"],
	]);
	assert.deepEqual(getSettingsRows(config, "working").map(row => [row.label, row.value]), [["Animation", "Full border"], ["Sweep speed", "47 cols/s"]]);
	const rows = [...SETTINGS_SECTIONS.flatMap(s => getSettingsRows(config, s.id)), ...SEGMENT_IDS.flatMap(id => getSettingsRows(config, "status", id))];
	assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
	for (const row of rows) {
		assert.ok(row.hint.length && row.hint.length < 130);
		assert.ok(row.label.length < 26);
		assert.ok(!["input-output", "percent+tokens", "read-write", "nerd", "auto"].includes(row.value));
	}
});

test("all choices are directly selectable, immutable and round-trip through saved config", () => {
	const config = defaultConfig(), before = structuredClone(config);
	const rows = [...getSettingsRows(config, "appearance"), ...getSettingsRows(config, "input"), ...getSettingsRows(config, "working"), ...SEGMENT_IDS.flatMap(id => getSettingsRows(config, "status", id))];
	for (const row of rows) {
		if (row.kind !== "choice" && row.kind !== "toggle") continue;
		assert.equal(new Set(row.options.map(o => o.label)).size, row.options.length);
		for (let index = 0; index < row.options.length; index++) {
			const next = row.select(config, index);
			const section: SettingsSectionId = row.id.startsWith("appearance") ? "appearance" : row.id.startsWith("input") ? "input" : row.id.startsWith("working") ? "working" : "status";
			const segment: SegmentId | undefined = SEGMENT_IDS.find(id => row.id.startsWith(id + "."));
			assert.equal(getSettingsRows(next, section, segment).find(r => r.id === row.id)!.value, row.options[index]!.label);
			assert.deepEqual(configFromText(configToText(next)), next);
			assert.deepEqual(config, before);
		}
	}
});

test("status order, disabled entries, custom refresh values and all 22 palettes survive regrouping", () => {
	const config = defaultConfig();
	config.segments.reverse(); config.segments[0]!.enabled = false;
	config.git.pollIntervalMs = 7500;
	assert.deepEqual(getSettingsRows(config, "status").map(r => r.value), ["Off", "On", "On", "On", "On", "On"]);
	assert.equal(getSettingsRows(config, "status")[0]!.label, "Model");
	assert.equal(getSettingsRows(config, "status", "git").find(r => r.id === "git.polling")!.value, "7.5 seconds");
	for (const slot of ["light", "dark"] as const) {
		const catalog = getThemeCatalogForSlot(slot);
		assert.equal(catalog.length, 22);
		assert.equal(new Set(catalog.map(c => c.id)).size, 22);
		assert.equal(catalog[0]!.tone, slot);
	}
});
