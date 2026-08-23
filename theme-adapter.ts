import { PALETTES, fg } from "./palette.js";
import { selectGlanceTheme, type GlanceAmbientTone } from "./theme-selection.js";
import type { GlanceThemeName } from "./themes.js";
import type { GlanceThemePair, Rgb, SegmentId } from "./types.js";

export type TextStyler = (text: string) => string;

export interface ResolvedGlanceSegmentStyles {
	readonly fg: TextStyler;
}

export interface ResolvedGlanceStyles {
	readonly cacheKey: string;
	readonly text: TextStyler;
	readonly dim: TextStyler;
	readonly warn: TextStyler;
	readonly error: TextStyler;
	readonly separator: TextStyler;
	readonly border: TextStyler;
	readonly title: TextStyler;
	readonly segments: Record<SegmentId, ResolvedGlanceSegmentStyles>;
}

export interface GlanceRenderStyleContext {
	readonly styles?: ResolvedGlanceStyles;
	readonly ambientTone?: GlanceAmbientTone;
	readonly getAmbientTone?: () => GlanceAmbientTone;
}

const STYLE_SEGMENT_IDS = ["git", "model", "context", "tokens", "cost", "throughput"] as const satisfies readonly SegmentId[];

function styleFromRgb(color: Rgb): TextStyler {
	return (text) => fg(color, text);
}

function resolveBuiltInSegmentStyles(theme: GlanceThemeName): Record<SegmentId, ResolvedGlanceSegmentStyles> {
	const palette = PALETTES[theme];
	return Object.fromEntries(
		STYLE_SEGMENT_IDS.map((segment) => [segment, { fg: styleFromRgb(palette.segments[segment].fg) }]),
	) as Record<SegmentId, ResolvedGlanceSegmentStyles>;
}

export function resolveBuiltInGlanceStyles(theme: GlanceThemeName): ResolvedGlanceStyles {
	const palette = PALETTES[theme];
	return {
		cacheKey: `glance:${theme}`,
		text: styleFromRgb(palette.text),
		dim: styleFromRgb(palette.dim),
		warn: styleFromRgb(palette.warn),
		error: styleFromRgb(palette.error),
		separator: styleFromRgb(palette.separator),
		border: styleFromRgb(palette.border),
		title: styleFromRgb(palette.title),
		segments: resolveBuiltInSegmentStyles(theme),
	};
}

export function resolveGlanceRenderStyles(theme: GlanceThemePair, context: GlanceRenderStyleContext = {}): ResolvedGlanceStyles {
	if (context.styles) return context.styles;
	const ambientTone = context.ambientTone ?? context.getAmbientTone?.() ?? "unknown";
	return resolveBuiltInGlanceStyles(selectGlanceTheme(theme, ambientTone));
}
