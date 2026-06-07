import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { GLANCE_THEMES } from "../themes.js";

const readme = await readFile("README.md", "utf8");

assert.ok(!readme.includes("pi-glance v0.3.1 targets"), "README compatibility copy should not hard-code stale v0.3.1 wording");
assert.ok(readme.includes("current pi-glance releases target"), "README compatibility copy should refer to current pi-glance releases");
assert.ok(readme.includes("pin `pi-glance@0.3.0`"), "README compatibility copy should preserve the legacy pin guidance");
assert.ok(readme.includes("Icons default to `plain`"), "README should state that icons default to plain");
assert.ok(readme.includes("`nerd` icons are opt-in"), "README should state that nerd icons are opt-in");
assert.ok(readme.includes("/glance` → **General** → `Icons`"), "README should point users to /glance General Icons");
assert.ok(readme.includes("Nerd icons need a Nerd Font or Symbols Nerd Font fallback"), "README should explain Nerd Font fallback requirement");
assert.ok(readme.includes("If icons look like boxes, choose `plain`"), "README should explain the plain fallback when icons render as boxes");
assert.ok(readme.includes("does not auto-detect, install, or bundle terminal fonts"), "README should avoid implying font detection/install/bundling");

assert.equal(GLANCE_THEMES.length, 22, "README theme copy should describe the curated 22-theme collection");
assert.ok(readme.includes("22 built-in palettes"), "README should describe the curated 22-theme count");
assert.ok(readme.includes("press Enter, preview palettes in the browser"), "README should describe the theme browser flow");
assert.ok(
	readme.includes("Built-ins: Light, Dark, Catppuccin Latte/Mocha/Frappé/Macchiato, Nord, Tokyo Night, Gruvbox Light/Dark, Solarized Light/Dark, Rosé Pine/Dawn, One Light/Dark, Kanagawa Wave/Lotus, Everforest Light/Dark, and High Contrast Light/Dark."),
	"README should keep the curated built-in theme expression",
);

console.log("✓ README copy checks passed");
