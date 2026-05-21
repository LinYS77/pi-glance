import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { cloneConfig, defaultConfig, moveSegment, toggleSegment } from "./config.js";
import { GLANCE_THEME_IDS, themeLabel } from "./themes.js";
import { renderInputSurface, renderInputSurfacePreview } from "./renderer.js";
import { SEGMENT_BY_ID } from "./segments.js";
import type {
	ContextDisplayMode,
	ContextUnknownMode,
	GitShaMode,
	GlanceConfig,
	GlanceState,
	IconMode,
	ModelThinkingMode,
	SegmentId,
	TokensCacheMode,
	TokensDisplayMode,
	WorkspaceLabelMode,
} from "./types.js";

type PaneFocus = "categories" | "settings" | "values";
type CategoryId = "general" | SegmentId;
type Category = { id: CategoryId; label: string };
type PaneResult = { action: "save"; config: GlanceConfig } | { action: "cancel" };
type Done = (result: PaneResult) => void;
type SettingKind = "toggle" | "cycle" | "info";
type SettingRow = { label: string; value: string; hint?: string; kind: SettingKind; mutate?: () => void };
type Tone = (text: string) => string;

interface PaneColors {
	accent: Tone;
	muted: Tone;
	dim: Tone;
	warn: Tone;
	success: Tone;
}

interface PaneLayout {
	width: number;
	contentWidth: number;
	outerPadding: string;
	categoryWidth: number;
	settingLabelWidth: number;
	valueWidth: number;
	settingsWidth: number;
	asideWidth: number;
	columnGap: string;
	asideGap: string;
	asideSeparator: string;
	showAside: boolean;
}

type HelpShortcut = { key: string; label: string };

type CategoryViewModel = Category & {
	selected: boolean;
	hasFocus: boolean;
	enabled?: boolean;
};

type SettingViewModel = Omit<SettingRow, "mutate"> & {
	selected: boolean;
	labelHasFocus: boolean;
	valueHasFocus: boolean;
};

interface GlancePaneViewModel {
	dirty: boolean;
	status: string;
	categories: CategoryViewModel[];
	selectedCategory?: Category;
	settingsTitle: string;
	settings: SettingViewModel[];
	selectedHint?: string;
	help: HelpShortcut[];
}

const PANE_FOCUS_ORDER: PaneFocus[] = ["categories", "settings", "values"];

const PANE_SPACING = {
	outerPadding: 2,
	contentInset: 4,
	categoryWidth: 14,
	settingLabelWidth: 20,
	valueWidth: 16,
	minValueWidth: 8,
	asideWidth: 36,
	minAsideWidth: 22,
	columnGap: 4,
	asideGap: 4,
	minContentWidth: 10,
	asideSeparator: "│",
} as const;

const POLL_INTERVALS = [2000, 5000, 10000, 30000] as const;
const CONTEXT_DISPLAY_LABELS: Record<ContextDisplayMode, string> = {
	"percent+tokens": "percent / tokens",
	percent: "percent",
	tokens: "tokens",
};
const TOKENS_DISPLAY_LABELS: Record<TokensDisplayMode, string> = {
	"input-output": "input / output",
	total: "total",
};
const WORKSPACE_LABEL_MODES: WorkspaceLabelMode[] = ["name", "smart", "path"];

function nextIn<T extends string>(current: T, values: readonly T[]): T {
	const index = values.indexOf(current);
	return values[(index + 1) % values.length] ?? values[0]!;
}

function nextNumber<T extends number>(current: number, values: readonly T[]): T {
	const index = values.indexOf(current as T);
	return values[(index + 1) % values.length] ?? values[0]!;
}

function plainLine(parts: string[], width: number): string {
	return truncateToWidth(parts.join(""), width, "…");
}

function makePaneLayout(width: number): PaneLayout {
	const outerPaddingWidth = width < 72 ? 1 : PANE_SPACING.outerPadding;
	const contentWidth = Math.max(PANE_SPACING.minContentWidth, width - outerPaddingWidth * 2);
	const categoryWidth = PANE_SPACING.categoryWidth;
	const columnGapWidth = width < 72 ? 2 : PANE_SPACING.columnGap;
	const asideFrameWidth = PANE_SPACING.asideGap + visibleWidth(PANE_SPACING.asideSeparator) + 1;
	const settingLabelWidth = PANE_SPACING.settingLabelWidth;
	const labelWidthWithCursor = settingLabelWidth + 2;
	const valueRoom = contentWidth - categoryWidth - columnGapWidth - labelWidthWithCursor - columnGapWidth;
	const valueWidth = Math.max(PANE_SPACING.minValueWidth, Math.min(PANE_SPACING.valueWidth, valueRoom));
	const settingsWidth = labelWidthWithCursor + columnGapWidth + valueWidth;
	const coreWidth = categoryWidth + columnGapWidth + settingsWidth;
	const asideRoom = contentWidth - coreWidth - asideFrameWidth;
	const showAside = asideRoom >= PANE_SPACING.minAsideWidth;
	const maxAsideWidth = width >= 120 ? 48 : PANE_SPACING.asideWidth;
	const asideWidth = showAside ? Math.min(maxAsideWidth, asideRoom) : 0;

	return {
		width,
		contentWidth,
		outerPadding: " ".repeat(outerPaddingWidth),
		categoryWidth,
		settingLabelWidth,
		valueWidth,
		settingsWidth,
		asideWidth,
		columnGap: " ".repeat(columnGapWidth),
		asideGap: " ".repeat(PANE_SPACING.asideGap),
		asideSeparator: PANE_SPACING.asideSeparator,
		showAside,
	};
}

function paneLine(layout: PaneLayout, parts: string[]): string {
	return plainLine([layout.outerPadding, ...parts], layout.width);
}

function padRightAnsi(text: string, width: number): string {
	const extra = Math.max(0, width - visibleWidth(text));
	return `${text}${" ".repeat(extra)}`;
}

function spreadAnsi(left: string, right: string, width: number): string {
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	if (leftWidth + rightWidth + 1 > width) {
		const leftBudget = Math.max(0, width - rightWidth - 1);
		if (leftBudget <= 0) return truncateToWidth(right, width, "…");
		return `${truncateToWidth(left, leftBudget, "…")} ${right}`;
	}
	return `${left}${" ".repeat(Math.max(0, width - leftWidth - rightWidth))}${right}`;
}

function sameConfig(a: GlanceConfig, b: GlanceConfig): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function makePaneColors(theme: Theme): PaneColors {
	return {
		accent: (s: string) => theme.fg("accent", s),
		muted: (s: string) => theme.fg("muted", s),
		dim: (s: string) => theme.fg("dim", s),
		warn: (s: string) => theme.fg("warning", s),
		success: (s: string) => theme.fg("success", s),
	};
}

function shortcut(colors: PaneColors, key: string, label: string): string {
	return `${colors.accent(`[${key}]`)} ${colors.dim(label)}`;
}

function helpText(help: HelpShortcut[], colors: PaneColors): string {
	return help.map((item) => shortcut(colors, item.key, item.label)).join(colors.dim("  ·  "));
}

function focusGap(gap: string, colors: PaneColors): string {
	const gapWidth = visibleWidth(gap);
	if (gapWidth <= 1) return colors.accent("›");
	return `${" ".repeat(Math.max(0, gapWidth - 2))}${colors.accent("› ")}`;
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

function contextDisplayLabel(mode: ContextDisplayMode): string {
	return CONTEXT_DISPLAY_LABELS[mode];
}

function tokensDisplayLabel(mode: TokensDisplayMode): string {
	return TOKENS_DISPLAY_LABELS[mode];
}

function toggleRow(label: string, value: boolean, hint: string, mutate: () => void): SettingRow {
	return { label, value: onOff(value), hint, kind: "toggle", mutate };
}

function cycleRow(label: string, value: string, hint: string, mutate: () => void): SettingRow {
	return { label, value, hint, kind: "cycle", mutate };
}

function infoRow(label: string, value: string, hint: string): SettingRow {
	return { label, value, hint, kind: "info" };
}

class GlanceConfigPane implements Component {
	private readonly initial: GlanceConfig;
	private draft: GlanceConfig;
	private focus: PaneFocus = "categories";
	private catIndex = 0;
	private setIndex = 0;
	private status = "";

	constructor(
		initial: GlanceConfig,
		private readonly theme: Theme,
		private readonly done: Done,
		private readonly requestRender: () => void,
		private readonly previewState?: GlanceState,
	) {
		this.initial = cloneConfig(initial);
		this.draft = cloneConfig(initial);
	}

	invalidate(): void {}

	private isDirty(): boolean {
		return !sameConfig(this.draft, this.initial);
	}

	private getViewModel(width = this.lastRenderedWidth): GlancePaneViewModel {
		const categories = this.getCategories();
		const selectedCategory = categories[this.catIndex];
		const settings = selectedCategory ? this.getSettings(selectedCategory.id) : [];
		return {
			dirty: this.isDirty(),
			status: this.status,
			categories: categories.map((cat, index) => {
				const segment = cat.id === "general" ? undefined : this.draft.segments.find((s) => s.id === cat.id);
				return {
					...cat,
					selected: index === this.catIndex,
					hasFocus: this.focus === "categories",
					enabled: segment?.enabled,
				};
			}),
			selectedCategory,
			settingsTitle: selectedCategory ? (selectedCategory.id === "general" ? "General" : selectedCategory.label) : "",
			settings: settings.map((row, index) => ({
				label: row.label,
				value: row.value,
				hint: row.hint,
				kind: row.kind,
				selected: index === this.setIndex,
				labelHasFocus: this.focus === "settings",
				valueHasFocus: this.focus === "values",
			})),
			selectedHint: settings[this.setIndex]?.hint,
			help: this.helpShortcuts(width),
		};
	}

	private helpShortcuts(width = this.lastRenderedWidth): HelpShortcut[] {
		const stable: HelpShortcut[] = [
			{ key: "←→↑↓", label: "move" },
			{ key: "S", label: "save" },
			{ key: "R", label: "reset" },
		];

		const isNarrow = width < 72;

		switch (this.focus) {
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

	private lastRenderedWidth = 96;

	private getCategories(): Category[] {
		return [
			{ id: "general", label: "General" },
			...this.draft.segments.map((segment) => ({
				id: segment.id,
				label: segmentLabel(segment.id),
			})),
		];
	}

	private getSettings(id: CategoryId): SettingRow[] {
		switch (id) {
			case "general":
				return this.generalRows();
			case "git":
				return this.gitRows();
			case "context":
				return this.contextRows();
			case "cost":
				return this.costRows();
			case "tokens":
				return this.tokensRows();
			case "model":
				return this.modelRows();
			default:
				return [];
		}
	}

	private generalRows(): SettingRow[] {
		return [
			toggleRow("Enabled", this.draft.enabled, "Temporarily disable pi-glance.", () => {
				this.draft.enabled = !this.draft.enabled;
			}),
			cycleRow("Theme", themeLabel(this.draft.theme), "Switch the palette.", () => {
				this.draft.theme = nextIn(this.draft.theme, GLANCE_THEME_IDS);
			}),
			cycleRow("Icons", this.draft.icons, "Plain works without Nerd Font.", () => {
				this.draft.icons = nextIn(this.draft.icons, ["plain", "nerd"] as IconMode[]);
			}),
			cycleRow("Min input rows", `${this.draft.editor.minContentRows}`, "Set the resting editor height.", () => {
				this.draft.editor.minContentRows = nextNumber(this.draft.editor.minContentRows, [2, 3, 4] as const);
			}),
			toggleRow("Adaptive width", this.draft.display.adaptive, "Drop later segments first.", () => {
				this.draft.display.adaptive = !this.draft.display.adaptive;
			}),
			cycleRow("Workspace label", this.draft.display.workspaceLabel, "Use ~/ path when space allows.", () => {
				this.draft.display.workspaceLabel = nextIn(this.draft.display.workspaceLabel, WORKSPACE_LABEL_MODES);
			}),
		];
	}

	private contextRows(): SettingRow[] {
		return this.segmentRows("context", [
			cycleRow("Display", contextDisplayLabel(this.draft.context.display), "Choose percent, tokens, or both.", () => {
				this.draft.context.display = nextIn(this.draft.context.display, ["percent+tokens", "percent", "tokens"] as ContextDisplayMode[]);
			}),
			cycleRow("Unknown", this.draft.context.unknown, "Hide when usage is unknown.", () => {
				this.draft.context.unknown = nextIn(this.draft.context.unknown, ["show", "hide"] as ContextUnknownMode[]);
			}),
		]);
	}

	private costRows(): SettingRow[] {
		return this.segmentRows("cost", [
			toggleRow("Hide zero", this.draft.cost.hideZero, "Hide until cost is non-zero.", () => {
				this.draft.cost.hideZero = !this.draft.cost.hideZero;
			}),
			infoRow("Display", "compact USD", "Compact session cost."),
		]);
	}

	private tokensRows(): SettingRow[] {
		return this.segmentRows("tokens", [
			cycleRow("Display", tokensDisplayLabel(this.draft.tokens.display), "Choose input/output or total.", () => {
				this.draft.tokens.display = nextIn(this.draft.tokens.display, ["input-output", "total"] as TokensDisplayMode[]);
			}),
			cycleRow("Cache", this.draft.tokens.cache, "Show or hide cache details.", () => {
				this.draft.tokens.cache = nextIn(this.draft.tokens.cache, ["auto", "show", "hide"] as TokensCacheMode[]);
			}),
		]);
	}

	private modelRows(): SettingRow[] {
		return this.segmentRows("model", [
			cycleRow("Provider label", this.draft.display.showProvider, "Show provider name.", () => {
				this.draft.display.showProvider = nextIn(this.draft.display.showProvider, ["auto", "always", "never"] as const);
			}),
			cycleRow("Thinking label", this.draft.model.showThinking, "Show thinking level.", () => {
				this.draft.model.showThinking = nextIn(this.draft.model.showThinking, ["auto", "always", "never"] as ModelThinkingMode[]);
			}),
		]);
	}

	private gitRows(): SettingRow[] {
		return this.segmentRows("git", [
			toggleRow("Dirty marker", this.draft.git.showDirty, "Conflicts always stay visible.", () => {
				this.draft.git.showDirty = !this.draft.git.showDirty;
			}),
			toggleRow("Ahead / behind", this.draft.git.showAheadBehind, "Show upstream counts.", () => {
				this.draft.git.showAheadBehind = !this.draft.git.showAheadBehind;
			}),
			cycleRow("SHA", this.draft.git.shaMode, "Keep branches quiet unless enabled.", () => {
				this.draft.git.shaMode = nextIn(this.draft.git.shaMode, ["off", "detached", "always"] as GitShaMode[]);
			}),
			cycleRow("Polling", formatPolling(this.draft.git.pollIntervalMs), "Check external Git changes.", () => {
				this.draft.git.pollIntervalMs = nextNumber(this.draft.git.pollIntervalMs, POLL_INTERVALS);
			}),
		]);
	}

	private segmentRows(id: SegmentId, rows: SettingRow[]): SettingRow[] {
		const segment = this.draft.segments.find((s) => s.id === id);
		return [
			toggleRow("Enabled", Boolean(segment?.enabled), "Show or hide this segment.", () => {
				this.draft = toggleSegment(this.draft, id);
			}),
			...rows,
		];
	}

	private activateCurrent(): void {
		const cat = this.getCategories()[this.catIndex];
		if (!cat) return;
		const settings = this.getSettings(cat.id);
		const row = settings[this.setIndex];
		if (!row) return;

		if (!row.mutate) {
			this.status = row.hint ?? `${row.label} is informational.`;
			return;
		}

		row.mutate();
		const next = this.getSettings(cat.id)[this.setIndex];
		this.status = `${row.label} → ${next?.value ?? "updated"}. Press S to save.`;
	}

	private moveCurrentSegment(direction: -1 | 1): void {
		if (this.catIndex === 0) {
			this.status = "Cannot move General settings.";
			return;
		}
		const segment = this.draft.segments[this.catIndex - 1];
		if (!segment) return;

		const targetCatIndex = this.catIndex + direction;
		if (targetCatIndex < 1 || targetCatIndex > this.draft.segments.length) {
			this.status = direction < 0 ? "Already at the top." : "Already at the bottom.";
			return;
		}

		this.draft = moveSegment(this.draft, segment.id, direction);
		this.catIndex = targetCatIndex;
		this.status = "Segment order updated. Press S to save.";
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.ctrl("c"))) {
			this.done({ action: "cancel" });
			return;
		}
		if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
			if (this.focus === "categories") {
				this.done({ action: "cancel" });
			} else {
				this.focus = "categories";
				this.requestRender();
			}
			return;
		}
		if (matchesKey(data, Key.left)) {
			const index = PANE_FOCUS_ORDER.indexOf(this.focus);
			if (this.focus === "settings") {
				const count = this.getCategories().length;
				this.catIndex = count === 0 ? 0 : Math.min(this.setIndex, count - 1);
			}
			this.focus = PANE_FOCUS_ORDER[Math.max(0, index - 1)] ?? "categories";
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.right)) {
			const index = PANE_FOCUS_ORDER.indexOf(this.focus);
			if (this.focus === "categories") {
				const cat = this.getCategories()[this.catIndex];
				const count = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = count === 0 ? 0 : Math.min(this.catIndex, count - 1);
			}
			this.focus = PANE_FOCUS_ORDER[Math.min(PANE_FOCUS_ORDER.length - 1, index + 1)] ?? "values";
			this.requestRender();
			return;
		}
		if (data === "s" || data === "S") {
			this.done({ action: "save", config: cloneConfig(this.draft) });
			return;
		}
		if (data === "r" || data === "R") {
			this.draft = defaultConfig();
			this.focus = "categories";
			this.catIndex = 0;
			this.setIndex = 0;
			this.status = "Defaults restored locally. Press S to save or Esc to discard.";
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.up)) {
			if (this.focus === "categories") {
				const count = this.getCategories().length;
				this.catIndex = count === 0 ? 0 : (this.catIndex - 1 + count) % count;
				const cat = this.getCategories()[this.catIndex];
				const settingsCount = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = settingsCount === 0 ? 0 : Math.min(this.catIndex, settingsCount - 1);
			} else {
				const cat = this.getCategories()[this.catIndex];
				const count = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = count === 0 ? 0 : (this.setIndex - 1 + count) % count;
			}
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			if (this.focus === "categories") {
				const count = this.getCategories().length;
				this.catIndex = count === 0 ? 0 : (this.catIndex + 1) % count;
				const cat = this.getCategories()[this.catIndex];
				const settingsCount = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = settingsCount === 0 ? 0 : Math.min(this.catIndex, settingsCount - 1);
			} else {
				const cat = this.getCategories()[this.catIndex];
				const count = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = count === 0 ? 0 : (this.setIndex + 1) % count;
			}
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			if (this.focus === "values") {
				this.activateCurrent();
				this.requestRender();
			}
			return;
		}
		if (matchesKey(data, Key.space)) return;
		if (this.focus === "categories" && (data === "k" || data === "K")) {
			this.moveCurrentSegment(-1);
			this.requestRender();
			return;
		}
		if (this.focus === "categories" && (data === "j" || data === "J")) {
			this.moveCurrentSegment(1);
			this.requestRender();
		}
	}

	private renderPreview(lines: string[], layout: PaneLayout): void {
		const preview = this.previewState
			? renderInputSurface(this.previewState, this.draft, layout.width, {
					contentLines: ["Ask pi to improve the input surface..."],
					focused: true,
				})
			: renderInputSurfacePreview(this.draft, layout.width, {
					contentLines: ["Ask pi to improve the input surface..."],
					focused: true,
				});
		for (const previewLine of preview) {
			lines.push(previewLine);
		}
	}

	private renderCategoryRow(cat: CategoryViewModel, colors: PaneColors): string {
		let labelTone = colors.muted;

		if (cat.selected) {
			labelTone = cat.hasFocus ? colors.accent : colors.muted;
		} else if (cat.enabled === false) {
			labelTone = colors.dim;
		}

		let cursor = "  ";
		if (cat.selected) {
			cursor = cat.hasFocus ? colors.accent("» ") : colors.dim("› ");
		}
		return `${cursor}${labelTone(cat.label)}`;
	}

	private renderLeftPane(model: GlancePaneViewModel, colors: PaneColors): string[] {
		return model.categories.map((cat) => this.renderCategoryRow(cat, colors));
	}

	private renderSettingValue(row: SettingViewModel, colors: PaneColors): string {
		if (row.kind === "info") return colors.dim(row.value);
		const valueTone = row.selected && row.valueHasFocus ? colors.accent : row.value === "on" ? colors.success : row.value === "off" ? colors.dim : colors.muted;
		let displayValue = row.value;
		if (row.selected && row.valueHasFocus) {
			displayValue = `[ ${row.value} ]`;
		}
		return valueTone(displayValue);
	}

	private renderSettingRow(row: SettingViewModel, layout: PaneLayout, colors: PaneColors): string {
		let labelTone = colors.muted;

		if (row.selected) {
			labelTone = row.labelHasFocus ? colors.accent : colors.muted;
		} else if (row.kind === "info") {
			labelTone = colors.dim;
		}

		const label = truncateToWidth(row.label, layout.settingLabelWidth, "…");
		const cursor = row.selected ? (row.labelHasFocus ? colors.accent("» ") : colors.dim("› ")) : "  ";
		const paddedLabel = padRightAnsi(`${cursor}${labelTone(label)}`, layout.settingLabelWidth + 2);
		const gap = row.selected && row.valueHasFocus ? focusGap(layout.columnGap, colors) : layout.columnGap;
		const valueStr = this.renderSettingValue(row, colors);
		const value = truncateToWidth(valueStr, layout.valueWidth, "…");
		return `${paddedLabel}${gap}${value}`;
	}

	private renderSettingsPane(model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): string[] {
		if (!model.selectedCategory) return [];

		if (model.settings.length === 0) {
			return [colors.dim("No settings available.")];
		}

		return model.settings.map((row) => this.renderSettingRow(row, layout, colors));
	}

	private renderAsidePane(model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): string[] {
		const hint = model.selectedHint ? truncateToWidth(model.selectedHint, layout.asideWidth - 2, "…") : "";
		return [colors.muted(model.settingsTitle), hint ? colors.dim(`“${hint}”`) : ""];
	}

	private renderSettingsColumns(lines: string[], model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): void {
		const categories = this.renderLeftPane(model, colors);
		const settings = this.renderSettingsPane(model, layout, colors);
		const aside = layout.showAside ? this.renderAsidePane(model, layout, colors) : [];

		const maxLines = Math.max(categories.length, settings.length, aside.length);
		for (let i = 0; i < maxLines; i++) {
			const category = padRightAnsi(categories[i] ?? "", layout.categoryWidth);
			const selectedSetting = model.settings[i];
			const categoryGap = selectedSetting?.selected && selectedSetting.labelHasFocus ? focusGap(layout.columnGap, colors) : layout.columnGap;
			const setting = padRightAnsi(settings[i] ?? "", layout.settingsWidth);
			const asideLine = aside[i] ?? "";
			const asidePart = layout.showAside ? [layout.asideGap, colors.dim(`${layout.asideSeparator} `), asideLine] : [];
			lines.push(paneLine(layout, [category, categoryGap, setting, ...asidePart]));
		}
	}

	private renderSettings(lines: string[], model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): void {
		this.renderSettingsColumns(lines, model, layout, colors);
		if (!layout.showAside && model.selectedHint) {
			const hint = truncateToWidth(model.selectedHint, layout.contentWidth, "…");
			lines.push("");
			lines.push(paneLine(layout, [colors.dim(`“${hint}”`)]));
		}
	}

	private renderFooter(lines: string[], model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): void {
		const footerLeft = helpText(model.help, colors);
		const footerRight = model.dirty ? colors.warn("● Unsaved changes") : colors.success("✓ Saved");
		lines.push(paneLine(layout, [spreadAnsi(footerLeft, footerRight, layout.contentWidth)]));
	}

	render(width: number): string[] {
		this.lastRenderedWidth = width;
		const colors = makePaneColors(this.theme);
		const layout = makePaneLayout(width);
		const model = this.getViewModel(width);
		const lines: string[] = [];

		if (model.status) lines.push(paneLine(layout, [colors.dim(model.status)]));

		this.renderPreview(lines, layout);
		lines.push("");

		this.renderSettings(lines, model, layout, colors);
		lines.push("");

		this.renderFooter(lines, model, layout, colors);
		return lines;
	}
}

interface GlancePaneUI {
	custom<T>(
		factory: (tui: TUI, theme: Theme, keybindings: unknown, done: (result: T) => void) => Component,
	): Promise<T>;
}

export async function showGlancePane(initial: GlanceConfig, ctx: { ui: GlancePaneUI }, previewState?: GlanceState): Promise<PaneResult> {
	return ctx.ui.custom<PaneResult>((tui, theme, _kb, done) => {
		return new GlanceConfigPane(initial, theme, done, () => tui.requestRender(), previewState);
	});
}
