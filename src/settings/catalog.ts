import { shortcutLabel } from "../input/shortcut.js";
import { cloneConfig } from "../config/model.js";
import { RETRY_BLINK, SUMMARY_SPEED, WORKING_SPEED, type NumericSettingSpec } from "../config/schema.js";
import { choiceSetting, toggleSetting, type SettingDescriptor, type SettingOption } from "../config/settings.js";
import { getSegmentSettings, segmentLabel } from "../segments/registry.js";
import { GLANCE_THEMES } from "../theme/themes.js";
import type { GlanceThemeSlot } from "../theme/selection.js";
import type { GlanceConfig, GlanceThemeName, SegmentId } from "../types.js";

export type { GlanceThemeSlot } from "../theme/selection.js";
export type SettingsSectionId = "appearance" | "status" | "working" | "input";
export const SETTINGS_SECTIONS = [
	{ id: "appearance", label: "Appearance" },
	{ id: "status", label: "Status line" },
	{ id: "working", label: "Activity" },
	{ id: "input", label: "Input" },
] as const;

interface RowBase {
	id: string;
	label: string;
	value: string;
	hint: string;
	inactive?: boolean;
}
export type SettingsRow = RowBase &
	(
		| {
				kind: "toggle" | "choice";
				selectedIndex: number;
				options: readonly SettingOption[];
				select(config: GlanceConfig, index: number): GlanceConfig;
		  }
		| { kind: "shortcut"; key: string }
		| { kind: "theme"; slot: GlanceThemeSlot }
		| {
				kind: "number";
				number: number;
				min: number;
				max: number;
				step: number;
				precision: number;
				inputHint: string;
				setValue(config: GlanceConfig, value: number): GlanceConfig;
		  }
		| { kind: "segment"; segment: SegmentId; enabled: boolean }
	);

function descriptorRow(config: GlanceConfig, descriptor: SettingDescriptor): SettingsRow {
	return {
		id: descriptor.id,
		label: descriptor.label,
		value: descriptor.value(config),
		hint: descriptor.hint,
		kind: descriptor.kind,
		selectedIndex: descriptor.selectedIndex(config),
		options: descriptor.options,
		select: (config, index) => {
			const next = cloneConfig(config);
			descriptor.select(next, index);
			return next;
		},
	};
}

const themeCatalogs = {
	light: Object.freeze([
		...GLANCE_THEMES.filter((theme) => theme.tone === "light"),
		...GLANCE_THEMES.filter((theme) => theme.tone === "dark"),
	]),
	dark: Object.freeze([
		...GLANCE_THEMES.filter((theme) => theme.tone === "dark"),
		...GLANCE_THEMES.filter((theme) => theme.tone === "light"),
	]),
};

export function getThemeCatalogForSlot(slot: GlanceThemeSlot) {
	return themeCatalogs[slot];
}

export function getThemeLabel(id: GlanceThemeName): string {
	return GLANCE_THEMES.find((theme) => theme.id === id)?.label ?? id;
}

const appearance = [
	toggleSetting(
		"appearance.enabled",
		"Glance",
		"Use the Glance editor frame and status line.",
		(c) => c.enabled,
		(c, v) => {
			c.enabled = v;
		},
	),
	choiceSetting(
		"appearance.icons",
		"Icons",
		"Nerd Font needs a compatible font. Choose Plain if icons look broken.",
		[
			{ value: "nerd", label: "Nerd Font" },
			{ value: "plain", label: "Plain" },
		],
		(c) => c.icons,
		(c, v) => {
			c.icons = v;
		},
	),
	choiceSetting(
		"appearance.workspace",
		"Workspace label",
		"Choose the name shown on the editor's top edge.",
		[
			{ value: "name", label: "Folder name" },
			{ value: "smart", label: "Smart path", hint: "Shorten the path to fit the available space." },
			{ value: "path", label: "Full path", hint: "Show as much of the path as fits." },
		],
		(c) => c.display.workspaceLabel,
		(c, v) => {
			c.display.workspaceLabel = v;
		},
	),
];

const inputSettings = [
	choiceSetting(
		"input.rows",
		"Editor height",
		"Minimum input rows. The editor can grow as you type.",
		[2, 3, 4].map((value) => ({ value, label: `${value} rows` })),
		(c) => c.editor.minContentRows,
		(c, v) => {
			c.editor.minContentRows = v;
		},
	),
	choiceSetting(
		"input.spacing",
		"Space above editor",
		"Blank rows between the conversation and the editor.",
		[
			{ value: 0, label: "None" },
			{ value: 1, label: "1 row" },
			{ value: 2, label: "2 rows" },
		],
		(c) => c.editor.topMarginRows,
		(c, v) => {
			c.editor.topMarginRows = v;
		},
	),
	toggleSetting("input.stash", "Prompt stash", "Keep a draft while you ask another question. Press the shortcut again to restore or swap.",
		c => c.editor.stashEnabled, (c, value) => { c.editor.stashEnabled = value; }),
];

const activityDisplay = choiceSetting(
	"activity.mode", "Display mode", "Text shows native activity in the bottom border. Sweep uses state-driven border effects.",
	[{ value: "text", label: "Text" }, { value: "sweep", label: "Sweep" }] as const,
	c => c.editor.activityMode, (c, value) => { c.editor.activityMode = value; },
);

const animation = choiceSetting(
	"working.mode",
	"Effect area",
	"Where sweeps travel and retry borders blink.",
	[
		{ value: "perimeter", label: "Full border", hint: "Move clockwise around the editor." },
		{ value: "top", label: "Top edge", hint: "Sweep across the workspace title and connecting line." },
	],
	(c) => c.editor.workingSweep,
	(c, v) => {
		c.editor.workingSweep = v;
	},
);

const sweepColor = choiceSetting(
	"working.color",
	"Effect color",
	"Theme-matched accent for sweeps and retry blinking. Text-mode colors stay unchanged.",
	[
		{ value: "theme", label: "Theme default" },
		{ value: "amber", label: "Amber" },
		{ value: "rose", label: "Rose" },
		{ value: "violet", label: "Violet" },
		{ value: "blue", label: "Blue" },
		{ value: "teal", label: "Teal" },
		{ value: "mint", label: "Mint" },
		{ value: "coral", label: "Coral" },
		{ value: "copper", label: "Copper" },
	],
	c => c.editor.workingSweepColor,
	(c, value) => { c.editor.workingSweepColor = value; },
);

function activityNumber(config: GlanceConfig, id: string, label: string,
	field: "workingSweepSpeed" | "summarySpeedMultiplier" | "retryBlinkHz", spec: NumericSettingSpec,
	value: string, unit: string, hint: string): SettingsRow {
	return {
		id, label, value, hint, kind: "number", number: config.editor[field],
		min: spec.min, max: spec.max, step: spec.step, precision: spec.precision,
		inputHint: `Enter ${spec.precision ? `a number (up to ${spec.precision} decimals)` : "a whole number"} from ${spec.min} to ${spec.max} ${unit}. Default: ${spec.defaultValue}.`,
		setValue: (config, value) => {
			const next = cloneConfig(config); next.editor[field] = spec.normalize(value); return next;
		},
	};
}

const segmentHints: Record<SegmentId, string> = {
	git: "Branch, uncommitted changes and upstream commits.",
	cost: "Session cost in USD, shown as a compact amount.",
	throughput: "Model output speed in tokens per second.",
	context: "Current context usage and available capacity.",
	tokens: "Session token counts and prompt-cache usage.",
	extensions: "Statuses published by other Pi extensions. Hidden when empty; yields to built-in facts.",
	model: "Model name, provider and thinking level. Always the last status item removed.",
};

export function getSettingsRows(config: GlanceConfig, section: SettingsSectionId, segment?: SegmentId): SettingsRow[] {
	if (section === "status") {
		if (segment) return getSegmentSettings(segment).map((descriptor) => descriptorRow(config, descriptor));
		return config.segments.map(({ id, enabled }) => ({
			id: `status.${id}`,
			label: segmentLabel(id),
			value: enabled ? "On" : "Off",
			hint: segmentHints[id],
			kind: "segment",
			segment: id,
			enabled,
		}));
	}
	if (section === "input") return [
		...inputSettings.map(setting => descriptorRow(config, setting)),
		{
			id: "input.shortcut", label: "Stash shortcut", value: shortcutLabel(config.editor.stashShortcut),
			hint: "Press Enter, then a shortcut. Pi's own bindings cannot be replaced.",
			kind: "shortcut", key: config.editor.stashShortcut,
		},
	];
	if (section === "working") {
		const editor = config.editor;
		return [
			descriptorRow(config, activityDisplay),
			descriptorRow(config, animation),
			activityNumber(config, "working.speed", "Sweep speed", "workingSweepSpeed", WORKING_SPEED,
				`${editor.workingSweepSpeed} cols/s`, "cols/s", "Working travel speed: 10–120 columns per second."),
			descriptorRow(config, sweepColor),
			activityNumber(config, "activity.summarySpeed", "Compaction / summary speed", "summarySpeedMultiplier", SUMMARY_SPEED,
				`${editor.summarySpeedMultiplier.toFixed(2)}× · ${Number((editor.workingSweepSpeed * editor.summarySpeedMultiplier).toFixed(2))} cols/s`, "×",
				"Multiply Working speed for compaction and branch summaries. Below 1 is slower; above 1 is faster."),
			activityNumber(config, "activity.retryBlink", "Retry blink rate", "retryBlinkHz", RETRY_BLINK,
				`${editor.retryBlinkHz.toFixed(2)} Hz`, "Hz", `One complete bright/normal cycle every ${Number((1 / editor.retryBlinkHz).toFixed(2))}s. Does not change Pi's retry delay.`),
		].map((row, index) => ({ ...row, inactive: index > 0 && editor.activityMode === "text" }));
	}
	const rows = appearance.map((descriptor) => descriptorRow(config, descriptor));
	rows.splice(
		1,
		0,
		...(["light", "dark"] as const).map((slot) => ({
			id: `appearance.palette.${slot}`,
			label: slot === "light" ? "Light palette" : "Dark palette",
			value: getThemeLabel(config.theme[slot]),
			hint:
				slot === "light"
					? "Glance colors for Pi's light or unrecognized theme. Does not change Pi's theme."
					: "Glance colors for Pi's dark theme. Does not change Pi's theme.",
			kind: "theme" as const,
			slot,
		})),
	);
	return rows;
}
