import { cloneConfig, defaultConfig, moveSegment } from "./config.js";
import { getSettingsCategories, getSettingsRows, type SettingsCategory, type SettingsCategoryId, type SettingsRow } from "./settings-catalog.js";
import type { GlanceConfig } from "./types.js";

export type PaneFocus = "categories" | "settings" | "values";
export type PaneMoveDirection = "left" | "right" | "up" | "down";

export type PaneIntent =
	| { type: "cancel" }
	| { type: "back" }
	| { type: "move"; direction: PaneMoveDirection }
	| { type: "activate" }
	| { type: "save" }
	| { type: "resetDefaults" }
	| { type: "reorderSegment"; direction: -1 | 1 }
	| { type: "noop" };

export type PaneCompletion = { action: "save"; config: GlanceConfig } | { action: "cancel" };

export interface PaneModelState {
	initial: GlanceConfig;
	draft: GlanceConfig;
	focus: PaneFocus;
	categoryIndex: number;
	settingIndex: number;
	status: string;
}

export interface PaneUpdateResult {
	model: PaneModelState;
	requestRender: boolean;
	completion?: PaneCompletion;
}

export interface HelpShortcut {
	key: string;
	label: string;
}

export type SettingsRowKind = SettingsRow["kind"];

export type CategoryViewModel = SettingsCategory & {
	selected: boolean;
	hasFocus: boolean;
};

export interface SettingViewModel {
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

export interface GlancePaneViewModel {
	dirty: boolean;
	status: string;
	categories: CategoryViewModel[];
	selectedCategory?: SettingsCategory;
	settingsTitle: string;
	settings: SettingViewModel[];
	selectedHint?: string;
	help: HelpShortcut[];
}

const PANE_FOCUS_ORDER: PaneFocus[] = ["categories", "settings", "values"];

function sameConfig(a: GlanceConfig, b: GlanceConfig): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function categoriesFor(model: PaneModelState): SettingsCategory[] {
	return getSettingsCategories(model.draft);
}

function rowsFor(model: PaneModelState, categoryId: SettingsCategoryId): SettingsRow[] {
	return getSettingsRows(model.draft, categoryId);
}

function selectedCategory(model: PaneModelState): SettingsCategory | undefined {
	return categoriesFor(model)[model.categoryIndex];
}

function withModel(model: PaneModelState, changes: Partial<PaneModelState>): PaneModelState {
	return { ...model, ...changes };
}

function result(model: PaneModelState, requestRender: boolean, completion?: PaneCompletion): PaneUpdateResult {
	return completion ? { model, requestRender, completion } : { model, requestRender };
}

function helpShortcuts(focus: PaneFocus, width: number): HelpShortcut[] {
	const stable: HelpShortcut[] = [
		{ key: "←→↑↓", label: "move" },
		{ key: "S", label: "save" },
		{ key: "R", label: "reset" },
	];

	const isNarrow = width < 72;

	switch (focus) {
		case "categories":
			if (isNarrow) {
				return [
					{ key: "S", label: "save" },
					{ key: "J/K", label: "switch" },
					{ key: "Esc", label: "cancel" },
				];
			}
			return [...stable, { key: "J/K", label: "switch" }, { key: "Esc", label: "cancel" }];
		case "settings":
			if (isNarrow) {
				return [
					{ key: "S", label: "save" },
					{ key: "Esc", label: "back" },
				];
			}
			return [...stable, { key: "Esc", label: "back" }];
		case "values":
			if (isNarrow) {
				return [
					{ key: "S", label: "save" },
					{ key: "Enter", label: "change" },
					{ key: "Esc", label: "back" },
				];
			}
			return [...stable, { key: "Enter", label: "change" }, { key: "Esc", label: "back" }];
	}
}

function moveFocus(model: PaneModelState, direction: PaneMoveDirection): PaneModelState {
	const categories = categoriesFor(model);
	let next = model;

	switch (direction) {
		case "left": {
			const index = PANE_FOCUS_ORDER.indexOf(model.focus);
			let categoryIndex = model.categoryIndex;
			if (model.focus === "settings") {
				categoryIndex = categories.length === 0 ? 0 : Math.min(model.settingIndex, categories.length - 1);
			}
			return withModel(model, {
				categoryIndex,
				focus: PANE_FOCUS_ORDER[Math.max(0, index - 1)] ?? "categories",
			});
		}
		case "right": {
			const index = PANE_FOCUS_ORDER.indexOf(model.focus);
			let settingIndex = model.settingIndex;
			if (model.focus === "categories") {
				const category = categories[model.categoryIndex];
				const rowCount = category ? rowsFor(model, category.id).length : 0;
				settingIndex = rowCount === 0 ? 0 : Math.min(model.categoryIndex, rowCount - 1);
			}
			return withModel(model, {
				settingIndex,
				focus: PANE_FOCUS_ORDER[Math.min(PANE_FOCUS_ORDER.length - 1, index + 1)] ?? "values",
			});
		}
		case "up":
			if (model.focus === "categories") {
				const count = categories.length;
				const categoryIndex = count === 0 ? 0 : (model.categoryIndex - 1 + count) % count;
				const category = categories[categoryIndex];
				const rowCount = category ? rowsFor(withModel(model, { categoryIndex }), category.id).length : 0;
				next = withModel(model, {
					categoryIndex,
					settingIndex: rowCount === 0 ? 0 : Math.min(categoryIndex, rowCount - 1),
				});
			} else {
				const category = categories[model.categoryIndex];
				const count = category ? rowsFor(model, category.id).length : 0;
				next = withModel(model, {
					settingIndex: count === 0 ? 0 : (model.settingIndex - 1 + count) % count,
				});
			}
			return next;
		case "down":
			if (model.focus === "categories") {
				const count = categories.length;
				const categoryIndex = count === 0 ? 0 : (model.categoryIndex + 1) % count;
				const category = categories[categoryIndex];
				const rowCount = category ? rowsFor(withModel(model, { categoryIndex }), category.id).length : 0;
				next = withModel(model, {
					categoryIndex,
					settingIndex: rowCount === 0 ? 0 : Math.min(categoryIndex, rowCount - 1),
				});
			} else {
				const category = categories[model.categoryIndex];
				const count = category ? rowsFor(model, category.id).length : 0;
				next = withModel(model, {
					settingIndex: count === 0 ? 0 : (model.settingIndex + 1) % count,
				});
			}
			return next;
	}
}

function activateCurrent(model: PaneModelState): PaneModelState {
	const category = selectedCategory(model);
	if (!category) return model;

	const rows = rowsFor(model, category.id);
	const row = rows[model.settingIndex];
	if (!row) return model;

	if (!row.apply) {
		return withModel(model, { status: row.hint ?? `${row.label} is informational.` });
	}

	const draft = row.apply(model.draft);
	const nextRow = getSettingsRows(draft, category.id)[model.settingIndex];
	return withModel(model, {
		draft,
		status: `${row.label} → ${nextRow?.value ?? "updated"}. Press S to save.`,
	});
}

function reorderCurrentSegment(model: PaneModelState, direction: -1 | 1): PaneModelState {
	if (model.categoryIndex === 0) {
		return withModel(model, { status: "Cannot move General settings." });
	}

	const segment = model.draft.segments[model.categoryIndex - 1];
	if (!segment) return model;

	const targetCategoryIndex = model.categoryIndex + direction;
	if (targetCategoryIndex < 1 || targetCategoryIndex > model.draft.segments.length) {
		return withModel(model, { status: direction < 0 ? "Already at the top." : "Already at the bottom." });
	}

	return withModel(model, {
		draft: moveSegment(model.draft, segment.id, direction),
		categoryIndex: targetCategoryIndex,
		status: "Segment order updated. Press S to save.",
	});
}

export function createPaneModel(initial: GlanceConfig): PaneModelState {
	return {
		initial: cloneConfig(initial),
		draft: cloneConfig(initial),
		focus: "categories",
		categoryIndex: 0,
		settingIndex: 0,
		status: "",
	};
}

export function paneIsDirty(model: PaneModelState): boolean {
	return !sameConfig(model.draft, model.initial);
}

export function createPaneViewModel(model: PaneModelState, width: number): GlancePaneViewModel {
	const categories = categoriesFor(model);
	const selected = categories[model.categoryIndex];
	const settings = selected ? rowsFor(model, selected.id) : [];

	return {
		dirty: paneIsDirty(model),
		status: model.status,
		categories: categories.map((category, index) => ({
			...category,
			selected: index === model.categoryIndex,
			hasFocus: model.focus === "categories",
		})),
		selectedCategory: selected,
		settingsTitle: selected ? (selected.id === "general" ? "General" : selected.label) : "",
		settings: settings.map((row, index) => ({
			id: row.id,
			label: row.label,
			value: row.value,
			hint: row.hint,
			kind: row.kind,
			editable: Boolean(row.apply),
			selected: index === model.settingIndex,
			labelHasFocus: model.focus === "settings",
			valueHasFocus: model.focus === "values",
		})),
		selectedHint: settings[model.settingIndex]?.hint,
		help: helpShortcuts(model.focus, width),
	};
}

export function updatePaneModel(model: PaneModelState, intent: PaneIntent): PaneUpdateResult {
	switch (intent.type) {
		case "cancel":
			return result(model, false, { action: "cancel" });
		case "back":
			if (model.focus === "categories") return result(model, false, { action: "cancel" });
			return result(withModel(model, { focus: "categories" }), true);
		case "move":
			return result(moveFocus(model, intent.direction), true);
		case "activate":
			if (model.focus !== "values") return result(model, false);
			return result(activateCurrent(model), true);
		case "save":
			return result(model, false, { action: "save", config: cloneConfig(model.draft) });
		case "resetDefaults":
			return result(
				withModel(model, {
					draft: defaultConfig(),
					focus: "categories",
					categoryIndex: 0,
					settingIndex: 0,
					status: "Defaults restored locally. Press S to save or Esc to discard.",
				}),
				true,
			);
		case "reorderSegment":
			if (model.focus !== "categories") return result(model, false);
			return result(reorderCurrentSegment(model, intent.direction), true);
		case "noop":
			return result(model, false);
	}
}
