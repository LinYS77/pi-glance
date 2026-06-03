import { cloneConfig, toggleSegment } from "./config.js";
import { SEGMENT_BY_ID } from "./segments.js";
import { GLANCE_THEME_IDS, themeLabel } from "./themes.js";
import type { GlanceConfig, SegmentId } from "./types.js";

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

const POLL_INTERVALS = [2000, 5000, 10000, 30000] as const;
const ICON_MODES = ["plain", "nerd"] as const;
const MIN_CONTENT_ROWS = [2, 3, 4] as const;
const WORKSPACE_LABEL_MODES = ["name", "smart", "path"] as const;
const GIT_SHA_MODES = ["off", "detached", "always"] as const;
const CONTEXT_DISPLAY_MODES = ["percent+tokens", "percent", "tokens"] as const;
const CONTEXT_UNKNOWN_MODES = ["show", "hide"] as const;
const TOKENS_DISPLAY_MODES = ["input-output", "total"] as const;
const TOKENS_CACHE_MODES = ["auto", "show", "hide"] as const;
const PROVIDER_LABEL_MODES = ["auto", "always", "never"] as const;
const MODEL_THINKING_MODES = ["auto", "always", "never"] as const;

const CONTEXT_DISPLAY_LABELS: Record<GlanceConfig["context"]["display"], string> = {
	"percent+tokens": "percent / tokens",
	percent: "percent",
	tokens: "tokens",
};

const TOKENS_DISPLAY_LABELS: Record<GlanceConfig["tokens"]["display"], string> = {
	"input-output": "input / output",
	total: "total",
};

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

function segmentLabel(id: SegmentId): string {
	return SEGMENT_BY_ID.get(id)?.label ?? id;
}

function formatPolling(ms: number): string {
	if (ms % 1000 === 0) return `${ms / 1000}s`;
	return `${ms}ms`;
}

function contextDisplayLabel(mode: GlanceConfig["context"]["display"]): string {
	return CONTEXT_DISPLAY_LABELS[mode];
}

function tokensDisplayLabel(mode: GlanceConfig["tokens"]["display"]): string {
	return TOKENS_DISPLAY_LABELS[mode];
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

function segmentRows(config: GlanceConfig, id: SegmentId, rows: SettingsRow[]): SettingsRow[] {
	const segment = config.segments.find((candidate) => candidate.id === id);
	return [
		toggleRow(`${id}.enabled`, "Enabled", Boolean(segment?.enabled), "Show or hide this segment.", (draft) => toggleSegment(draft, id)),
		...rows,
	];
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
						next.icons = nextIn(next.icons, ICON_MODES);
					}),
				),
				cycleRow("general.minInputRows", "Min input rows", `${config.editor.minContentRows}`, "Set the resting editor height.", (draft) =>
					withConfig(draft, (next) => {
						next.editor.minContentRows = nextNumber(next.editor.minContentRows, MIN_CONTENT_ROWS);
					}),
				),
				toggleRow("general.adaptiveWidth", "Adaptive width", config.display.adaptive, "Drop later segments first.", (draft) =>
					withConfig(draft, (next) => {
						next.display.adaptive = !next.display.adaptive;
					}),
				),
				cycleRow("general.workspaceLabel", "Workspace label", config.display.workspaceLabel, "Use ~/ path when space allows.", (draft) =>
					withConfig(draft, (next) => {
						next.display.workspaceLabel = nextIn(next.display.workspaceLabel, WORKSPACE_LABEL_MODES);
					}),
				),
			];
		case "git":
			return segmentRows(config, "git", [
				toggleRow("git.dirtyMarker", "Dirty marker", config.git.showDirty, "Conflicts always stay visible.", (draft) =>
					withConfig(draft, (next) => {
						next.git.showDirty = !next.git.showDirty;
					}),
				),
				toggleRow("git.aheadBehind", "Ahead / behind", config.git.showAheadBehind, "Show upstream counts.", (draft) =>
					withConfig(draft, (next) => {
						next.git.showAheadBehind = !next.git.showAheadBehind;
					}),
				),
				cycleRow("git.sha", "SHA", config.git.shaMode, "Keep branches quiet unless enabled.", (draft) =>
					withConfig(draft, (next) => {
						next.git.shaMode = nextIn(next.git.shaMode, GIT_SHA_MODES);
					}),
				),
				cycleRow("git.polling", "Polling", formatPolling(config.git.pollIntervalMs), "Check external Git changes.", (draft) =>
					withConfig(draft, (next) => {
						next.git.pollIntervalMs = nextNumber(next.git.pollIntervalMs, POLL_INTERVALS);
					}),
				),
			]);
		case "context":
			return segmentRows(config, "context", [
				cycleRow("context.display", "Display", contextDisplayLabel(config.context.display), "Choose percent, tokens, or both.", (draft) =>
					withConfig(draft, (next) => {
						next.context.display = nextIn(next.context.display, CONTEXT_DISPLAY_MODES);
					}),
				),
				cycleRow("context.unknown", "Unknown", config.context.unknown, "Hide when usage is unknown.", (draft) =>
					withConfig(draft, (next) => {
						next.context.unknown = nextIn(next.context.unknown, CONTEXT_UNKNOWN_MODES);
					}),
				),
			]);
		case "cost":
			return segmentRows(config, "cost", [
				toggleRow("cost.hideZero", "Hide zero", config.cost.hideZero, "Hide until cost is non-zero.", (draft) =>
					withConfig(draft, (next) => {
						next.cost.hideZero = !next.cost.hideZero;
					}),
				),
				infoRow("cost.display", "Display", "compact USD", "Compact session cost."),
			]);
		case "tokens":
			return segmentRows(config, "tokens", [
				cycleRow("tokens.display", "Display", tokensDisplayLabel(config.tokens.display), "Choose input/output or total.", (draft) =>
					withConfig(draft, (next) => {
						next.tokens.display = nextIn(next.tokens.display, TOKENS_DISPLAY_MODES);
					}),
				),
				cycleRow("tokens.cache", "Cache", config.tokens.cache, "Show or hide cache details.", (draft) =>
					withConfig(draft, (next) => {
						next.tokens.cache = nextIn(next.tokens.cache, TOKENS_CACHE_MODES);
					}),
				),
			]);
		case "model":
			return segmentRows(config, "model", [
				cycleRow("model.providerLabel", "Provider label", config.display.showProvider, "Show provider name.", (draft) =>
					withConfig(draft, (next) => {
						next.display.showProvider = nextIn(next.display.showProvider, PROVIDER_LABEL_MODES);
					}),
				),
				cycleRow("model.thinkingLabel", "Thinking label", config.model.showThinking, "Show thinking level.", (draft) =>
					withConfig(draft, (next) => {
						next.model.showThinking = nextIn(next.model.showThinking, MODEL_THINKING_MODES);
					}),
				),
			]);
		default:
			return [];
	}
}
