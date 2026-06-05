import { strict as assert } from "node:assert";
import { cloneConfig, defaultConfig } from "../config.js";
import { getSettingsCategories } from "../settings-catalog.js";
import type { GlanceConfig, SegmentId } from "../types.js";

type PaneFocus = "categories" | "settings" | "values";
type MoveDirection = "left" | "right" | "up" | "down";
type PaneIntent =
	| { type: "cancel" }
	| { type: "back" }
	| { type: "move"; direction: MoveDirection }
	| { type: "activate" }
	| { type: "save" }
	| { type: "resetDefaults" }
	| { type: "reorderSegment"; direction: -1 | 1 }
	| { type: "noop" };
type PaneCompletion = { action: "save"; config: GlanceConfig } | { action: "cancel" };
type HelpShortcut = { key: string; label: string };
type SettingsRowKind = "toggle" | "cycle" | "info";

interface PaneModelState {
	initial: GlanceConfig;
	draft: GlanceConfig;
	focus: PaneFocus;
	categoryIndex: number;
	settingIndex: number;
	status: string;
}

interface PaneUpdateResult {
	model: PaneModelState;
	requestRender: boolean;
	completion?: PaneCompletion;
}

interface CategoryViewModel {
	id: string;
	label: string;
	enabled?: boolean;
	selected: boolean;
	hasFocus: boolean;
}

interface SettingViewModel {
	id: string;
	label: string;
	value: string;
	hint: string;
	kind: SettingsRowKind;
	editable: boolean;
	selected: boolean;
	labelHasFocus: boolean;
	valueHasFocus: boolean;
}

interface GlancePaneViewModel {
	dirty: boolean;
	status: string;
	categories: CategoryViewModel[];
	selectedCategory?: CategoryViewModel;
	settingsTitle: string;
	settings: SettingViewModel[];
	selectedHint?: string;
	help: HelpShortcut[];
}

interface PaneModelModule {
	createPaneModel(initial: GlanceConfig): PaneModelState;
	createPaneViewModel(model: PaneModelState, width: number): GlancePaneViewModel;
	paneIsDirty(model: PaneModelState): boolean;
	updatePaneModel(model: PaneModelState, intent: PaneIntent): PaneUpdateResult;
}

const paneModelPath: string = "../pane-model.js";
const paneModel = (await import(paneModelPath)) as PaneModelModule;
const { createPaneModel, createPaneViewModel, paneIsDirty, updatePaneModel } = paneModel;

for (const [name, exported] of Object.entries({ createPaneModel, createPaneViewModel, paneIsDirty, updatePaneModel })) {
	assert.equal(typeof exported, "function", `${name} should be exported by pane-model.ts`);
}

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

function segmentOrder(config: GlanceConfig): SegmentId[] {
	return config.segments.map((segment) => segment.id);
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
assert.equal(model.categoryIndex, 0, "initial category index should select General");
assert.equal(model.settingIndex, 0, "initial setting index should select the first row");
assert.equal(model.status, "", "initial status should be empty");
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
assert.equal(initialView.selectedCategory?.id, "general", "initial view should select General");
assert.equal(initialView.settingsTitle, "General", "initial settings title should be General");
assert.deepEqual(
	initialView.categories.map((category) => ({ id: category.id, label: category.label, enabled: category.enabled, selected: category.selected })),
	[
		{ id: "general", label: "General", enabled: undefined, selected: true },
		...config.segments.map((segment) => ({
			id: segment.id,
			label: segment.id[0]!.toUpperCase() + segment.id.slice(1),
			enabled: segment.enabled,
			selected: false,
		})),
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
		{ key: "J/K", label: "switch" },
		{ key: "Esc", label: "cancel" },
	],
	"wide category help should include movement, save/reset, segment switch, and cancel",
);

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
const upFromGeneral = move(model, "up");
assert.equal(upFromGeneral.requestRender, true, "category up should request render");
assert.equal(upFromGeneral.model.focus, "categories", "category up should stay in categories");
assert.equal(upFromGeneral.model.categoryIndex, categories.length - 1, "category up from General should wrap to the last category");
assert.equal(upFromGeneral.model.settingIndex, 2, "category up should sync setting index to the selected visual row bounded by row count");
assert.equal(view(upFromGeneral.model).selectedCategory?.id, "model", "category up wrap should select Model");
assert.equal(selectedSetting(view(upFromGeneral.model)).id, "model.thinkingLabel", "category up sync should select Model's visible row");

const downToGit = move(model, "down");
assert.equal(downToGit.requestRender, true, "category down should request render");
assert.equal(downToGit.model.categoryIndex, 1, "category down from General should select Git");
assert.equal(downToGit.model.settingIndex, 1, "category down should sync to the same visual row");
assert.equal(view(downToGit.model).selectedCategory?.id, "git", "category down should select Git");
assert.equal(selectedSetting(view(downToGit.model)).id, "git.dirtyMarker", "category down should sync to Git dirty marker row");

const gitSettings = move(downToGit.model, "right");
assert.equal(gitSettings.requestRender, true, "right from categories should request render");
assert.equal(gitSettings.model.focus, "settings", "right from categories should focus settings");
assert.equal(gitSettings.model.settingIndex, 1, "right from categories should keep the selected visual row");
assert.equal(selectedSetting(view(gitSettings.model)).id, "git.dirtyMarker", "right from Git should select Dirty marker in settings");
assert.equal(selectedSetting(view(gitSettings.model)).labelHasFocus, true, "settings focus should mark the selected label as focused");
assert.equal(selectedSetting(view(gitSettings.model)).valueHasFocus, false, "settings focus should not mark the selected value as focused");

const settingsDown = move(gitSettings.model, "down");
assert.equal(settingsDown.model.focus, "settings", "down in settings should stay in settings");
assert.equal(settingsDown.model.categoryIndex, 1, "down in settings should not change category index");
assert.equal(settingsDown.model.settingIndex, 2, "down in settings should move to the next setting row");
assert.equal(selectedSetting(view(settingsDown.model)).id, "git.aheadBehind", "down in settings should select Ahead / behind");

const leftToCategories = move(settingsDown.model, "left");
assert.equal(leftToCategories.requestRender, true, "left from settings should request render");
assert.equal(leftToCategories.model.focus, "categories", "left from settings should focus categories");
assert.equal(leftToCategories.model.categoryIndex, 2, "left from settings should sync the category to the same visual row");
assert.equal(view(leftToCategories.model).selectedCategory?.id, "context", "left from settings visual row 2 should select Context");

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

const enterInCategories = updatePaneModel(model, { type: "activate" });
assert.equal(enterInCategories.requestRender, false, "Enter in categories should be a no-op without render");
assert.equal(enterInCategories.completion, undefined, "Enter in categories should not complete the pane");
assert.deepEqual(enterInCategories.model, model, "Enter in categories should not change model state");

const enterInSettings = updatePaneModel(withFocus(model, "settings"), { type: "activate" });
assert.equal(enterInSettings.requestRender, false, "Enter in settings should be a no-op without render");
assert.equal(enterInSettings.completion, undefined, "Enter in settings should not complete the pane");
assert.deepEqual(enterInSettings.model, withFocus(model, "settings"), "Enter in settings should not change model state");

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

const costInfoModel = withFocus(model, "values", 3, 2);
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
assert.equal(backFromValues.model.focus, "categories", "Esc/q from values should return to categories");
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
assert.deepEqual(segmentOrder(gitMovedDown.model.draft), ["context", "git", "cost", "tokens", "model"], "J should move Git below Context using the segment/category offset");
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

const settingsFocusView = view(gitSettings.model, 120);
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
		{ key: "Esc", label: "back" },
	],
	"wide settings help should include back but no segment switch or Enter change",
);

const gitValuesView = view(move(gitSettings.model, "right").model, 120);
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
		{ key: "J/K", label: "switch" },
		{ key: "Esc", label: "cancel" },
	],
	"narrow category help should collapse to save/switch/cancel",
);
assertHelp(
	view(gitSettings.model, 56).help,
	[
		{ key: "S", label: "save" },
		{ key: "Esc", label: "back" },
	],
	"narrow settings help should collapse to save/back",
);
assertHelp(
	view(move(gitSettings.model, "right").model, 56).help,
	[
		{ key: "S", label: "save" },
		{ key: "Enter", label: "change" },
		{ key: "Esc", label: "back" },
	],
	"narrow values help should collapse to save/change/back",
);

console.log("✓ glance pane model checks passed");
