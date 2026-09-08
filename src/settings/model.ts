import { normalizeStashShortcut, shortcutLabel } from "../input/shortcut.js";
import { cloneConfig, defaultConfig, moveSegment, toggleSegment } from "../config/model.js";
import {
	getSettingsRows,
	getThemeCatalogForSlot,
	SETTINGS_SECTIONS,
	type SettingsRow,
	type SettingsSectionId,
	type GlanceThemeSlot,
} from "./catalog.js";
import { segmentLabel } from "../segments/registry.js";
import type { GlanceConfig, SegmentId, WidthMode } from "../types.js";

export type PanePreviewDensity = "auto" | WidthMode;
interface ListPage {
	kind: "list";
	index: number;
	segment?: SegmentId;
}
interface EditorPageBase {
	parent: ListPage;
	restore: GlanceConfig;
	rowId: string;
}
type EditorPage =
	| (EditorPageBase & { kind: "choices"; index: number })
	| (EditorPageBase & { kind: "theme"; index: number; slot: GlanceThemeSlot })
	| (EditorPageBase & { kind: "shortcut"; key: string; error: string })
	| (EditorPageBase & { kind: "number"; text: string; error: string });
type ContentPage = ListPage | EditorPage;
type PanePage = ContentPage | { kind: "confirm"; action: "discard" | "reset"; index: number; previous: ContentPage };
export interface PaneModelState {
	initial: GlanceConfig;
	draft: GlanceConfig;
	section: SettingsSectionId;
	sectionPages: Record<SettingsSectionId, ListPage>;
	detailRows: Partial<Record<SegmentId, number>>;
	page: PanePage;
	previewDensity: PanePreviewDensity;
}
export type PaneCompletion = { action: "save"; config: GlanceConfig } | { action: "cancel" };
export type PaneIntent =
	| { type: "move"; direction: "up" | "down"; amount?: number }
	| { type: "adjust"; direction: -1 | 1 }
	| { type: "section"; direction: -1 | 1 }
	| { type: "reorder"; direction: -1 | 1 }
	| { type: "shortcut"; key?: string; error?: string }
	| { type: "input"; text: string }
	| { type: "activate" | "toggle" | "back" | "cancel" | "save" | "reset" | "density" };
export interface PaneUpdateResult {
	model: PaneModelState;
	completion?: PaneCompletion;
}
export interface HelpShortcut {
	key: string;
	label: string;
}
export interface GlancePaneViewModel {
	section: SettingsSectionId;
	title: string;
	dirty: boolean;
	rows: Array<{
		id: string;
		label: string;
		value: string;
		kind: SettingsRow["kind"];
		selected: boolean;
		changed: boolean;
	}>;
	choices: Array<{ label: string; selected: boolean; checked: boolean }>;
	hint: string;
	page: PanePage["kind"];
	actions: HelpShortcut[];
	help: HelpShortcut[];
	preview: { config: GlanceConfig; working: boolean; density: PanePreviewDensity; ambientTone?: GlanceThemeSlot };
}

export function createPaneModel(initial: GlanceConfig): PaneModelState {
	return {
		initial: cloneConfig(initial),
		draft: cloneConfig(initial),
		section: "appearance",
		sectionPages: {
			appearance: { kind: "list", index: 0 },
			status: { kind: "list", index: 0 },
			working: { kind: "list", index: 0 },
			input: { kind: "list", index: 0 },
		},
		detailRows: {},
		page: { kind: "list", index: 0 },
		previewDensity: "auto",
	};
}
export function paneIsDirty(model: PaneModelState): boolean {
	// Normalized config order is not significant (defaults and loaded files may differ).
	return !sameValue(model.draft, model.initial);
}
function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
	const first = Object.entries(a),
		second = Object.entries(b);
	return (
		first.length === second.length &&
		first.every(([key, value]) => Object.hasOwn(b, key) && sameValue(value, (b as Record<string, unknown>)[key]))
	);
}
function contentPage(model: PaneModelState): ContentPage {
	return model.page.kind === "confirm" ? model.page.previous : model.page;
}
function listPage(model: PaneModelState): ListPage {
	const page = contentPage(model);
	return page.kind === "list" ? page : page.parent;
}
function rowsFor(model: PaneModelState): SettingsRow[] {
	return getSettingsRows(model.draft, model.section, listPage(model).segment);
}
function selectedRow(model: PaneModelState, rows = rowsFor(model)): SettingsRow | undefined {
	const page = contentPage(model);
	return page.kind === "list" ? rows[page.index] : rows.find((row) => row.id === page.rowId);
}
function wrap(index: number, count: number): number {
	return count ? ((index % count) + count) % count : 0;
}
function clampIndex(index: number, count: number): number {
	return Math.max(0, Math.min(count - 1, index));
}
function withList(model: PaneModelState, page: ListPage): PaneModelState {
	return {
		...model,
		page,
		sectionPages: { ...model.sectionPages, [model.section]: page },
		detailRows: page.segment ? { ...model.detailRows, [page.segment]: page.index } : model.detailRows,
	};
}
function pickerRow(model: PaneModelState, page: EditorPage) {
	const row = getSettingsRows(page.restore, model.section, page.parent.segment).find((row) => row.id === page.rowId);
	return row?.kind === "choice" ? row : undefined;
}
function pickerCount(model: PaneModelState, page: Extract<EditorPage, { kind: "theme" | "choices" }>): number {
	if (page.kind === "theme") return getThemeCatalogForSlot(page.slot).length;
	const row = pickerRow(model, page);
	return row ? row.options.length + (row.selectedIndex < 0 ? 1 : 0) : 0;
}
function selectChoice(
	model: PaneModelState,
	page: Extract<EditorPage, { kind: "theme" | "choices" }>,
	index: number,
): PaneModelState {
	let draft = model.draft;
	if (page.kind === "theme") {
		const theme = getThemeCatalogForSlot(page.slot)[index];
		if (theme) {
			draft = cloneConfig(draft);
			draft.theme[page.slot] = theme.id;
		}
	} else {
		const row = pickerRow(model, page);
		if (row)
			draft =
				row.selectedIndex < 0 && index === row.options.length
					? cloneConfig(page.restore)
					: row.select(model.draft, index);
	}
	return { ...model, draft, page: { ...page, index } };
}
function updateNumber(model: PaneModelState, text: string, confirm = false): PaneModelState {
	if (model.page.kind !== "number") return model;
	const row = selectedRow(model);
	if (row?.kind !== "number") return model;
	const value = Number(text);
	const valid = /^\d+$/.test(text) && Number.isInteger(value) && value >= row.min && value <= row.max;
	return {
		...model,
		draft: valid ? row.setValue(model.draft, value) : model.draft,
		page: {
			...model.page,
			text,
			error: valid
				? ""
				: confirm
					? `Enter a whole number from ${row.min} to ${row.max}.`
					: text === model.page.text
						? model.page.error
						: "",
		},
	};
}
function back(model: PaneModelState): PaneUpdateResult {
	const page = model.page;
	if (page.kind === "confirm") return { model: { ...model, page: page.previous } };
	if (page.kind !== "list") return { model: { ...model, draft: page.restore, page: page.parent } };
	if (page.segment)
		return {
			model: withList(model, {
				kind: "list",
				index: Math.max(
					0,
					model.draft.segments.findIndex((segment) => segment.id === page.segment),
				),
			}),
		};
	return paneIsDirty(model)
		? { model: { ...model, page: { kind: "confirm", action: "discard", index: 0, previous: page } } }
		: { model, completion: { action: "cancel" } };
}
function activate(model: PaneModelState): PaneUpdateResult {
	const page = model.page;
	if (page.kind === "confirm") {
		if (page.index === 0) return { model: { ...model, page: page.previous } };
		if (page.action === "discard") return { model, completion: { action: "cancel" } };
		const draft = defaultConfig(),
			parent = listPage(model),
			rowId = selectedRow(model)?.id;
		const index = Math.max(
			0,
			getSettingsRows(draft, model.section, parent.segment).findIndex((row) => row.id === rowId),
		);
		return { model: withList({ ...model, draft }, { ...parent, index }) };
	}
	if (page.kind === "shortcut") {
		if (page.error) return { model };
		const draft = cloneConfig(model.draft);
		draft.editor.stashShortcut = page.key;
		return { model: { ...model, draft, page: page.parent } };
	}
	if (page.kind === "number") {
		const next = updateNumber(model, page.text, true);
		return { model: next.page.kind === "number" && next.page.error ? next : { ...next, page: page.parent } };
	}
	if (page.kind === "theme" || page.kind === "choices")
		return { model: { ...selectChoice(model, page, page.index), page: page.parent } };
	const row = selectedRow(model);
	if (!row) return { model };
	if (row.kind === "segment")
		return {
			model: withList(model, { kind: "list", segment: row.segment, index: model.detailRows[row.segment] ?? 0 }),
		};
	if (row.kind === "toggle")
		return { model: { ...model, draft: row.select(model.draft, row.selectedIndex === 0 ? 1 : 0) } };
	const base = { parent: page, restore: cloneConfig(model.draft), rowId: row.id };
	if (row.kind === "theme")
		return {
			model: {
				...model,
				page: {
					...base,
					kind: "theme",
					slot: row.slot,
					index: Math.max(
						0,
						getThemeCatalogForSlot(row.slot).findIndex((theme) => theme.id === model.draft.theme[row.slot]),
					),
				},
			},
		};
	if (row.kind === "shortcut") return { model: { ...model, page: { ...base, kind: "shortcut", key: row.key, error: "" } } };
	if (row.kind === "number")
		return { model: { ...model, page: { ...base, kind: "number", text: String(row.number), error: "" } } };
	return {
		model: {
			...model,
			page: { ...base, kind: "choices", index: row.selectedIndex < 0 ? row.options.length : row.selectedIndex },
		},
	};
}

function adjustRow(config: GlanceConfig, row: SettingsRow, direction: -1 | 1): GlanceConfig {
	switch (row.kind) {
		case "shortcut": return config;
		case "segment":
			return row.enabled === (direction === 1) ? config : toggleSegment(config, row.segment);
		case "toggle":
			return row.select(config, direction === 1 ? 0 : 1);
		case "number":
			return row.setValue(config, row.number + direction);
		case "theme": {
			const themes = getThemeCatalogForSlot(row.slot);
			const current = themes.findIndex((theme) => theme.id === config.theme[row.slot]);
			const draft = cloneConfig(config);
			draft.theme[row.slot] = themes[clampIndex(current + direction, themes.length)]!.id;
			return draft;
		}
		case "choice": {
			if (row.selectedIndex < 0 && direction === 1) return config;
			const current = row.selectedIndex < 0 ? row.options.length : row.selectedIndex;
			return row.select(config, clampIndex(current + direction, row.options.length));
		}
	}
}

export function updatePaneModel(model: PaneModelState, intent: PaneIntent): PaneUpdateResult {
	const page = model.page;
	if (intent.type === "cancel") return { model, completion: { action: "cancel" } };
	if (intent.type === "back") return back(model);
	if (intent.type === "activate") return activate(model);
	if (intent.type === "save")
		return page.kind === "list"
			? { model, completion: { action: "save", config: cloneConfig(model.draft) } }
			: { model };
	if (intent.type === "shortcut") {
		if (page.kind !== "shortcut") return { model };
		const key = normalizeStashShortcut(intent.key);
		return { model: { ...model, page: { ...page, key: key ?? page.key, error: intent.error ?? (key ? "" : "Use Ctrl, Alt or a function key.") } } };
	}
	if (intent.type === "input") return { model: updateNumber(model, intent.text) };
	if (intent.type === "adjust" && (page.kind === "theme" || page.kind === "choices")) {
		return { model: selectChoice(model, page, clampIndex(page.index + intent.direction, pickerCount(model, page))) };
	}
	if (intent.type === "move") {
		const amount = Number.isFinite(intent.amount) ? Math.max(1, Math.floor(intent.amount!)) : 1;
		const step = (intent.direction === "up" ? -1 : 1) * amount;
		if (page.kind === "number" || page.kind === "shortcut") return { model };
		if (page.kind === "confirm")
			return { model: { ...model, page: { ...page, index: clampIndex(page.index + step, 2) } } };
		if (page.kind === "theme" || page.kind === "choices")
			return { model: selectChoice(model, page, clampIndex(page.index + step, pickerCount(model, page))) };
		return { model: withList(model, { ...page, index: clampIndex(page.index + step, rowsFor(model).length) }) };
	}
	if (page.kind !== "list") return { model };
	const row = selectedRow(model);
	switch (intent.type) {
		case "section": {
			const current = SETTINGS_SECTIONS.findIndex((section) => section.id === model.section);
			const section = SETTINGS_SECTIONS[wrap(current + intent.direction, SETTINGS_SECTIONS.length)]!.id;
			return { model: { ...model, section, page: model.sectionPages[section] } };
		}
		case "reset":
			return { model: { ...model, page: { kind: "confirm", action: "reset", index: 0, previous: page } } };
		case "density": {
			const values: PanePreviewDensity[] = ["auto", "full", "compact", "minimal"];
			return {
				model:
					model.section === "status"
						? { ...model, previewDensity: values[wrap(values.indexOf(model.previewDensity) + 1, values.length)]! }
						: model,
			};
		}
		case "toggle": {
			if (row?.kind === "segment") return { model: { ...model, draft: toggleSegment(model.draft, row.segment) } };
			return row?.kind === "toggle" ? activate(model) : { model };
		}
		case "adjust": {
			if (!row) return { model };
			const draft = adjustRow(model.draft, row, intent.direction);
			return { model: draft === model.draft ? model : { ...model, draft } };
		}
		case "reorder": {
			if (row?.kind !== "segment") return { model };
			const index = Math.max(0, Math.min(model.draft.segments.length - 1, page.index + intent.direction));
			return {
				model: withList(
					{ ...model, draft: moveSegment(model.draft, row.segment, intent.direction) },
					{ ...page, index },
				),
			};
		}
	}
}

export function createPaneViewModel(model: PaneModelState): GlancePaneViewModel {
	const rows = rowsFor(model);
	const page = model.page,
		content = contentPage(model),
		list = listPage(model),
		row = selectedRow(model, rows);
	let title = list.segment
		? `Status line / ${segmentLabel(list.segment)}`
		: SETTINGS_SECTIONS.find((section) => section.id === model.section)!.label;
	let hint = row?.kind === "choice" ? (row.options[row.selectedIndex]?.hint ?? row.hint) : (row?.hint ?? "");
	if (list.segment && !model.draft.segments.find((segment) => segment.id === list.segment)?.enabled) title += " (Off)";
	let choices: GlancePaneViewModel["choices"] = [];
	let help: HelpShortcut[], actions: HelpShortcut[];
	if (page.kind === "confirm") {
		title = page.action === "reset" ? "Reset all settings?" : "Discard unsaved changes?";
		hint =
			page.action === "reset"
				? "Restore Glance defaults in this preview. Save to apply them."
				: "Your saved settings will stay unchanged.";
		choices = [
			{ label: "Keep editing", selected: page.index === 0, checked: false },
			{
				label: page.action === "reset" ? "Reset all settings" : "Discard changes",
				selected: page.index === 1,
				checked: false,
			},
		];
		help = [{ key: "↑↓", label: "Select" }];
		actions = [
			{ key: "Enter", label: "Confirm" },
			{ key: "Esc", label: "Back" },
		];
	} else if (page.kind === "shortcut") {
		title = `Stash shortcut · ${shortcutLabel(page.key)}`;
		hint = page.error || "Press a shortcut, then Enter to confirm. Esc keeps the previous key.";
		help = [];
		actions = [{ key: "Enter", label: "Confirm" }, { key: "Esc", label: "Cancel" }];
	} else if (page.kind === "number") {
		title = row?.label ?? "Sweep speed";
		hint = page.error || "Type to replace the speed (10–120 cols/s). Default: 47.";
		help = [];
		actions = [
			{ key: "Enter", label: "Confirm" },
			{ key: "Esc", label: "Cancel" },
		];
	} else if (page.kind === "theme" || page.kind === "choices") {
		title = row?.label ?? title;
		if (page.kind === "theme") {
			const themes = getThemeCatalogForSlot(page.slot),
				selected = themes[page.index];
			choices = themes.map((theme, index) => ({
				label: theme.label,
				selected: index === page.index,
				checked: theme.id === page.restore.theme[page.slot],
			}));
			hint = selected ? `${selected.groupLabel} · ${selected.description}` : hint;
		} else {
			const previous = pickerRow(model, page);
			if (previous) {
				choices = previous.options.map((option, index) => ({
					label: option.label,
					selected: index === page.index,
					checked: index === previous.selectedIndex,
				}));
				if (previous.selectedIndex < 0)
					choices.push({
						label: `${previous.value} (current)`,
						selected: page.index === previous.options.length,
						checked: true,
					});
				hint = previous.options[page.index]?.hint ?? previous.hint;
			}
		}
		help = [
			{ key: "↑↓", label: "Preview" },
			{ key: "←→", label: "Prev / next" },
		];
		actions = [
			{ key: "Enter", label: "Confirm" },
			{ key: "Esc", label: "Cancel" },
		];
	} else {
		help = [
			{ key: "Tab/Shift+Tab", label: "Section" },
			{ key: "↑↓", label: "Select" },
			{
				key: "←→",
				label:
					row?.kind === "segment" || row?.kind === "toggle"
						? "Off / on"
						: row?.kind === "number"
							? "Slower / faster"
							: "Prev / next",
			},
			{ key: "Enter", label: row?.kind === "segment" ? "Details" : row?.kind === "toggle" ? "Toggle" : "Edit" },
		];
		if (row?.kind === "shortcut") help = help.filter(item => item.key !== "←→");
		if (row?.kind === "segment" || row?.kind === "toggle") help.push({ key: "Space", label: "Toggle" });
		if (row?.kind === "segment") help.push({ key: "J/K", label: "Reorder" });
		if (model.section === "status") help.push({ key: "D", label: "Preview layout" });
		actions = [
			{ key: "S", label: "Save & close" },
			{ key: "Esc", label: list.segment ? "Back" : "Close" },
			{ key: "R", label: "Reset" },
		];
	}
	const original = getSettingsRows(model.initial, model.section, list.segment);
	return {
		section: model.section,
		title,
		page: page.kind,
		dirty: paneIsDirty(model),
		hint,
		choices,
		help,
		actions,
		rows: rows.map((row, index) => ({
			id: row.id,
			label: row.label,
			value: row.value,
			kind: row.kind,
			selected: index === list.index,
			changed:
				row.value !== original.find((previous) => previous.id === row.id)?.value ||
				(row.kind === "segment" && original[index]?.id !== row.id),
		})),
		preview: {
			config: model.draft,
			density: model.previewDensity,
			working:
				model.draft.enabled &&
				model.draft.editor.workingSweep !== "off" &&
				model.section === "working" &&
				page.kind !== "confirm",
			ambientTone: content.kind === "theme" ? content.slot : row?.kind === "theme" ? row.slot : undefined,
		},
	};
}
