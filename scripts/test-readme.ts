import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { defaultConfig, normalizeConfig } from "../config.js";
import { GLANCE_THEMES } from "../themes.js";

const readme = await readFile("README.md", "utf8");

function assertReadmeIncludes(fragment: string, message: string): void {
	assert.ok(readme.includes(fragment), message);
}

assert.ok(!readme.includes("pi-glance v0.3.1 targets"), "README compatibility copy should not hard-code stale v0.3.1 wording");
assertReadmeIncludes("development and CI baseline is Pi 0.84.2", "README should document the Pi 0.84.2 compatibility baseline");
assertReadmeIncludes("Node 22.19.0 or newer", "README should document the current Pi Node runtime floor");
assertReadmeIncludes("Pi core packages remain peer dependencies supplied by Pi", "README should explain how Pi packages are provided at runtime");
assertReadmeIncludes("pin `pi-glance@0.3.0`", "README compatibility copy should preserve the legacy pin guidance");
assert.ok(!readme.includes("github.com/badlogic/pi-mono"), "README should not link to the retired pi-mono repository");
assertReadmeIncludes("github.com/earendil-works/pi", "README should link to the current Pi repository");
assertReadmeIncludes("Icons default to `plain`", "README should state that icons default to plain");
assertReadmeIncludes("`nerd` icons are opt-in", "README should state that nerd icons are opt-in");
assertReadmeIncludes("/glance` → **General** → `Icons`", "README should point users to /glance General Icons");
assertReadmeIncludes("Nerd icons need a Nerd Font or Symbols Nerd Font fallback", "README should explain Nerd Font fallback requirement");
assertReadmeIncludes("If icons look like boxes, choose `plain`", "README should explain the plain fallback when icons render as boxes");
assertReadmeIncludes("does not auto-detect, install, or bundle terminal fonts", "README should avoid implying font detection/install/bundling");
assertReadmeIncludes("supports Pi 0.84's regular and fullscreen TUI modes", "README should document the fullscreen dogfood compatibility result");
assertReadmeIncludes("reserves one footer dock row", "README should disclose Pi's current fullscreen empty-footer dock behavior");
assertReadmeIncludes("Pi exposes a single custom-editor slot", "README should disclose the public custom-editor composition boundary");
assertReadmeIncludes("the last one loaded wins", "README should explain custom-editor load-order behavior");
assertReadmeIncludes("does not patch or wrap arbitrary third-party editors", "README should preserve the public-seam-only custom-editor boundary");

assert.equal(GLANCE_THEMES.length, 22, "README theme copy should describe the curated 22-theme collection");
assertReadmeIncludes("22 built-in palettes", "README should describe the curated 22-theme count");
assertReadmeIncludes("/glance` → **General** → `Light theme` or `Dark theme`", "README should document the split /glance theme rows");
assertReadmeIncludes("press Enter, preview palettes in the browser", "README should describe the theme browser flow");
assertReadmeIncludes("Both rows can choose from all 22 built-in Glance palettes", "README should state both theme slots can choose all built-in palettes");
assertReadmeIncludes("Light theme browser lists light-toned palettes first", "README should document light-slot preferred ordering");
assertReadmeIncludes("Dark theme browser lists dark-toned palettes first", "README should document dark-slot preferred ordering");
assertReadmeIncludes("neither browser filters the catalog", "README should state slot ordering is not filtering");
assertReadmeIncludes(
	"Built-ins: Light, Dark, Catppuccin Latte/Mocha/Frappé/Macchiato, Nord, Tokyo Night, Gruvbox Light/Dark, Solarized Light/Dark, Rosé Pine/Dawn, One Light/Dark, Kanagawa Wave/Lotus, Everforest Light/Dark, and High Contrast Light/Dark.",
	"README should keep the curated built-in theme expression",
);
assertReadmeIncludes("pi-glance uses its own curated 22 built-in Glance palettes", "README should clarify themes are pi-glance-owned palettes");
assertReadmeIncludes("It is not a Pi theme manager", "README should avoid implying Pi theme management");
assertReadmeIncludes("does not enumerate, switch, or install Pi UI themes", "README should explicitly rule out Pi theme enumeration/switching");
assertReadmeIncludes("does not render with Pi theme token colors", "README should explicitly rule out Pi token color rendering");
assertReadmeIncludes("no dormant Pi token-style adapter or activation flag", "README should document deletion of the speculative Pi style seam");
assertReadmeIncludes("theme: { light: GlanceThemeName, dark: GlanceThemeName }", "README should document the supported theme pair config model");
assertReadmeIncludes('"theme": {\n    "light": "light",\n    "dark": "dark"\n  }', "README should document the new-install theme pair default");
assert.deepEqual(defaultConfig().theme, { light: "light", dark: "dark" }, "README default theme copy should stay aligned with defaultConfig");
assertReadmeIncludes('{ "theme": "x" }', "README should document old string theme migration input");
assertReadmeIncludes('{ "theme": { "light": "x", "dark": "x" } }', "README should document conservative old string theme migration output");
assert.deepEqual(normalizeConfig({ theme: "tokyo-night" }).theme, { light: "tokyo-night", dark: "tokyo-night" }, "README migration copy should stay aligned with config normalization");
assertReadmeIncludes("exact `light` selects `theme.light`", "README should document exact light ambient tone slot selection");
assertReadmeIncludes("exact `dark` selects `theme.dark`", "README should document exact dark ambient tone slot selection");
assertReadmeIncludes("unknown or custom Pi theme names fall back to `theme.light`", "README should document unknown/custom ambient tone fallback");
assertReadmeIncludes("three Cache modes: `rate` (default), `read/write`, and `hide`", "README should document the simplified Tokens cache modes and default");
assertReadmeIncludes("full Nerd-icon mode it appears as `󰃨42%`", "README should document the full-width cache-rate glyph");
assertReadmeIncludes("a known rate becomes the sole Tokens value (`󰄨 42%`)", "README should document compact/minimal rate priority");
assertReadmeIncludes("unknown rate falls back to token amounts", "README should document the folded unknown-rate fallback");
assertReadmeIncludes("actual aggregate cache token amounts such as `R563M W12M`", "README should explain the read/write cache amount mode");
assertReadmeIncludes("Legacy `auto` configs migrate to `rate`", "README should document the legacy auto migration");
assertReadmeIncludes("legacy `show` configs migrate to the canonical `read-write` value", "README should document the legacy show migration");
assert.ok(!readme.includes("Cache to `auto`, `show`, `hide`, or `rate`"), "README should not advertise the removed width-dependent auto mode");
assertReadmeIncludes("rounded session aggregate cache hit percentage", "README should define cache-rate aggregation semantics");
assertReadmeIncludes("cacheRead / (input + cacheRead + cacheWrite)", "README should document the cache-rate denominator");
assertReadmeIncludes("billed assistant responses, usage-bearing tool results, compactions, and branch summaries", "README should document complete Pi 0.84 session usage sources");
assertReadmeIncludes("Pi's public `ctx.getContextUsage()` result", "README should name the public context truth boundary");
assertReadmeIncludes("Tokens and Cost use Pi's billed-session semantics", "README should align Tokens and Cost copy with complete session totals");
assertReadmeIncludes("A known cache miss appears as `0%`", "README should distinguish a zero-percent hit rate from unknown usage");
assertReadmeIncludes("No cache rate is shown until prompt-token usage exists", "README should document the cache-rate unknown boundary");
assert.ok(!readme.includes("CH%") && !/CH\d+%/.test(readme), "README should not use the removed CH abbreviation for cache rate");

assertReadmeIncludes("Global config at `~/.pi/agent/pi-glance/config.json`; saves use an atomic temporary-file rename", "README should document atomic config persistence");
assertReadmeIncludes("Invalid, unreadable, or newer-version config files are diagnosed and treated as read-only", "README should document conservative config load diagnostics");
assertReadmeIncludes("Fix or remove the file, then run `/reload`", "README should document config diagnostic recovery");

console.log("✓ README copy checks passed");
