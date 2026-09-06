import { test } from "node:test";
import { strict as assert } from "node:assert";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { stripControls } from "../../src/surface/format.js";
import { PALETTES, fg, fg256 } from "../../src/theme/palette.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { GLANCE_THEME_IDS } from "../../src/theme/themes.js";
import { testState } from "../support/helpers.js";
import type { GlanceConfig, GlanceState, GlanceThemeName, SegmentId } from "../../src/types.js";

import { renderGlanceLine } from "../../src/surface/status-line.js";

const RESET = "\x1b[0m";

function configWithSegments(ids: SegmentId[], mutate?: (config: GlanceConfig) => void): GlanceConfig {
	const config = defaultConfig();
	config.icons = "plain";
	config.segments = ids.map((id) => ({ id, enabled: true }));
	mutate?.(config);
	return config;
}

function useTheme(config: GlanceConfig, theme: GlanceThemeName): void {
	config.theme = { light: theme, dark: theme };
}

function plainLine(
	ids: SegmentId[],
	state: GlanceState = testState(),
	width = 120,
	providerCount = state.providers.availableCount,
	mutate?: (config: GlanceConfig) => void,
): string {
	return stripControls(renderGlanceLine(state, configWithSegments(ids, mutate), width, providerCount));
}

function rawLine(
	ids: SegmentId[],
	state: GlanceState = testState(),
	width = 120,
	providerCount = state.providers.availableCount,
	mutate?: (config: GlanceConfig) => void,
): string {
	return renderGlanceLine(state, configWithSegments(ids, mutate), width, providerCount);
}

function modelState(providerCount = 1, thinking = "off"): GlanceState {
	return testState({
		providers: { availableCount: providerCount },
		model: { id: "gpt-5.5", provider: "openai", displayName: "GPT 5.5", thinking },
	});
}

function richState(): GlanceState {
	const base = testState();
	return testState({
		git: { ...base.git, repo: true, branch: "main", status: "dirty", dirty: true, unstaged: 1 },
		providers: { availableCount: 2 },
		model: { id: "gpt-5.5", provider: "openai", displayName: "GPT 5.5", thinking: "high" },
		context: { tokens: 46_800, window: 200_000, percent: 23.4 },
		usage: { input: 12_400, output: 3_100, cacheRead: 800, cacheWrite: 20, cost: 0.042 },
	});
}

function fgSeq(color: { r: number; g: number; b: number }): string {
	return `\x1b[38;2;${color.r};${color.g};${color.b}m`;
}

function lastColorBefore(text: string, index: number): string | undefined {
	let last: string | undefined;
	const colorPattern = /\x1b\[38;2;\d+;\d+;\d+m/g;
	for (const match of text.matchAll(colorPattern)) {
		if (match.index === undefined || match.index >= index) break;
		last = match[0];
	}
	return last;
}

const singleSegmentParityCases: Array<{ id: SegmentId; state: GlanceState; text: string }> = [
	{ id: "git", state: richState(), text: "git main *" },
	{ id: "cost", state: richState(), text: "$0.042" },
	{ id: "throughput", state: testState(), text: "spd ? tok/s" },
	{ id: "context", state: richState(), text: "ctx 23% 47k/200k" },
	{ id: "tokens", state: richState(), text: "tok ↑12k ↓3.1k 6%" },
	{ id: "model", state: modelState(1), text: "ai GPT 5.5" },
];

for (const themeId of GLANCE_THEME_IDS) {
	const palette = PALETTES[themeId];
	for (const { id, state, text } of singleSegmentParityCases) {
		const config = configWithSegments([id], (next) => {
			useTheme(next, themeId);
		});
		assert.equal(
			renderGlanceLine(state, config, 120, state.providers.availableCount),
			`${fg(palette.segments[id].fg, text)}${RESET}`,
			`${themeId}.${id} status segment should keep byte-equivalent legacy palette styling through adapter`,
		);
	}
}

await test("status-line should emit ANSI 256-color output when Pi reports truecolor unavailable", async () => {
	const config = configWithSegments(["model"], (next) => {
		useTheme(next, "light");
	});
	const ansi256 = renderGlanceLine(modelState(1), config, 120, 1, { trueColor: false });
	assert.equal(
		ansi256,
		`${fg256(PALETTES.light.segments.model.fg, "ai GPT 5.5")}${RESET}`,
		"status-line should emit ANSI 256-color output when Pi reports truecolor unavailable",
	);
	assert.equal(ansi256.includes("\x1b[38;2;"), false, "ANSI 256-color status output should not retain truecolor escapes");
	assert.ok(ansi256.includes("\x1b[38;5;"), "ANSI 256-color status output should use indexed foreground escapes");
});

await test("status-line should honor an injected shared style context instead of resolving config.theme independently", async () => {
	const config = configWithSegments(["model"], (next) => {
		useTheme(next, "light");
	});
	const darkStyles = resolveBuiltInGlanceStyles("dark");
	assert.equal(
		renderGlanceLine(modelState(1), config, 120, 1, { styles: darkStyles }),
		`${fg(PALETTES.dark.segments.model.fg, "ai GPT 5.5")}${RESET}`,
		"status-line should honor an injected shared style context instead of resolving config.theme independently",
	);
});

await test("status-line should resolve a theme pair through the light slot for ambient light", async () => {
	const config = configWithSegments(["model"], (next) => {
		next.theme = { light: "one-light", dark: "tokyo-night" };
	});
	assert.equal(
		renderGlanceLine(modelState(1), config, 120, 1, { ambientTone: "light" }),
		`${fg(PALETTES["one-light"].segments.model.fg, "ai GPT 5.5")}${RESET}`,
		"status-line should resolve a theme pair through the light slot for ambient light",
	);
	assert.equal(
		renderGlanceLine(modelState(1), config, 120, 1, { ambientTone: "dark" }),
		`${fg(PALETTES["tokyo-night"].segments.model.fg, "ai GPT 5.5")}${RESET}`,
		"status-line should resolve a theme pair through the dark slot for ambient dark",
	);
	assert.equal(
		renderGlanceLine(modelState(1), config, 120, 1, { ambientTone: "unknown" }),
		`${fg(PALETTES["one-light"].segments.model.fg, "ai GPT 5.5")}${RESET}`,
		"status-line should resolve a theme pair through the light slot for ambient unknown",
	);
	assert.equal(
		renderGlanceLine(modelState(1), config, 120, 1),
		`${fg(PALETTES["one-light"].segments.model.fg, "ai GPT 5.5")}${RESET}`,
		"status-line should default missing ambient tone to the light slot",
	);
	let ambientTone: "light" | "dark" = "light";
	assert.equal(
		renderGlanceLine(modelState(1), config, 120, 1, { getAmbientTone: () => ambientTone }),
		`${fg(PALETTES["one-light"].segments.model.fg, "ai GPT 5.5")}${RESET}`,
		"status-line should call getAmbientTone lazily for light output",
	);
	ambientTone = "dark";
	assert.equal(
		renderGlanceLine(modelState(1), config, 120, 1, { getAmbientTone: () => ambientTone }),
		`${fg(PALETTES["tokyo-night"].segments.model.fg, "ai GPT 5.5")}${RESET}`,
		"status-line should call getAmbientTone lazily for dark output",
	);
	const overrideStyles = resolveBuiltInGlanceStyles("dark");
	assert.equal(
		renderGlanceLine(modelState(1), config, 120, 1, { styles: overrideStyles, ambientTone: "light" }),
		`${fg(PALETTES.dark.segments.model.fg, "ai GPT 5.5")}${RESET}`,
		"status-line explicit styles override should win over ambient tone selection",
	);
});

for (const themeId of ["light", "dark", "high-contrast-light"] as const) {
	const palette = PALETTES[themeId];
	const joined = rawLine(
		["context", "model"],
		testState({ context: { tokens: 180_000, window: 200_000, percent: 90 }, model: { id: "gpt-5.5", provider: "openai", displayName: "GPT 5.5", thinking: "off" } }),
		120,
		1,
		(config) => {
			useTheme(config, themeId);
			config.context.display = "percent";
		},
	);
	assert.equal(
		joined,
		`${fg(palette.error, "ctx 90%")}${fg(palette.separator, " · ")}${fg(palette.segments.model.fg, "ai GPT 5.5")}${RESET}`,
		`${themeId} context error + separator + model join should keep byte-equivalent legacy palette styling and reset behavior`,
	);
}

for (const themeId of ["light", "dark"] as const) {
	const palette = PALETTES[themeId];
	const state = modelState(2);
	const config = configWithSegments(["model"], (next) => {
		useTheme(next, themeId);
		next.display.showProvider = "always";
	});
	const width = 12;
	const legacyLine = `${fg(palette.segments.model.fg, "ai openai/GPT 5.5")}${RESET}`;
	assert.equal(
		renderGlanceLine(state, config, width, 2),
		truncateToWidth(legacyLine, width, fg(palette.dim, "…")),
		`${themeId} truncation should keep byte-equivalent legacy dim ellipsis styling through adapter`,
	);
}

await test("disabled config should render an empty status line", async () => {
	const config = defaultConfig();
	config.enabled = false;
	assert.equal(renderGlanceLine(testState(), config, 120), "", "disabled config should render an empty status line");
});

await test("auto provider should hide provider when only one provider is available", async () => {
	assert.equal(plainLine(["model"], modelState(1), 120, 1), "ai GPT 5.5", "auto provider should hide provider when only one provider is available");
	assert.equal(
		plainLine(["model"], modelState(2), 120, 2),
		"ai openai/GPT 5.5",
		"auto provider should show provider at full width when multiple providers are available",
	);
	assert.equal(plainLine(["model"], modelState(2), 80, 2), "ai GPT 5.5", "auto provider should hide provider in compact width");
	assert.equal(plainLine(["model"], modelState(2), 48, 2), "ai GPT 5.5", "auto provider should hide provider in minimal width");
	assert.equal(
		plainLine(["model"], modelState(1), 48, 1, (config) => {
			config.display.showProvider = "always";
		}),
		"ai openai/GPT 5.5",
		"provider display always should override auto width/provider-count hiding",
	);
	assert.equal(
		plainLine(["model"], modelState(3), 120, 3, (config) => {
			config.display.showProvider = "never";
		}),
		"ai GPT 5.5",
		"provider display never should hide provider even at full width with multiple providers",
	);

	const forcedDensityConfig = configWithSegments(["model"]);
	assert.equal(
		stripControls(renderGlanceLine(modelState(2, "high"), forcedDensityConfig, 120, 2, { widthMode: "full" })),
		"ai openai/GPT 5.5 high",
		"forced full preview density should retain provider and thinking detail at a wide physical width",
	);
	assert.equal(
		stripControls(renderGlanceLine(modelState(2, "high"), forcedDensityConfig, 120, 2, { widthMode: "compact" })),
		"ai GPT 5.5",
		"forced compact preview density should fold optional Provider and Thinking details",
	);
	assert.equal(
		stripControls(renderGlanceLine(modelState(2, "high"), forcedDensityConfig, 120, 2, { widthMode: "minimal" })),
		"ai GPT 5.5",
		"forced minimal preview density should fold provider and thinking detail without changing physical width",
	);
});

await test("status line should follow configured segment order: cost before model", async () => {
	const state = richState();
	const full = plainLine(["cost", "model", "context", "git"], state, 160, 2);
	assert.ok(full.indexOf("$0.042") < full.indexOf("ai openai/GPT 5.5 high"), "status line should follow configured segment order: cost before model");
	assert.ok(full.indexOf("ai openai/GPT 5.5 high") < full.indexOf("ctx 23% 47k/200k"), "status line should follow configured segment order: model before context");
	assert.ok(full.indexOf("ctx 23% 47k/200k") < full.indexOf("git main *"), "status line should follow configured segment order: context before git");

	const narrowWidth = 24;
	const narrow = plainLine(["model", "context", "cost", "git"], state, narrowWidth, 2);
	assert.ok(visibleWidth(narrow) <= narrowWidth, "adaptive fitting should keep visible width within the requested width");
	assert.ok(narrow.includes("ai GPT 5.5"), "adaptive fitting should keep earlier segments first");
	assert.ok(narrow.includes("ctx 23%"), "adaptive fitting should keep earlier context segment at narrow width");
	assert.equal(narrow.includes("$0.042"), false, "adaptive fitting should drop later cost segment before earlier segments");
	assert.equal(narrow.includes("git main"), false, "adaptive fitting should drop latest git segment first at narrow width");
});

await test("context below warn threshold should use normal context color", async () => {
	const palette = PALETTES.light;
	const normal = rawLine(
		["context"],
		testState({ context: { tokens: 140_000, window: 200_000, percent: 74 } }),
		120,
		1,
		(config) => {
			config.context.display = "percent";
		},
	);
	const warn = rawLine(
		["context"],
		testState({ context: { tokens: 150_000, window: 200_000, percent: 75 } }),
		120,
		1,
		(config) => {
			config.context.display = "percent";
		},
	);
	const error = rawLine(
		["context"],
		testState({ context: { tokens: 180_000, window: 200_000, percent: 90 } }),
		120,
		1,
		(config) => {
			config.context.display = "percent";
		},
	);
	assert.equal(lastColorBefore(normal, normal.indexOf("ctx")), fgSeq(palette.segments.context.fg), "context below warn threshold should use normal context color");
	assert.equal(lastColorBefore(warn, warn.indexOf("ctx")), fgSeq(palette.warn), "context at warn threshold should use warning color");
	assert.equal(lastColorBefore(error, error.indexOf("ctx")), fgSeq(palette.error), "context at error threshold should use error color");
	assert.equal(normal, `${fg(palette.segments.context.fg, "ctx 74%")}${RESET}`, "context below warn threshold should preserve exact normal segment ANSI bytes");
	assert.equal(warn, `${fg(palette.warn, "ctx 75%")}${RESET}`, "context at warn threshold should preserve exact warning ANSI bytes");
	assert.equal(error, `${fg(palette.error, "ctx 90%")}${RESET}`, "context at error threshold should preserve exact error ANSI bytes");

	const joined = rawLine(
		["context", "model"],
		testState({ context: { tokens: 180_000, window: 200_000, percent: 90 }, model: { id: "gpt-5.5", provider: "openai", displayName: "GPT 5.5", thinking: "off" } }),
		120,
		1,
		(config) => {
			config.context.display = "percent";
		},
	);
	assert.equal(lastColorBefore(joined, joined.indexOf(" · ")), fgSeq(palette.separator), "separator should have separator color, not context warning/error bleed");
	assert.equal(lastColorBefore(joined, joined.indexOf("ai GPT 5.5")), fgSeq(palette.segments.model.fg), "model segment should reset to model color after warning/error context");
});

await test("compact status should prioritize the configured Tokens cache rate with the same icon-plus-percent grammar as Context", async () => {
	const reportedState = testState({
		git: { ...testState().git, repo: true, branch: "main", status: "clean", dirty: false },
		usage: { input: 20_000_000, output: 1_100_000, cacheRead: 320_000_000, cacheWrite: 0, cost: 302 },
		context: { tokens: 106_000, window: 200_000, percent: 53 },
		throughput: { currentRun: null, lastRun: null },
		model: { id: "gpt-5.6-sol", provider: "OTTAI", displayName: "GPT 5.6 sol", thinking: "max" },
		providers: { availableCount: 1 },
	});
	const reportedConfig = configWithSegments(["git", "cost", "throughput", "context", "tokens", "model"], (config) => {
		config.icons = "nerd";
	});
	assert.equal(
		stripControls(renderGlanceLine(reportedState, reportedConfig, 75, 1)),
		" main · 󰈸 $302.0 ·  ?/s · 󰔟 53% · 󰄨 94% · 󰚩 GPT 5.6 sol",
		"compact status should prioritize the configured Tokens cache rate with the same icon-plus-percent grammar as Context",
	);
});

await test("tokens full plain mode should include cache rate without the CH abbreviation", async () => {
	const state = richState();
	assert.equal(plainLine(["tokens"], state, 96), "tok ↑12k ↓3.1k 6%", "tokens full plain mode should include cache rate without the CH abbreviation");
	assert.equal(plainLine(["tokens"], state, 95), "tok 6%", "tokens compact rate mode should prioritize cache rate over absolute token amounts");
	assert.equal(plainLine(["tokens"], state, 63), "tok 6%", "tokens minimal rate mode should retain the same icon-plus-percent grammar");
	assert.equal(
		plainLine(["tokens"], state, 96, state.providers.availableCount, (config) => {
			config.icons = "nerd";
		}),
		"󰄨 ↑12k ↓3.1k 󰑐6%",
		"tokens full Nerd mode should mark cache rate with the taller nf-md-refresh glyph",
	);
	assert.equal(
		plainLine(["tokens"], state, 95, state.providers.availableCount, (config) => {
			config.icons = "nerd";
		}),
		"󰄨 6%",
		"tokens compact Nerd mode should drop the inline cache glyph and align with other segment icon-plus-value forms",
	);
	assert.equal(
		plainLine(["tokens"], state, 96, state.providers.availableCount, (config) => {
			config.tokens.cache = "read-write";
		}),
		"tok ↑12k ↓3.1k R800 W20",
		"tokens cache read/write mode should show actual cache token amounts in full mode",
	);
	assert.equal(
		plainLine(["tokens"], state, 95, state.providers.availableCount, (config) => {
			config.tokens.cache = "read-write";
		}),
		"tok ↑12k ↓3.1k",
		"tokens compact mode should fold read/write cache detail",
	);
	assert.equal(
		plainLine(["tokens"], state, 63, state.providers.availableCount, (config) => {
			config.tokens.cache = "read-write";
		}),
		"tok 16k",
		"tokens minimal mode should fold read/write cache detail and input/output breakdown",
	);
	assert.equal(
		plainLine(["tokens"], state, 63, state.providers.availableCount, (config) => {
			config.tokens.display = "total";
		}),
		"tok 6%",
		"tokens minimal rate mode should prioritize cache rate even when full display is configured as total",
	);
	assert.equal(
		plainLine(["tokens"], state, 96, state.providers.availableCount, (config) => {
			config.tokens.cache = "hide";
		}),
		"tok ↑12k ↓3.1k",
		"tokens cache hide should suppress read/write details in full width mode",
	);
	assert.equal(
		plainLine(
			["tokens"],
			testState({ usage: { input: 900, output: 50, cacheRead: 0, cacheWrite: 100, cost: 0 } }),
			96,
			1,
			(config) => {
				config.tokens.cache = "rate";
			},
		),
		"tok ↑900 ↓50 0%",
		"tokens cache rate should distinguish a known zero-percent cache hit from unknown usage without CH",
	);
	assert.equal(
		plainLine(
			["tokens"],
			testState({ usage: { input: 900, output: 50, cacheRead: 0, cacheWrite: 100, cost: 0 } }),
			95,
		),
		"tok 0%",
		"tokens compact rate mode should preserve a known zero-percent cache hit",
	);
	assert.equal(
		plainLine(
			["tokens"],
			testState({ usage: { input: 0, output: 50, cacheRead: 100, cacheWrite: 0, cost: 0 } }),
			96,
			1,
			(config) => {
				config.tokens.cache = "rate";
			},
		),
		"tok ↑0 ↓50 100%",
		"tokens cache rate should handle a fully cached prompt without CH",
	);
	assert.equal(
		plainLine(
			["tokens"],
			testState({ usage: { input: 0, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0 } }),
			96,
			1,
			(config) => {
				config.tokens.cache = "rate";
			},
		),
		"tok ↑0 ↓50",
		"tokens cache rate should stay absent when no prompt-token denominator is known",
	);
	assert.equal(
		plainLine(
			["tokens"],
			testState({ usage: { input: 0, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0 } }),
			95,
		),
		"tok ↑0 ↓50",
		"tokens compact rate mode should fall back to absolute amounts while the rate denominator is unknown",
	);
	assert.equal(
		plainLine(
			["tokens"],
			testState({ usage: { input: 0, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0 } }),
			63,
		),
		"tok 50",
		"tokens minimal rate mode should fall back to total usage while the rate denominator is unknown",
	);
	assert.equal(plainLine(["model"], modelState(1, "high"), 96), "ai GPT 5.5 high", "model thinking auto should show thinking at full width");
	assert.equal(plainLine(["model"], modelState(1, "high"), 64), "ai GPT 5.5", "model thinking auto should hide thinking at compact width");
	assert.equal(plainLine(["model"], modelState(1, "high"), 63), "ai GPT 5.5", "model thinking auto should hide thinking at minimal width");
});

for (const icons of ["plain", "nerd"] as const) {
	for (const width of [48, 80, 120]) {
		const config = configWithSegments(["git", "context", "cost", "tokens", "model"], (next) => {
			next.icons = icons;
		});
		const rendered = renderGlanceLine(richState(), config, width, 2);
		assert.ok(stripControls(rendered).length > 0, `${icons} status line should render visible text at width ${width}`);
		assert.ok(visibleWidth(rendered) <= width, `${icons} status line visible width should stay within budget ${width}`);
	}
}

console.log("✓ status line checks passed");
