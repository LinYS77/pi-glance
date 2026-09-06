import { PALETTES, fg, fg256 } from "./palette.js";
import { selectGlanceTheme, type GlanceAmbientTone } from "./selection.js";
import { WORKING_ACCENTS } from "./working-colors.js";
import type { GlanceThemeName, GlanceThemePair, Rgb, SegmentId } from "../types.js";

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
	/** Normalized beam intensity for the title and border; other styles stay untouched. */
	readonly highlight?: (style: TextStyler, amount: number) => TextStyler;
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

const builtInStyles = new Map<string, ResolvedGlanceStyles>();

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
	const cacheKey = `glance:${theme}:${colorMode}`;
	const cached = builtInStyles.get(cacheKey);
	if (cached) return cached;
	const palette = PALETTES[theme];
	const styles: ResolvedGlanceStyles = {
		cacheKey,
		text: styleFromRgb(palette.text, colorMode),
		dim: styleFromRgb(palette.dim, colorMode),
		warn: styleFromRgb(palette.warn, colorMode),
		error: styleFromRgb(palette.error, colorMode),
		separator: styleFromRgb(palette.separator, colorMode),
		border: styleFromRgb(palette.border, colorMode),
		title: styleFromRgb(palette.title, colorMode),
		segments: resolveBuiltInSegmentStyles(theme, colorMode),
	};
	const peak = WORKING_ACCENTS[theme];
	const colors = new Map<TextStyler, Rgb>([[styles.border, palette.border], [styles.title, palette.title]]);
	const shades = new Map<TextStyler, Map<number, TextStyler>>();
	const resolved: ResolvedGlanceStyles = {
		...styles,
		highlight: (style, amount) => {
			const color = colors.get(style);
			if (!color || !Number.isFinite(amount) || amount <= 0) return style;
			const level = Math.round(Math.min(1, amount) * 32);
			if (level === 0) return style;
			let cache = shades.get(style);
			if (!cache) shades.set(style, cache = new Map());
			let shade = cache.get(level);
			if (!shade) {
				const mix = (from: number, to: number) => Math.round(from + (to - from) * level / 32);
				const colorStyle = styleFromRgb({ r: mix(color.r, peak.r), g: mix(color.g, peak.g), b: mix(color.b, peak.b) }, colorMode);
				shade = level >= 24 ? (text) => `\x1b[1m${colorStyle(text)}\x1b[22m` : colorStyle;
				cache.set(level, shade);
			}
			return shade;
		},
	};
	// The built-in catalog bounds this cache to 22 palettes × 2 color modes.
	builtInStyles.set(cacheKey, resolved);
	return resolved;
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
