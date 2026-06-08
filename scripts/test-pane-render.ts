import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
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

async function makePane(config: GlanceConfig = defaultConfig(), previewState: GlanceState = makeState()): Promise<{ component: Component; renders: () => number; done: () => unknown }> {
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
		previewState,
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

function assertSourceExcludes(path: string, source: string, snippet: string, message?: string): void {
	assert.equal(source.includes(snippet), false, message ?? `${path} should not contain source snippet ${snippet}`);
}

function lineContainingAll(text: string, fragments: string[]): string | undefined {
	return text.split("\n").find((line) => fragments.every((fragment) => line.includes(fragment)));
}

function assertLineContainsAll(text: string, fragments: string[], message?: string): void {
	assert.ok(lineContainingAll(text, fragments), message ?? `expected one render line to include ${fragments.map((f) => JSON.stringify(f)).join(", ")}`);
}

function themeRowLabel(line: string): string | undefined {
	return [...GLANCE_THEMES]
		.map((theme) => theme.label)
		.sort((a, b) => b.length - a.length)
		.find((label) => line.trimEnd().endsWith(label));
}

function themeListRows(text: string): string[] {
	return text.split("\n").filter((line) => Boolean(themeRowLabel(line)) && !line.includes("Theme · preview") && !line.includes("Selected ·") && !line.includes("saved "));
}

function themeListLabels(text: string): string[] {
	return themeListRows(text).map((line) => {
		const label = themeRowLabel(line);
		assert.ok(label, `expected theme row label in ${JSON.stringify(line)}`);
		return label;
	});
}

function assertThemeMarkerColumns(text: string, message: string): void {
	for (const line of themeListRows(text)) {
		const markerStart = line.search(/[»\s][●\s] [✓\s][↩\s] /);
		assert.notEqual(markerStart, -1, `${message}: marker columns should align in ${JSON.stringify(line)}`);
	}
}

function findLineContaining(text: string, fragment: string): string {
	const line = text.split("\n").find((candidate) => candidate.includes(fragment));
	assert.ok(line, `expected render to include a line with ${JSON.stringify(fragment)}`);
	return line;
}

function findLineIndexContaining(lines: string[], fragment: string): number {
	const index = lines.findIndex((candidate) => candidate.includes(fragment));
	assert.notEqual(index, -1, `expected render to include a line with ${JSON.stringify(fragment)}`);
	return index;
}

function assertNoRawThemeIds(text: string, context: string): void {
	for (const { id } of GLANCE_THEMES) {
		assert.ok(!text.includes(id), `${context} should not show raw theme id ${id}`);
	}
}

function assertThemeRow(text: string, label: string): void {
	const line = text.split("\n").find((candidate) => candidate.includes("Theme") && candidate.includes(label));
	assert.ok(line, `Theme row should show ${label}`);
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

const replySpeedPreviewConfig = defaultConfig();
replySpeedPreviewConfig.segments = replySpeedPreviewConfig.segments.map((segment) =>
	segment.id === "throughput" ? { ...segment, enabled: true } : segment,
);
const replySpeedPreviewPane = await makePane(replySpeedPreviewConfig);
const replySpeedPreviewText = plainText(replySpeedPreviewPane.component, 160);
assertNotContains(replySpeedPreviewText, "spd 42 tok/s", "Reply speed preview should not inject a fake sample speed before measurement");
assertContains(replySpeedPreviewText, "spd ? tok/s", "Reply speed preview should show the same unknown placeholder as runtime when no measurement exists");

const previewTurn = {
	startedAtMs: 0,
	endedAtMs: 1000,
	elapsedMs: 1000,
	tokensPerSecond: 42,
	usage: { input: 0, output: 42, cacheRead: 0, cacheWrite: 0, totalTokens: 42, assistantMessages: 1 },
};
const provisionalPreviewPane = await makePane(
	replySpeedPreviewConfig,
	testState({ throughput: { lastTurn: null, currentRun: previewTurn } as unknown as GlanceState["throughput"] }),
);
assertContains(
	plainText(provisionalPreviewPane.component, 160),
	"spd ~42 tok/s",
	"Reply speed preview should render real previewState.throughput.currentRun as provisional with ~",
);
const finalPreviewPane = await makePane(
	replySpeedPreviewConfig,
	testState({ throughput: { lastTurn: previewTurn, currentRun: null } as unknown as GlanceState["throughput"] }),
);
assertContains(
	plainText(finalPreviewPane.component, 160),
	"spd 42 tok/s",
	"Reply speed preview should render real previewState.throughput.lastTurn as final without ~",
);

const themePane = await makePane();
press(themePane.component, "\x1b[C");
press(themePane.component, "\x1b[B");
press(themePane.component, "\x1b[C");
press(themePane.component, "\r");
const themeBrowserText = plainText(themePane.component, 160);
assertContains(themeBrowserText, "Theme · preview Light", "enter on Theme value should open the calm theme browser");
assertContains(themeBrowserText, "saved Light", "theme browser should show concise saved copy");
assertContains(themeBrowserText, "1/22", "theme browser should show position/count");
assertContains(themeBrowserText, "Selected · Core · default · bright · neutral", "selected detail should show highlighted theme metadata");
assertContains(themeBrowserText, "Bright neutral palette", "selected detail should show highlighted theme description");
assertNotContains(themeBrowserText, "Selected · core", "selected detail should not expose raw group ids");
assertLineContainsAll(themeBrowserText, ["»", "●", "✓", "Light"], "initial browser row should mark the focused saved preview theme");
assertLineContainsAll(themeBrowserText, ["Dark"], "theme browser should render other friendly labels");
assert.equal(themeListRows(themeBrowserText).length, GLANCE_THEMES.length, "theme browser should render all theme labels in catalog order");
assert.deepEqual(themeListLabels(themeBrowserText), GLANCE_THEMES.map((theme) => theme.label), "theme browser list should preserve catalog order");
assert.ok(!lineContainingAll(themeBrowserText, ["Dark", "default"]), "ordinary rows should contain labels only without metadata");
assertNotContains(themeBrowserText, "○", "theme browser should not render hollow markers for non-preview rows");
assertNotContains(themeBrowserText, "\nCore\n", "theme browser should not render group headers");
assertNotContains(themeBrowserText, "\nCatppuccin\n", "theme browser should not render group headers");
assertNotContains(themeBrowserText, "\nAccessible\n", "theme browser should not render group headers");
assertThemeMarkerColumns(themeBrowserText, "initial theme browser");
assertNoRawThemeIds(themeBrowserText, "Theme browser");

press(themePane.component, "\x1b[B");
const previewedThemeBrowserText = plainText(themePane.component, 160);
assertLineContainsAll(previewedThemeBrowserText, ["»", "●", "Dark"], "moving highlight should preview and focus Dark");
assertLineContainsAll(previewedThemeBrowserText, ["✓", "Light"], "pre-browser saved marker should remain on Light while previewing Dark");
assertContains(previewedThemeBrowserText, "● Unsaved changes", "previewing a different theme should dirty the pane");
assertContains(previewedThemeBrowserText, "Theme · preview Dark", "preview movement should show the friendly preview label");
assertContains(previewedThemeBrowserText, "Selected · Core · default · neutral", "selected detail should update with catalog-sourced raw id suppression");
assertContains(previewedThemeBrowserText, "Neutral dim palette for dim terminals.", "selected detail should update with catalog-sourced friendly description copy");
assertNotContains(previewedThemeBrowserText, "Selected · Core · default · dark · neutral", "selected detail should suppress the selected raw theme id tag");
assertNotContains(previewedThemeBrowserText, "Theme → Dark. Press S to save.", "preview movement should not accept the theme yet");
assertNotContains(previewedThemeBrowserText, "○", "previewed browser should not render hollow markers");
assertNoRawThemeIds(previewedThemeBrowserText, "Previewed theme browser");

const lowerWindowPane = await makePane();
press(lowerWindowPane.component, "\x1b[C");
press(lowerWindowPane.component, "\x1b[B");
press(lowerWindowPane.component, "\x1b[C");
press(lowerWindowPane.component, "\r");
for (let i = 0; i < 20; i++) press(lowerWindowPane.component, "\x1b[B");
const lowerWindowText = plainText(lowerWindowPane.component, 160);
assertContains(lowerWindowText, "21/22", "moving near lower themes should update position/count");
assertContains(lowerWindowText, "High Contrast Dark", "full list should render the highlighted lower theme");
assertContains(lowerWindowText, "Light", "full list should keep the first theme visible when far down the catalog");
assertContains(lowerWindowText, "Selected · Accessible", "selected detail should use display group labels for lower themes");
assertContains(lowerWindowText, "High-contrast palette", "selected detail should update for lower themes");
assertNotContains(lowerWindowText, "Selected · accessibility", "lower theme detail should not expose raw group ids");
assert.equal(themeListRows(lowerWindowText).length, GLANCE_THEMES.length, "lower browser should still render the full ungrouped list");
assertThemeMarkerColumns(lowerWindowText, "lower theme browser");
assertNoRawThemeIds(lowerWindowText, "Lower theme browser");

const activeBrowserSavePane = await makePane();
press(activeBrowserSavePane.component, "\x1b[C");
press(activeBrowserSavePane.component, "\x1b[B");
press(activeBrowserSavePane.component, "\x1b[C");
press(activeBrowserSavePane.component, "\r");
press(activeBrowserSavePane.component, "\x1b[B");
press(activeBrowserSavePane.component, "s");
const activeBrowserSaveResult = activeBrowserSavePane.done();
assert.deepEqual((activeBrowserSaveResult as { action?: string; config?: GlanceConfig }).action, "save", "S should save directly from an active theme browser preview");
assert.equal((activeBrowserSaveResult as { config: GlanceConfig }).config.theme, "dark", "active browser save should include the previewed draft theme");

const activeBrowserCancelPane = await makePane();
press(activeBrowserCancelPane.component, "\x1b[C");
press(activeBrowserCancelPane.component, "\x1b[B");
press(activeBrowserCancelPane.component, "\x1b[C");
press(activeBrowserCancelPane.component, "\r");
press(activeBrowserCancelPane.component, "\x1b[B");
press(activeBrowserCancelPane.component, "\x03");
assert.deepEqual((activeBrowserCancelPane.done() as { action?: string }).action, "cancel", "Ctrl-C should cancel from an active theme browser preview");

const dirtyBeforeBrowserPane = await makePane();
press(dirtyBeforeBrowserPane.component, "\x1b[C");
press(dirtyBeforeBrowserPane.component, "\x1b[B");
press(dirtyBeforeBrowserPane.component, "\x1b[C");
press(dirtyBeforeBrowserPane.component, "\r");
press(dirtyBeforeBrowserPane.component, "\x1b[B");
press(dirtyBeforeBrowserPane.component, "\r");
press(dirtyBeforeBrowserPane.component, "\r");
const dirtyBeforeBrowserText = plainText(dirtyBeforeBrowserPane.component, 160);
assertContains(dirtyBeforeBrowserText, "Theme · preview Dark", "dirty draft Theme row should reopen the browser");
assertContains(dirtyBeforeBrowserText, "saved Light", "browser saved copy should name the actual initial theme");
assertContains(dirtyBeforeBrowserText, "Esc returns Dark", "browser restore copy should name the pre-browser draft theme separately");
assertNotContains(dirtyBeforeBrowserText, "saved Dark", "browser should not label the pre-browser draft theme as saved");
assertLineContainsAll(dirtyBeforeBrowserText, ["✓", "Light"], "saved marker should remain on the initial theme when browser opens from a dirty draft");
assertLineContainsAll(dirtyBeforeBrowserText, ["↩", "●", "Dark"], "restore/preview marker should be on the pre-browser draft theme");
assertNotContains(dirtyBeforeBrowserText, "○", "dirty browser should not render hollow markers");
press(dirtyBeforeBrowserPane.component, "\x1b[B");
const dirtyBeforeBrowserPreviewText = plainText(dirtyBeforeBrowserPane.component, 160);
assertLineContainsAll(dirtyBeforeBrowserPreviewText, ["✓", "Light"], "saved marker should remain on initial theme while preview changes from dirty draft");
assertLineContainsAll(dirtyBeforeBrowserPreviewText, ["↩", "Dark"], "restore marker should remain on pre-browser draft while preview changes");
assertLineContainsAll(dirtyBeforeBrowserPreviewText, ["»", "●", "Catppuccin Latte"], "preview marker should move independently from restore and saved markers");
assertContains(dirtyBeforeBrowserPreviewText, "Selected · Catppuccin", "dirty browser selected detail should update after preview movement");
assertNotContains(dirtyBeforeBrowserPreviewText, "saved Dark", "preview movement should not create misleading saved draft copy");
assertNotContains(dirtyBeforeBrowserPreviewText, "○", "dirty preview browser should not render hollow markers");
press(dirtyBeforeBrowserPane.component, "\x1b[D");
const dirtyBeforeBrowserRestoredText = plainText(dirtyBeforeBrowserPane.component, 160);
assertThemeRow(dirtyBeforeBrowserRestoredText, "Dark");
assertContains(dirtyBeforeBrowserRestoredText, "● Unsaved changes", "Left restore should return to the dirty pre-browser draft, not the saved theme");

press(themePane.component, "\r");
const acceptedThemeText = plainText(themePane.component, 160);
assertContains(acceptedThemeText, "Theme → Dark. Press S to save.", "enter in the browser should accept the highlighted theme");
assertNotContains(acceptedThemeText, "Choose a palette", "accepted browser should return to normal settings");
assertThemeRow(acceptedThemeText, "Dark");
press(themePane.component, "s");
const themeSaveResult = themePane.done();
assert.deepEqual((themeSaveResult as { action?: string; config?: GlanceConfig }).action, "save", "S should save accepted browser theme through existing path");
assert.equal((themeSaveResult as { config: GlanceConfig }).config.theme, "dark", "saved browser config should include the accepted theme");

const restoreBrowserPane = await makePane();
press(restoreBrowserPane.component, "\x1b[C");
press(restoreBrowserPane.component, "\x1b[B");
press(restoreBrowserPane.component, "\x1b[C");
press(restoreBrowserPane.component, "\r");
press(restoreBrowserPane.component, "\x1b[B");
press(restoreBrowserPane.component, "\x1b[D");
const leftRestoredText = plainText(restoreBrowserPane.component, 160);
assertContains(leftRestoredText, "Theme preview discarded.", "left in the browser should restore and return");
assertNotContains(leftRestoredText, "Choose a palette", "left restore should return to normal settings");
assertContains(leftRestoredText, "✓ Saved", "left restore should clear preview-only dirty state");
assertThemeRow(leftRestoredText, "Light");

const escRestoreBrowserPane = await makePane();
press(escRestoreBrowserPane.component, "\x1b[C");
press(escRestoreBrowserPane.component, "\x1b[B");
press(escRestoreBrowserPane.component, "\x1b[C");
press(escRestoreBrowserPane.component, "\r");
press(escRestoreBrowserPane.component, "\x1b[B");
press(escRestoreBrowserPane.component, "\x1b");
const escRestoredText = plainText(escRestoreBrowserPane.component, 160);
assertContains(escRestoredText, "Theme preview discarded.", "Esc in the browser should restore and return");
assertThemeRow(escRestoredText, "Light");

for (const width of [56, 64, 80, 120, 160]) {
	const widthThemePane = await makePane();
	press(widthThemePane.component, "\x1b[C");
	press(widthThemePane.component, "\x1b[B");
	press(widthThemePane.component, "\x1b[C");
	press(widthThemePane.component, "\r");
	const widthLines = plainRender(widthThemePane.component, width);
	assertContains(widthLines.join("\n"), "Theme · preview", `theme browser should render at width ${width}`);
	assertContains(widthLines.join("\n"), "Light", `theme browser should keep labels at width ${width}`);
	assertContains(widthLines.join("\n"), "Selected", `theme browser should keep selected detail at width ${width}`);
	assertNotContains(widthLines.join("\n"), "○", `theme browser should not render hollow markers at width ${width}`);
	if (width >= 120) {
		assert.equal(themeListRows(widthLines.join("\n")).length, GLANCE_THEMES.length, `theme browser should render all labels at width ${width}`);
	}
	for (const line of widthLines) {
		assert.ok(visibleWidth(line) <= width, `theme browser line should fit width ${width}: ${stripAnsi(line)}`);
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
const iconsSelectedText = plainText(gridSettingPane.component);
assertContains(iconsSelectedText, "» Icons", "down arrow should move within the setting column");
assertContains(iconsSelectedText, "Nerd icons need", "Icons row hint should mention Nerd Font fallback guidance");
press(gridSettingPane.component, "\x1b[D");
assertContains(plainText(gridSettingPane.component), "» Cost", "left arrow should move to the category on the same visual row");

const reorderPane = await makePane();
press(reorderPane.component, "\x1b[B");
press(reorderPane.component, "j");
const reorderedLines = plainRender(reorderPane.component);
assertContains(reorderedLines.join("\n"), "Segment order updated. Press S to save.", "J should reorder a segment in the category column");
assertContains(reorderedLines.join("\n"), "● Unsaved changes", "segment reorder should dirty the draft");
assert.ok(
	findLineIndexContaining(reorderedLines, "  Cost") < findLineIndexContaining(reorderedLines, "» Git"),
	"J should move Git below Cost",
);
press(reorderPane.component, "k");
const restoredOrderLines = plainRender(reorderPane.component);
assert.ok(
	findLineIndexContaining(restoredOrderLines, "» Git") < findLineIndexContaining(restoredOrderLines, "  Cost"),
	"K should move Git back above Cost",
);

const settingsJPane = await makePane();
press(settingsJPane.component, "\x1b[B");
press(settingsJPane.component, "\x1b[C");
const beforeSettingsJ = plainText(settingsJPane.component);
const beforeSettingsJRenders = settingsJPane.renders();
press(settingsJPane.component, "j");
assert.equal(plainText(settingsJPane.component), beforeSettingsJ, "J should not reorder outside the category column");
assert.equal(settingsJPane.renders(), beforeSettingsJRenders, "J outside the category column should not request a render");

const contextPane = await makePane();
press(contextPane.component, "\x1b[B");
press(contextPane.component, "\x1b[B");
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

const costInfoPane = await makePane();
press(costInfoPane.component, "\x1b[B");
press(costInfoPane.component, "\x1b[B");
press(costInfoPane.component, "\x1b[C");
press(costInfoPane.component, "\x1b[C");
press(costInfoPane.component, "\r");
const costInfoLines = plainRender(costInfoPane.component);
assertContains(costInfoLines[0] ?? "", "Compact session cost.", "info row enter should show its hint as status");
assertContains(costInfoLines.join("\n"), "✓ Saved", "info row enter should not dirty the draft");
assertNotContains(costInfoLines.join("\n"), "● Unsaved changes", "info row enter should not create unsaved changes");

const tokensPane = await makePane();
press(tokensPane.component, "\x1b[B");
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
const topSpacing = plainText(generalHintPane.component);
assertLineContainsAll(topSpacing, ["Top spacing", "1 row"], "top spacing setting should render");
assertContains(topSpacing, "Set breathing room above the editor.", "top spacing hint should render");
press(generalHintPane.component, "\r");
assertLineContainsAll(plainText(generalHintPane.component), ["Top spacing", "1 row"], "enter should not cycle top spacing before value column");
press(generalHintPane.component, "\x1b[C");
press(generalHintPane.component, "\r");
assertLineContainsAll(plainText(generalHintPane.component), ["Top spacing", "2 rows"], "enter should cycle top spacing in value column");
press(generalHintPane.component, "\x1b[D");
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

const gitEnabledPane = await makePane();
press(gitEnabledPane.component, "\x1b[B");
press(gitEnabledPane.component, "\x1b[C");
press(gitEnabledPane.component, "\x1b[A");
press(gitEnabledPane.component, "\x1b[C");
press(gitEnabledPane.component, "\r");
const gitEnabledChanged = plainText(gitEnabledPane.component);
assertLineContainsAll(gitEnabledChanged, ["Enabled", "off"], "enter should toggle a segment enabled row from the catalog");
assertContains(gitEnabledChanged, "Enabled → off. Press S to save.", "segment enabled status should use the updated friendly value");

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

const paneSource = await readFile("pane.ts", "utf8");
assertSourceExcludes("pane.ts", paneSource, "displayThemeGroup", "pane.ts should not own Theme browser group labels");
assertSourceExcludes("pane.ts", paneSource, "displayThemeDetailText", "pane.ts should not own Theme browser detail text rewrites");
assertSourceExcludes("pane.ts", paneSource, "displayThemeTags", "pane.ts should not own Theme browser detail tag rewrites");
assertSourceExcludes("pane.ts", paneSource, "case \"core\":", "pane.ts should not own Theme browser group mapping switch logic");
assertSourceExcludes("pane.ts", paneSource, "low-light", "pane.ts should not own Theme browser friendly detail rewrites");

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
