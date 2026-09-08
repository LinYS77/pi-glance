import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseKey, type KeybindingsConfig } from "@earendil-works/pi-tui";
import { normalizeStashShortcut } from "../../src/input/shortcut.js";
import { shortcutConflict } from "../../src/input/keybinding.js";
import { configFromText, configToText, defaultConfig, normalizeConfig } from "../../src/config/model.js";

test("v0.7 uses Summary for new installs and every legacy dirty preference without enabling disabled Git", () => {
	assert.equal(defaultConfig().git.changes, "summary");
	for (const version of [undefined, 1, 5, 8, 9, 10, 11]) for (const showDirty of [true, false, undefined]) {
		const config = normalizeConfig({ version, git: { showDirty }, segments: [{ id: "git", enabled: false }] });
		assert.equal(config.git.changes, "summary");
		assert.equal(config.segments.find(s => s.id === "git")?.enabled, false);
		assert.equal(Object.hasOwn(config.git, "showDirty"), false);
		assert.deepEqual(configFromText(configToText(config)), config);
	}
});

test("current choices survive round trips and unsafe or incomplete shortcuts cannot become plain typing", () => {
	for (const changes of ["hidden", "marker", "summary"] as const) {
		const config = defaultConfig(); config.git.changes = changes; config.git.autoFetch = false;
		config.editor.stashEnabled = false; config.editor.stashShortcut = "ctrl+alt+x";
		assert.deepEqual(configFromText(configToText(config)), config);
	}
	for (const value of ["s", "shift+s", "enter", "ctrl+", "ctrl+ctrl+s", "alt+foo", "alt+\n", "ctrl+x ctrl+s", null]) {
		assert.equal(normalizeStashShortcut(value), undefined);
		assert.equal(normalizeConfig({ editor: { stashShortcut: value } }).editor.stashShortcut, "alt+s");
	}
	assert.equal(normalizeStashShortcut("Alt+Ctrl+X"), "ctrl+alt+x");
	assert.equal(normalizeStashShortcut("F6"), "f6");
	const manager = { getEffectiveConfig: (): KeybindingsConfig => ({ "tui.input.tab": "tab", "app.editor.external": "ctrl+g" }) };
	assert.equal(shortcutConflict("\x1bs", "alt+s", manager), undefined);
	assert.equal(shortcutConflict("\t", "ctrl+i", manager), "tui.input.tab");
	assert.equal(shortcutConflict("\x07", parseKey("\x07")!, manager), "app.editor.external");
});
