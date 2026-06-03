import { strict as assert } from "node:assert";
import { defaultConfig, normalizeConfig } from "../config.js";
import { GLANCE_THEME_IDS } from "../themes.js";
import type { GlanceConfig, SegmentConfig } from "../types.js";

function assertDefault(raw: unknown, message: string): void {
	assert.deepEqual(normalizeConfig(raw), defaultConfig(), message);
}

function assertSegments(actual: SegmentConfig[], expected: SegmentConfig[], message: string): void {
	assert.deepEqual(actual, expected, message);
}

const defaults = defaultConfig();

for (const raw of [undefined, null, false, true, 0, 1, "", "{}", []]) {
	assertDefault(raw, `non-object raw config ${JSON.stringify(raw)} should normalize to defaults`);
}

assert.equal(normalizeConfig({ version: 0 }).version, 2, "old raw version should normalize to current schema version");
assert.equal(normalizeConfig({ version: 999 }).version, 2, "future raw version should normalize to current schema version");

for (const theme of GLANCE_THEME_IDS) {
	assert.equal(normalizeConfig({ theme }).theme, theme, `${theme} should normalize as a valid theme`);
}

const userConfig = normalizeConfig({
	version: 1,
	enabled: false,
	theme: "tokyo-night",
	icons: "nerd",
	editor: {
		minContentRows: 4,
	},
	display: {
		adaptive: false,
		showProvider: "always",
		workspaceLabel: "path",
	},
	segments: [
		{ id: "model", enabled: false },
		{ id: "tokens", enabled: true },
		{ id: "git", enabled: false },
		{ id: "cost", enabled: false },
		{ id: "context", enabled: true },
	],
	model: {
		customNames: {
			"anthropic/claude-sonnet-4-20250514": "Sonnet",
			"openai/gpt-4.1": "GPT 4.1",
		},
		showThinking: "always",
	},
	git: {
		showDirty: false,
		showAheadBehind: false,
		shaMode: "always",
		timeoutMs: 2500,
		refreshDebounceMs: 250,
		pollIntervalMs: 30000,
	},
	context: {
		display: "tokens",
		unknown: "hide",
	},
	cost: {
		hideZero: true,
	},
	tokens: {
		display: "total",
		cache: "show",
	},
});

assert.deepEqual(
	userConfig,
	{
		version: 2,
		enabled: false,
		theme: "tokyo-night",
		icons: "nerd",
		editor: {
			minContentRows: 4,
		},
		display: {
			adaptive: false,
			showProvider: "always",
			workspaceLabel: "path",
		},
		segments: [
			{ id: "model", enabled: false },
			{ id: "tokens", enabled: true },
			{ id: "git", enabled: false },
			{ id: "cost", enabled: false },
			{ id: "context", enabled: true },
		],
		model: {
			customNames: {
				"anthropic/claude-sonnet-4-20250514": "Sonnet",
				"openai/gpt-4.1": "GPT 4.1",
			},
			showThinking: "always",
		},
		git: {
			showDirty: false,
			showAheadBehind: false,
			shaMode: "always",
			timeoutMs: 2500,
			refreshDebounceMs: 250,
			pollIntervalMs: 30000,
		},
		context: {
			display: "tokens",
			unknown: "hide",
		},
		cost: {
			hideZero: true,
		},
		tokens: {
			display: "total",
			cache: "show",
		},
	},
	"valid existing user settings should be preserved while version normalizes",
);

assert.equal(normalizeConfig({ icons: "nerd" }).icons, "nerd", "saved icons: nerd should remain nerd");
assert.equal(normalizeConfig({ enabled: false, theme: "dark" }).enabled, false, "missing nested groups should not reset known top-level booleans");
assert.equal(normalizeConfig({ enabled: false, theme: "dark" }).theme, "dark", "missing nested groups should not reset known top-level enums");
assert.deepEqual(normalizeConfig({ enabled: false, theme: "dark" }).editor, defaults.editor, "missing editor group should fill defaults");
assert.deepEqual(normalizeConfig({ enabled: false, theme: "dark" }).display, defaults.display, "missing display group should fill defaults");
assert.deepEqual(normalizeConfig({ enabled: false, theme: "dark" }).model, defaults.model, "missing model group should fill defaults");
assert.deepEqual(normalizeConfig({ enabled: false, theme: "dark" }).git, defaults.git, "missing git group should fill defaults");
assert.deepEqual(normalizeConfig({ enabled: false, theme: "dark" }).context, defaults.context, "missing context group should fill defaults");
assert.deepEqual(normalizeConfig({ enabled: false, theme: "dark" }).cost, defaults.cost, "missing cost group should fill defaults");
assert.deepEqual(normalizeConfig({ enabled: false, theme: "dark" }).tokens, defaults.tokens, "missing tokens group should fill defaults");

assert.equal(normalizeConfig({ theme: "catppuccin-macchiato" }).theme, defaults.theme, "unknown theme should fall back to default theme");
assert.equal(normalizeConfig({ theme: null }).theme, defaults.theme, "non-string theme should fall back to default theme");
assert.equal(normalizeConfig({ icons: "emoji" }).icons, defaults.icons, "unknown icon mode should fall back to default icons");
assert.equal(normalizeConfig({ icons: null }).icons, defaults.icons, "non-string icon mode should fall back to default icons");
assert.equal(normalizeConfig({ display: { showProvider: "sometimes" } }).display.showProvider, defaults.display.showProvider, "unknown provider mode should fall back to default");
assert.equal(normalizeConfig({ display: { workspaceLabel: "repo" } }).display.workspaceLabel, defaults.display.workspaceLabel, "unknown workspace label mode should fall back to default");
assert.equal(normalizeConfig({ git: { shaMode: "branch" } }).git.shaMode, defaults.git.shaMode, "unknown git SHA mode should fall back to default");
assert.equal(normalizeConfig({ context: { display: "window" } }).context.display, defaults.context.display, "unknown context display mode should fall back to default");
assert.equal(normalizeConfig({ context: { unknown: "dim" } }).context.unknown, defaults.context.unknown, "unknown context unknown mode should fall back to default");
assert.equal(normalizeConfig({ tokens: { display: "input" } }).tokens.display, defaults.tokens.display, "unknown tokens display mode should fall back to default");
assert.equal(normalizeConfig({ tokens: { cache: "read" } }).tokens.cache, defaults.tokens.cache, "unknown tokens cache mode should fall back to default");
assert.equal(normalizeConfig({ model: { showThinking: "maybe" } }).model.showThinking, defaults.model.showThinking, "unknown thinking mode should fall back to default");

assert.equal(normalizeConfig({ editor: { minContentRows: 1 } }).editor.minContentRows, 2, "minContentRows should clamp to minimum 2");
assert.equal(normalizeConfig({ editor: { minContentRows: 2.9 } }).editor.minContentRows, 2, "minContentRows should floor fractional values");
assert.equal(normalizeConfig({ editor: { minContentRows: 3.9 } }).editor.minContentRows, 3, "minContentRows should floor before preserving in range");
assert.equal(normalizeConfig({ editor: { minContentRows: 9 } }).editor.minContentRows, 4, "minContentRows should clamp to maximum 4");
assert.equal(normalizeConfig({ editor: { minContentRows: Number.NaN } }).editor.minContentRows, defaults.editor.minContentRows, "NaN minContentRows should fall back to default");
assert.equal(normalizeConfig({ editor: { minContentRows: "4" } }).editor.minContentRows, defaults.editor.minContentRows, "non-number minContentRows should fall back to default");

assert.equal(normalizeConfig({ git: { timeoutMs: 99 } }).git.timeoutMs, 100, "git timeout should enforce minimum 100ms");
assert.equal(normalizeConfig({ git: { timeoutMs: 250.9 } }).git.timeoutMs, 250, "git timeout should floor fractional values");
assert.equal(normalizeConfig({ git: { timeoutMs: Number.POSITIVE_INFINITY } }).git.timeoutMs, defaults.git.timeoutMs, "non-finite git timeout should fall back to default");
assert.equal(normalizeConfig({ git: { refreshDebounceMs: -1 } }).git.refreshDebounceMs, 0, "git debounce should enforce minimum 0ms");
assert.equal(normalizeConfig({ git: { refreshDebounceMs: 250.9 } }).git.refreshDebounceMs, 250, "git debounce should floor fractional values");
assert.equal(normalizeConfig({ git: { refreshDebounceMs: "250" } }).git.refreshDebounceMs, defaults.git.refreshDebounceMs, "non-number git debounce should fall back to default");
assert.equal(normalizeConfig({ git: { pollIntervalMs: 999 } }).git.pollIntervalMs, 1000, "git polling should enforce minimum 1000ms");
assert.equal(normalizeConfig({ git: { pollIntervalMs: 1000.9 } }).git.pollIntervalMs, 1000, "git polling should floor fractional values");
assert.equal(normalizeConfig({ git: { pollIntervalMs: null } }).git.pollIntervalMs, defaults.git.pollIntervalMs, "non-number git polling should fall back to default");

assert.deepEqual(
	normalizeConfig({ model: { customNames: { sonnet: "Sonnet", empty: "", count: 4, disabled: false, nested: { name: "Nested" }, none: null } } }).model.customNames,
	{ sonnet: "Sonnet", empty: "" },
	"custom model names should preserve string values and filter non-string values",
);
assert.deepEqual(normalizeConfig({ model: { customNames: null } }).model.customNames, {}, "non-object customNames should fall back to empty object");

assertSegments(
	normalizeConfig({
		segments: [
			{ id: "tokens", enabled: true },
			{ id: "git", enabled: false },
			{ id: "model", enabled: false },
			{ id: "context", enabled: true },
			{ id: "cost", enabled: false },
		],
	}).segments,
	[
		{ id: "tokens", enabled: true },
		{ id: "git", enabled: false },
		{ id: "model", enabled: false },
		{ id: "context", enabled: true },
		{ id: "cost", enabled: false },
	],
	"current segment lists should preserve known order and enabled flags",
);

assertSegments(
	normalizeConfig({
		segments: [
			{ id: "git", enabled: false },
			{ id: "tokens", enabled: true },
		],
	}).segments,
	[
		{ id: "git", enabled: false },
		{ id: "tokens", enabled: true },
		{ id: "context", enabled: true },
		{ id: "cost", enabled: true },
		{ id: "model", enabled: true },
	],
	"segment migration should append missing default segments when current model anchor is present",
);

assertSegments(
	normalizeConfig({
		segments: [
			{ id: "git", enabled: false },
			{ id: "git", enabled: true },
			{ id: "unknown", enabled: false },
			{ id: "model", enabled: false },
			{ id: "tokens", enabled: "yes" },
		],
	}).segments,
	[
		{ id: "git", enabled: false },
		{ id: "model", enabled: false },
		{ id: "tokens", enabled: false },
		{ id: "context", enabled: true },
		{ id: "cost", enabled: true },
	],
	"segment migration should ignore duplicates/unknown ids and use defaults for invalid enabled flags",
);

assertSegments(
	normalizeConfig({
		segments: [
			{ id: "context", enabled: false },
			{ id: "tokens", enabled: true },
		],
	}).segments,
	defaults.segments,
	"legacy/ambiguous segment lists without git should fall back to curated defaults",
);
assertSegments(normalizeConfig({ segments: [] }).segments, defaults.segments, "empty segment lists should fall back to defaults");
assertSegments(normalizeConfig({ segments: "git" }).segments, defaults.segments, "non-array segment lists should fall back to defaults");

const normalized = normalizeConfig({ enabled: false, editor: { minContentRows: 4 } });
const expectedShape: GlanceConfig = { ...defaults, enabled: false, editor: { minContentRows: 4 } };
assert.deepEqual(normalized, expectedShape, "partial configs should normalize to the full current config shape");

console.log("✓ config normalization checks passed");
