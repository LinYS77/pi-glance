import { PALETTES, fg } from "./palette.js";
import { themeLabel, type GlanceThemeName } from "./themes.js";
import type { Rgb, SegmentId } from "./types.js";

export type TextStyler = (text: string) => string;

export interface ResolvedGlanceSegmentStyles {
	readonly fg: TextStyler;
}

export interface ResolvedGlanceStyles {
	readonly source: "glance";
	readonly themeId: GlanceThemeName;
	readonly label: string;
	readonly cacheKey: `glance:${GlanceThemeName}`;
	readonly text: TextStyler;
	readonly dim: TextStyler;
	readonly warn: TextStyler;
	readonly error: TextStyler;
	readonly separator: TextStyler;
	readonly border: TextStyler;
	readonly title: TextStyler;
	readonly segments: Record<SegmentId, ResolvedGlanceSegmentStyles>;
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
		source: "glance",
		themeId: theme,
		label: themeLabel(theme),
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
