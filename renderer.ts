import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { ICONS, PALETTES, fg } from "./palette.js";
import {
	planSurfaceBottomFrame,
	planSurfaceRow,
	planSurfaceStatusBudget,
	planSurfaceTopFrame,
	planWorkspaceTitle,
	renderSurfaceChunks,
	surfaceMetrics,
} from "./surface-layout.js";
import { SEGMENT_BY_ID, renderSegment } from "./segments.js";
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
		showProvider: resolveShowProvider(config, providerCount, widthMode),
	};
	const rendered: SegmentRenderResult[] = [];
	for (const segmentConfig of config.segments) {
		if (!segmentConfig.enabled) continue;
		const definition = SEGMENT_BY_ID.get(segmentConfig.id);
		if (!definition) continue;
		const result = renderSegment(ctx, definition);
		if (result) rendered.push(result);
	}
	return { palette, segments: rendered };
}

interface JoinedSegments {
	text: string;
	width: number;
}

function joinSegments(palette: GlancePalette, segments: SegmentRenderResult[]): JoinedSegments {
	if (segments.length === 0) return { text: "", width: 0 };
	const text = `${segments
		.map((segment) => applyInlineSegmentStyle(segment, palette, segment.text))
		.join(fg(palette.separator, " · "))}${RESET}`;
	return { text, width: visibleWidth(text) };
}

function fitSegments(palette: GlancePalette, segments: SegmentRenderResult[], width: number): JoinedSegments {
	const fitted = [...segments];
	let joined = joinSegments(palette, fitted);
	while (fitted.length > 1 && joined.width > width) {
		fitted.pop();
		joined = joinSegments(palette, fitted);
	}
	return joined;
}

export function renderGlanceLine(state: GlanceState, config: GlanceConfig, width: number, providerCount = state.providers.availableCount): string {
	if (!config.enabled) return "";
	const { palette, segments } = renderEnabledSegments(state, config, width, providerCount);
	const line = fitSegments(palette, segments, width);
	if (line.width > width) {
		return truncateToWidth(line.text, width, fg(palette.dim, "…"));
	}
	return line.text;
}

interface InputSurfaceRenderOptions {
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

export function renderInputSurfacePreview(config: GlanceConfig, width: number, options: InputSurfaceRenderOptions = {}): string[] {
	const state: GlanceState = {
		workspace: { name: "pi-glance", path: "/Users/winnie/projects/pi-glance" },
		git: {
			repo: true,
			branch: "main",
			detached: false,
			sha: "a1b2c3d",
			upstream: "origin/main",
			ahead: 2,
			behind: 1,
			staged: 1,
			unstaged: 1,
			untracked: 0,
			conflicts: 0,
			dirty: true,
			status: "dirty",
			updatedAt: Date.now(),
		},
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
	const { safeWidth, innerWidth } = surfaceMetrics(width);
	const minRows = Math.max(2, Math.min(4, config.editor.minContentRows));
	const contentLines = options.contentLines ?? [""];
	const rows = Math.max(minRows, contentLines.length);
	const title = planWorkspaceTitle({
		workspacePath: state.workspace.path,
		workspaceName: state.workspace.name,
		mode: config.display.workspaceLabel,
		innerWidth,
		surfaceWidth: safeWidth,
		showTitle: options.showTitle,
	});
	const statusBudget = planSurfaceStatusBudget(innerWidth, title.width);
	const status = renderGlanceLine(state, config, statusBudget, state.providers.availableCount);
	const top = renderSurfaceChunks(planSurfaceTopFrame({ width: safeWidth, left: title, status }).chunks, {
		border: (text) => borderColor(config, text),
		title: (text) => titleColor(config, text),
		status: (text) => text,
		text: (text) => text,
		dim: (text) => dimColor(config, text),
	});
	const lines = [truncateToWidth(top, safeWidth, borderColor(config, "…"))];
	for (let i = 0; i < rows; i++) {
		const raw = contentLines[i] ?? "";
		const focusedPrefix = i === 0 && options.focused;
		const row = planSurfaceRow({
			width: safeWidth,
			text: raw,
			prefix: focusedPrefix ? "› " : "  ",
			ellipsis: dimColor(config, "…"),
			prefixRole: focusedPrefix ? "dim" : "text",
		});
		lines.push(
			renderSurfaceChunks(row.chunks, {
				border: (text) => borderColor(config, text),
				content: (text) => textColor(config, text),
				dim: (text) => dimColor(config, text),
				text: (text) => text,
			}),
		);
	}
	lines.push(
		renderSurfaceChunks(planSurfaceBottomFrame({ width: safeWidth }).chunks, {
			border: (text) => borderColor(config, text),
		}),
	);
	return lines;
}
