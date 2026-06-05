import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { ICONS, PALETTES, fg } from "./palette.js";
import { SEGMENT_BY_ID } from "./segment-registry.js";
import { renderSegment } from "./segments.js";
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
