import { strict as assert } from "node:assert";
import { PALETTES } from "../palette.js";
import { GLANCE_THEMES, GLANCE_THEME_IDS, isGlanceThemeName, themeLabel } from "../themes.js";
import type { GlancePalette } from "../types.js";

assert.deepEqual(
	GLANCE_THEMES.map((theme) => theme.label),
	[
		"Light",
		"Dark",
		"Catppuccin Latte",
		"Catppuccin Mocha",
		"Nord",
		"Tokyo Night",
		"Gruvbox Dark",
		"Solarized Dark",
		"Rosé Pine",
		"One Dark",
	],
	"theme metadata should keep the friendly theme order",
);

const allThemes = Object.keys(PALETTES).sort();
assert.deepEqual(allThemes, [...GLANCE_THEME_IDS].sort(), "palette keys should match shared theme ids");

for (const { id, label } of GLANCE_THEMES) {
	assert.ok(PALETTES[id], `${id} palette should exist`);
	assert.ok(label.trim(), `${id} should have a user-facing label`);
	assert.equal(themeLabel(id), label, `${id} label should come from shared metadata`);
	assert.equal(isGlanceThemeName(id), true, `${id} should validate as a theme name`);
}

assert.equal(isGlanceThemeName("catppuccin-macchiato"), false, "unknown theme should not validate");

function assertSegmentPalette(themeId: (typeof GLANCE_THEME_IDS)[number], theme: GlancePalette): void {
	for (const segment of ["git", "model", "context", "tokens", "cost"] as const) {
		assert.ok(theme.segments[segment], `${themeId} should define ${segment} segment color`);
	}
}

for (const themeId of GLANCE_THEME_IDS) {
	assertSegmentPalette(themeId, PALETTES[themeId]);
}

console.log("✓ theme config checks passed");
