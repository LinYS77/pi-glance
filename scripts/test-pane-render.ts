import { strict as assert } from "node:assert";
import { visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../config.js";
import { showGlancePane } from "../pane.js";
import { GLANCE_THEMES, themeLabel } from "../themes.js";
import { testState } from "./helpers.js";
import type { GlanceConfig, GlanceState } from "../types.js";

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}

function plainRender(component: Component, width = 120): string[] {
	return component.render(width).map(stripAnsi);
}

function plainText(component: Component, width = 120): string {
	return plainRender(component, width).join("\n");
}

function press(component: Component, data: string): void {
	component.handleInput?.(data);
}

function makeState(): GlanceState {
	return testState({
		git: {
			repo: true,
			branch: "main",
			detached: false,
			sha: "a1b2c3d",
			upstream: "origin/main",
			ahead: 1,
			behind: 0,
			staged: 0,
			unstaged: 1,
			untracked: 0,
			conflicts: 0,
			dirty: true,
			status: "dirty",
			updatedAt: 0,
		},
		providers: { availableCount: 2 },
		model: { id: "claude-sonnet-4-20250514", provider: "anthropic", displayName: "Sonnet 4", thinking: "high" },
		context: { tokens: 46_800, window: 200_000, percent: 23.4 },
		usage: { input: 12_400, output: 3_100, cacheRead: 800, cacheWrite: 0, cost: 0.042 },
	});
}

async function makePane(config: GlanceConfig = defaultConfig()): Promise<{ component: Component; renders: () => number; done: () => unknown }> {
	let component: Component | undefined;
	let renderRequests = 0;
	let doneResult: unknown;

	await showGlancePane(
		config,
		{
			ui: {
				custom: async <T>(factory: (tui: TUI, theme: Theme, keybindings: unknown, done: (result: T) => void) => Component): Promise<T> => {
					component = factory(
						{ requestRender: () => renderRequests++ } as unknown as TUI,
						theme,
						undefined,
						(result: T) => {
							doneResult = result;
						},
					);
					return { action: "cancel" } as T;
				},
			},
		},
		makeState(),
	);

	assert.ok(component, "pane component should be created");
	return { component, renders: () => renderRequests, done: () => doneResult };
}

function assertContains(text: string, fragment: string, message?: string): void {
	assert.ok(text.includes(fragment), message ?? `expected render to include ${JSON.stringify(fragment)}`);
}

function assertNotContains(text: string, fragment: string, message?: string): void {
	assert.ok(!text.includes(fragment), message ?? `expected render not to include ${JSON.stringify(fragment)}`);
}

function assertLineContainsAll(text: string, fragments: string[], message?: string): void {
	const found = text.split("\n").some((line) => fragments.every((fragment) => line.includes(fragment)));
	assert.ok(found, message ?? `expected one render line to include ${fragments.map((f) => JSON.stringify(f)).join(", ")}`);
}

function findLineContaining(text: string, fragment: string): string {
	const line = text.split("\n").find((candidate) => candidate.includes(fragment));
	assert.ok(line, `expected render to include a line with ${JSON.stringify(fragment)}`);
	return line;
}

function assertNoRawThemeIds(text: string, context: string): void {
	for (const { id } of GLANCE_THEMES) {
		assert.ok(!text.includes(id), `${context} should not show raw theme id ${id}`);
	}
}

function assertThemeRow(text: string, label: string): void {
	const line = findLineContaining(text, "Theme");
	assert.ok(line.includes(label), `Theme row should show ${label}`);
	assertNoRawThemeIds(line, "Theme row");
}

function helpIndex(lines: string[]): number {
	const index = lines.findIndex((line) => line.includes("[←→↑↓] move"));
	assert.notEqual(index, -1, "help line should be rendered");
	return index;
}

const first = await makePane();
const initial = plainText(first.component);
assertContains(initial, "✓ Saved", "initial pane should be clean");
assertContains(initial, "Ask pi to improve the input surface...", "preview should render");
assertNotContains(initial, "PREVIEW", "preview label should stay removed");
assertContains(initial, "Enabled", "settings section should render");
assertContains(initial, "» General", "general category should be selected initially");
assertContains(initial, "Git", "git category should render");
assertContains(initial, "Tokens", "tokens category should render");
assertContains(initial, "[←→↑↓] move  ·  [S] save  ·  [R] reset", "stable help shortcuts should stay first");
assertContains(initial, "[J/K] switch", "category help should describe segment switching");
assertNotContains(initial, "Changes stay local", "empty default status copy should stay removed");
assertNotContains(initial, "NOTES", "old notes section should stay removed");
assertNotContains(initial, "[Tab]", "tab navigation should stay removed");

const themePane = await makePane();
press(themePane.component, "\x1b[C");
press(themePane.component, "\x1b[B");
press(themePane.component, "\x1b[C");
for (let i = 1; i <= GLANCE_THEMES.length; i++) {
	const expectedTheme = GLANCE_THEMES[i % GLANCE_THEMES.length]!;
	const expectedLabel = themeLabel(expectedTheme.id);
	press(themePane.component, "\r");
	const themeText = plainText(themePane.component);
	assertThemeRow(themeText, expectedLabel);
	if (expectedTheme.id !== "light") {
		assertContains(themeText, `Theme → ${expectedLabel}. Press S to save.`, "theme status should use friendly label");
		assertNoRawThemeIds(findLineContaining(themeText, "Theme →"), "Theme status");
	}
}

const gridPane = await makePane();
press(gridPane.component, "\x1b[B");
press(gridPane.component, "\x1b[C");
assertContains(plainText(gridPane.component), "» Dirty marker", "right arrow should move to the same visual row in the setting column");
press(gridPane.component, "\x1b[D");
assertContains(plainText(gridPane.component), "» Git", "left arrow should return to the same visual row in the category column");

const gridSettingPane = await makePane();
press(gridSettingPane.component, "\x1b[C");
press(gridSettingPane.component, "\x1b[B");
press(gridSettingPane.component, "\x1b[B");
assertContains(plainText(gridSettingPane.component), "» Icons", "down arrow should move within the setting column");
press(gridSettingPane.component, "\x1b[D");
assertContains(plainText(gridSettingPane.component), "» Context", "left arrow should move to the category on the same visual row");

const contextPane = await makePane();
press(contextPane.component, "\x1b[B");
press(contextPane.component, "\x1b[B");
const contextCategory = plainText(contextPane.component);
assertContains(contextCategory, "Display", "context category should show context detail settings");
assertLineContainsAll(contextCategory, ["Display", "percent / tokens"], "context display setting should render");
assertLineContainsAll(contextCategory, ["Unknown", "show"], "context unknown setting should render");

press(contextPane.component, "\x1b[C");
press(contextPane.component, "\x1b[A");
const contextDisplay = plainText(contextPane.component);
assertContains(contextDisplay, "Choose percent, tokens, or both.", "context display hint should render");
press(contextPane.component, "\r");
assertLineContainsAll(plainText(contextPane.component), ["Display", "percent / tokens"], "enter should not cycle before value column");
press(contextPane.component, "\x1b[C");
press(contextPane.component, "\r");
const contextDisplayChanged = plainText(contextPane.component);
assertLineContainsAll(contextDisplayChanged, ["Display", "percent"], "enter should cycle context display in value column");
press(contextPane.component, "\x1b[B");
press(contextPane.component, "\r");
const contextUnknownChanged = plainText(contextPane.component);
assertLineContainsAll(contextUnknownChanged, ["Unknown", "hide"], "enter should cycle context unknown behavior");
assertContains(contextUnknownChanged, "Hide when usage is unknown.", "context unknown hint should render");

const costPane = await makePane();
press(costPane.component, "\x1b[B");
press(costPane.component, "\x1b[B");
press(costPane.component, "\x1b[B");
const costCategory = plainText(costPane.component);
assertContains(costCategory, "Hide zero", "cost category should show cost detail settings");
assertLineContainsAll(costCategory, ["Hide zero", "off"], "cost hide zero setting should render");
assertLineContainsAll(costCategory, ["Display", "compact USD"], "cost display info should render");

press(costPane.component, "\x1b[C");
press(costPane.component, "\x1b[A");
press(costPane.component, "\x1b[C");
press(costPane.component, "\r");
const costChanged = plainText(costPane.component);
assertLineContainsAll(costChanged, ["Hide zero", "on"], "enter should toggle cost hide zero");
assertContains(costChanged, "Hide until cost is non-zero.", "cost hide zero hint should render");

const tokensPane = await makePane();
press(tokensPane.component, "\x1b[B");
press(tokensPane.component, "\x1b[B");
press(tokensPane.component, "\x1b[B");
press(tokensPane.component, "\x1b[B");
const tokensCategory = plainText(tokensPane.component);
assertContains(tokensCategory, "Cache", "tokens category should show tokens detail settings");
assertLineContainsAll(tokensCategory, ["Display", "input / output"], "tokens display setting should render");
assertLineContainsAll(tokensCategory, ["Cache", "auto"], "tokens cache setting should render");

press(tokensPane.component, "\x1b[C");
press(tokensPane.component, "\x1b[A");
press(tokensPane.component, "\x1b[C");
press(tokensPane.component, "\r");
const tokensDisplayChanged = plainText(tokensPane.component);
assertLineContainsAll(tokensDisplayChanged, ["Display", "total"], "enter should cycle tokens display");
press(tokensPane.component, "\x1b[B");
press(tokensPane.component, "\r");
const tokensCacheChanged = plainText(tokensPane.component);
assertLineContainsAll(tokensCacheChanged, ["Cache", "show"], "enter should cycle tokens cache mode");
assertContains(tokensCacheChanged, "Show or hide cache details.", "tokens cache hint should render");

const modelPane = await makePane();
press(modelPane.component, "\x1b[B");
press(modelPane.component, "\x1b[B");
press(modelPane.component, "\x1b[B");
press(modelPane.component, "\x1b[B");
press(modelPane.component, "\x1b[B");
const modelCategory = plainText(modelPane.component);
assertContains(modelCategory, "Provider label", "model category should show model detail settings");
assertLineContainsAll(modelCategory, ["Provider label", "auto"], "model provider setting should render");
assertLineContainsAll(modelCategory, ["Thinking label", "auto"], "model thinking setting should render");

press(modelPane.component, "\x1b[C");
press(modelPane.component, "\x1b[A");
press(modelPane.component, "\x1b[C");
press(modelPane.component, "\r");
const providerChanged = plainText(modelPane.component);
assertLineContainsAll(providerChanged, ["Provider label", "always"], "enter should cycle provider label");
press(modelPane.component, "\x1b[B");
press(modelPane.component, "\r");
const thinkingChanged = plainText(modelPane.component);
assertLineContainsAll(thinkingChanged, ["Thinking label", "always"], "enter should cycle thinking label");
assertContains(thinkingChanged, "Show thinking level.", "model thinking hint should render");

const generalHintPane = await makePane();
press(generalHintPane.component, "\x1b[C");
assertContains(plainText(generalHintPane.component), "Temporarily disable pi-glance.", "general enabled hint should render");
press(generalHintPane.component, "\x1b[B");
assertContains(plainText(generalHintPane.component), "Switch the palette.", "general theme hint should render");
press(generalHintPane.component, "\x1b[B");
press(generalHintPane.component, "\x1b[B");
press(generalHintPane.component, "\x1b[B");
press(generalHintPane.component, "\x1b[B");
const workspaceLabel = plainText(generalHintPane.component);
assertLineContainsAll(workspaceLabel, ["Workspace label", "name"], "workspace label setting should render");
assertContains(workspaceLabel, "Use ~/ path when space allows.", "workspace label hint should render");
press(generalHintPane.component, "\r");
assertLineContainsAll(plainText(generalHintPane.component), ["Workspace label", "name"], "enter should not cycle workspace label before value column");
press(generalHintPane.component, "\x1b[C");
press(generalHintPane.component, "\r");
assertLineContainsAll(plainText(generalHintPane.component), ["Workspace label", "smart"], "enter should cycle workspace label in value column");

const gitPane = await makePane();
press(gitPane.component, "\x1b[B");
const gitCategory = plainText(gitPane.component);
assertContains(gitCategory, "Dirty marker", "git category should show git detail settings");
assertContains(gitCategory, "Dirty marker", "git dirty setting should render");
assertContains(gitCategory, "Ahead / behind", "git ahead/behind setting should render");
assertContains(gitCategory, "SHA", "git SHA setting should render");
assertContains(gitCategory, "Polling", "git polling setting should render");

press(gitPane.component, "\x1b[C");
const gitSettings = plainText(gitPane.component);
assertNotContains(gitSettings, "[Enter] change", "setting label column should not describe changing values");
assertContains(gitSettings, "[←→↑↓] move  ·  [S] save  ·  [R] reset", "stable help shortcuts should stay first outside category column");
assertContains(gitSettings, "[Esc] back", "settings help should describe returning to categories");
assertNotContains(gitSettings, "[J/K] switch", "category segment switching help should be hidden outside category column");
press(gitPane.component, "\x1b[C");
const gitValues = plainText(gitPane.component);
assertContains(gitValues, "[←→↑↓] move  ·  [S] save  ·  [R] reset", "stable help shortcuts should stay first in value column");
assertContains(gitValues, "[Enter] change", "value column should describe changing values");

const dirtyLines = plainRender(gitPane.component);
const dirtyText = dirtyLines.join("\n");
assertContains(dirtyText, "Conflicts always stay visible.", "selected hint should render for dirty marker");
const dirtyHelpIndex = helpIndex(dirtyLines);

press(gitPane.component, "\x1b[B");
const aheadLines = plainRender(gitPane.component);
const aheadText = aheadLines.join("\n");
assertNotContains(aheadText, "Conflicts always stay visible.", "hint should change with the selected setting");
assert.equal(helpIndex(aheadLines), dirtyHelpIndex, "help row should stay vertically stable when selected hint changes");

const interaction = await makePane();
press(interaction.component, "\x1b[C");
const beforeSpace = plainText(interaction.component);
const beforeSpaceRenderRequests = interaction.renders();
press(interaction.component, " ");
const afterSpace = plainText(interaction.component);
assert.equal(afterSpace, beforeSpace, "space should not change the selected setting");
assert.equal(interaction.renders(), beforeSpaceRenderRequests, "space should not request a render");
assertContains(afterSpace, "✓ Saved", "space should not dirty the draft");

press(interaction.component, "\r");
assertContains(plainText(interaction.component), "✓ Saved", "enter should not change a setting before value column");
press(interaction.component, "\x1b[C");
press(interaction.component, "\r");
const afterEnter = plainText(interaction.component);
assertContains(afterEnter, "● Unsaved changes", "enter should change the selected setting and dirty the draft in value column");
assertLineContainsAll(afterEnter, ["Enabled", "off"], "enter should toggle the selected setting");

press(interaction.component, "s");
const saveResult = interaction.done();
assert.deepEqual(
	(saveResult as { action?: string; config?: GlanceConfig }).action,
	"save",
	"S should request save",
);
assert.equal((saveResult as { config: GlanceConfig }).config.enabled, false, "saved config should include the draft change");

const backPane = await makePane();
press(backPane.component, "\x1b[C");
press(backPane.component, "\x1b[D");
assertContains(plainText(backPane.component), "[J/K] switch", "left arrow should return from settings to categories");

// Test selection markers and wrappers across category/settings/value focus
const selPane = await makePane();
// Focus starts on general category
const selText1 = plainText(selPane.component);
assertContains(selText1, "» General", "active category column has focused category marked with '»'");
assertContains(selText1, "  Git", "inactive categories have spaces");

// Move to settings column (the label 'Enabled')
press(selPane.component, "\x1b[C");
const selText2 = plainText(selPane.component);
assertContains(selText2, "› General", "inactive selected category has '›' marker");
assertContains(selText2, "» Enabled", "active selected setting has '»' marker");

// Move to values column (the value 'on')
press(selPane.component, "\x1b[C");
const selText3 = plainText(selPane.component);
assertContains(selText3, "› General", "inactive selected category still has '›' marker");
assertContains(selText3, "› Enabled", "inactive selected setting row has '›' marker");
assertContains(selText3, "[ on ]", "active focused value has lightweight wrapper '[ value ]'");

for (const width of [56, 64, 72, 96, 120, 160]) {
	const widthPane = await makePane();
	const lines = widthPane.component.render(width);
	assert.ok(lines.length > 0, `render should produce lines at width ${width}`);
	const fullText = lines.map(stripAnsi).join("\n");
	if (width < 96) {
		assertContains(fullText, "“Temporarily disable pi-glance.”", `narrow width ${width} should render inline hint`);
	} else {
		assert.ok(fullText.includes("Temporarily disable"), `standard width ${width} should render hint`);
	}

	for (const line of lines) {
		assert.ok(visibleWidth(line) <= width, `line should fit width ${width}: ${stripAnsi(line)}`);
	}
}

console.log("✓ glance pane render checks passed");
