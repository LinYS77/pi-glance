import { strict as assert } from "node:assert";
import { defaultConfig, normalizeConfig } from "../config.js";
import { GLANCE_THEME_IDS } from "../themes.js";

for (const theme of GLANCE_THEME_IDS) {
	assert.equal(normalizeConfig({ theme }).theme, theme, `${theme} should normalize as a valid theme`);
}

assert.equal(normalizeConfig({ theme: "catppuccin-macchiato" }).theme, defaultConfig().theme, "unknown theme should fall back to default theme");
assert.equal(normalizeConfig({ theme: null }).theme, defaultConfig().theme, "non-string theme should fall back to default theme");

console.log("✓ config normalization checks passed");
