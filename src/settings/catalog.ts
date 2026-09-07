import { cloneConfig } from "../config/model.js";
import { WORKING_SPEED } from "../config/schema.js";
import { choiceSetting, toggleSetting, type SegmentSettingDescriptor, type SettingOption } from "../segments/feature.js";
import { getSegmentSettings, segmentLabel } from "../segments/registry.js";
import { GLANCE_THEMES } from "../theme/themes.js";
import type { GlanceThemeSlot } from "../theme/selection.js";
import type { GlanceConfig, GlanceThemeName, SegmentId } from "../types.js";

export type { GlanceThemeSlot } from "../theme/selection.js";
export type SettingsSectionId = "appearance" | "status" | "working";
export const SETTINGS_SECTIONS = [
	{ id: "appearance", label: "Appearance" },
	{ id: "status", label: "Status line" },
	{ id: "working", label: "Working" },
] as const;

interface RowBase { id: string; label: string; value: string; hint: string }
export type SettingsRow = RowBase & (
	| { kind: "toggle" | "choice"; selectedIndex: number; options: readonly SettingOption[]; select(config: GlanceConfig, index: number): GlanceConfig }
	| { kind: "theme"; slot: GlanceThemeSlot }
	| { kind: "number"; number: number; min: number; max: number; setValue(config: GlanceConfig, value: number): GlanceConfig }
	| { kind: "segment"; segment: SegmentId; enabled: boolean }
);

function descriptorRow(config: GlanceConfig, descriptor: SegmentSettingDescriptor): SettingsRow {
	return {
		id: descriptor.id, label: descriptor.label, value: descriptor.value(config), hint: descriptor.hint,
		kind: descriptor.kind, selectedIndex: descriptor.selectedIndex(config), options: descriptor.options,
		select: (config, index) => {
			const next = cloneConfig(config);
			descriptor.select(next, index);
			return next;
		},
	};
}

export function getThemeCatalogForSlot(slot: GlanceThemeSlot) {
	return [...GLANCE_THEMES.filter(theme => theme.tone === slot), ...GLANCE_THEMES.filter(theme => theme.tone !== slot)];
}

export function getThemeLabel(id: GlanceThemeName): string {
	return GLANCE_THEMES.find(theme => theme.id === id)?.label ?? id;
}

const appearance = [
	toggleSetting("appearance.enabled", "Glance", "Use the Glance editor frame and status line.", c => c.enabled, (c, v) => { c.enabled = v; }),
	choiceSetting("appearance.icons", "Icons", "Nerd Font needs a compatible font. Choose Plain if icons look broken.", [
		{ value: "nerd", label: "Nerd Font" }, { value: "plain", label: "Plain" },
	], c => c.icons, (c, v) => { c.icons = v; }),
	choiceSetting("appearance.workspace", "Workspace label", "Choose the name shown on the editor's top edge.", [
		{ value: "name", label: "Folder name" }, { value: "smart", label: "Smart path", hint: "Shorten the path to fit the available space." }, { value: "path", label: "Full path", hint: "Show as much of the path as fits." },
	], c => c.display.workspaceLabel, (c, v) => { c.display.workspaceLabel = v; }),
	choiceSetting("appearance.rows", "Editor height", "Minimum input rows. The editor can grow as you type.", [2, 3, 4].map(value => ({ value, label: `${value} rows` })), c => c.editor.minContentRows, (c, v) => { c.editor.minContentRows = v; }),
	choiceSetting("appearance.spacing", "Space above editor", "Blank rows between the conversation and the editor.", [
		{ value: 0, label: "None" }, { value: 1, label: "1 row" }, { value: 2, label: "2 rows" },
	], c => c.editor.topMarginRows, (c, v) => { c.editor.topMarginRows = v; }),
];

const animation = choiceSetting("working.mode", "Animation", "Off uses Pi's Working indicator instead of a sweep.", [
	{ value: "perimeter", label: "Full border", hint: "Move clockwise around the editor." },
	{ value: "top", label: "Top edge", hint: "Sweep across the workspace title and connecting line." },
	{ value: "off", label: "Off", hint: "Use Pi's Working indicator." },
], c => c.editor.workingSweep, (c, v) => { c.editor.workingSweep = v; });

const segmentHints: Record<SegmentId, string> = {
	git: "Branch, uncommitted changes and upstream commits.",
	cost: "Session cost in USD, shown as a compact amount.",
	throughput: "Model output speed in tokens per second.",
	context: "Current context usage and available capacity.",
	tokens: "Session token counts and prompt-cache usage.",
	model: "Model name, provider and thinking level.",
};

export function getSettingsRows(config: GlanceConfig, section: SettingsSectionId, segment?: SegmentId): SettingsRow[] {
	if (section === "status") {
		if (segment) return getSegmentSettings(segment).map(descriptor => descriptorRow(config, descriptor));
		return config.segments.map(({ id, enabled }) => ({
			id: `status.${id}`, label: segmentLabel(id), value: enabled ? "On" : "Off", hint: segmentHints[id], kind: "segment", segment: id, enabled,
		}));
	}
	if (section === "working") return [
		descriptorRow(config, animation),
		{
			id: "working.speed", label: "Sweep speed", value: `${config.editor.workingSweepSpeed} cols/s`,
			hint: config.editor.workingSweep === "off" ? "Turn animation on to preview the speed. Your speed is kept while off." : "10–120 columns per second. Applies to both sweep modes.",
			kind: "number", number: config.editor.workingSweepSpeed, min: WORKING_SPEED.min, max: WORKING_SPEED.max,
			setValue: (config, value) => {
				const next = cloneConfig(config);
				next.editor.workingSweepSpeed = WORKING_SPEED.normalize(value);
				return next;
			},
		},
	];
	const rows = appearance.map(descriptor => descriptorRow(config, descriptor));
	rows.splice(1, 0, ...(["light", "dark"] as const).map(slot => ({
		id: `appearance.palette.${slot}`, label: slot === "light" ? "Light palette" : "Dark palette", value: getThemeLabel(config.theme[slot]),
		hint: slot === "light" ? "Glance colors for Pi's light or unrecognized theme. Does not change Pi's theme." : "Glance colors for Pi's dark theme. Does not change Pi's theme.",
		kind: "theme" as const, slot,
	})));
	return rows;
}
