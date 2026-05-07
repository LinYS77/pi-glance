import { CustomEditor, type KeybindingsManager } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth, type EditorOptions, type EditorTheme, type TUI } from "@mariozechner/pi-tui";
import { PALETTES, fg } from "./palette.js";
import { renderGlanceLine } from "./renderer.js";
import { formatWorkspaceLabel, stripControls } from "./format.js";
import type { GlanceConfig, GlanceState } from "./types.js";

const CONTENT_PADDING_X = 1;
const AUTOCOMPLETE_INDENT = 1 + CONTENT_PADDING_X;

const BORDER = {
	topLeft: "╭",
	topRight: "╮",
	bottomLeft: "╰",
	bottomRight: "╯",
	vertical: "│",
	horizontal: "─",
};

function ansiPadRight(text: string, width: number): string {
	return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

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

function normalizeRenderedLine(line: string, width: number): string {
	const lineWidth = visibleWidth(line);
	if (lineWidth === width) return line;
	if (lineWidth < width) return `${line}${" ".repeat(width - lineWidth)}`;
	return truncateToWidth(line, width, "");
}

function indentAutocompleteLine(line: string, width: number): string {
	const indent = " ".repeat(Math.min(AUTOCOMPLETE_INDENT, Math.max(0, width - 1)));
	return normalizeRenderedLine(`${indent}${line}`, width);
}

interface TitleLayout {
	line: string;
	width: number;
}

export class GlanceEditor extends CustomEditor {
	private cachedVersion = -1;
	private cachedConfig?: GlanceConfig;
	private cachedWidth = -1;
	private cachedProviderCount = -1;
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

	private renderStatus(width: number): string {
		const state = this.getState();
		const config = this.getConfig();
		if (
			this.cachedWidth === width &&
			this.cachedVersion === state.version &&
			this.cachedConfig === config &&
			this.cachedProviderCount === state.providers.availableCount
		) {
			return this.cachedStatus;
		}
		const status = renderGlanceLine(state, config, width, state.providers.availableCount);
		this.cachedWidth = width;
		this.cachedVersion = state.version;
		this.cachedConfig = config;
		this.cachedProviderCount = state.providers.availableCount;
		this.cachedStatus = status;
		return status;
	}

	private border(text: string, isFocused: boolean): string {
		const palette = PALETTES[this.getConfig().theme];
		return fg(isFocused ? palette.border : palette.dim, text);
	}

	private title(text: string, isFocused: boolean): string {
		const palette = PALETTES[this.getConfig().theme];
		return fg(isFocused ? palette.title : palette.dim, text);
	}

	private titleLayout(width: number, innerWidth: number, original: string, isFocused: boolean): TitleLayout {
		const scrollIndicator = this.extractScrollIndicator(original, width);
		if (scrollIndicator) {
			return {
				line: this.border(scrollIndicator, isFocused),
				width: visibleWidth(scrollIndicator),
			};
		}

		if (innerWidth < 16) {
			return {
				line: this.border(BORDER.horizontal, isFocused),
				width: visibleWidth(BORDER.horizontal),
			};
		}

		const config = this.getConfig();
		const state = this.getState();
		const maxTitleWidth = Math.max(1, Math.min(48, Math.floor(innerWidth * 0.42)));
		const workspaceName = formatWorkspaceLabel(
			state.workspace.path,
			state.workspace.name || "workspace",
			config.display.workspaceLabel,
			Math.max(1, maxTitleWidth - 2),
			width,
		);
		const rawTitle = ` ${workspaceName} `;
		const titleText = truncateToWidth(rawTitle, maxTitleWidth, "…");
		const line =
			innerWidth >= 20
				? `${this.border(BORDER.horizontal, isFocused)}${this.title(rawTitle, isFocused)}`
				: `${this.border(BORDER.horizontal, isFocused)}${this.title(titleText, isFocused)}`;
		return { line, width: visibleWidth(line) };
	}

	private dimStatus(status: string, isFocused: boolean, config: GlanceConfig): string {
		if (isFocused || !status) return status;
		return fg(PALETTES[config.theme].dim, stripControls(status));
	}

	private makeTopBorder(width: number, original: string, isFocused: boolean): string {
		const config = this.getConfig();
		const innerWidth = Math.max(0, width - 2);
		const title = this.titleLayout(width, innerWidth, original, isFocused);
		const status = this.dimStatus(this.renderStatus(Math.max(0, innerWidth - title.width - 3)), isFocused, config);
		const statusWidth = visibleWidth(status);
		const leftGap = status ? " " : "";
		const rightGap = status ? " " : "";
		const rightCap = status ? BORDER.horizontal : "";
		const fillerWidth = Math.max(
			0,
			innerWidth - title.width - visibleWidth(leftGap) - statusWidth - visibleWidth(rightGap) - visibleWidth(rightCap),
		);

		return `${this.border(BORDER.topLeft, isFocused)}${title.line}${this.border(BORDER.horizontal.repeat(fillerWidth), isFocused)}${leftGap}${status}${rightGap}${this.border(rightCap, isFocused)}${this.border(BORDER.topRight, isFocused)}`;
	}

	private makeBottomBorder(width: number, original: string, isFocused: boolean): string {
		const indicator = this.extractScrollIndicator(original, width);
		if (!indicator) {
			return `${this.border(BORDER.bottomLeft, isFocused)}${this.border(BORDER.horizontal.repeat(Math.max(0, width - 2)), isFocused)}${this.border(BORDER.bottomRight, isFocused)}`;
		}
		const innerWidth = Math.max(0, width - 2);
		const indicatorWidth = visibleWidth(indicator);
		const fillerWidth = Math.max(0, innerWidth - indicatorWidth);
		return `${this.border(BORDER.bottomLeft, isFocused)}${this.border(indicator, isFocused)}${this.border(BORDER.horizontal.repeat(fillerWidth), isFocused)}${this.border(BORDER.bottomRight, isFocused)}`;
	}

	private extractScrollIndicator(line: string, width: number): string | undefined {
		const plain = stripBorderColor(line, this.borderColor);
		const match = plain.match(/(?:↑|↓) \d+ more/);
		if (!match) return undefined;
		const indicator = `${BORDER.horizontal.repeat(3)} ${match[0]} `;
		return truncateToWidth(indicator, Math.max(0, width - 2), "");
	}

	private wrapContentLine(line: string, width: number, isFocused: boolean): string {
		const innerWidth = Math.max(0, width - 2);
		const contentWidth = Math.max(1, innerWidth - CONTENT_PADDING_X * 2);
		const content = normalizeRenderedLine(line, contentWidth);
		const padded = `${" ".repeat(CONTENT_PADDING_X)}${content}${" ".repeat(CONTENT_PADDING_X)}`;
		return `${this.border(BORDER.vertical, isFocused)}${ansiPadRight(padded, innerWidth)}${this.border(BORDER.vertical, isFocused)}`;
	}

	render(width: number): string[] {
		const config = this.getConfig();
		if (!config.enabled) {
			return super.render(width);
		}

		const safeWidth = Math.max(4, width);
		const renderWidth = Math.max(1, safeWidth - 2 - CONTENT_PADDING_X * 2);
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

		const output = [this.makeTopBorder(safeWidth, topOriginal, isFocused)];
		for (const line of contentLines) {
			output.push(this.wrapContentLine(line, safeWidth, isFocused));
		}
		output.push(this.makeBottomBorder(safeWidth, bottomOriginal, isFocused));
		for (const line of autocomplete) {
			output.push(indentAutocompleteLine(line, safeWidth));
		}
		return output;
	}
}
