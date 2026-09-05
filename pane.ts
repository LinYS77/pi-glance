import {
	Key,
	matchesKey,
	SelectList,
	truncateToWidth,
	visibleWidth,
	type Component,
	type Keybinding,
	type KeyId,
	type SelectItem,
	type TUI,
} from "@earendil-works/pi-tui";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	createPaneModel,
	createPaneViewModel,
	updatePaneModel,
	type CategoryViewModel,
	type GlancePaneViewModel,
	type HelpShortcut,
	type PaneIntent,
	type PaneModelState,
	type SettingViewModel,
	type ThemeBrowserThemeViewModel,
} from "./pane-model.js";
import { renderInputSurface, renderInputSurfacePreview } from "./renderer.js";
import type { GlanceRenderStyleContext } from "./theme-adapter.js";
import type { GlanceConfig, GlanceState } from "./types.js";

type PaneResult = { action: "save"; config: GlanceConfig } | { action: "cancel" };
type Done = (result: GlanceConfig | null) => void;
type Tone = (text: string) => string;

export interface GlancePaneOptions {
	readonly renderStyleContext?: GlanceRenderStyleContext;
}

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

const THEME_VIEWPORT = {
	minRows: 4,
	maxRows: 8,
	reservedRows: 16,
	fallbackTerminalRows: 40,
} as const;

function themeViewportRows(terminalRows: number | undefined): number {
	const rows = typeof terminalRows === "number" && Number.isFinite(terminalRows)
		? Math.floor(terminalRows)
		: THEME_VIEWPORT.fallbackTerminalRows;
	return Math.max(THEME_VIEWPORT.minRows, Math.min(THEME_VIEWPORT.maxRows, rows - THEME_VIEWPORT.reservedRows));
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

function matchesPaneBinding(
	data: string,
	keybindings: KeybindingsManager | undefined,
	action: Keybinding,
	fallback: KeyId,
): boolean {
	return keybindings ? keybindings.matches(data, action) : matchesKey(data, fallback);
}

function paneIntentFromKey(data: string, keybindings: KeybindingsManager | undefined, pageSize: number): PaneIntent | undefined {
	if (matchesKey(data, Key.ctrl("c"))) return { type: "cancel" };
	if (matchesPaneBinding(data, keybindings, "tui.select.cancel", Key.escape) || data === "q" || data === "Q") return { type: "back" };
	if (matchesKey(data, Key.left)) return { type: "move", direction: "left" };
	if (matchesKey(data, Key.right)) return { type: "move", direction: "right" };
	if (matchesPaneBinding(data, keybindings, "tui.select.up", Key.up)) return { type: "move", direction: "up" };
	if (matchesPaneBinding(data, keybindings, "tui.select.down", Key.down)) return { type: "move", direction: "down" };
	if (matchesPaneBinding(data, keybindings, "tui.select.pageUp", Key.pageUp)) return { type: "move", direction: "up", amount: pageSize };
	if (matchesPaneBinding(data, keybindings, "tui.select.pageDown", Key.pageDown)) return { type: "move", direction: "down", amount: pageSize };
	if (matchesPaneBinding(data, keybindings, "tui.select.confirm", Key.enter)) return { type: "activate" };
	if (matchesKey(data, Key.space)) return { type: "noop" };
	if (data === "s" || data === "S") return { type: "save" };
	if (data === "r" || data === "R") return { type: "resetDefaults" };
	if (data === "d" || data === "D") return { type: "cyclePreviewDensity" };
	if (data === "j" || data === "J") return { type: "reorderSegment", direction: 1 };
	if (data === "k" || data === "K") return { type: "reorderSegment", direction: -1 };
	return undefined;
}

class GlanceConfigPane implements Component {
	private model: PaneModelState;

	constructor(
		initial: GlanceConfig,
		private readonly theme: Theme,
		private readonly done: Done,
		private readonly requestRender: () => void,
		private readonly keybindings?: KeybindingsManager,
		private readonly getTerminalRows: () => number | undefined = () => undefined,
		private readonly previewState?: GlanceState,
		private readonly options: GlancePaneOptions = {},
	) {
		this.model = createPaneModel(initial);
	}

	invalidate(): void {}

	handleInput(data: string): void {
		const pageSize = this.model.subview === "themeBrowser" ? themeViewportRows(this.getTerminalRows()) : 5;
		const intent = paneIntentFromKey(data, this.keybindings, pageSize);
		if (!intent) return;

		const update = updatePaneModel(this.model, intent);
		this.model = update.model;

		if (update.completion) {
			this.done(update.completion.action === "cancel" ? null : update.completion.config);
			return;
		}

		if (update.requestRender) this.requestRender();
	}

	private renderPreview(lines: string[], model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): void {
		lines.push(paneLine(layout, [colors.dim(`Preview · density ${model.previewDensityLabel} · [D] cycle`)]));
		const previewOptions = {
			contentLines: ["Ask pi to improve the input surface..."],
			focused: true,
			...(this.options.renderStyleContext ?? {}),
			...(model.preview.density === "auto" ? {} : { previewDensity: model.preview.density }),
			...(model.preview.ambientTone ? { ambientTone: model.preview.ambientTone } : {}),
		};
		const preview = this.previewState
			? renderInputSurface(this.previewState, model.preview.config, layout.width, previewOptions)
			: renderInputSurfacePreview(model.preview.config, layout.width, previewOptions);
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

	private themeBrowserItems(browser: NonNullable<GlancePaneViewModel["themeBrowser"]>): SelectItem[] {
		return browser.themes.map((theme) => {
			const previewMarker = theme.previewed ? "●" : " ";
			const savedMarker = theme.saved ? "✓" : " ";
			const restoreMarker = theme.restored && !theme.saved ? "↩" : " ";
			return {
				value: theme.id,
				label: `${previewMarker} ${savedMarker}${restoreMarker} ${theme.label}`,
			};
		});
	}

	private renderThemeBrowserList(
		browser: NonNullable<GlancePaneViewModel["themeBrowser"]>,
		layout: PaneLayout,
		colors: PaneColors,
	): string[] {
		const list = new SelectList(this.themeBrowserItems(browser), themeViewportRows(this.getTerminalRows()), {
			selectedPrefix: colors.accent,
			selectedText: colors.accent,
			description: colors.muted,
			scrollInfo: colors.dim,
			noMatch: colors.warn,
		});
		list.setSelectedIndex(browser.highlightedThemeIndex);
		return list.render(layout.contentWidth).map((line) => paneLine(layout, [line]));
	}

	private renderThemeBrowserDetail(theme: ThemeBrowserThemeViewModel, layout: PaneLayout, colors: PaneColors): string[] {
		const tags = theme.detailTags.join(" · ");
		const summary = ["Selected", theme.groupLabel, tags].filter(Boolean).join(" · ");
		return [paneLine(layout, [colors.muted(summary)]), paneLine(layout, [colors.dim(theme.detailDescription)])];
	}

	private renderThemeBrowser(lines: string[], model: GlancePaneViewModel, layout: PaneLayout, colors: PaneColors): void {
		const browser = model.themeBrowser;
		if (!browser) return;

		const selected = browser.themes[browser.highlightedThemeIndex] ?? browser.themes.find((theme) => theme.selected);
		const title = `${browser.slotLabel} · preview ${browser.previewLabel}`;
		const restore = browser.restoreTheme === browser.savedTheme ? `saved ${browser.savedLabel}` : `saved ${browser.savedLabel} · Esc returns ${browser.restoreLabel}`;
		lines.push(paneLine(layout, [colors.muted(title)]));
		lines.push(paneLine(layout, [colors.dim(restore)]));
		lines.push(...this.renderThemeBrowserList(browser, layout, colors));

		if (selected) {
			lines.push("");
			lines.push(...this.renderThemeBrowserDetail(selected, layout, colors));
		}
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
		if (model.subview === "themeBrowser") {
			this.renderThemeBrowser(lines, model, layout, colors);
			return;
		}

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
		const colors = makePaneColors(this.theme);
		const layout = makePaneLayout(width);
		const model = createPaneViewModel(this.model, width);
		const lines: string[] = [];

		if (model.status) lines.push(paneLine(layout, [colors.dim(model.status)]));

		this.renderPreview(lines, model, layout, colors);
		lines.push("");

		this.renderSettings(lines, model, layout, colors);
		lines.push("");

		this.renderFooter(lines, model, layout, colors);
		return lines;
	}
}

interface GlancePaneUI {
	custom<T>(
		factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void) => Component,
	): Promise<T>;
}

export async function showGlancePane(
	initial: GlanceConfig,
	ctx: { ui: GlancePaneUI },
	previewState?: GlanceState,
	options: GlancePaneOptions = {},
): Promise<PaneResult> {
	return ctx.ui.custom<PaneResult>((tui, theme, keybindings, done) => {
		return new GlanceConfigPane(
			initial,
			theme,
			(result) => done(result ? { action: "save", config: result } : { action: "cancel" }),
			() => tui.requestRender(),
			keybindings,
			() => tui.terminal.rows,
			previewState,
			options,
		);
	});
}
