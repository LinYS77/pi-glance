import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { ICONS } from "../theme/palette.js";
import { SEGMENT_BY_ID } from "../segments/registry.js";
import { renderSegment } from "../segments/render.js";
import { resolveGlanceRenderStyles, type GlanceRenderStyleContext, type ResolvedGlanceStyles } from "../theme/adapter.js";
import type { GlanceConfig, GlanceState, SegmentRenderContext, SegmentRenderResult, WidthMode } from "../types.js";

const RESET = "\x1b[0m";

interface GlanceLineRenderOptions extends GlanceRenderStyleContext {
	readonly widthMode?: WidthMode;
}

function applyInlineSegmentStyle(segment: SegmentRenderResult, styles: ResolvedGlanceStyles, text: string): string {
	if (segment.tone === "error") return styles.error(text);
	if (segment.tone === "warning") return styles.warn(text);
	return styles.segments[segment.id].fg(text);
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
	options: GlanceLineRenderOptions = {},
): { styles: ResolvedGlanceStyles; segments: SegmentRenderResult[] } {
	const widthMode = options.widthMode ?? widthModeFor(width);
	const styles = resolveGlanceRenderStyles(config.theme, options);
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
	return { styles, segments: rendered };
}

interface JoinedSegments {
	text: string;
	width: number;
}

function joinSegments(styles: ResolvedGlanceStyles, segments: SegmentRenderResult[]): JoinedSegments {
	if (segments.length === 0) return { text: "", width: 0 };
	const text = `${segments
		.map((segment) => applyInlineSegmentStyle(segment, styles, segment.text))
		.join(styles.separator(" · "))}${RESET}`;
	return { text, width: visibleWidth(text) };
}

function fitSegments(styles: ResolvedGlanceStyles, segments: SegmentRenderResult[], width: number): JoinedSegments {
	const fitted = [...segments];
	let joined = joinSegments(styles, fitted);
	while (fitted.length > 0 && joined.width > width) {
		// Preserve configured priority: try shortening the trailing segment before
		// removing it, without sacrificing earlier facts to keep later ones.
		const last = fitted.at(-1)!;
		const remaining = width - (joined.width - visibleWidth(last.text));
		const shorter = last.fit?.(remaining);
		if (shorter !== undefined) {
			fitted[fitted.length - 1] = { ...last, text: shorter };
			return joinSegments(styles, fitted);
		}
		if (fitted.length === 1) break;
		fitted.pop();
		joined = joinSegments(styles, fitted);
	}
	return joined;
}

export function renderGlanceLine(
	state: GlanceState,
	config: GlanceConfig,
	width: number,
	providerCount = state.providers.availableCount,
	options: GlanceLineRenderOptions = {},
): string {
	if (!config.enabled) return "";
	const { styles, segments } = renderEnabledSegments(state, config, width, providerCount, options);
	const line = fitSegments(styles, segments, width);
	if (line.width > width) {
		return truncateToWidth(line.text, width, styles.dim("…"));
	}
	return line.text;
}
