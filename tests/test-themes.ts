import { strict as assert } from "node:assert";
import { PALETTES, fg, fg256, rgbToAnsi256 } from "../src/theme/palette.js";
import { resolveBuiltInGlanceStyles, resolveGlanceRenderStyles, type GlanceColorMode } from "../src/theme/adapter.js";
import { selectGlanceTheme } from "../src/theme/selection.js";
import { readPiAmbientTone } from "../src/theme/tone.js";
import { GLANCE_THEME_CATALOG } from "../src/theme/catalog.js";
import { GLANCE_THEMES, GLANCE_THEME_IDS, isGlanceThemeName, themeLabel } from "../src/theme/themes.js";
import type { GlancePalette, Rgb, SegmentId } from "../src/types.js";

import { EXPECTED_THEMES, EXPECTED_THEME_IDS, EXPECTED_PALETTES } from "./fixtures/themes.js";

const PALETTE_KEYS = ["text", "dim", "warn", "error", "separator", "border", "title", "segments"] as const;
const STYLE_ROLE_KEYS = ["text", "dim", "warn", "error", "separator", "border", "title"] as const;
const SEGMENT_IDS = ["git", "model", "context", "tokens", "cost", "throughput"] as const satisfies readonly SegmentId[];
const EXPECTED_THEME_GROUP_LABELS: Record<string, string> = {
	core: "Core",
	catppuccin: "Catppuccin",
	classic: "Classics",
	editor: "Editor",
	kanagawa: "Japanese",
	everforest: "Forest",
	accessibility: "Accessible",
};
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesRawThemeId(text: string, themeId: string): boolean {
	return new RegExp(`\\b${escapeRegExp(themeId)}\\b`).test(text);
}

const catalogMetadata = GLANCE_THEME_CATALOG.map(({ palette, ...metadata }) => metadata);
const catalogPalettes = Object.fromEntries(GLANCE_THEME_CATALOG.map((entry) => [entry.id, entry.palette]));

assert.equal(GLANCE_THEMES.length, 22, "theme metadata should keep the curated 22-theme collection");
assert.deepEqual(GLANCE_THEMES, EXPECTED_THEMES, "theme metadata should preserve exact current id/label/group/tone/tags/detail display snapshot");
assert.deepEqual(GLANCE_THEME_IDS, EXPECTED_THEME_IDS, "theme id helper should preserve exact GLANCE_THEMES order");
assert.deepEqual(Object.keys(PALETTES), EXPECTED_THEME_IDS, "palette object key order should exactly match GLANCE_THEME_IDS");
assert.deepEqual(PALETTES, EXPECTED_PALETTES, "palette RGB snapshot should preserve exact current theme colors");
assert.deepEqual(GLANCE_THEME_CATALOG.map((entry) => entry.id), GLANCE_THEME_IDS, "unified theme catalog should preserve exact GLANCE_THEME_IDS order");
assert.deepEqual(catalogMetadata, GLANCE_THEMES, "unified theme catalog metadata projection should match active GLANCE_THEMES export");
assert.deepEqual(catalogPalettes, PALETTES, "unified theme catalog palette projection should match active PALETTES export");

const themeIds = GLANCE_THEMES.map((theme) => theme.id);
const themeLabels = GLANCE_THEMES.map((theme) => theme.label);
assert.equal(new Set(themeIds).size, themeIds.length, "theme ids should be unique");
assert.equal(new Set(themeLabels).size, themeLabels.length, "theme labels should be unique");

for (const { id, label, group, groupLabel, tone, tags, detailTags, description, detailDescription } of GLANCE_THEMES) {
	assert.ok(label.trim(), `${id} should have a non-empty user-facing label`);
	assert.ok(group.trim(), `${id} should have a non-empty metadata group`);
	assert.equal(groupLabel, EXPECTED_THEME_GROUP_LABELS[group], `${id} browser group label should come from catalog display copy`);
	assert.ok(tone === "light" || tone === "dark", `${id} should declare a stable light/dark tone`);
	assert.ok(tags.length > 0, `${id} should have at least one metadata tag`);
	assert.equal(new Set(tags).size, tags.length, `${id} metadata tags should be unique`);
	for (const tag of tags) {
		assert.equal(tag, tag.trim(), `${id} metadata tag should be trimmed`);
		assert.match(tag, /^[a-z0-9-]+$/, `${id} metadata tag should be lowercase kebab text`);
	}
	assert.ok(detailTags.length > 0, `${id} should have browser detail tags`);
	assert.equal(new Set(detailTags).size, detailTags.length, `${id} browser detail tags should be unique`);
	for (const tag of detailTags) {
		assert.equal(tag, tag.trim(), `${id} browser detail tag should be trimmed`);
		assert.equal(themeIds.includes(tag as never), false, `${id} browser detail tag should not expose raw theme id ${tag}`);
	}
	assert.ok(description.trim(), `${id} should have a non-empty metadata description`);
	assert.ok(detailDescription.trim(), `${id} should have a non-empty browser detail description`);
	for (const themeId of themeIds) {
		assert.equal(includesRawThemeId(detailDescription, themeId), false, `${id} browser detail description should not expose raw theme id ${themeId}`);
	}
	assert.ok(PALETTES[id], `${id} palette should exist`);
	assert.equal(themeLabel(id), label, `${id} label should come from shared metadata`);
	assert.equal(isGlanceThemeName(id), true, `${id} should validate as a theme name`);
}

const themesById = new Map(GLANCE_THEMES.map((theme) => [theme.id, theme]));
assert.deepEqual(themesById.get("dark")?.detailTags, ["default", "neutral"], "dark browser detail tags should keep raw id suppression");
assert.equal(themesById.get("dark")?.detailDescription, "Neutral dim palette for dim terminals.", "dark browser detail should keep low-light/friendly text behavior");
assert.equal(themesById.get("catppuccin-latte")?.detailDescription, "Soft Catppuccin palette with warm bright tones.", "light raw id should be friendly in browser detail copy");
assert.equal(themesById.get("kanagawa-wave")?.groupLabel, "Japanese", "kanagawa browser group label should stay friendly");
assert.equal(themesById.get("everforest-dark")?.groupLabel, "Forest", "everforest browser group label should stay friendly");
assert.equal(themesById.get("high-contrast-dark")?.groupLabel, "Accessible", "accessibility browser group label should stay friendly");

assert.equal(themeLabel("dracula" as never), "dracula", "unknown theme label should fall back to the provided id");
assert.equal(isGlanceThemeName("catppuccin-macchiato"), true, "curated Catppuccin Macchiato theme should validate");
assert.equal(isGlanceThemeName("high-contrast-light"), true, "new counterpart High Contrast Light theme should validate");
assert.equal(isGlanceThemeName("one-light"), true, "new counterpart One Light theme should validate");
assert.equal(isGlanceThemeName("kanagawa-lotus"), true, "new counterpart Kanagawa Lotus theme should validate");
assert.equal(isGlanceThemeName("everforest-light"), true, "new counterpart Everforest Light theme should validate");
assert.equal(isGlanceThemeName("dracula"), false, "unknown theme should not validate");

const selectedThemePair = { light: "one-light", dark: "tokyo-night" } as const;
assert.equal(selectGlanceTheme(selectedThemePair, "light"), "one-light", "theme selection should return the light slot for light ambient tone");
assert.equal(selectGlanceTheme(selectedThemePair, "dark"), "tokyo-night", "theme selection should return the dark slot for dark ambient tone");
assert.equal(selectGlanceTheme(selectedThemePair, "unknown"), "one-light", "theme selection should fall back to the light slot for unknown ambient tone");
assert.equal(resolveGlanceRenderStyles(selectedThemePair, { ambientTone: "light" }).cacheKey, "glance:one-light:truecolor", "render style resolver should use the light slot for ambient light");
assert.equal(resolveGlanceRenderStyles(selectedThemePair, { ambientTone: "dark" }).cacheKey, "glance:tokyo-night:truecolor", "render style resolver should use the dark slot for ambient dark");
assert.equal(resolveGlanceRenderStyles(selectedThemePair, { ambientTone: "unknown" }).cacheKey, "glance:one-light:truecolor", "render style resolver should use the light slot for ambient unknown");
assert.equal(resolveGlanceRenderStyles(selectedThemePair).cacheKey, "glance:one-light:truecolor", "render style resolver should default missing ambient tone to the light slot");
assert.equal(resolveGlanceRenderStyles(selectedThemePair, { getAmbientTone: () => "dark" }).cacheKey, "glance:tokyo-night:truecolor", "render style resolver should use lazy getAmbientTone when no static tone is provided");
assert.equal(
	resolveGlanceRenderStyles(selectedThemePair, { ambientTone: "light", getAmbientTone: () => "dark" }).cacheKey,
	"glance:one-light:truecolor",
	"render style resolver should prefer static ambientTone over getAmbientTone",
);
const explicitStyleOverride = resolveBuiltInGlanceStyles("dark");
assert.equal(
	resolveGlanceRenderStyles(selectedThemePair, { styles: explicitStyleOverride, ambientTone: "light", getAmbientTone: () => "dark" }),
	explicitStyleOverride,
	"render style resolver should return an explicit styles override without applying ambient tone selection",
);

assert.equal(readPiAmbientTone({ theme: { name: "light" } }), "light", "ambient tone reader should map exact public Pi theme name light to light tone");
assert.equal(readPiAmbientTone({ theme: { name: "dark" } }), "dark", "ambient tone reader should map exact public Pi theme name dark to dark tone");
for (const host of [undefined, {}, { theme: undefined }, { theme: {} }, { theme: { name: undefined } }] as const) {
	assert.equal(readPiAmbientTone(host), "unknown", "ambient tone reader should return unknown for missing host/theme/name");
}
for (const name of ["my-dark-theme", "dark-plus", "catppuccin-latte", "high-contrast-light", "Light", "DARK", " dark "] as const) {
	assert.equal(readPiAmbientTone({ theme: { name } }), "unknown", `${name} should not be classified by substring/case/trim heuristics`);
}
const colorModeOnlyHost = { theme: { name: "catppuccin-latte", getColorMode: () => "dark" } };
assert.equal(readPiAmbientTone(colorModeOnlyHost), "unknown", "ambient tone reader should ignore getColorMode because it is color depth, not tone");
assert.equal(selectGlanceTheme(selectedThemePair, readPiAmbientTone(colorModeOnlyHost)), "one-light", "unknown ambient tone from reader should select the light slot");
assert.equal(selectGlanceTheme(selectedThemePair, readPiAmbientTone({ theme: { name: "dark" } })), "tokyo-night", "dark ambient tone from reader should select the dark slot");

function assertRgb(themeId: string, path: string, color: Rgb): void {
	for (const channel of ["r", "g", "b"] as const) {
		const value = color[channel];
		assert.ok(Number.isFinite(value), `${themeId}.${path}.${channel} should be finite`);
		assert.ok(Number.isInteger(value), `${themeId}.${path}.${channel} should be an integer`);
		assert.ok(value >= 0 && value <= 255, `${themeId}.${path}.${channel} should be in [0,255]`);
	}
}

function assertPalette(themeId: (typeof GLANCE_THEME_IDS)[number], theme: GlancePalette): void {
	assert.deepEqual(Object.keys(theme), PALETTE_KEYS, `${themeId} should preserve exact top-level palette key order`);
	assert.deepEqual(Object.keys(theme.segments), SEGMENT_IDS, `${themeId} should preserve exact segment color key order`);

	for (const key of ["text", "dim", "warn", "error", "separator", "border", "title"] as const) {
		assertRgb(themeId, key, theme[key]);
	}

	for (const segment of SEGMENT_IDS) {
		assert.ok(theme.segments[segment], `${themeId} should define ${segment} segment color`);
		assertRgb(themeId, `segments.${segment}.fg`, theme.segments[segment].fg);
	}
}

const colorModes = ["truecolor", "ansi256"] as const satisfies readonly GlanceColorMode[];
const styleCacheKeys = new Set<string>();
for (const themeId of GLANCE_THEME_IDS) {
	const palette: GlancePalette = PALETTES[themeId];
	assertPalette(themeId, palette);

	for (const colorMode of colorModes) {
		const styles = resolveBuiltInGlanceStyles(themeId, colorMode);
		const secondStyles = resolveBuiltInGlanceStyles(themeId, colorMode);
		assert.equal(styles.cacheKey, `glance:${themeId}:${colorMode}`, `${themeId} ${colorMode} resolved style cacheKey should be stable and capability-specific`);
		assert.equal(secondStyles.cacheKey, styles.cacheKey, `${themeId} ${colorMode} resolved style cacheKey should be stable across calls`);
		styleCacheKeys.add(styles.cacheKey);

		for (const role of STYLE_ROLE_KEYS) {
			const text = `${themeId}:${role}:sample`;
			const expected = colorMode === "truecolor" ? fg(palette[role], text) : fg256(palette[role], text);
			assert.equal(styles[role](text), expected, `${themeId}.${role} style should use ${colorMode} palette output`);
		}
		for (const segment of SEGMENT_IDS) {
			const text = `${themeId}:${segment}:segment`;
			const expected = colorMode === "truecolor" ? fg(palette.segments[segment].fg, text) : fg256(palette.segments[segment].fg, text);
			assert.equal(styles.segments[segment].fg(text), expected, `${themeId}.segments.${segment}.fg should use ${colorMode} palette output`);
		}
	}
}
assert.equal(styleCacheKeys.size, GLANCE_THEME_IDS.length * colorModes.length, "resolved style cache keys should be unique across themes and color modes");

assert.equal(rgbToAnsi256(PALETTES.light.text), 16, "light neutral text should map to the nearest xterm cube color");
assert.equal(rgbToAnsi256(PALETTES.dark.text), 254, "near-neutral dark-theme text should map to the nearest xterm grayscale color");
assert.equal(rgbToAnsi256(PALETTES.light.segments.context.fg), 29, "saturated context color should preserve its tint in the xterm cube");

assert.equal(
	resolveGlanceRenderStyles(selectedThemePair, { ambientTone: "light", trueColor: false }).cacheKey,
	"glance:one-light:ansi256",
	"a static false trueColor capability should select ANSI 256-color styles",
);
assert.equal(
	resolveGlanceRenderStyles(selectedThemePair, { ambientTone: "dark", getTrueColor: () => false }).cacheKey,
	"glance:tokyo-night:ansi256",
	"a lazy false trueColor capability should select ANSI 256-color styles",
);
assert.equal(
	resolveGlanceRenderStyles(selectedThemePair, { ambientTone: "dark", trueColor: true, getTrueColor: () => false }).cacheKey,
	"glance:tokyo-night:truecolor",
	"static trueColor should take precedence over the lazy capability provider",
);

console.log("✓ theme config checks passed");
