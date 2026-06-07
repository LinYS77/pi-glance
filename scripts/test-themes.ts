import { strict as assert } from "node:assert";
import { PALETTES } from "../palette.js";
import { GLANCE_THEMES, GLANCE_THEME_IDS, isGlanceThemeName, themeLabel } from "../themes.js";
import type { GlancePalette, Rgb, SegmentId } from "../types.js";

const EXPECTED_THEMES = [
	{ id: "light", label: "Light" },
	{ id: "dark", label: "Dark" },
	{ id: "catppuccin-latte", label: "Catppuccin Latte" },
	{ id: "catppuccin-mocha", label: "Catppuccin Mocha" },
	{ id: "nord", label: "Nord" },
	{ id: "tokyo-night", label: "Tokyo Night" },
	{ id: "gruvbox-dark", label: "Gruvbox Dark" },
	{ id: "solarized-dark", label: "Solarized Dark" },
	{ id: "rose-pine", label: "Rosé Pine" },
	{ id: "one-dark", label: "One Dark" },
	{ id: "one-light", label: "One Light" },
	{ id: "solarized-light", label: "Solarized Light" },
	{ id: "gruvbox-light", label: "Gruvbox Light" },
	{ id: "rose-pine-dawn", label: "Rosé Pine Dawn" },
	{ id: "catppuccin-frappe", label: "Catppuccin Frappé" },
	{ id: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
	{ id: "kanagawa-wave", label: "Kanagawa Wave" },
	{ id: "kanagawa-lotus", label: "Kanagawa Lotus" },
	{ id: "everforest-dark", label: "Everforest Dark" },
	{ id: "everforest-light", label: "Everforest Light" },
	{ id: "high-contrast-dark", label: "High Contrast Dark" },
	{ id: "high-contrast-light", label: "High Contrast Light" },
] as const;

const SEGMENT_IDS = ["git", "model", "context", "tokens", "cost", "throughput"] as const satisfies readonly SegmentId[];

assert.equal(GLANCE_THEMES.length, 22, "theme metadata should keep the curated 22-theme collection");
assert.deepEqual(
	GLANCE_THEMES.map(({ id, label }) => ({ id, label })),
	EXPECTED_THEMES,
	"theme metadata should keep the curated friendly theme order and labels",
);
assert.deepEqual(GLANCE_THEME_IDS, EXPECTED_THEMES.map((theme) => theme.id), "theme id helper should preserve GLANCE_THEMES order");

const themeIds = GLANCE_THEMES.map((theme) => theme.id);
const themeLabels = GLANCE_THEMES.map((theme) => theme.label);
assert.equal(new Set(themeIds).size, themeIds.length, "theme ids should be unique");
assert.equal(new Set(themeLabels).size, themeLabels.length, "theme labels should be unique");

for (const { id, label, group, tone, tags, description } of GLANCE_THEMES) {
	assert.ok(label.trim(), `${id} should have a non-empty user-facing label`);
	assert.ok(group.trim(), `${id} should have a non-empty metadata group`);
	assert.ok(tone === "light" || tone === "dark", `${id} should declare a stable light/dark tone`);
	assert.ok(tags.length > 0, `${id} should have at least one metadata tag`);
	assert.equal(new Set(tags).size, tags.length, `${id} metadata tags should be unique`);
	for (const tag of tags) {
		assert.equal(tag, tag.trim(), `${id} metadata tag should be trimmed`);
		assert.match(tag, /^[a-z0-9-]+$/, `${id} metadata tag should be lowercase kebab text`);
	}
	assert.ok(description.trim(), `${id} should have a non-empty metadata description`);
	assert.ok(PALETTES[id], `${id} palette should exist`);
	assert.equal(themeLabel(id), label, `${id} label should come from shared metadata`);
	assert.equal(isGlanceThemeName(id), true, `${id} should validate as a theme name`);
}

const paletteThemeIds = Object.keys(PALETTES).sort();
assert.deepEqual(paletteThemeIds, [...GLANCE_THEME_IDS].sort(), "palette keys should match shared theme ids");
assert.equal(isGlanceThemeName("catppuccin-macchiato"), true, "curated Catppuccin Macchiato theme should validate");
assert.equal(isGlanceThemeName("high-contrast-light"), true, "new counterpart High Contrast Light theme should validate");
assert.equal(isGlanceThemeName("one-light"), true, "new counterpart One Light theme should validate");
assert.equal(isGlanceThemeName("kanagawa-lotus"), true, "new counterpart Kanagawa Lotus theme should validate");
assert.equal(isGlanceThemeName("everforest-light"), true, "new counterpart Everforest Light theme should validate");
assert.equal(isGlanceThemeName("dracula"), false, "unknown theme should not validate");

function assertRgb(themeId: string, path: string, color: Rgb): void {
	for (const channel of ["r", "g", "b"] as const) {
		const value = color[channel];
		assert.ok(Number.isFinite(value), `${themeId}.${path}.${channel} should be finite`);
		assert.ok(Number.isInteger(value), `${themeId}.${path}.${channel} should be an integer`);
		assert.ok(value >= 0 && value <= 255, `${themeId}.${path}.${channel} should be in [0,255]`);
	}
}

function assertPalette(themeId: (typeof GLANCE_THEME_IDS)[number], theme: GlancePalette): void {
	for (const key of ["text", "dim", "warn", "error", "separator", "border", "title"] as const) {
		assertRgb(themeId, key, theme[key]);
	}

	assert.deepEqual(Object.keys(theme.segments).sort(), [...SEGMENT_IDS].sort(), `${themeId} should define exactly the known segment color keys`);
	for (const segment of SEGMENT_IDS) {
		assert.ok(theme.segments[segment], `${themeId} should define ${segment} segment color`);
		assertRgb(themeId, `segments.${segment}.fg`, theme.segments[segment].fg);
	}
}

for (const themeId of GLANCE_THEME_IDS) {
	assertPalette(themeId, PALETTES[themeId]);
}

console.log("✓ theme config checks passed");
