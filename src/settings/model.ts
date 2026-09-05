import { cloneConfig, defaultConfig, moveSegment } from "../config/model.js";
import {
	getSettingsCategories,
	getSettingsRows,
	getThemeCatalogForSlot,
	getThemeCount,
	getThemeIdByIndex,
	getThemeIndex,
	getThemeLabel,
	type GlanceThemeSlot,
	type SettingsCategory,
	type SettingsCategoryId,
	type SettingsRow,
} from "./catalog.js";
import type { GlanceConfig, GlanceThemeName, WidthMode } from "../types.js";

export type PanePreviewDensity = "auto" | WidthMode;

export type PaneFocus = "categories" | "settings" | "values";
export type PaneSubview = "settings" | "themeBrowser";
export type PaneMoveDirection = "left" | "right" | "up" | "down";

export type PaneIntent =
	| { type: "cancel" }
	| { type: "back" }
	| { type: "move"; direction: PaneMoveDirection; amount?: number }
	| { type: "activate" }
	| { type: "save" }
	| { type: "resetDefaults" }
	| { type: "cyclePreviewDensity" }
	| { type: "reorderSegment"; direction: -1 | 1 }
	| { type: "noop" };

export type PaneCompletion = { action: "save"; config: GlanceConfig } | { action: "cancel" };

export interface ThemeBrowserState {
	slot: GlanceThemeSlot;
	highlightedThemeIndex: number;
	restoreTheme: GlanceThemeName;
	returnFocus: PaneFocus;
	returnCategoryIndex: number;
	returnSettingIndex: number;
}

interface PaneSharedState {
	initial: GlanceConfig;
	draft: GlanceConfig;
	focus: PaneFocus;
	categoryIndex: number;
	settingIndex: number;
	status: string;
	previewDensity: PanePreviewDensity;
}

export type PaneModelState = PaneSharedState & (
	| { subview: "settings"; themeBrowser?: never }
	| { subview: "themeBrowser"; themeBrowser: ThemeBrowserState }
);

type ThemeBrowserModel = Extract<PaneModelState, { subview: "themeBrowser" }>;

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
	opensSubview?: PaneSubview;
	editable: boolean;
	selected: boolean;
	labelHasFocus: boolean;
	valueHasFocus: boolean;
}

export interface ThemeBrowserThemeViewModel {
	id: GlanceThemeName;
	label: string;
	group: string;
	groupLabel: string;
	tone: string;
	tags: readonly string[];
	detailTags: readonly string[];
	description: string;
	detailDescription: string;
	selected: boolean;
	previewed: boolean;
	restored: boolean;
	saved: boolean;
}

export interface ThemeBrowserViewModel {
	slot: GlanceThemeSlot;
	slotLabel: string;
	highlightedThemeIndex: number;
	savedTheme: GlanceThemeName;
	savedLabel: string;
	restoreTheme: GlanceThemeName;
	restoreLabel: string;
	previewTheme: GlanceThemeName;
	previewLabel: string;
	themes: ThemeBrowserThemeViewModel[];
}

export interface GlancePaneViewModel {
	dirty: boolean;
	status: string;
	subview: PaneSubview;
	categories: CategoryViewModel[];
	selectedCategory?: SettingsCategory;
	settingsTitle: string;
	settings: SettingViewModel[];
	selectedHint?: string;
	previewDensity: PanePreviewDensity;
	previewDensityLabel: string;
	preview: {
		config: GlanceConfig;
		density: PanePreviewDensity;
		ambientTone?: GlanceThemeSlot;
	};
	themeBrowser?: ThemeBrowserViewModel;
	help: HelpShortcut[];
}

const PREVIEW_DENSITIES: readonly PanePreviewDensity[] = ["auto", "full", "compact", "minimal"];

function previewDensityLabel(density: PanePreviewDensity): string {
	return density === "auto" ? "Auto" : density[0]!.toUpperCase() + density.slice(1);
}

function cyclePreviewDensity(model: PaneModelState): PaneModelState {
	const index = PREVIEW_DENSITIES.indexOf(model.previewDensity);
	const previewDensity = PREVIEW_DENSITIES[(index + 1) % PREVIEW_DENSITIES.length] ?? "auto";
	return withModel(model, { previewDensity });
}

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

function withModel<M extends PaneModelState>(model: M, changes: Partial<PaneSharedState>): M {
	return { ...model, ...changes };
}

function result(model: PaneModelState, requestRender: boolean, completion?: PaneCompletion): PaneUpdateResult {
	return completion ? { model, requestRender, completion } : { model, requestRender };
}

function themeSlotLabel(slot: GlanceThemeSlot): string {
	return slot === "light" ? "Light" : "Dark";
}

function configTheme(config: GlanceConfig, slot: GlanceThemeSlot): GlanceThemeName {
	return config.theme[slot];
}

function withConfigTheme(config: GlanceConfig, slot: GlanceThemeSlot, theme: GlanceThemeName): GlanceConfig {
	return { ...config, theme: { ...config.theme, [slot]: theme } };
}

function themeBrowserHelpShortcuts(): HelpShortcut[] {
	return [
		{ key: "↑↓", label: "preview" },
		{ key: "Enter", label: "accept" },
		{ key: "Esc/Left", label: "restore" },
		{ key: "S", label: "save" },
	];
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
					{ key: "J/K", label: "reorder" },
					{ key: "Esc", label: "cancel" },
				];
			}
			return [...stable, { key: "Enter", label: "open" }, { key: "J/K", label: "reorder" }, { key: "Esc", label: "cancel" }];
		case "settings":
			if (isNarrow) {
				return [
					{ key: "Enter", label: "edit" },
					{ key: "S", label: "save" },
					{ key: "Esc", label: "back" },
				];
			}
			return [...stable, { key: "Enter", label: "edit" }, { key: "Esc", label: "back" }];
		case "values":
			if (isNarrow) {
				return [
					{ key: "Enter", label: "change" },
					{ key: "S", label: "save" },
					{ key: "Esc", label: "back" },
				];
			}
			return [...stable, { key: "Enter", label: "change" }, { key: "Esc", label: "back" }];
	}
}

function closeThemeBrowser(model: ThemeBrowserModel, draft: GlanceConfig, status: string): PaneModelState {
	const browser = model.themeBrowser;
	return {
		...model,
		draft,
		focus: browser.returnFocus,
		categoryIndex: browser.returnCategoryIndex,
		settingIndex: browser.returnSettingIndex,
		status,
		subview: "settings",
		themeBrowser: undefined,
	};
}

function acceptThemeBrowser(model: ThemeBrowserModel): PaneModelState {
	const slot = model.themeBrowser.slot;
	return closeThemeBrowser(model, model.draft, `${themeSlotLabel(slot)} theme → ${getThemeLabel(configTheme(model.draft, slot))}. Press S to save.`);
}

function restoreThemeBrowser(model: ThemeBrowserModel): PaneModelState {
	return closeThemeBrowser(model, withConfigTheme(model.draft, model.themeBrowser.slot, model.themeBrowser.restoreTheme), "Theme preview discarded.");
}

function moveThemeBrowserHighlight(model: ThemeBrowserModel, direction: PaneMoveDirection, amount = 1): PaneModelState {
	if (direction === "left") return restoreThemeBrowser(model);
	if (direction === "right") return model;

	const slot = model.themeBrowser.slot;
	const count = getThemeCount(slot);
	const distance = Math.max(1, Math.floor(amount));
	const step = direction === "up" ? -distance : distance;
	const highlightedThemeIndex = (model.themeBrowser.highlightedThemeIndex + step % count + count) % count;
	const theme = getThemeIdByIndex(highlightedThemeIndex, slot) ?? configTheme(model.draft, slot);
	return {
		...model,
		draft: withConfigTheme(model.draft, slot, theme),
		themeBrowser: {
			...model.themeBrowser,
			highlightedThemeIndex,
		},
	};
}

function moveFocus(model: PaneModelState, direction: PaneMoveDirection, amount = 1): PaneModelState {
	if (model.subview === "themeBrowser") return moveThemeBrowserHighlight(model, direction, amount);

	const categories = categoriesFor(model);
	const distance = Math.max(1, Math.floor(amount));

	switch (direction) {
		case "left":
			if (model.focus === "values") return withModel(model, { focus: "settings" });
			if (model.focus === "settings") return withModel(model, { focus: "categories" });
			return model;
		case "right": {
			const category = categories[model.categoryIndex];
			const hasRows = Boolean(category && rowsFor(model, category.id).length > 0);
			if (!hasRows) return model;
			if (model.focus === "categories") return withModel(model, { focus: "settings" });
			if (model.focus === "settings") return withModel(model, { focus: "values" });
			return model;
		}
		case "up":
		case "down": {
			const step = (direction === "up" ? -1 : 1) * distance;
			if (model.focus === "categories") {
				const count = categories.length;
				const categoryIndex = count === 0 ? 0 : ((model.categoryIndex + step) % count + count) % count;
				return withModel(model, { categoryIndex, settingIndex: 0 });
			}

			const category = categories[model.categoryIndex];
			const count = category ? rowsFor(model, category.id).length : 0;
			return withModel(model, {
				settingIndex: count === 0 ? 0 : ((model.settingIndex + step) % count + count) % count,
			});
		}
	}
}

function selectedRow(model: PaneModelState): SettingsRow | undefined {
	const category = selectedCategory(model);
	if (!category) return undefined;
	return rowsFor(model, category.id)[model.settingIndex];
}

function openThemeBrowser(model: PaneModelState, row: SettingsRow): PaneModelState {
	const slot = row.themeSlot ?? "light";
	const highlightedThemeIndex = getThemeIndex(configTheme(model.draft, slot), slot);
	return {
		...model,
		subview: "themeBrowser",
		themeBrowser: {
			slot,
			highlightedThemeIndex,
			restoreTheme: configTheme(model.draft, slot),
			returnFocus: model.focus,
			returnCategoryIndex: model.categoryIndex,
			returnSettingIndex: model.settingIndex,
		},
	};
}

function activateCurrent(model: PaneModelState): PaneModelState {
	if (model.subview === "themeBrowser") return acceptThemeBrowser(model);

	const category = selectedCategory(model);
	if (!category) return model;
	const row = selectedRow(model);
	if (!row) return model;

	if (model.focus === "categories") return withModel(model, { focus: "settings" });
	if (model.focus === "settings") return withModel(model, { focus: "values" });

	if (row.opensSubview === "themeBrowser") return openThemeBrowser(model, row);

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
		previewDensity: "auto",
		subview: "settings",
	};
}

export function paneIsDirty(model: PaneModelState): boolean {
	return !sameConfig(model.draft, model.initial);
}

function createThemeBrowserViewModel(model: PaneModelState): ThemeBrowserViewModel | undefined {
	if (model.subview !== "themeBrowser") return undefined;
	const slot = model.themeBrowser.slot;
	const savedTheme = configTheme(model.initial, slot);
	const previewTheme = configTheme(model.draft, slot);
	return {
		slot,
		slotLabel: `${themeSlotLabel(slot)} theme`,
		highlightedThemeIndex: model.themeBrowser.highlightedThemeIndex,
		savedTheme,
		savedLabel: getThemeLabel(savedTheme),
		restoreTheme: model.themeBrowser.restoreTheme,
		restoreLabel: getThemeLabel(model.themeBrowser.restoreTheme),
		previewTheme,
		previewLabel: getThemeLabel(previewTheme),
		themes: getThemeCatalogForSlot(slot).map((theme, index) => ({
			id: theme.id,
			label: theme.label,
			group: theme.group,
			groupLabel: theme.groupLabel,
			tone: theme.tone,
			tags: theme.tags,
			detailTags: theme.detailTags,
			description: theme.description,
			detailDescription: theme.detailDescription,
			selected: index === model.themeBrowser?.highlightedThemeIndex,
			previewed: theme.id === previewTheme,
			restored: theme.id === model.themeBrowser?.restoreTheme,
			saved: theme.id === savedTheme,
		})),
	};
}

export function createPaneViewModel(model: PaneModelState, width: number): GlancePaneViewModel {
	const categories = categoriesFor(model);
	const selected = categories[model.categoryIndex];
	const settings = selected ? rowsFor(model, selected.id) : [];

	return {
		dirty: paneIsDirty(model),
		status: model.status,
		subview: model.subview,
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
			opensSubview: row.opensSubview,
			editable: Boolean(row.apply),
			selected: index === model.settingIndex,
			labelHasFocus: model.focus === "settings",
			valueHasFocus: model.focus === "values",
		})),
		selectedHint: settings[model.settingIndex]?.hint,
		previewDensity: model.previewDensity,
		previewDensityLabel: previewDensityLabel(model.previewDensity),
		preview: {
			config: model.draft,
			density: model.previewDensity,
			ambientTone: model.subview === "themeBrowser" ? model.themeBrowser.slot : undefined,
		},
		themeBrowser: createThemeBrowserViewModel(model),
		help: model.subview === "themeBrowser" ? themeBrowserHelpShortcuts() : helpShortcuts(model.focus, width),
	};
}

export function updatePaneModel(model: PaneModelState, intent: PaneIntent): PaneUpdateResult {
	switch (intent.type) {
		case "cancel":
			return result(model, false, { action: "cancel" });
		case "back":
			if (model.subview === "themeBrowser") return result(restoreThemeBrowser(model), true);
			if (model.focus === "categories") return result(model, false, { action: "cancel" });
			return result(withModel(model, { focus: model.focus === "values" ? "settings" : "categories" }), true);
		case "move":
			return result(moveFocus(model, intent.direction, intent.amount), true);
		case "activate":
			return result(activateCurrent(model), true);
		case "save":
			return result(model, false, { action: "save", config: cloneConfig(model.draft) });
		case "resetDefaults":
			return result(
				{
					...model,
					draft: defaultConfig(),
					focus: "categories",
					categoryIndex: 0,
					settingIndex: 0,
					status: "Defaults restored locally. Press S to save or Esc to discard.",
					subview: "settings",
					themeBrowser: undefined,
				},
				true,
			);
		case "cyclePreviewDensity":
			return result(cyclePreviewDensity(model), true);
		case "reorderSegment":
			if (model.focus !== "categories") return result(model, false);
			return result(reorderCurrentSegment(model, intent.direction), true);
		case "noop":
			return result(model, false);
	}
}
