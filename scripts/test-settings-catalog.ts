import { strict as assert } from "node:assert";
import {
	CONTEXT_DISPLAY_MODE_VALUES,
	CONTEXT_UNKNOWN_MODE_VALUES,
	GIT_SHA_MODE_VALUES,
	ICON_MODE_VALUES,
	MODEL_THINKING_MODE_VALUES,
	PROVIDER_DISPLAY_MODE_VALUES,
	TOKENS_CACHE_MODE_VALUES,
	TOKENS_DISPLAY_MODE_VALUES,
	WORKSPACE_LABEL_MODE_VALUES,
} from "../config-options.js";
import { defaultConfig } from "../config.js";
import { getSettingsCategories, getSettingsRows, type SettingsCategoryId, type SettingsRow } from "../settings-catalog.js";
import { GLANCE_THEMES } from "../themes.js";
import type { GlanceConfig, SegmentId } from "../types.js";

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function withTestConfig(config: GlanceConfig, mutate: (next: GlanceConfig) => void): GlanceConfig {
	const next = clone(config);
	mutate(next);
	return next;
}

function assertConfigUnchanged(before: GlanceConfig, after: GlanceConfig, message: string): void {
	assert.deepEqual(after, before, message);
}

function applyRow(config: GlanceConfig, row: SettingsRow): GlanceConfig {
	assert.ok(row.apply, `${row.label} should be editable`);
	const before = clone(config);
	const next = row.apply(config);
	assert.notEqual(next, config, `${row.label} apply should return a new config object`);
	assertConfigUnchanged(before, config, `${row.label} apply should not mutate input config`);
	return next;
}

function rowSummary(row: SettingsRow): Pick<SettingsRow, "id" | "label" | "value" | "hint" | "kind"> {
	return {
		id: row.id,
		label: row.label,
		value: row.value,
		hint: row.hint,
		kind: row.kind,
	};
}

function assertRows(config: GlanceConfig, categoryId: SettingsCategoryId, expected: Array<Pick<SettingsRow, "id" | "label" | "value" | "hint" | "kind">>): SettingsRow[] {
	const rows = getSettingsRows(config, categoryId);
	assert.deepEqual(rows.map(rowSummary), expected, `${categoryId} rows should preserve pane copy/order/value/kind`);
	return rows;
}

function assertEditableRowsArePure(config: GlanceConfig, categoryId: SettingsCategoryId): void {
	for (const row of getSettingsRows(config, categoryId)) {
		if (!row.apply) continue;
		applyRow(config, row);
	}
}

function rowById(rows: SettingsRow[], id: string): SettingsRow {
	const row = rows.find((candidate) => candidate.id === id);
	assert.ok(row, `expected row ${id}`);
	return row;
}

function assertCycleUsesValues<T extends string>(
	base: GlanceConfig,
	values: readonly T[],
	categoryId: SettingsCategoryId,
	rowId: string,
	label: string,
	withValue: (config: GlanceConfig, value: T) => GlanceConfig,
	getValue: (config: GlanceConfig) => T,
): void {
	for (let index = 0; index < values.length; index++) {
		const current = values[index]!;
		const expected = values[(index + 1) % values.length]!;
		const before = withValue(base, current);
		const row = rowById(getSettingsRows(before, categoryId), rowId);
		const after = applyRow(before, row);
		assert.equal(getValue(after), expected, `${label} should cycle ${current} -> ${expected}`);
	}
}

const config = defaultConfig();
const categories = getSettingsCategories(config);
assert.deepEqual(
	categories,
	[
		{ id: "general", label: "General" },
		...config.segments.map((segment) => ({ id: segment.id, label: segment.id[0]!.toUpperCase() + segment.id.slice(1), enabled: segment.enabled })),
	],
	"categories should start with General then follow configured segment order with enabled flags",
);

const reordered: GlanceConfig = {
	...config,
	segments: [
		{ id: "model", enabled: false },
		{ id: "tokens", enabled: true },
		{ id: "cost", enabled: false },
		{ id: "context", enabled: true },
		{ id: "git", enabled: false },
	],
};
assert.deepEqual(
	getSettingsCategories(reordered),
	[
		{ id: "general", label: "General" },
		{ id: "model", label: "Model", enabled: false },
		{ id: "tokens", label: "Tokens", enabled: true },
		{ id: "cost", label: "Cost", enabled: false },
		{ id: "context", label: "Context", enabled: true },
		{ id: "git", label: "Git", enabled: false },
	],
	"categories should preserve arbitrary config.segments order",
);

const generalRows = assertRows(config, "general", [
	{
		id: "general.enabled",
		label: "Enabled",
		value: "on",
		hint: "Temporarily disable pi-glance.",
		kind: "toggle",
	},
	{
		id: "general.theme",
		label: "Theme",
		value: "Light",
		hint: "Switch the palette.",
		kind: "cycle",
	},
	{
		id: "general.icons",
		label: "Icons",
		value: "plain",
		hint: "Nerd icons need a Nerd Font or Symbols Nerd Font fallback. If icons look like boxes, choose plain.",
		kind: "cycle",
	},
	{
		id: "general.minInputRows",
		label: "Min input rows",
		value: "3",
		hint: "Set the resting editor height.",
		kind: "cycle",
	},
	{
		id: "general.adaptiveWidth",
		label: "Adaptive width",
		value: "on",
		hint: "Drop later segments first.",
		kind: "toggle",
	},
	{
		id: "general.workspaceLabel",
		label: "Workspace label",
		value: "name",
		hint: "Use ~/ path when space allows.",
		kind: "cycle",
	},
]);

const gitRows = assertRows(config, "git", [
	{
		id: "git.enabled",
		label: "Enabled",
		value: "on",
		hint: "Show or hide this segment.",
		kind: "toggle",
	},
	{
		id: "git.dirtyMarker",
		label: "Dirty marker",
		value: "on",
		hint: "Conflicts always stay visible.",
		kind: "toggle",
	},
	{
		id: "git.aheadBehind",
		label: "Ahead / behind",
		value: "on",
		hint: "Show upstream counts.",
		kind: "toggle",
	},
	{
		id: "git.sha",
		label: "SHA",
		value: "off",
		hint: "Keep branches quiet unless enabled.",
		kind: "cycle",
	},
	{
		id: "git.polling",
		label: "Polling",
		value: "5s",
		hint: "Check external Git changes.",
		kind: "cycle",
	},
]);

const contextRows = assertRows(config, "context", [
	{
		id: "context.enabled",
		label: "Enabled",
		value: "on",
		hint: "Show or hide this segment.",
		kind: "toggle",
	},
	{
		id: "context.display",
		label: "Display",
		value: "percent / tokens",
		hint: "Choose percent, tokens, or both.",
		kind: "cycle",
	},
	{
		id: "context.unknown",
		label: "Unknown",
		value: "show",
		hint: "Hide when usage is unknown.",
		kind: "cycle",
	},
]);

const costRows = assertRows(config, "cost", [
	{
		id: "cost.enabled",
		label: "Enabled",
		value: "on",
		hint: "Show or hide this segment.",
		kind: "toggle",
	},
	{
		id: "cost.hideZero",
		label: "Hide zero",
		value: "off",
		hint: "Hide until cost is non-zero.",
		kind: "toggle",
	},
	{
		id: "cost.display",
		label: "Display",
		value: "compact USD",
		hint: "Compact session cost.",
		kind: "info",
	},
]);

const tokensRows = assertRows(config, "tokens", [
	{
		id: "tokens.enabled",
		label: "Enabled",
		value: "off",
		hint: "Show or hide this segment.",
		kind: "toggle",
	},
	{
		id: "tokens.display",
		label: "Display",
		value: "input / output",
		hint: "Choose input/output or total.",
		kind: "cycle",
	},
	{
		id: "tokens.cache",
		label: "Cache",
		value: "auto",
		hint: "Show or hide cache details.",
		kind: "cycle",
	},
]);

const modelRows = assertRows(config, "model", [
	{
		id: "model.enabled",
		label: "Enabled",
		value: "on",
		hint: "Show or hide this segment.",
		kind: "toggle",
	},
	{
		id: "model.providerLabel",
		label: "Provider label",
		value: "auto",
		hint: "Show provider name.",
		kind: "cycle",
	},
	{
		id: "model.thinkingLabel",
		label: "Thinking label",
		value: "auto",
		hint: "Show thinking level.",
		kind: "cycle",
	},
]);

assert.equal(rowById(generalRows, "general.enabled").apply!(config).enabled, false, "general enabled should toggle off");
assert.equal(rowById(generalRows, "general.theme").apply!(config).theme, GLANCE_THEMES[1]!.id, "theme should cycle to next theme id");
assert.equal(
	getSettingsRows({ ...config, theme: "catppuccin-mocha" }, "general").find((row) => row.id === "general.theme")?.value,
	"Catppuccin Mocha",
	"theme row should display friendly theme label",
);
assert.equal(rowById(generalRows, "general.icons").apply!(config).icons, "nerd", "icons should cycle plain -> nerd");
assert.equal(rowById(generalRows, "general.minInputRows").apply!(config).editor.minContentRows, 4, "min input rows should cycle 3 -> 4");
assert.equal(rowById(generalRows, "general.adaptiveWidth").apply!(config).display.adaptive, false, "adaptive width should toggle off");
assert.equal(rowById(generalRows, "general.workspaceLabel").apply!(config).display.workspaceLabel, "smart", "workspace label should cycle name -> smart");

assert.equal(rowById(gitRows, "git.enabled").apply!(config).segments.find((segment) => segment.id === "git")?.enabled, false, "git enabled should toggle off");
assert.equal(rowById(gitRows, "git.dirtyMarker").apply!(config).git.showDirty, false, "dirty marker should toggle off");
assert.equal(rowById(gitRows, "git.aheadBehind").apply!(config).git.showAheadBehind, false, "ahead/behind should toggle off");
assert.equal(rowById(gitRows, "git.sha").apply!(config).git.shaMode, "detached", "sha mode should cycle off -> detached");
assert.equal(rowById(gitRows, "git.polling").apply!(config).git.pollIntervalMs, 10000, "polling should cycle 5s -> 10s");

const pollingValues = [2000, 5000, 10000, 30000].map((pollIntervalMs) =>
	getSettingsRows({ ...config, git: { ...config.git, pollIntervalMs } }, "git").find((row) => row.id === "git.polling")?.value,
);
assert.deepEqual(pollingValues, ["2s", "5s", "10s", "30s"], "polling values should be formatted as seconds");

assert.equal(rowById(contextRows, "context.enabled").apply!(config).segments.find((segment) => segment.id === "context")?.enabled, false, "context enabled should toggle off");
assert.equal(rowById(contextRows, "context.display").apply!(config).context.display, "percent", "context display should cycle percent+tokens -> percent");
assert.equal(rowById(contextRows, "context.unknown").apply!(config).context.unknown, "hide", "context unknown should cycle show -> hide");

assert.equal(rowById(costRows, "cost.enabled").apply!(config).segments.find((segment) => segment.id === "cost")?.enabled, false, "cost enabled should toggle off");
assert.equal(rowById(costRows, "cost.hideZero").apply!(config).cost.hideZero, true, "cost hide zero should toggle on");
const infoBefore = clone(config);
const costInfo = rowById(costRows, "cost.display");
assert.equal(costInfo.apply, undefined, "cost display info row should not expose apply");
assertConfigUnchanged(infoBefore, config, "reading an info row should not dirty config");

assert.equal(rowById(tokensRows, "tokens.enabled").apply!(config).segments.find((segment) => segment.id === "tokens")?.enabled, true, "tokens enabled should toggle on");
assert.equal(rowById(tokensRows, "tokens.display").apply!(config).tokens.display, "total", "tokens display should cycle input-output -> total");
assert.equal(rowById(tokensRows, "tokens.cache").apply!(config).tokens.cache, "show", "tokens cache should cycle auto -> show");

assert.equal(rowById(modelRows, "model.enabled").apply!(config).segments.find((segment) => segment.id === "model")?.enabled, false, "model enabled should toggle off");
assert.equal(rowById(modelRows, "model.providerLabel").apply!(config).display.showProvider, "always", "provider label should cycle auto -> always");
assert.equal(rowById(modelRows, "model.thinkingLabel").apply!(config).model.showThinking, "always", "thinking label should cycle auto -> always");

assertCycleUsesValues(
	config,
	ICON_MODE_VALUES,
	"general",
	"general.icons",
	"General Icons",
	(base, icons) => withTestConfig(base, (next) => {
		next.icons = icons;
	}),
	(after) => after.icons,
);
assertCycleUsesValues(
	config,
	WORKSPACE_LABEL_MODE_VALUES,
	"general",
	"general.workspaceLabel",
	"General Workspace label",
	(base, workspaceLabel) => withTestConfig(base, (next) => {
		next.display.workspaceLabel = workspaceLabel;
	}),
	(after) => after.display.workspaceLabel,
);
assertCycleUsesValues(
	config,
	GIT_SHA_MODE_VALUES,
	"git",
	"git.sha",
	"Git SHA",
	(base, shaMode) => withTestConfig(base, (next) => {
		next.git.shaMode = shaMode;
	}),
	(after) => after.git.shaMode,
);
assertCycleUsesValues(
	config,
	CONTEXT_DISPLAY_MODE_VALUES,
	"context",
	"context.display",
	"Context Display",
	(base, display) => withTestConfig(base, (next) => {
		next.context.display = display;
	}),
	(after) => after.context.display,
);
assertCycleUsesValues(
	config,
	CONTEXT_UNKNOWN_MODE_VALUES,
	"context",
	"context.unknown",
	"Context Unknown",
	(base, unknown) => withTestConfig(base, (next) => {
		next.context.unknown = unknown;
	}),
	(after) => after.context.unknown,
);
assertCycleUsesValues(
	config,
	TOKENS_DISPLAY_MODE_VALUES,
	"tokens",
	"tokens.display",
	"Tokens Display",
	(base, display) => withTestConfig(base, (next) => {
		next.tokens.display = display;
	}),
	(after) => after.tokens.display,
);
assertCycleUsesValues(
	config,
	TOKENS_CACHE_MODE_VALUES,
	"tokens",
	"tokens.cache",
	"Tokens Cache",
	(base, cache) => withTestConfig(base, (next) => {
		next.tokens.cache = cache;
	}),
	(after) => after.tokens.cache,
);
assertCycleUsesValues(
	config,
	PROVIDER_DISPLAY_MODE_VALUES,
	"model",
	"model.providerLabel",
	"Model Provider label",
	(base, showProvider) => withTestConfig(base, (next) => {
		next.display.showProvider = showProvider;
	}),
	(after) => after.display.showProvider,
);
assertCycleUsesValues(
	config,
	MODEL_THINKING_MODE_VALUES,
	"model",
	"model.thinkingLabel",
	"Model Thinking label",
	(base, showThinking) => withTestConfig(base, (next) => {
		next.model.showThinking = showThinking;
	}),
	(after) => after.model.showThinking,
);

for (const categoryId of ["general", "git", "context", "cost", "tokens", "model"] as const) {
	assertEditableRowsArePure(config, categoryId);
}

assert.deepEqual(getSettingsRows(config, "unknown" as SettingsCategoryId), [], "unknown category should safely return no rows");
assert.deepEqual(getSettingsRows(config, "git-ish" as SegmentId), [], "unknown segment id should safely return no rows");

console.log("✓ settings catalog checks passed");
