import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../src/config/model.js";
import { createPaneModel, createPaneViewModel, updatePaneModel, type PaneModelState } from "../src/settings/model.js";

// Compile-time contracts: browser data is mandatory in browser state and absent in settings.
function checkStateTypes(base: PaneModelState): void {
	// @ts-expect-error a theme browser cannot exist without its navigation/restore state
	const missingBrowser: PaneModelState = { ...base, subview: "themeBrowser", themeBrowser: undefined };
	if (base.subview === "themeBrowser") {
		// @ts-expect-error settings cannot retain browser-only state
		const staleBrowser: PaneModelState = { ...base, subview: "settings" };
		void staleBrowser;
	}
	void missingBrowser;
}
void checkStateTypes;

test("preview view model carries draft, density and edited slot through accept and restore", () => {
	const initial = defaultConfig();
	const root = createPaneModel(initial);
	const opened = updatePaneModel({ ...root, focus: "values", settingIndex: 2 }, { type: "activate" }).model;
	const previewed = updatePaneModel(opened, { type: "move", direction: "down" }).model;
	const dense = updatePaneModel(previewed, { type: "cyclePreviewDensity" }).model;
	const view = createPaneViewModel(dense, 120);
	assert.equal(view.preview.ambientTone, "dark");
	assert.equal(view.preview.density, "full");
	assert.equal(view.preview.config.theme.dark, "catppuccin-mocha");
	assert.equal(initial.theme.dark, "dark");
	const restored = createPaneViewModel(updatePaneModel(dense, { type: "back" }).model, 120);
	assert.equal(restored.preview.ambientTone, undefined);
	assert.equal(restored.preview.config.theme.dark, "dark");
	assert.equal(restored.dirty, false);
	const accepted = createPaneViewModel(updatePaneModel(dense, { type: "activate" }).model, 120);
	assert.equal(accepted.preview.ambientTone, undefined);
	assert.equal(accepted.preview.config.theme.dark, "catppuccin-mocha");
	assert.equal(accepted.dirty, true);
});
