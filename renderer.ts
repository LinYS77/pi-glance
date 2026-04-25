import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { ICONS, PALETTES, fg } from "./palette.js";
import { SEGMENT_BY_ID } from "./segments.js";
import type {
	GlanceConfig,
	GlancePalette,
	GlanceState,
	SegmentRenderContext,
	SegmentRenderResult,
	WidthMode,
} from "./types.js";

const RESET = "\x1b[0m";

function applyInlineSegmentStyle(segment: SegmentRenderResult, palette: GlancePalette, text: string): string {
	if (segment.id === "context") {
		const match = text.match(/([0-9]+(?:\.[0-9]+)?)%/);
		const percent = match ? Number.parseFloat(match[1]!) : NaN;
		if (Number.isFinite(percent) && percent >= 90) return fg(palette.error, text);
		if (Number.isFinite(percent) && percent >= 75) return fg(palette.warn, text);
		return fg(palette.segments.context.fg, text);
	}
	return fg(palette.segments[segment.id].fg, text);
}

function widthModeFor(width: number): WidthMode {
	if (width < 64) return "minimal";
	if (width < 96) return "compact";
	return "full";
}

function resolveShowProvider(config: GlanceConfig, providerCount: number, widthMode: WidthMode): boolean {
	if (config.display.showProvider === "always") return true;
	if (config.display.showProvider === "never") return false;
	return providerCount > 1 && widthMode === "full";
}

function renderEnabledSegments(
	state: GlanceState,
	config: GlanceConfig,
	width: number,
	providerCount = 1,
): { palette: GlancePalette; segments: SegmentRenderResult[] } {
	const widthMode = config.display.adaptive ? widthModeFor(width) : "full";
	const palette = PALETTES[config.theme];
	const icons = ICONS[config.icons];
	const ctx: SegmentRenderContext = {
		state,
		config,
		widthMode,
		icons,
		palette,
		showProvider: resolveShowProvider(config, providerCount, widthMode),
	};
	const rendered: SegmentRenderResult[] = [];
	for (const segmentConfig of config.segments) {
		if (!segmentConfig.enabled) continue;
		const definition = SEGMENT_BY_ID.get(segmentConfig.id);
		if (!definition) continue;
		const result = definition.render(ctx);
		if (result) rendered.push(result);
	}
	return { palette, segments: rendered };
}

function joinSegments(palette: GlancePalette, segments: SegmentRenderResult[]): string {
	if (segments.length === 0) return "";
	return `${segments
		.map((segment) => applyInlineSegmentStyle(segment, palette, segment.text))
		.join(fg(palette.separator, " · "))}${RESET}`;
}

function fitSegments(config: GlanceConfig, palette: GlancePalette, segments: SegmentRenderResult[], width: number): SegmentRenderResult[] {
	const fitted = [...segments];
	while (fitted.length > 1 && visibleWidth(joinSegments(palette, fitted)) > width) {
		const lowestPriority = Math.min(...fitted.map((segment) => segment.priority));
		const removeIndex = fitted.findIndex((segment) => segment.priority === lowestPriority);
		fitted.splice(removeIndex, 1);
	}
	return fitted;
}

export function renderGlanceLine(state: GlanceState, config: GlanceConfig, width: number, providerCount = state.providers.availableCount): string {
	if (!config.enabled) return "";
	const { palette, segments } = renderEnabledSegments(state, config, width, providerCount);
	const fitted = fitSegments(config, palette, segments, width);
	let line = joinSegments(palette, fitted);
	if (visibleWidth(line) > width) {
		line = truncateToWidth(line, width, fg(palette.dim, "…"));
	}
	return line;
}

export interface InputSurfaceRenderOptions {
	contentLines?: string[];
	focused?: boolean;
	showTitle?: boolean;
}

function borderColor(config: GlanceConfig, text: string): string {
	const palette = PALETTES[config.theme];
	return fg(palette.border, text);
}

function textColor(config: GlanceConfig, text: string): string {
	const palette = PALETTES[config.theme];
	return fg(palette.text, text);
}

function titleColor(config: GlanceConfig, text: string): string {
	const palette = PALETTES[config.theme];
	return fg(palette.title, text);
}

function dimColor(config: GlanceConfig, text: string): string {
	const palette = PALETTES[config.theme];
	return fg(palette.dim, text);
}

function padPlain(text: string, width: number): string {
	return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

export function renderInputSurfacePreview(config: GlanceConfig, width: number, options: InputSurfaceRenderOptions = {}): string[] {
	const state: GlanceState = {
		workspace: { name: "pi-glance", path: "/Users/winnie/projects/pi-glance" },
		git: { branch: "main" },
		providers: { availableCount: 2 },
		model: { id: "claude-sonnet-4-20250514", provider: "anthropic", displayName: "Sonnet 4", thinking: "high" },
		context: { tokens: 46_800, window: 200_000, percent: 23.4 },
		usage: { input: 12_400, output: 3_100, cacheRead: 800, cacheWrite: 0, cost: 0.042 },
		version: 0,
	};
	return renderInputSurface(state, config, width, options);
}

export function renderInputSurface(
	state: GlanceState,
	config: GlanceConfig,
	width: number,
	options: InputSurfaceRenderOptions = {},
): string[] {
	const safeWidth = Math.max(4, width);
	const innerWidth = Math.max(0, safeWidth - 2);
	const minRows = Math.max(2, Math.min(4, config.editor.minContentRows));
	const contentLines = options.contentLines ?? [""];
	const rows = Math.max(minRows, contentLines.length);
	const rawTitle = options.showTitle === false ? "" : ` ${state.workspace.name} `;
	const title = rawTitle ? truncateToWidth(rawTitle, Math.max(1, Math.min(32, Math.floor(innerWidth * 0.35))), "…") : "";
	const statusBudget = Math.max(0, innerWidth - (title ? visibleWidth(title) + 3 : 1));
	const status = renderGlanceLine(state, config, statusBudget, state.providers.availableCount);
	const statusWidth = visibleWidth(status);
	const leftTitle = title ? `${borderColor(config, "─")}${titleColor(config, title)}` : borderColor(config, "─");
	const leftTitleWidth = visibleWidth(leftTitle);
	const gap = status ? " " : "";
	const rightGap = status ? " " : "";
	const rightCap = status ? borderColor(config, "─") : "";
	const fillerWidth = Math.max(
		0,
		innerWidth - leftTitleWidth - visibleWidth(gap) - statusWidth - visibleWidth(rightGap) - visibleWidth(rightCap),
	);
	const top = `${borderColor(config, "╭")}${leftTitle}${borderColor(config, "─".repeat(fillerWidth))}${gap}${status}${rightGap}${rightCap}${borderColor(config, "╮")}`;
	const lines = [truncateToWidth(top, safeWidth, borderColor(config, "…"))];
	for (let i = 0; i < rows; i++) {
		const raw = contentLines[i] ?? "";
		const prefix = i === 0 && options.focused ? dimColor(config, "› ") : "  ";
		const contentBudget = Math.max(0, innerWidth - visibleWidth(prefix));
		const content = truncateToWidth(raw, contentBudget, dimColor(config, "…"));
		const padded = padPlain(`${prefix}${textColor(config, content)}`, innerWidth);
		lines.push(`${borderColor(config, "│")}${padded}${borderColor(config, "│")}`);
	}
	lines.push(`${borderColor(config, "╰")}${borderColor(config, "─".repeat(innerWidth))}${borderColor(config, "╯")}`);
	return lines;
}
