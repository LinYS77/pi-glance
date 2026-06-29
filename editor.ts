import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type EditorOptions, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { stripControls } from "./format.js";
import { renderGlanceLine } from "./status-line.js";
import {
	formatSurfaceScrollIndicator,
	planSurfaceBottomFrame,
	planSurfaceRow,
	planSurfaceStatusBudget,
	planSurfaceTopFrame,
	planWorkspaceTitle,
	renderSurfaceChunks,
	renderSurfaceTopMargin,
	safeSurfaceWidth,
	surfaceMetrics,
	SURFACE_AUTOCOMPLETE_INDENT,
	SURFACE_CONTENT_PADDING_X,
} from "./surface-layout.js";
import { resolveBuiltInGlanceStyles, type ResolvedGlanceStyles } from "./theme-adapter.js";
import type { GlanceConfig, GlanceState } from "./types.js";

function stripBorderColor(line: string, borderColor: (text: string) => string): string {
	const sample = borderColor("─");
	if (!sample || sample === "─") return stripControls(line);
	const markerIndex = sample.indexOf("─");
	if (markerIndex < 0) return stripControls(line);
	const prefix = sample.slice(0, markerIndex);
	const suffix = sample.slice(markerIndex + 1);
	let out = line;
	if (prefix) out = out.split(prefix).join("");
	if (suffix) out = out.split(suffix).join("");
	return stripControls(out);
}

function isHorizontalBorder(line: string, borderColor: (text: string) => string): boolean {
	const plain = stripBorderColor(line, borderColor).trim();
	return (
		plain.length > 0 &&
		plain.includes("─") &&
		[...plain].every((char) => char === "─" || char === "↑" || char === "↓" || char === " " || /[0-9a-z]/i.test(char))
	);
}

function stripControlsPreservingSpaces(text: string): string {
	return text
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\r\n\t]/g, " ");
}

function normalizeRenderedLine(line: string, width: number): string {
	const lineWidth = visibleWidth(line);
	if (lineWidth === width) return line;
	if (lineWidth < width) return `${line}${" ".repeat(width - lineWidth)}`;
	return truncateToWidth(line, width, "");
}

function indentAutocompleteLine(line: string, width: number): string {
	const indent = " ".repeat(Math.min(SURFACE_AUTOCOMPLETE_INDENT, Math.max(0, width - 1)));
	return normalizeRenderedLine(`${indent}${line}`, width);
}

export class GlanceEditor extends CustomEditor {
	private cachedVersion = -1;
	private cachedConfig?: GlanceConfig;
	private cachedWidth = -1;
	private cachedProviderCount = -1;
	private cachedStatusStyleKey = "";
	private cachedStatus = "";

	constructor(
		tui: TUI,
		theme: EditorTheme,
		private readonly appKeybindings: KeybindingsManager,
		private readonly getState: () => GlanceState,
		private readonly getConfig: () => GlanceConfig,
		private readonly onThinkingLevelMaybeChanged?: () => void,
		options?: EditorOptions,
	) {
		super(tui, theme, appKeybindings, options);
	}

	handleInput(data: string): void {
		const isThinkingCycle = this.appKeybindings.matches(data, "app.thinking.cycle");
		super.handleInput(data);
		if (isThinkingCycle) this.onThinkingLevelMaybeChanged?.();
	}

	private currentStyles(config: GlanceConfig = this.getConfig()): ResolvedGlanceStyles {
		return resolveBuiltInGlanceStyles(config.theme);
	}

	private renderStatus(width: number, styles: ResolvedGlanceStyles): string {
		const state = this.getState();
		const config = this.getConfig();
		if (
			this.cachedWidth === width &&
			this.cachedVersion === state.version &&
			this.cachedConfig === config &&
			this.cachedProviderCount === state.providers.availableCount &&
			this.cachedStatusStyleKey === styles.cacheKey
		) {
			return this.cachedStatus;
		}
		const status = renderGlanceLine(state, config, width, state.providers.availableCount);
		this.cachedWidth = width;
		this.cachedVersion = state.version;
		this.cachedConfig = config;
		this.cachedProviderCount = state.providers.availableCount;
		this.cachedStatusStyleKey = styles.cacheKey;
		this.cachedStatus = status;
		return status;
	}

	private border(text: string, isFocused: boolean, styles: ResolvedGlanceStyles): string {
		return isFocused ? styles.border(text) : styles.dim(text);
	}

	private title(text: string, isFocused: boolean, styles: ResolvedGlanceStyles): string {
		return isFocused ? styles.title(text) : styles.dim(text);
	}

	private topLeftPlan(width: number, innerWidth: number, original: string) {
		const scrollIndicator = this.extractScrollIndicator(original, width);
		if (scrollIndicator) {
			const chunks = [{ role: "border" as const, text: scrollIndicator }];
			return { chunks, width: visibleWidth(scrollIndicator) };
		}

		const config = this.getConfig();
		const state = this.getState();
		return planWorkspaceTitle({
			workspacePath: state.workspace.path,
			workspaceName: state.workspace.name,
			mode: config.display.workspaceLabel,
			innerWidth,
			surfaceWidth: width,
		});
	}

	private dimStatus(status: string, isFocused: boolean, styles: ResolvedGlanceStyles): string {
		if (isFocused || !status) return status;
		return styles.dim(stripControlsPreservingSpaces(status));
	}

	private makeTopBorder(width: number, original: string, isFocused: boolean, styles: ResolvedGlanceStyles): string {
		const { safeWidth, innerWidth } = surfaceMetrics(width);
		const left = this.topLeftPlan(safeWidth, innerWidth, original);
		const statusBudget = planSurfaceStatusBudget(innerWidth, left.width);
		const status = this.dimStatus(this.renderStatus(statusBudget, styles), isFocused, styles);
		return renderSurfaceChunks(planSurfaceTopFrame({ width: safeWidth, left, status }).chunks, {
			border: (text) => this.border(text, isFocused, styles),
			title: (text) => this.title(text, isFocused, styles),
			status: (text) => text,
			text: (text) => text,
			dim: (text) => this.border(text, isFocused, styles),
		});
	}

	private makeBottomBorder(width: number, original: string, isFocused: boolean, styles: ResolvedGlanceStyles): string {
		return renderSurfaceChunks(
			planSurfaceBottomFrame({ width, scrollIndicator: this.extractScrollIndicator(original, width) }).chunks,
			{
				border: (text) => this.border(text, isFocused, styles),
			},
		);
	}

	private extractScrollIndicator(line: string, width: number): string | undefined {
		return formatSurfaceScrollIndicator(stripBorderColor(line, this.borderColor), width);
	}

	private wrapContentLine(line: string, width: number, isFocused: boolean, styles: ResolvedGlanceStyles): string {
		return renderSurfaceChunks(
			planSurfaceRow({
				width,
				text: line,
				paddingX: SURFACE_CONTENT_PADDING_X,
				reserveRightPadding: true,
				ellipsis: "",
			}).chunks,
			{
				border: (text) => this.border(text, isFocused, styles),
				content: (text) => text,
				text: (text) => text,
			},
		);
	}

	render(width: number): string[] {
		const config = this.getConfig();
		if (!config.enabled) {
			return super.render(width);
		}

		const styles = this.currentStyles(config);
		const safeWidth = safeSurfaceWidth(width);
		const renderWidth = Math.max(1, safeWidth - 2 - SURFACE_CONTENT_PADDING_X * 2);
		const lines = super.render(renderWidth);
		if (lines.length < 2) return lines;

		const isFocused = this.focused;

		const topOriginal = lines[0] ?? "";
		let bottomIndex = -1;
		for (let i = 1; i < lines.length; i++) {
			if (isHorizontalBorder(lines[i] ?? "", this.borderColor)) bottomIndex = i;
		}
		if (bottomIndex < 1) return lines;

		const bottomOriginal = lines[bottomIndex] ?? "";
		const body = lines.slice(1, bottomIndex);
		const autocomplete = lines.slice(bottomIndex + 1);
		const contentLines = body.length > 0 ? body : [""];
		while (contentLines.length < config.editor.minContentRows) {
			contentLines.push("");
		}

		const output = [...renderSurfaceTopMargin(safeWidth, config.editor.topMarginRows), this.makeTopBorder(safeWidth, topOriginal, isFocused, styles)];
		for (const line of contentLines) {
			output.push(this.wrapContentLine(line, safeWidth, isFocused, styles));
		}
		output.push(this.makeBottomBorder(safeWidth, bottomOriginal, isFocused, styles));
		for (const line of autocomplete) {
			output.push(indentAutocompleteLine(line, safeWidth));
		}
		return output;
	}
}
