import { cloneConfig, toggleSegment } from "./config.js";
import {
	EDITOR_TOP_MARGIN_ROW_VALUES,
	ICON_MODE_VALUES,
	WORKSPACE_LABEL_MODE_VALUES,
} from "./config-options.js";
import { getSegmentSettings, segmentLabel, type SegmentSettingDescriptor } from "./segment-registry.js";
import { GLANCE_THEME_IDS, themeLabel } from "./themes.js";
import type { EditorTopMarginRows, GlanceConfig, SegmentId } from "./types.js";

export type SettingsCategoryId = "general" | SegmentId;
type SettingsRowKind = "toggle" | "cycle" | "info";

export interface SettingsCategory {
	id: SettingsCategoryId;
	label: string;
	enabled?: boolean;
}

export interface SettingsRow {
	id: string;
	label: string;
	value: string;
	hint: string;
	kind: SettingsRowKind;
	apply?: (config: GlanceConfig) => GlanceConfig;
}

const MIN_CONTENT_ROWS = [2, 3, 4] as const;

function nextIn<T extends string>(current: T, values: readonly T[]): T {
	const index = values.indexOf(current);
	return values[(index + 1) % values.length] ?? values[0]!;
}

function nextNumber<T extends number>(current: number, values: readonly T[]): T {
	const index = values.indexOf(current as T);
	return values[(index + 1) % values.length] ?? values[0]!;
}

function withConfig(config: GlanceConfig, mutate: (next: GlanceConfig) => void): GlanceConfig {
	const next = cloneConfig(config);
	mutate(next);
	return next;
}

function onOff(value: boolean): string {
	return value ? "on" : "off";
}

function topMarginRowsLabel(value: EditorTopMarginRows): string {
	return value === 0 ? "none" : value === 1 ? "1 row" : "2 rows";
}

function toggleRow(id: string, label: string, value: boolean, hint: string, apply: (config: GlanceConfig) => GlanceConfig): SettingsRow {
	return { id, label, value: onOff(value), hint, kind: "toggle", apply };
}

function cycleRow(id: string, label: string, value: string, hint: string, apply: (config: GlanceConfig) => GlanceConfig): SettingsRow {
	return { id, label, value, hint, kind: "cycle", apply };
}

function infoRow(id: string, label: string, value: string, hint: string): SettingsRow {
	return { id, label, value, hint, kind: "info" };
}

function descriptorRow(config: GlanceConfig, descriptor: SegmentSettingDescriptor): SettingsRow {
	const row = {
		id: descriptor.id,
		label: descriptor.label,
		value: descriptor.value(config),
		hint: descriptor.hint,
		kind: descriptor.kind,
	};
	if (descriptor.kind === "info") return row;
	return {
		...row,
		apply: (draft) => withConfig(draft, descriptor.mutate),
	};
}

function segmentRows(config: GlanceConfig, id: SegmentId, rows: SettingsRow[]): SettingsRow[] {
	const segment = config.segments.find((candidate) => candidate.id === id);
	return [
		toggleRow(`${id}.enabled`, "Enabled", Boolean(segment?.enabled), "Show or hide this segment.", (draft) => toggleSegment(draft, id)),
		...rows,
	];
}

function segmentDescriptorRows(config: GlanceConfig, id: SegmentId): SettingsRow[] {
	return segmentRows(config, id, getSegmentSettings(id).map((descriptor) => descriptorRow(config, descriptor)));
}

export function getSettingsCategories(config: GlanceConfig): SettingsCategory[] {
	return [
		{ id: "general", label: "General" },
		...config.segments.map((segment) => ({
			id: segment.id,
			label: segmentLabel(segment.id),
			enabled: segment.enabled,
		})),
	];
}

export function getSettingsRows(config: GlanceConfig, categoryId: SettingsCategoryId): SettingsRow[] {
	switch (categoryId) {
		case "general":
			return [
				toggleRow("general.enabled", "Enabled", config.enabled, "Temporarily disable pi-glance.", (draft) =>
					withConfig(draft, (next) => {
						next.enabled = !next.enabled;
					}),
				),
				cycleRow("general.theme", "Theme", themeLabel(config.theme), "Switch the palette.", (draft) =>
					withConfig(draft, (next) => {
						next.theme = nextIn(next.theme, GLANCE_THEME_IDS);
					}),
				),
				cycleRow("general.icons", "Icons", config.icons, "Nerd icons need a Nerd Font or Symbols Nerd Font fallback. If icons look like boxes, choose plain.", (draft) =>
					withConfig(draft, (next) => {
						next.icons = nextIn(next.icons, ICON_MODE_VALUES);
					}),
				),
				cycleRow("general.minInputRows", "Min input rows", `${config.editor.minContentRows}`, "Set the resting editor height.", (draft) =>
					withConfig(draft, (next) => {
						next.editor.minContentRows = nextNumber(next.editor.minContentRows, MIN_CONTENT_ROWS);
					}),
				),
				cycleRow("general.topMarginRows", "Top spacing", topMarginRowsLabel(config.editor.topMarginRows), "Set breathing room above the editor.", (draft) =>
					withConfig(draft, (next) => {
						next.editor.topMarginRows = nextNumber(next.editor.topMarginRows, EDITOR_TOP_MARGIN_ROW_VALUES);
					}),
				),
				toggleRow("general.adaptiveWidth", "Adaptive width", config.display.adaptive, "Drop later segments first.", (draft) =>
					withConfig(draft, (next) => {
						next.display.adaptive = !next.display.adaptive;
					}),
				),
				cycleRow("general.workspaceLabel", "Workspace label", config.display.workspaceLabel, "Use ~/ path when space allows.", (draft) =>
					withConfig(draft, (next) => {
						next.display.workspaceLabel = nextIn(next.display.workspaceLabel, WORKSPACE_LABEL_MODE_VALUES);
					}),
				),
			];
		case "git":
		case "context":
		case "cost":
		case "tokens":
		case "model":
		case "throughput":
			return segmentDescriptorRows(config, categoryId);
		default:
			return [];
	}
}
