import { strict as assert } from "node:assert";
import { PALETTES } from "../palette.js";
import type { GlancePalette, GlanceThemeName } from "../types.js";

const expectedThemes: GlanceThemeName[] = ["light", "dark", "catppuccin-latte", "catppuccin-mocha"];

for (const theme of expectedThemes) {
	assert.ok(PALETTES[theme], `${theme} palette should exist`);
	assert.equal(PALETTES[theme].name, theme, `${theme} palette name should match`);
}

const allThemes = Object.keys(PALETTES).sort();
assert.deepEqual(allThemes, [...expectedThemes].sort(), "palette keys should match known themes");

function assertSegmentPalette(theme: GlancePalette): void {
	for (const segment of ["git", "model", "context", "tokens", "cost"] as const) {
		assert.ok(theme.segments[segment], `${theme.name} should define ${segment} segment color`);
	}
}

assertSegmentPalette(PALETTES["catppuccin-latte"]);
assertSegmentPalette(PALETTES["catppuccin-mocha"]);

console.log("✓ theme config checks passed");
