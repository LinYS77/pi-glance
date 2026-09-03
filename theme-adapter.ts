import { PALETTES, fg, fg256 } from "./palette.js";
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

export type GlanceColorMode = "truecolor" | "ansi256";

export interface GlanceRenderStyleContext {
	readonly styles?: ResolvedGlanceStyles;
	readonly ambientTone?: GlanceAmbientTone;
	readonly getAmbientTone?: () => GlanceAmbientTone;
	readonly trueColor?: boolean;
	readonly getTrueColor?: () => boolean;
}

const STYLE_SEGMENT_IDS = ["git", "model", "context", "tokens", "cost", "throughput"] as const satisfies readonly SegmentId[];

function styleFromRgb(color: Rgb, colorMode: GlanceColorMode): TextStyler {
	return colorMode === "truecolor" ? (text) => fg(color, text) : (text) => fg256(color, text);
}

function resolveBuiltInSegmentStyles(theme: GlanceThemeName, colorMode: GlanceColorMode): Record<SegmentId, ResolvedGlanceSegmentStyles> {
	const palette = PALETTES[theme];
	return Object.fromEntries(
		STYLE_SEGMENT_IDS.map((segment) => [segment, { fg: styleFromRgb(palette.segments[segment].fg, colorMode) }]),
	) as Record<SegmentId, ResolvedGlanceSegmentStyles>;
}

export function resolveBuiltInGlanceStyles(theme: GlanceThemeName, colorMode: GlanceColorMode = "truecolor"): ResolvedGlanceStyles {
	const palette = PALETTES[theme];
	return {
		cacheKey: `glance:${theme}:${colorMode}`,
		text: styleFromRgb(palette.text, colorMode),
		dim: styleFromRgb(palette.dim, colorMode),
		warn: styleFromRgb(palette.warn, colorMode),
		error: styleFromRgb(palette.error, colorMode),
		separator: styleFromRgb(palette.separator, colorMode),
		border: styleFromRgb(palette.border, colorMode),
		title: styleFromRgb(palette.title, colorMode),
		segments: resolveBuiltInSegmentStyles(theme, colorMode),
	};
}

function resolveColorMode(context: GlanceRenderStyleContext): GlanceColorMode {
	const trueColor = context.trueColor ?? context.getTrueColor?.() ?? true;
	return trueColor ? "truecolor" : "ansi256";
}

export function resolveGlanceRenderStyles(theme: GlanceThemePair, context: GlanceRenderStyleContext = {}): ResolvedGlanceStyles {
	if (context.styles) return context.styles;
	const ambientTone = context.ambientTone ?? context.getAmbientTone?.() ?? "unknown";
	return resolveBuiltInGlanceStyles(selectGlanceTheme(theme, ambientTone), resolveColorMode(context));
}
