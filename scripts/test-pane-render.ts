import { strict as assert } from "node:assert";
import { visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { defaultConfig } from "../config.js";
import { showGlancePane } from "../pane.js";
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
	return {
		workspace: { name: "repo", path: "/repo" },
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
		version: 0,
	};
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

function helpIndex(lines: string[]): number {
	const index = lines.findIndex((line) => line.includes("[↑↓] nav"));
	assert.notEqual(index, -1, "help line should be rendered");
	return index;
}

const first = await makePane();
const initial = plainText(first.component);
assertContains(initial, "◌ pi-glance settings", "header should render");
assertContains(initial, "✓ Saved", "initial pane should be clean");
assertContains(initial, "PREVIEW", "preview section should render");
assertContains(initial, "SETTINGS", "settings section should render");
assertContains(initial, "› General", "general category should be selected initially");
assertContains(initial, "● Git", "enabled segment dot should render");
assertContains(initial, "○ Tokens", "disabled segment dot should render");
assertContains(initial, "[Enter/→] edit", "category help should describe entering settings");
assertContains(initial, "[J/K] switch", "category help should describe segment switching");
assertNotContains(initial, "Changes stay local", "empty default status copy should stay removed");
assertNotContains(initial, "NOTES", "old notes section should stay removed");
assertNotContains(initial, "[Tab]", "tab navigation should stay removed");

const contextPane = await makePane();
press(contextPane.component, "\x1b[B");
press(contextPane.component, "\x1b[B");
const contextCategory = plainText(contextPane.component);
assertContains(contextCategory, "CONTEXT SETTINGS", "context category should show context detail settings");
assertContains(contextCategory, "Display  [ percent / tokens ]", "context display setting should render");
assertContains(contextCategory, "Unknown  [ show ]", "context unknown setting should render");

press(contextPane.component, "\x1b[C");
press(contextPane.component, "\x1b[B");
const contextDisplay = plainText(contextPane.component);
assertContains(contextDisplay, "Choose how context usage is shown.", "context display hint should render");
press(contextPane.component, "\r");
const contextDisplayChanged = plainText(contextPane.component);
assertContains(contextDisplayChanged, "Display  [ percent ]", "enter should cycle context display");
press(contextPane.component, "\x1b[B");
press(contextPane.component, "\r");
const contextUnknownChanged = plainText(contextPane.component);
assertContains(contextUnknownChanged, "Unknown  [ hide ]", "enter should cycle context unknown behavior");
assertContains(contextUnknownChanged, "Hide context when usage is unknown.", "context unknown hint should render");

const costPane = await makePane();
press(costPane.component, "\x1b[B");
press(costPane.component, "\x1b[B");
press(costPane.component, "\x1b[B");
const costCategory = plainText(costPane.component);
assertContains(costCategory, "COST SETTINGS", "cost category should show cost detail settings");
assertContains(costCategory, "Hide zero  [ off ]", "cost hide zero setting should render");
assertContains(costCategory, "Display    compact USD", "cost display info should render");

press(costPane.component, "\x1b[C");
press(costPane.component, "\x1b[B");
press(costPane.component, "\r");
const costChanged = plainText(costPane.component);
assertContains(costChanged, "Hide zero  [ on ]", "enter should toggle cost hide zero");
assertContains(costChanged, "Hide cost until usage is greater than zero.", "cost hide zero hint should render");

const tokensPane = await makePane();
press(tokensPane.component, "\x1b[B");
press(tokensPane.component, "\x1b[B");
press(tokensPane.component, "\x1b[B");
press(tokensPane.component, "\x1b[B");
const tokensCategory = plainText(tokensPane.component);
assertContains(tokensCategory, "TOKENS SETTINGS", "tokens category should show tokens detail settings");
assertContains(tokensCategory, "Display  [ input / output ]", "tokens display setting should render");
assertContains(tokensCategory, "Cache    [ auto ]", "tokens cache setting should render");

press(tokensPane.component, "\x1b[C");
press(tokensPane.component, "\x1b[B");
press(tokensPane.component, "\r");
const tokensDisplayChanged = plainText(tokensPane.component);
assertContains(tokensDisplayChanged, "Display  [ total ]", "enter should cycle tokens display");
press(tokensPane.component, "\x1b[B");
press(tokensPane.component, "\r");
const tokensCacheChanged = plainText(tokensPane.component);
assertContains(tokensCacheChanged, "Cache    [ show ]", "enter should cycle tokens cache mode");
assertContains(tokensCacheChanged, "Control cache read/write details.", "tokens cache hint should render");

const modelPane = await makePane();
press(modelPane.component, "\x1b[B");
press(modelPane.component, "\x1b[B");
press(modelPane.component, "\x1b[B");
press(modelPane.component, "\x1b[B");
press(modelPane.component, "\x1b[B");
const modelCategory = plainText(modelPane.component);
assertContains(modelCategory, "MODEL SETTINGS", "model category should show model detail settings");
assertContains(modelCategory, "Provider label  [ auto ]", "model provider setting should render");
assertContains(modelCategory, "Thinking label  [ auto ]", "model thinking setting should render");

press(modelPane.component, "\x1b[C");
press(modelPane.component, "\x1b[B");
press(modelPane.component, "\r");
const providerChanged = plainText(modelPane.component);
assertContains(providerChanged, "Provider label  [ always ]", "enter should cycle provider label");
press(modelPane.component, "\x1b[B");
press(modelPane.component, "\r");
const thinkingChanged = plainText(modelPane.component);
assertContains(thinkingChanged, "Thinking label  [ always ]", "enter should cycle thinking label");
assertContains(thinkingChanged, "Control the model thinking label.", "model thinking hint should render");

const generalHintPane = await makePane();
press(generalHintPane.component, "\x1b[C");
assertContains(plainText(generalHintPane.component), "Disable pi-glance without removing the extension.", "general enabled hint should render");
press(generalHintPane.component, "\x1b[B");
assertContains(plainText(generalHintPane.component), "Switch the input surface palette.", "general theme hint should render");

const gitPane = await makePane();
press(gitPane.component, "\x1b[B");
const gitCategory = plainText(gitPane.component);
assertContains(gitCategory, "GIT SETTINGS", "git category should show git detail settings");
assertContains(gitCategory, "Dirty marker", "git dirty setting should render");
assertContains(gitCategory, "Ahead / behind", "git ahead/behind setting should render");
assertContains(gitCategory, "SHA", "git SHA setting should render");
assertContains(gitCategory, "Polling", "git polling setting should render");

press(gitPane.component, "\x1b[C");
const gitSettings = plainText(gitPane.component);
assertContains(gitSettings, "[Enter] change", "settings help should describe changing values");
assertContains(gitSettings, "[←/Esc] back", "settings help should describe returning to categories");
assertNotContains(gitSettings, "[Enter/→] edit", "category help should be hidden while editing settings");

press(gitPane.component, "\x1b[B");
const dirtyLines = plainRender(gitPane.component);
const dirtyText = dirtyLines.join("\n");
assertContains(dirtyText, "Conflict markers are always shown.", "selected hint should render for dirty marker");
const dirtyHelpIndex = helpIndex(dirtyLines);

press(gitPane.component, "\x1b[B");
const aheadLines = plainRender(gitPane.component);
const aheadText = aheadLines.join("\n");
assertNotContains(aheadText, "Conflict markers are always shown.", "hint should change with the selected setting");
assert.equal(helpIndex(aheadLines), dirtyHelpIndex, "hint row should be reserved even when selected setting has no hint");

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
const afterEnter = plainText(interaction.component);
assertContains(afterEnter, "● Unsaved changes", "enter should change the selected setting and dirty the draft");
assertContains(afterEnter, "Enabled         [ off ]", "enter should toggle the selected setting");

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
assertContains(plainText(backPane.component), "[Enter/→] edit", "left arrow should return from settings to categories");

for (const width of [72, 96, 120, 160]) {
	const widthPane = await makePane();
	const lines = widthPane.component.render(width);
	assert.ok(lines.length > 0, `render should produce lines at width ${width}`);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= width, `line should fit width ${width}: ${stripAnsi(line)}`);
	}
}

console.log("✓ glance pane render checks passed");
