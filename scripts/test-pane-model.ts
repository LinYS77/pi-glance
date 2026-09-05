import { strict as assert } from "node:assert";
import { cloneConfig, defaultConfig } from "../config.js";
import { getSettingsCategories, getThemeCatalogForSlot } from "../settings-catalog.js";
import { GLANCE_THEMES, themeLabel } from "../themes.js";
import type { GlanceThemeSlot } from "../theme-selection.js";
import type { GlanceConfig, GlanceThemeName, SegmentId } from "../types.js";

import { createPaneModel, createPaneViewModel, paneIsDirty, updatePaneModel, type PaneFocus, type PaneMoveDirection as MoveDirection, type PaneModelState, type GlancePaneViewModel, type HelpShortcut } from "../pane-model.js";

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function view(model: PaneModelState, width = 120): GlancePaneViewModel {
	return createPaneViewModel(model, width);
}

function selectedSetting(model: GlancePaneViewModel): GlancePaneViewModel["settings"][number] {
	const row = model.settings.find((candidate) => candidate.selected);
	assert.ok(row, "expected one selected setting row");
	return row;
}

function categoryById(model: GlancePaneViewModel, id: string): GlancePaneViewModel["categories"][number] {
	const category = model.categories.find((candidate) => candidate.id === id);
	assert.ok(category, `expected category ${id}`);
	return category;
}

function move(model: PaneModelState, direction: MoveDirection): ReturnType<typeof updatePaneModel> {
	return updatePaneModel(model, { type: "move", direction });
}

function withFocus(model: PaneModelState, focus: PaneFocus, categoryIndex = model.categoryIndex, settingIndex = model.settingIndex): PaneModelState {
	return { ...model, focus, categoryIndex, settingIndex };
}

function activateThemeRow(model: PaneModelState): ReturnType<typeof updatePaneModel> {
	return updatePaneModel(withFocus(model, "values", 0, 1), { type: "activate" });
}

function activateDarkThemeRow(model: PaneModelState): ReturnType<typeof updatePaneModel> {
	return updatePaneModel(withFocus(model, "values", 0, 2), { type: "activate" });
}

function segmentOrder(config: GlanceConfig): SegmentId[] {
	return config.segments.map((segment) => segment.id);
}

function lightTheme(config: GlanceConfig): GlanceThemeName {
	return config.theme.light;
}

function darkTheme(config: GlanceConfig): GlanceThemeName {
	return config.theme.dark;
}

function setLightTheme(config: GlanceConfig, theme: GlanceThemeName): void {
	config.theme = { ...config.theme, light: theme };
}

function setDarkTheme(config: GlanceConfig, theme: GlanceThemeName): void {
	config.theme = { ...config.theme, dark: theme };
}

function assertHelp(actual: HelpShortcut[], expected: HelpShortcut[], message: string): void {
	assert.deepEqual(actual, expected, message);
}

function assertCancel(result: ReturnType<typeof updatePaneModel>, message: string): void {
	assert.equal(result.requestRender, false, `${message}: cancel should not request render`);
	assert.equal(result.completion?.action, "cancel", `${message}: should complete with cancel`);
}

const config = defaultConfig();
const model = createPaneModel(config);

assert.equal(model.focus, "categories", "initial focus should be categories");
assert.equal(model.subview, "settings", "initial subview should be normal settings");
assert.equal(model.themeBrowser, undefined, "initial model should not carry theme browser state");
assert.equal(model.categoryIndex, 0, "initial category index should select General");
assert.equal(model.settingIndex, 0, "initial setting index should select the first row");
assert.equal(model.status, "", "initial status should be empty");
assert.equal(model.previewDensity, "auto", "initial preview density should follow the pane width automatically");
assert.deepEqual(model.initial, config, "initial model should preserve the supplied config value");
assert.deepEqual(model.draft, config, "initial draft should start from the supplied config value");
assert.notEqual(model.initial, config, "initial config should be cloned away from the caller input");
assert.notEqual(model.draft, config, "draft config should be cloned away from the caller input");
assert.notEqual(model.initial, model.draft, "initial and draft should be independent clones");

const callerConfig = defaultConfig();
const callerModel = createPaneModel(callerConfig);
callerConfig.enabled = false;
assert.equal(callerModel.initial.enabled, true, "mutating caller config after create should not mutate model.initial");
assert.equal(callerModel.draft.enabled, true, "mutating caller config after create should not mutate model.draft");

const initialView = view(model);
assert.equal(initialView.dirty, false, "initial view should not be dirty");
assert.equal(paneIsDirty(model), false, "initial model should not be dirty");
assert.equal(initialView.status, "", "initial view status should be empty");
assert.equal(initialView.previewDensity, "auto", "initial view should expose automatic preview density");
assert.equal(initialView.previewDensityLabel, "Auto", "initial view should expose a friendly automatic density label");
assert.equal(initialView.subview, "settings", "initial view should expose the normal settings subview");
assert.equal(initialView.themeBrowser, undefined, "initial view should not expose theme browser data");
assert.equal(initialView.selectedCategory?.id, "general", "initial view should select General");
assert.equal(initialView.settingsTitle, "General", "initial settings title should be General");
assert.deepEqual(
	initialView.categories.map((category) => ({ id: category.id, label: category.label, enabled: category.enabled, selected: category.selected })),
	[
		{ id: "general", label: "General", enabled: undefined, selected: true },
		{ id: "git", label: "Git", enabled: true, selected: false },
		{ id: "cost", label: "Cost", enabled: true, selected: false },
		{ id: "throughput", label: "Model speed", enabled: true, selected: false },
		{ id: "context", label: "Context", enabled: true, selected: false },
		{ id: "tokens", label: "Tokens", enabled: false, selected: false },
		{ id: "model", label: "Model", enabled: true, selected: false },
	],
	"view categories should start with General and then follow config.segments order/enabled flags",
);
assert.deepEqual(
	{
		id: selectedSetting(initialView).id,
		label: selectedSetting(initialView).label,
		value: selectedSetting(initialView).value,
		hint: selectedSetting(initialView).hint,
		kind: selectedSetting(initialView).kind,
		editable: selectedSetting(initialView).editable,
		selected: selectedSetting(initialView).selected,
		labelHasFocus: selectedSetting(initialView).labelHasFocus,
		valueHasFocus: selectedSetting(initialView).valueHasFocus,
	},
	{
		id: "general.enabled",
		label: "Enabled",
		value: "on",
		hint: "Temporarily disable pi-glance.",
		kind: "toggle",
		editable: true,
		selected: true,
		labelHasFocus: false,
		valueHasFocus: false,
	},
	"initial selected setting should be the General enabled toggle without setting/value focus",
);
assert.equal(categoryById(initialView, "general").hasFocus, true, "selected category should carry category focus initially");
assertHelp(
	initialView.help,
	[
		{ key: "←→↑↓", label: "move" },
		{ key: "S", label: "save" },
		{ key: "R", label: "reset" },
		{ key: "Enter", label: "open" },
		{ key: "J/K", label: "reorder" },
		{ key: "Esc", label: "cancel" },
	],
	"wide category help should include movement, save/reset, segment reorder, and cancel",
);

let densityModel = model;
for (const [density, label] of [
	["full", "Full"],
	["compact", "Compact"],
	["minimal", "Minimal"],
	["auto", "Auto"],
] as const) {
	const update = updatePaneModel(densityModel, { type: "cyclePreviewDensity" });
	assert.equal(update.requestRender, true, `cycling preview density to ${density} should request render`);
	assert.equal(update.completion, undefined, "preview density cycling should not complete the pane");
	assert.equal(update.model.previewDensity, density, `preview density should cycle to ${density}`);
	assert.equal(view(update.model).previewDensityLabel, label, `preview density ${density} should expose friendly label ${label}`);
	assert.deepEqual(update.model.draft, model.draft, "preview density should not mutate display config");
	assert.equal(paneIsDirty(update.model), false, "preview density should remain transient and never dirty config");
	densityModel = update.model;
}

const reorderedConfig = cloneConfig(config);
reorderedConfig.segments = [
	{ id: "model", enabled: false },
	{ id: "tokens", enabled: true },
	{ id: "cost", enabled: false },
	{ id: "context", enabled: true },
	{ id: "git", enabled: false },
];
assert.deepEqual(
	view(createPaneModel(reorderedConfig)).categories.map((category) => ({ id: category.id, enabled: category.enabled })),
	[
		{ id: "general", enabled: undefined },
		{ id: "model", enabled: false },
		{ id: "tokens", enabled: true },
		{ id: "cost", enabled: false },
		{ id: "context", enabled: true },
		{ id: "git", enabled: false },
	],
	"view categories should preserve arbitrary config segment order and enabled flags",
);

const categories = getSettingsCategories(config);
const pagedCategories = updatePaneModel(model, { type: "move", direction: "down", amount: 3 });
assert.equal(pagedCategories.model.categoryIndex, 3, "page-sized category movement should advance by the requested amount");
assert.equal(pagedCategories.model.settingIndex, 0, "page-sized category movement should still enter the new parent at its first child");

const upFromGeneral = move(model, "up");
assert.equal(upFromGeneral.requestRender, true, "category up should request render");
assert.equal(upFromGeneral.model.focus, "categories", "category up should stay in categories");
assert.equal(upFromGeneral.model.categoryIndex, categories.length - 1, "category up from General should wrap to the last category");
assert.equal(upFromGeneral.model.settingIndex, 0, "category movement should reset the child setting selection");
assert.equal(view(upFromGeneral.model).selectedCategory?.id, "model", "category up wrap should select Model, the default final segment");
assert.equal(selectedSetting(view(upFromGeneral.model)).id, "model.enabled", "entering a different category should start at its first setting");

const downToGit = move(model, "down");
assert.equal(downToGit.requestRender, true, "category down should request render");
assert.equal(downToGit.model.categoryIndex, 1, "category down from General should select Git");
assert.equal(downToGit.model.settingIndex, 0, "category movement should reset Git to its first child setting");
assert.equal(view(downToGit.model).selectedCategory?.id, "git", "category down should select Git");
assert.equal(selectedSetting(view(downToGit.model)).id, "git.enabled", "newly selected Git category should start on Enabled");

const gitSettings = move(downToGit.model, "right");
assert.equal(gitSettings.requestRender, true, "right from categories should request render");
assert.equal(gitSettings.model.focus, "settings", "right from categories should focus settings");
assert.equal(gitSettings.model.settingIndex, 0, "right from categories should preserve the category's child selection");
assert.equal(selectedSetting(view(gitSettings.model)).id, "git.enabled", "right from Git should enter its first child setting");
assert.equal(selectedSetting(view(gitSettings.model)).labelHasFocus, true, "settings focus should mark the selected label as focused");
assert.equal(selectedSetting(view(gitSettings.model)).valueHasFocus, false, "settings focus should not mark the selected value as focused");

const settingsDown = move(gitSettings.model, "down");
assert.equal(settingsDown.model.focus, "settings", "down in settings should stay in settings");
assert.equal(settingsDown.model.categoryIndex, 1, "down in settings should not change category index");
assert.equal(settingsDown.model.settingIndex, 1, "down in settings should move to the next setting row");
assert.equal(selectedSetting(view(settingsDown.model)).id, "git.dirtyMarker", "down in settings should select Dirty marker");

const leftToCategories = move(settingsDown.model, "left");
assert.equal(leftToCategories.requestRender, true, "left from settings should request render");
assert.equal(leftToCategories.model.focus, "categories", "left from settings should focus categories");
assert.equal(leftToCategories.model.categoryIndex, 1, "left from settings should preserve the parent category");
assert.equal(leftToCategories.model.settingIndex, 1, "left from settings should preserve the selected child for re-entry");
assert.equal(view(leftToCategories.model).selectedCategory?.id, "git", "left from settings should return to the Git parent category");

const gitSettingsTop = withFocus(model, "settings", 1, 0);
const settingsWrapUp = move(gitSettingsTop, "up");
assert.equal(settingsWrapUp.model.categoryIndex, 1, "up in settings should preserve category index");
assert.equal(settingsWrapUp.model.settingIndex, 4, "up from first Git setting should wrap to the last Git setting");
assert.equal(selectedSetting(view(settingsWrapUp.model)).id, "git.polling", "up in settings should wrap to Git polling");

const gitValuesBottom = withFocus(model, "values", 1, 4);
const valuesWrapDown = move(gitValuesBottom, "down");
assert.equal(valuesWrapDown.model.focus, "values", "down in values should stay in values");
assert.equal(valuesWrapDown.model.categoryIndex, 1, "down in values should preserve category index");
assert.equal(valuesWrapDown.model.settingIndex, 0, "down from last Git value should wrap to first Git value");
assert.equal(selectedSetting(view(valuesWrapDown.model)).id, "git.enabled", "down in values should wrap to Git enabled");

const leftBoundary = move(model, "left");
assert.equal(leftBoundary.requestRender, true, "left boundary should still request render to match pane behavior");
assert.equal(leftBoundary.model.focus, "categories", "left boundary should remain on categories");
assert.equal(leftBoundary.model.categoryIndex, 0, "left boundary should preserve category index");

const rightBoundary = move(withFocus(model, "values"), "right");
assert.equal(rightBoundary.requestRender, true, "right boundary should still request render to match pane behavior");
assert.equal(rightBoundary.model.focus, "values", "right boundary should remain on values");

const themeValueView = view(withFocus(model, "values", 0, 1));
assert.equal(selectedSetting(themeValueView).id, "general.theme.light", "Light theme row should occupy the first theme slot row");
assert.equal(selectedSetting(themeValueView).opensSubview, "themeBrowser", "Light theme row view should declare it opens the theme browser subview");
const darkThemeValueView = view(withFocus(model, "values", 0, 2));
assert.equal(selectedSetting(darkThemeValueView).id, "general.theme.dark", "Dark theme row should occupy the second theme slot row");
assert.equal(selectedSetting(darkThemeValueView).opensSubview, "themeBrowser", "Dark theme row view should declare it opens the theme browser subview");

const openedThemeBrowser = activateThemeRow(model);
assert.equal(openedThemeBrowser.requestRender, true, "activating Light theme row should request render");
assert.equal(openedThemeBrowser.completion, undefined, "opening theme browser should not complete the pane");
assert.equal(openedThemeBrowser.model.subview, "themeBrowser", "Theme row action should open the theme browser subview");
assert.deepEqual(openedThemeBrowser.model.themeBrowser, {
	slot: "light",
	highlightedThemeIndex: 0,
	restoreTheme: "light",
	returnFocus: "values",
	returnCategoryIndex: 0,
	returnSettingIndex: 1,
});
assert.equal(lightTheme(openedThemeBrowser.model.draft), "light", "opening should keep the current draft theme previewed");
const openedBrowserView = view(openedThemeBrowser.model);
assert.equal(openedBrowserView.subview, "themeBrowser", "theme browser view should expose the active browser subview");
assert.equal(openedBrowserView.themeBrowser?.slot, "light", "theme browser view should expose the edited light slot");
assert.equal(openedBrowserView.themeBrowser?.slotLabel, "Light theme", "theme browser view should expose a friendly slot label");
assert.equal(openedBrowserView.themeBrowser?.highlightedThemeIndex, 0, "theme browser view should highlight the draft theme");
assert.equal(openedBrowserView.themeBrowser?.savedTheme, "light", "theme browser view should keep the initial saved theme");
assert.equal(openedBrowserView.themeBrowser?.savedLabel, themeLabel("light"), "theme browser view should use friendly saved labels");
assert.equal(openedBrowserView.themeBrowser?.restoreTheme, "light", "theme browser view should keep the restore theme");
assert.equal(openedBrowserView.themeBrowser?.restoreLabel, themeLabel("light"), "theme browser view should use friendly restore labels");
assert.equal(openedBrowserView.themeBrowser?.previewTheme, "light", "theme browser view should preview the draft theme");
assert.equal(openedBrowserView.themeBrowser?.previewLabel, themeLabel("light"), "theme browser view should use friendly preview labels");
assertHelp(
	openedBrowserView.help,
	[
		{ key: "↑↓", label: "preview" },
		{ key: "Enter", label: "accept" },
		{ key: "Esc/Left", label: "restore" },
		{ key: "S", label: "save" },
	],
	"theme browser help should describe preview, accept, restore, and save",
);
assert.deepEqual(
	openedBrowserView.themeBrowser?.themes.map((theme) => ({ id: theme.id, label: theme.label, selected: theme.selected, previewed: theme.previewed, restored: theme.restored, saved: theme.saved })),
	getThemeCatalogForSlot("light").map((theme, index) => ({ id: theme.id, label: theme.label, selected: index === 0, previewed: index === 0, restored: index === 0, saved: index === 0 })),
	"theme browser view should expose all themes in light-slot order with friendly labels and markers",
);

const pagedLightSlotTheme = updatePaneModel(openedThemeBrowser.model, { type: "move", direction: "down", amount: 5 });
assert.equal(pagedLightSlotTheme.model.themeBrowser?.highlightedThemeIndex, 5, "page-sized theme movement should advance the highlighted preview by the requested amount");
assert.equal(lightTheme(pagedLightSlotTheme.model.draft), getThemeCatalogForSlot("light")[5]?.id, "page-sized theme movement should preview the target catalog theme");

const previewedLightSlotTheme = move(openedThemeBrowser.model, "down");
assert.equal(previewedLightSlotTheme.requestRender, true, "moving theme browser highlight should request render");
assert.equal(previewedLightSlotTheme.model.subview, "themeBrowser", "moving highlight should stay in the theme browser");
assert.equal(previewedLightSlotTheme.model.themeBrowser?.highlightedThemeIndex, 1, "down should highlight the next light-slot curated theme");
assert.equal(lightTheme(previewedLightSlotTheme.model.draft), "catppuccin-latte", "moving highlight should preview the highlighted light-slot theme in draft config");
assert.equal(darkTheme(previewedLightSlotTheme.model.draft), "dark", "light slot preview should preserve the dark slot");
assert.equal(previewedLightSlotTheme.model.themeBrowser?.restoreTheme, "light", "preview movement should preserve the pre-browser restore theme");
assert.equal(view(previewedLightSlotTheme.model).themeBrowser?.previewLabel, themeLabel("catppuccin-latte"), "preview movement should expose the highlighted friendly label");
assert.equal(paneIsDirty(previewedLightSlotTheme.model), true, "previewing a different initial theme should make the draft dirty");
const previewedLightTheme = move(previewedLightSlotTheme.model, "up");
assert.equal(previewedLightTheme.model.themeBrowser?.highlightedThemeIndex, 0, "up should return to the previous curated theme");
assert.equal(lightTheme(previewedLightTheme.model.draft), "light", "moving back to the restore theme should preview it again");
assert.equal(paneIsDirty(previewedLightTheme.model), false, "previewing the initial theme again should clear dirty state");

const acceptedLightSlotTheme = updatePaneModel(previewedLightSlotTheme.model, { type: "activate" });
assert.equal(acceptedLightSlotTheme.requestRender, true, "accepting a browser theme should request render");
assert.equal(acceptedLightSlotTheme.completion, undefined, "accepting a browser theme should not complete the pane");
assert.equal(acceptedLightSlotTheme.model.subview, "settings", "accepting a browser theme should return to normal settings");
assert.equal(acceptedLightSlotTheme.model.themeBrowser, undefined, "accepting should clear theme browser state");
assert.equal(lightTheme(acceptedLightSlotTheme.model.draft), "catppuccin-latte", "accepting should keep the previewed light slot theme in the draft config");
assert.equal(darkTheme(acceptedLightSlotTheme.model.draft), "dark", "accepting a light slot theme should preserve the dark slot");
assert.equal(acceptedLightSlotTheme.model.focus, "values", "accepting should restore the Light theme row value focus");
assert.equal(acceptedLightSlotTheme.model.categoryIndex, 0, "accepting should restore the General category");
assert.equal(acceptedLightSlotTheme.model.settingIndex, 1, "accepting should restore the Light theme row");
assert.equal(acceptedLightSlotTheme.model.status, "Light theme → Catppuccin Latte. Press S to save.", "accepting should describe the accepted friendly light slot label");
assert.equal(selectedSetting(view(acceptedLightSlotTheme.model)).value, "Catppuccin Latte", "Light theme row should show the accepted friendly label");
assert.equal(paneIsDirty(acceptedLightSlotTheme.model), true, "accepting a different initial theme should leave the pane dirty");
const saveAcceptedLightSlotTheme = updatePaneModel(acceptedLightSlotTheme.model, { type: "save" });
assert.equal(saveAcceptedLightSlotTheme.completion?.action, "save", "saving after browser accept should use the existing save path");
if (saveAcceptedLightSlotTheme.completion?.action !== "save") throw new Error("theme browser save completion missing");
assert.equal(lightTheme(saveAcceptedLightSlotTheme.completion.config), "catppuccin-latte", "saving after browser accept should include the accepted light slot theme");
assert.equal(darkTheme(saveAcceptedLightSlotTheme.completion.config), "dark", "saving after browser accept should preserve the dark slot");

const savePreviewedLightSlotTheme = updatePaneModel(previewedLightSlotTheme.model, { type: "save" });
assert.equal(savePreviewedLightSlotTheme.completion?.action, "save", "saving while browser previews should still use existing draft save path");
if (savePreviewedLightSlotTheme.completion?.action !== "save") throw new Error("theme browser preview save completion missing");
assert.equal(lightTheme(savePreviewedLightSlotTheme.completion.config), "catppuccin-latte", "saving while browser previews should include the previewed light slot theme");

const openedDarkThemeBrowser = activateDarkThemeRow(model);
assert.equal(openedDarkThemeBrowser.requestRender, true, "activating Dark theme row should request render");
assert.deepEqual(openedDarkThemeBrowser.model.themeBrowser, {
	slot: "dark",
	highlightedThemeIndex: 0,
	restoreTheme: "dark",
	returnFocus: "values",
	returnCategoryIndex: 0,
	returnSettingIndex: 2,
});
assert.equal(lightTheme(openedDarkThemeBrowser.model.draft), "light", "opening dark slot browser should preserve the light slot");
assert.equal(darkTheme(openedDarkThemeBrowser.model.draft), "dark", "opening dark slot browser should preview the dark slot");
const openedDarkBrowserView = view(openedDarkThemeBrowser.model);
assert.equal(openedDarkBrowserView.themeBrowser?.slot, "dark", "dark browser view should expose the edited dark slot");
assert.equal(openedDarkBrowserView.themeBrowser?.slotLabel, "Dark theme", "dark browser view should expose a friendly slot label");
assert.deepEqual(
	openedDarkBrowserView.themeBrowser?.themes.map((theme) => ({ id: theme.id, selected: theme.selected, previewed: theme.previewed, restored: theme.restored, saved: theme.saved })),
	getThemeCatalogForSlot("dark").map((theme, index) => ({ id: theme.id, selected: index === 0, previewed: index === 0, restored: index === 0, saved: index === 0 })),
	"dark browser view should expose all themes in dark-slot order with slot-specific markers",
);
const previewedDarkSlotTheme = move(openedDarkThemeBrowser.model, "down");
assert.equal(darkTheme(previewedDarkSlotTheme.model.draft), "catppuccin-mocha", "dark slot preview should update only the dark slot");
assert.equal(lightTheme(previewedDarkSlotTheme.model.draft), "light", "dark slot preview should preserve the light slot");
assert.equal(view(previewedDarkSlotTheme.model).themeBrowser?.previewLabel, themeLabel("catppuccin-mocha"), "dark slot preview should expose the highlighted friendly label");
const acceptedDarkSlotTheme = updatePaneModel(previewedDarkSlotTheme.model, { type: "activate" });
assert.equal(acceptedDarkSlotTheme.model.status, "Dark theme → Catppuccin Mocha. Press S to save.", "accepting dark slot should describe the accepted friendly dark slot label");
assert.equal(darkTheme(acceptedDarkSlotTheme.model.draft), "catppuccin-mocha", "accepting dark slot should keep the previewed dark theme");
assert.equal(lightTheme(acceptedDarkSlotTheme.model.draft), "light", "accepting dark slot should preserve the light slot");
assert.equal(acceptedDarkSlotTheme.model.settingIndex, 2, "accepting dark slot should restore the Dark theme row");
const restoredDarkSlotTheme = updatePaneModel(previewedDarkSlotTheme.model, { type: "back" });
assert.equal(darkTheme(restoredDarkSlotTheme.model.draft), "dark", "restoring dark slot should restore only that slot");
assert.equal(lightTheme(restoredDarkSlotTheme.model.draft), "light", "restoring dark slot should preserve the light slot");

const resetFromThemeBrowser = updatePaneModel(previewedLightSlotTheme.model, { type: "resetDefaults" });
assert.equal(resetFromThemeBrowser.requestRender, true, "reset from theme browser should request render");
assert.equal(resetFromThemeBrowser.model.subview, "settings", "reset from theme browser should return to normal settings");
assert.equal(resetFromThemeBrowser.model.themeBrowser, undefined, "reset from theme browser should clear browser state");
assert.deepEqual(resetFromThemeBrowser.model.draft, defaultConfig(), "reset from theme browser should restore default config through the existing reset path");
assert.equal(resetFromThemeBrowser.model.focus, "categories", "reset from theme browser should restore category focus like existing reset");
assert.equal(resetFromThemeBrowser.model.status, "Defaults restored locally. Press S to save or Esc to discard.", "reset from theme browser should keep existing reset status copy");

const restoredFromBack = updatePaneModel(previewedLightSlotTheme.model, { type: "back" });
assert.equal(restoredFromBack.requestRender, true, "Esc/back in theme browser should request render");
assert.equal(restoredFromBack.completion, undefined, "Esc/back in theme browser should not cancel the pane");
assert.equal(restoredFromBack.model.subview, "settings", "Esc/back should return to normal settings");
assert.equal(restoredFromBack.model.themeBrowser, undefined, "Esc/back should clear theme browser state");
assert.equal(lightTheme(restoredFromBack.model.draft), "light", "Esc/back should restore the pre-browser draft theme");
assert.equal(restoredFromBack.model.focus, "values", "Esc/back should restore Light theme row value focus");
assert.equal(restoredFromBack.model.categoryIndex, 0, "Esc/back should restore the General category");
assert.equal(restoredFromBack.model.settingIndex, 1, "Esc/back should restore the Light theme row");
assert.equal(paneIsDirty(restoredFromBack.model), false, "restoring the initial theme should clear preview-only dirty state");

const restoredFromLeft = move(previewedLightSlotTheme.model, "left");
assert.equal(restoredFromLeft.requestRender, true, "Left in theme browser should request render");
assert.equal(restoredFromLeft.model.subview, "settings", "Left should return to normal settings");
assert.equal(lightTheme(restoredFromLeft.model.draft), "light", "Left should restore the pre-browser draft theme");
assert.equal(paneIsDirty(restoredFromLeft.model), false, "Left restore should clear preview-only dirty state");

const dirtyBeforeBrowser = cloneConfig(config);
setLightTheme(dirtyBeforeBrowser, "tokyo-night");
const dirtyBrowserModel = createPaneModel(dirtyBeforeBrowser);
const dirtyBrowserOpened = activateThemeRow(dirtyBrowserModel);
const dirtyBrowserPreview = move(dirtyBrowserOpened.model, "down");
const dirtyBrowserRestored = updatePaneModel(dirtyBrowserPreview.model, { type: "back" });
assert.equal(lightTheme(dirtyBrowserRestored.model.draft), "tokyo-night", "restore should use the dirty draft theme active when browser opened");
assert.equal(paneIsDirty(dirtyBrowserRestored.model), false, "restoring to a non-default initial draft should preserve existing dirty comparison semantics");
const dirtyBrowserBackToSettings = updatePaneModel(dirtyBrowserRestored.model, { type: "back" });
assert.equal(dirtyBrowserBackToSettings.requestRender, true, "Esc/q after returning from theme browser should step from values to settings");
assert.equal(dirtyBrowserBackToSettings.completion, undefined, "values-column back after browser restore should not cancel immediately");
assert.equal(dirtyBrowserBackToSettings.model.focus, "settings", "values-column back after browser restore should return to the setting label");
const dirtyBrowserBackToCategories = updatePaneModel(dirtyBrowserBackToSettings.model, { type: "back" });
assert.equal(dirtyBrowserBackToCategories.model.focus, "categories", "a second back should return from the setting label to its parent category");
assertCancel(updatePaneModel(dirtyBrowserBackToCategories.model, { type: "back" }), "Esc/q from categories after returning from theme browser");

let preDirtyThemeModel = withFocus(createPaneModel(config), "values", 0, 1);
const preDirtyThemeDraft = cloneConfig(preDirtyThemeModel.draft);
setLightTheme(preDirtyThemeDraft, "tokyo-night");
preDirtyThemeModel = { ...preDirtyThemeModel, draft: preDirtyThemeDraft };
assert.equal(lightTheme(preDirtyThemeModel.draft), "tokyo-night", "pre-existing dirty theme setup should start from Tokyo Night");
assert.equal(paneIsDirty(preDirtyThemeModel), true, "dirty draft theme setup should be dirty before opening browser");
const preDirtyBrowserOpened = updatePaneModel(preDirtyThemeModel, { type: "activate" });
assert.equal(preDirtyBrowserOpened.model.themeBrowser?.restoreTheme, "tokyo-night", "browser should remember the pre-existing dirty draft theme");
const preDirtyBrowserView = view(preDirtyBrowserOpened.model);
assert.equal(preDirtyBrowserView.themeBrowser?.savedTheme, "light", "dirty browser should keep the original saved theme separate from restore theme");
assert.deepEqual(
	preDirtyBrowserView.themeBrowser?.themes.filter((theme) => theme.saved).map((theme) => theme.id),
	["light"],
	"dirty browser should mark only the original initial theme as saved",
);
assert.deepEqual(
	preDirtyBrowserView.themeBrowser?.themes.filter((theme) => theme.restored).map((theme) => theme.id),
	["tokyo-night"],
	"dirty browser should mark the pre-browser draft theme as restore target",
);
const preDirtyBrowserPreview = move(preDirtyBrowserOpened.model, "down");
assert.notEqual(lightTheme(preDirtyBrowserPreview.model.draft), "tokyo-night", "pre-existing dirty case should preview a different theme");
const preDirtyBrowserRestored = updatePaneModel(preDirtyBrowserPreview.model, { type: "back" });
assert.equal(lightTheme(preDirtyBrowserRestored.model.draft), "tokyo-night", "restore should preserve the dirty draft theme active when browser opened");
assert.equal(paneIsDirty(preDirtyBrowserRestored.model), true, "restoring to a pre-existing dirty draft theme should keep the pane dirty");

const enterInCategories = updatePaneModel(model, { type: "activate" });
assert.equal(enterInCategories.requestRender, true, "Enter in categories should descend into the selected category");
assert.equal(enterInCategories.completion, undefined, "Enter in categories should not complete the pane");
assert.equal(enterInCategories.model.focus, "settings", "Enter in categories should focus the first child setting");
assert.equal(enterInCategories.model.categoryIndex, 0, "descending should preserve the selected category");
assert.equal(enterInCategories.model.settingIndex, 0, "descending should preserve the selected child setting");

const enterInSettings = updatePaneModel(enterInCategories.model, { type: "activate" });
assert.equal(enterInSettings.requestRender, true, "Enter in settings should descend into the value column");
assert.equal(enterInSettings.completion, undefined, "Enter in settings should not complete the pane");
assert.equal(enterInSettings.model.focus, "values", "Enter in settings should focus the selected value");
assert.equal(enterInSettings.model.categoryIndex, 0, "settings descent should preserve the parent category");
assert.equal(enterInSettings.model.settingIndex, 0, "settings descent should preserve the selected row");

const valuesEnabled = withFocus(model, "values", 0, 0);
const valuesEnabledBefore = clone(valuesEnabled);
const sourceConfigBefore = clone(config);
const toggledEnabled = updatePaneModel(valuesEnabled, { type: "activate" });
assert.equal(toggledEnabled.requestRender, true, "Enter in values should request render after changing a row");
assert.equal(toggledEnabled.model.draft.enabled, false, "Enter on General enabled value should toggle enabled off");
assert.equal(toggledEnabled.model.status, "Enabled → off. Press S to save.", "editable activation should describe the updated friendly value");
assert.equal(paneIsDirty(toggledEnabled.model), true, "editable activation should make the model dirty");
assert.equal(view(toggledEnabled.model).dirty, true, "view should report dirty after editable activation");
assert.equal(selectedSetting(view(toggledEnabled.model)).value, "off", "view should show the updated value after activation");
assert.deepEqual(valuesEnabled, valuesEnabledBefore, "updatePaneModel should not mutate the input model during editable activation");
assert.deepEqual(config, sourceConfigBefore, "updatePaneModel should not mutate the original caller config during editable activation");
assert.notEqual(toggledEnabled.model, valuesEnabled, "editable activation should return a new model object");
assert.notEqual(toggledEnabled.model.draft, valuesEnabled.draft, "editable activation should return a new draft config object");

const costInfoModel = withFocus(model, "values", 2, 2);
const costInfo = updatePaneModel(costInfoModel, { type: "activate" });
assert.equal(costInfo.requestRender, true, "Enter on an info row should request render so status can be shown");
assert.equal(costInfo.model.status, "Compact session cost.", "info row activation should copy the row hint into status");
assert.equal(paneIsDirty(costInfo.model), false, "info row activation should not dirty the draft");
assert.deepEqual(costInfo.model.draft, costInfoModel.draft, "info row activation should not change draft config");

const saveResult = updatePaneModel(toggledEnabled.model, { type: "save" });
assert.equal(saveResult.requestRender, false, "save should complete without requesting render");
assert.equal(saveResult.completion?.action, "save", "save should complete with action=save");
if (saveResult.completion?.action !== "save") throw new Error("save completion missing");
assert.equal(saveResult.completion.config.enabled, false, "save completion should include the current draft value");
assert.deepEqual(saveResult.completion.config, toggledEnabled.model.draft, "save completion config should equal the draft");
assert.notEqual(saveResult.completion.config, toggledEnabled.model.draft, "save completion config should be cloned, not reuse the draft object");
assert.notEqual(saveResult.completion.config.segments, toggledEnabled.model.draft.segments, "save completion should deep-clone nested arrays");
saveResult.completion.config.enabled = true;
assert.equal(toggledEnabled.model.draft.enabled, false, "mutating save completion config should not mutate model draft");

const nonDefaultInitial = cloneConfig(config);
nonDefaultInitial.enabled = false;
nonDefaultInitial.segments = [...nonDefaultInitial.segments].reverse();
const resetStart = withFocus(createPaneModel(nonDefaultInitial), "values", 4, 2);
const resetResult = updatePaneModel(resetStart, { type: "resetDefaults" });
assert.equal(resetResult.requestRender, true, "reset should request render");
assert.deepEqual(resetResult.model.draft, defaultConfig(), "reset should restore defaultConfig(), not the initial config");
assert.notDeepEqual(resetResult.model.draft, nonDefaultInitial, "reset should not restore the non-default initial config");
assert.deepEqual(resetResult.model.initial, nonDefaultInitial, "reset should keep the original initial config for dirty comparison");
assert.equal(resetResult.model.focus, "categories", "reset should return focus to categories");
assert.equal(resetResult.model.categoryIndex, 0, "reset should select General");
assert.equal(resetResult.model.settingIndex, 0, "reset should select the first setting row");
assert.equal(resetResult.model.status, "Defaults restored locally. Press S to save or Esc to discard.", "reset should show local restore status");
assert.equal(paneIsDirty(resetResult.model), true, "reset from a non-default initial config should be dirty until saved");

const valuesFocus = withFocus(model, "values", 1, 2);
const backFromValues = updatePaneModel(valuesFocus, { type: "back" });
assert.equal(backFromValues.requestRender, true, "Esc/q back from values should request render");
assert.equal(backFromValues.completion, undefined, "Esc/q back from values should not complete");
assert.equal(backFromValues.model.focus, "settings", "Esc/q from values should return to the owning setting label");
assert.equal(backFromValues.model.categoryIndex, 1, "back from values should preserve the parent category");
assert.equal(backFromValues.model.settingIndex, 2, "back from values should preserve the selected setting");
const backFromSettings = updatePaneModel(backFromValues.model, { type: "back" });
assert.equal(backFromSettings.model.focus, "categories", "Esc/q from settings should return to the parent category");
assert.equal(backFromSettings.model.categoryIndex, 1, "back from settings should not jump to a category sharing its visual row");
assertCancel(updatePaneModel(model, { type: "back" }), "Esc/q from categories");
assertCancel(updatePaneModel(valuesFocus, { type: "cancel" }), "Ctrl-C from values");

const defaultOrder = segmentOrder(config);
const generalReorder = updatePaneModel(model, { type: "reorderSegment", direction: 1 });
assert.equal(generalReorder.requestRender, true, "J on General should request render to show status");
assert.equal(generalReorder.model.status, "Cannot move General settings.", "General should not be movable");
assert.deepEqual(segmentOrder(generalReorder.model.draft), defaultOrder, "J on General should not change segment order");
assert.equal(paneIsDirty(generalReorder.model), false, "J on General should not dirty the draft");

const gitCategoryModel = withFocus(model, "categories", 1, 1);
const gitMovedDown = updatePaneModel(gitCategoryModel, { type: "reorderSegment", direction: 1 });
assert.equal(gitMovedDown.requestRender, true, "J on a segment category should request render");
assert.deepEqual(segmentOrder(gitMovedDown.model.draft), ["cost", "git", "throughput", "context", "tokens", "model"], "J should move Git below Cost using the segment/category offset");
assert.equal(gitMovedDown.model.categoryIndex, 2, "J should move the selected category index with the segment");
assert.equal(gitMovedDown.model.status, "Segment order updated. Press S to save.", "successful segment reorder should show save status");
assert.equal(paneIsDirty(gitMovedDown.model), true, "successful segment reorder should dirty the draft");

const gitMovedBackUp = updatePaneModel(gitMovedDown.model, { type: "reorderSegment", direction: -1 });
assert.deepEqual(segmentOrder(gitMovedBackUp.model.draft), defaultOrder, "K should move Git back above Context");
assert.equal(gitMovedBackUp.model.categoryIndex, 1, "K should move the selected category index back with the segment");
assert.equal(paneIsDirty(gitMovedBackUp.model), false, "restoring the original order should clear dirty state");

const gitAtTop = updatePaneModel(gitCategoryModel, { type: "reorderSegment", direction: -1 });
assert.equal(gitAtTop.requestRender, true, "K at the top should request render to show status");
assert.equal(gitAtTop.model.status, "Already at the top.", "K on the top segment should show top boundary status");
assert.deepEqual(segmentOrder(gitAtTop.model.draft), defaultOrder, "K on the top segment should not reorder segments");
assert.equal(paneIsDirty(gitAtTop.model), false, "K on the top segment should not dirty the draft");

const lastCategoryModel = withFocus(model, "categories", categories.length - 1, 2);
const bottomBoundary = updatePaneModel(lastCategoryModel, { type: "reorderSegment", direction: 1 });
assert.equal(bottomBoundary.requestRender, true, "J at the bottom should request render to show status");
assert.equal(bottomBoundary.model.status, "Already at the bottom.", "J on the bottom segment should show bottom boundary status");
assert.deepEqual(segmentOrder(bottomBoundary.model.draft), defaultOrder, "J on the bottom segment should not reorder segments");
assert.equal(paneIsDirty(bottomBoundary.model), false, "J on the bottom segment should not dirty the draft");

const reorderOutsideCategories = updatePaneModel(withFocus(gitCategoryModel, "settings"), { type: "reorderSegment", direction: 1 });
assert.equal(reorderOutsideCategories.requestRender, false, "J/K outside categories should be no-op without render");
assert.equal(reorderOutsideCategories.completion, undefined, "J/K outside categories should not complete");
assert.deepEqual(reorderOutsideCategories.model, withFocus(gitCategoryModel, "settings"), "J/K outside categories should not change model state");

const settingsFocusView = view(settingsDown.model, 120);
assert.equal(settingsFocusView.selectedCategory?.id, "git", "settings focus view should retain selected category");
assert.equal(categoryById(settingsFocusView, "git").selected, true, "settings focus view should keep Git selected");
assert.equal(categoryById(settingsFocusView, "git").hasFocus, false, "settings focus should remove active focus from the category column");
assert.equal(selectedSetting(settingsFocusView).id, "git.dirtyMarker", "settings focus view should select Dirty marker");
assert.equal(selectedSetting(settingsFocusView).labelHasFocus, true, "settings focus should mark selected row label focus");
assert.equal(selectedSetting(settingsFocusView).valueHasFocus, false, "settings focus should not mark selected row value focus");
assert.equal(settingsFocusView.selectedHint, "Conflicts always stay visible.", "view should expose the selected row hint");
assertHelp(
	settingsFocusView.help,
	[
		{ key: "←→↑↓", label: "move" },
		{ key: "S", label: "save" },
		{ key: "R", label: "reset" },
		{ key: "Enter", label: "edit" },
		{ key: "Esc", label: "back" },
	],
	"wide settings help should include back but no segment reorder or Enter change",
);

const gitValuesView = view(move(settingsDown.model, "right").model, 120);
assert.equal(selectedSetting(gitValuesView).id, "git.dirtyMarker", "values focus should retain selected row");
assert.equal(selectedSetting(gitValuesView).labelHasFocus, false, "values focus should not mark selected row label focus");
assert.equal(selectedSetting(gitValuesView).valueHasFocus, true, "values focus should mark selected row value focus");
assertHelp(
	gitValuesView.help,
	[
		{ key: "←→↑↓", label: "move" },
		{ key: "S", label: "save" },
		{ key: "R", label: "reset" },
		{ key: "Enter", label: "change" },
		{ key: "Esc", label: "back" },
	],
	"wide values help should include Enter change",
);

assertHelp(
	view(model, 56).help,
	[
		{ key: "S", label: "save" },
		{ key: "J/K", label: "reorder" },
		{ key: "Esc", label: "cancel" },
	],
	"narrow category help should prioritize save/reorder/cancel while Enter/Right remain documented at wider widths",
);
assertHelp(
	view(gitSettings.model, 56).help,
	[
		{ key: "Enter", label: "edit" },
		{ key: "S", label: "save" },
		{ key: "Esc", label: "back" },
	],
	"narrow settings help should collapse to edit/save/back",
);
assertHelp(
	view(move(gitSettings.model, "right").model, 56).help,
	[
		{ key: "Enter", label: "change" },
		{ key: "S", label: "save" },
		{ key: "Esc", label: "back" },
	],
	"narrow values help should collapse to change/save/back",
);

console.log("✓ glance pane model checks passed");
