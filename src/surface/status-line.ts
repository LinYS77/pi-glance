import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { extensionStatusTexts, fitExtensionStatuses } from "./extension-statuses.js";
import { ICONS } from "../theme/palette.js";
import { SEGMENT_BY_ID } from "../segments/registry.js";
import { renderSegment } from "../segments/render.js";
import {
	resolveGlanceRenderStyles,
	type GlanceRenderStyleContext,
	type ResolvedGlanceStyles,
} from "../theme/adapter.js";
import type { GlanceConfig, GlanceState, SegmentRenderContext, SegmentRenderResult, WidthMode } from "../types.js";

const RESET = "\x1b[0m";

interface GlanceLineRenderOptions extends GlanceRenderStyleContext {
	readonly widthMode?: WidthMode;
	readonly extensionStatuses?: ReadonlyMap<string, string>;
}

function applyInlineSegmentStyle(segment: SegmentRenderResult, styles: ResolvedGlanceStyles, text: string): string {
	if (segment.id === "extensions") return text;
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
		if (!definition || definition.id === "extensions") continue;
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

function fitSegments(styles: ResolvedGlanceStyles, segments: SegmentRenderResult[], width: number): SegmentRenderResult[] {
	const fitted = [...segments];
	let joined = joinSegments(styles, fitted);
	// New optional detail must not crowd out facts that fit before it was added.
	for (let i = 0; i < fitted.length && joined.width > width; i++) {
		const segment = fitted[i]!;
		for (const text of segment.detailFallbacks ?? []) {
			if (visibleWidth(text) >= visibleWidth(fitted[i]!.text)) continue;
			fitted[i] = { ...segment, text };
			joined = joinSegments(styles, fitted);
			if (joined.width <= width) break;
		}
	}
	while (fitted.length > 0 && joined.width > width) {
		// Display order ranks ordinary facts, but Model always survives last.
		// Try the trailing fact's shorter labels before removing any fact.
		const last = fitted.at(-1)!;
		const remaining = width - (joined.width - visibleWidth(last.text));
		const shorter = last.fit?.(remaining);
		if (shorter !== undefined) {
			fitted[fitted.length - 1] = { ...last, text: shorter };
			return fitted;
		}
		if (fitted.length === 1) break;
		const removable = last.id === "model" ? fitted.length - 2 : fitted.length - 1;
		fitted.splice(removable, 1);
		joined = joinSegments(styles, fitted);
	}
	return fitted;
}

function readExtensionTexts(config: GlanceConfig, options: GlanceLineRenderOptions): readonly string[] {
	return config.enabled && config.segments.some(s => s.id === "extensions" && s.enabled)
		? extensionStatusTexts(options.extensionStatuses) : [];
}

function renderLine(
	state: GlanceState,
	config: GlanceConfig,
	width: number,
	providerCount: number,
	options: GlanceLineRenderOptions,
	extensionTexts: readonly string[],
): string {
	if (!config.enabled) return "";
	const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
	const { styles, segments } = renderEnabledSegments(state, config, safeWidth, providerCount, options);
	const fitted = fitSegments(styles, segments, safeWidth);
	let line = joinSegments(styles, fitted);
	if (extensionTexts.length) {
		// External text gets spare columns, never a built-in fact's space.
		const budget = fitted.length ? Math.min(Math.floor(safeWidth / 3), safeWidth - line.width - 3) : safeWidth;
		const text = fitExtensionStatuses(extensionTexts, budget, styles);
		if (text) {
			const order = config.segments.map(s => s.id);
			const index = order.indexOf("extensions");
			const before = fitted.filter(s => order.indexOf(s.id) < index).length;
			fitted.splice(before, 0, { id: "extensions", tone: "normal", text });
			line = joinSegments(styles, fitted);
		}
	}
	if (line.width > safeWidth) {
		return truncateToWidth(line.text, safeWidth, styles.dim("…"));
	}
	return line.text;
}

export function renderGlanceLine(
	state: GlanceState,
	config: GlanceConfig,
	width: number,
	providerCount = state.providers.availableCount,
	options: GlanceLineRenderOptions = {},
): string {
	return renderLine(state, config, width, providerCount, options, readExtensionTexts(config, options));
}

/** One entry per surface; compare live status contents rather than the Map's identity. */
export class GlanceLineRenderer {
	private cached?: {
		state: GlanceState;
		version: number;
		config: GlanceConfig;
		width: number;
		providerCount: number;
		styleKey: string;
		widthMode?: WidthMode;
		extensionTexts: readonly string[];
		text: string;
	};

	render(
		state: GlanceState,
		config: GlanceConfig,
		width: number,
		providerCount = state.providers.availableCount,
		options: GlanceLineRenderOptions = {},
	): string {
		const styles = resolveGlanceRenderStyles(config.theme, options);
		const extensionTexts = readExtensionTexts(config, options);
		const previous = this.cached;
		if (
			previous?.state === state &&
			previous.version === state.version &&
			previous.config === config &&
			previous.width === width &&
			previous.providerCount === providerCount &&
			previous.styleKey === styles.cacheKey &&
			previous.widthMode === options.widthMode &&
			previous.extensionTexts.length === extensionTexts.length &&
			previous.extensionTexts.every((text, index) => text === extensionTexts[index])
		) {
			return previous.text;
		}
		const text = renderLine(state, config, width, providerCount, { styles, widthMode: options.widthMode }, extensionTexts);
		this.cached = {
			state,
			version: state.version,
			config,
			width,
			providerCount,
			styleKey: styles.cacheKey,
			widthMode: options.widthMode,
			extensionTexts,
			text,
		};
		return text;
	}
}
