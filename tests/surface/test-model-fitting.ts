import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { renderGlanceLine } from "../../src/surface/status-line.js";
import { GlanceEditor } from "../../src/surface/editor.js";
import { stripAnsi } from "../support/surface-test-harness.js";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { renderInputSurface } from "../../src/surface/renderer.js";
import { stripControls } from "../../src/surface/format.js";
import { testState } from "../support/helpers.js";

function reportedState() {
	return testState({
		workspace: { name: "07_pi-glance", path: "/work/00_project/07_pi-glance" },
		git: { ...testState().git, repo: true, branch: "main", status: "dirty", dirty: true, unstaged: 1, ahead: 1 },
		providers: { availableCount: 2 },
		model: { id: "team-gpt-6-astra", displayName: "team-gpt-6-astra", provider: "TEAM", thinking: "xhigh" },
		context: { tokens: 163_200, window: 680_000, percent: 24 },
		usage: { input: 1_000_000, output: 1_700_000, cacheRead: 24_000_000, cacheWrite: 0, cost: 414.1 },
		throughput: { currentRun: null, lastRun: {
			startedAtMs: 0, endedAtMs: 1000, elapsedMs: 1000, tokensPerSecond: 43,
			usage: { input: 0, output: 43, cacheRead: 0, cacheWrite: 0, totalTokens: 43, assistantMessages: 1 },
		} },
	});
}

test("half-screen keeps the full model identity but folds automatic provider and thinking details", () => {
	const config = defaultConfig();
	const state = reportedState();
	state.context.percent = 30;
	state.throughput.lastRun = null;
	const raw = renderInputSurface(state, config, 120)[config.editor.topMarginRows]!;
	const text = stripControls(raw);
	assert.ok(text.includes("?/s") && text.includes("30%"), text);
	assert.ok(text.includes("󰚩"), text);
	assert.equal(text.includes("TEAM/"), false);
	assert.ok(text.includes("󰚩 team-gpt-6-astra"), text);
	assert.equal(text.includes("xhigh"), false);
	assert.equal(text.includes("↑1"), false);
	assert.ok(visibleWidth(raw) <= 120);
});

test("shared density chooses full details, full model identity, then core identity", () => {
	const config = defaultConfig();
	config.segments = [{ id: "model", enabled: true }];
	const state = reportedState();
	const render = (widthMode: "full" | "compact" | "minimal") => stripControls(renderGlanceLine(state, config, 180, 2, { widthMode }));
	assert.equal(render("full"), "󰚩 TEAM/team-gpt-6-astra xhigh");
	assert.equal(render("compact"), "󰚩 team-gpt-6-astra");
	assert.equal(render("minimal"), "󰚩 gpt-6-astra");
	assert.equal(render("full"), "󰚩 TEAM/team-gpt-6-astra xhigh");
	for (const [width, expected] of [[96, "󰚩 TEAM/team-gpt-6-astra xhigh"], [95, "󰚩 team-gpt-6-astra"], [64, "󰚩 team-gpt-6-astra"], [63, "󰚩 gpt-6-astra"]] as const) {
		assert.equal(stripControls(renderGlanceLine(state, config, width)), expected, `${width} status columns`);
	}
	state.model.displayName = "GPT 5.5";
	assert.equal(render("compact"), "󰚩 GPT 5.5");
	assert.equal(render("minimal"), "󰚩 GPT 5.5");
});

test("reported six-segment frame shortens the model before removing it on a narrow screen", () => {
	const config = defaultConfig();
	const state = reportedState();
	const wide = stripControls(renderInputSurface(state, config, 180)[config.editor.topMarginRows]!);
	assert.ok(wide.includes("team-gpt-6-astra xhigh"), wide);
	const narrow = renderInputSurface(state, config, 82)[config.editor.topMarginRows]!;
	const text = stripControls(narrow);
	assert.ok(text.includes("󰚩 gpt-6-astra"), "use the fourth tier before removing Model: " + text);
	assert.equal(text.includes("…stra"), false, "the complete core name still fits");
	assert.equal(text.includes("xhigh"), false, "automatic thinking detail should fold before the name");
	assert.ok(text.includes("main ●") && text.includes("$414.1") && text.includes("43/s") && text.includes("24%") && text.includes("96%"), text);
	assert.ok(visibleWidth(narrow) <= 82);
});

test("model fitting follows provider, thinking, and matching namespace tiers before ellipsis", () => {
	const config = defaultConfig();
	config.segments = [{ id: "model", enabled: true }];
	const state = reportedState();
	const render = (width: number) => stripControls(renderGlanceLine(state, config, width, 2, { widthMode: "full" }));
	assert.equal(render(60), "󰚩 TEAM/team-gpt-6-astra xhigh");
	assert.equal(render(24), "󰚩 team-gpt-6-astra xhigh");
	assert.equal(render(20), "󰚩 team-gpt-6-astra");
	assert.equal(render(14), "󰚩 gpt-6-astra");
	assert.equal(render(60), "󰚩 TEAM/team-gpt-6-astra xhigh", "growing restores the original label");
});

test("explicit custom model aliases are not namespace-shortened", () => {
	const config = defaultConfig();
	config.segments = [{ id: "model", enabled: true }];
	config.model.customNames = { "team-gpt": "team-gpt-6-astra" };
	const text = stripControls(renderGlanceLine(reportedState(), config, 14, 2, { widthMode: "full" }));
	assert.equal(text, "󰚩 team-g…astra", "an explicit alias is not a provider namespace even when its spelling matches");
	assert.equal(stripControls(renderGlanceLine(reportedState(), config, 180, 2, { widthMode: "minimal" })), "󰚩 team-gpt-6-astra", "minimal density also preserves custom aliases");
});

test("always labels remain attached to the shortened name; never labels do not reappear", () => {
	const config = defaultConfig();
	config.segments = [{ id: "model", enabled: true }];
	config.display.showProvider = "always";
	config.model.showThinking = "always";
	const text = stripControls(renderGlanceLine(reportedState(), config, 25));
	assert.equal(text, "󰚩 TEAM/gpt-6-astra xhigh");
	assert.ok(visibleWidth(text) <= 25);
	assert.equal(stripControls(renderGlanceLine(reportedState(), config, 180, 2, { widthMode: "compact" })), "󰚩 TEAM/team-gpt-6-astra xhigh");
	assert.equal(stripControls(renderGlanceLine(reportedState(), config, 180, 2, { widthMode: "minimal" })), "󰚩 TEAM/gpt-6-astra xhigh");
	config.display.showProvider = "never";
	config.model.showThinking = "never";
	assert.equal(stripControls(renderGlanceLine(reportedState(), config, 120)), "󰚩 team-gpt-6-astra");
});

test("reordered segments retain user priority and extremely narrow budgets stay safe", () => {
	const config = defaultConfig();
	config.segments = [{ id: "model", enabled: true }, { id: "cost", enabled: true }];
	const state = reportedState();
	const before = structuredClone({ state, config });
	assert.equal(stripControls(renderGlanceLine(state, config, 20)), "󰚩 gpt-6-astra", "drop later Cost rather than shortening the earlier minimal Model label to make room for it");
	for (const width of [0, 1, 2, 3, 6, 9, 15, 24, 80]) {
		assert.ok(visibleWidth(renderGlanceLine(state, config, width)) <= width);
	}
	assert.deepEqual({ state, config }, before, "fitting must not mutate saved names or config");
	config.segments[0]!.enabled = false;
	assert.equal(stripControls(renderGlanceLine(state, config, 80)), "󰈸 $414.1");
});

test("namespace removal is case-insensitive, leading-only, and provider-specific", () => {
	const config = defaultConfig();
	config.segments = [{ id: "model", enabled: true }];
	config.display.showProvider = "never";
	config.model.showThinking = "never";
	for (const [name, provider, expected] of [
		["team-gpt-6-astra", "TEAM", "gpt-6-astra"],
		["TeAm-gpt-6-astra", "team", "gpt-6-astra"],
		["pro-gpt-6-astra", "TEAM", "pro-gp…astra"],
		["mini-gpt-6-astra", "TEAM", "mini-g…astra"],
		["steam-gpt-6-astra", "TEAM", "steam-…astra"],
		["x-team-gpt-6-astra", "TEAM", "x-team…astra"],
		["team-", "TEAM", "team-"],
		["team-gpt-6-astra", undefined, "team-g…astra"],
	] as const) {
		const state = reportedState();
		state.model = { id: name, displayName: name, provider, thinking: "xhigh" };
		assert.equal(stripControls(renderGlanceLine(state, config, 14)), `󰚩 ${expected}`, `${provider}/${name}`);
	}
});

test("ellipsis is only an emergency fallback after the fourth tier cannot fit", () => {
	const config = defaultConfig();
	config.segments = [{ id: "model", enabled: true }];
	for (const width of [13, 14, 15, 16, 17]) {
		assert.equal(stripControls(renderGlanceLine(reportedState(), config, width)), "󰚩 gpt-6-astra");
	}
	const raw = renderGlanceLine(reportedState(), config, 12);
	assert.ok(stripControls(raw).includes("…"));
	assert.ok(visibleWidth(raw) <= 12);
});

test("Unicode names keep whole graphemes and both ends in RGB and ANSI256", () => {
	const state = reportedState();
	state.model.displayName = "团队👩🏽‍💻-自定义-e\u0301-长模型名字-尾部";
	for (const icons of ["plain", "nerd"] as const) for (const trueColor of [true, false]) {
		const config = defaultConfig();
		config.icons = icons;
		config.segments = [{ id: "model", enabled: true }];
		for (let width = 12; width <= 28; width++) {
			const raw = renderGlanceLine(state, config, width, 2, { trueColor });
			const text = stripControls(raw);
			assert.ok(visibleWidth(raw) <= width, `${width}: ${text}`);
			assert.ok(text.includes("团队") && text.endsWith("尾部"), text);
			if (text.includes("👩")) assert.ok(text.includes("👩🏽‍💻"), "emoji must not split");
			if (text.includes("e")) assert.ok(text.includes("e\u0301"), "combining accent must not split");
			if (!trueColor) assert.equal(raw.includes("\x1b[38;2;"), false);
		}
	}
});

test("live editor and settings preview agree when resizing down and back up", () => {
	const config = defaultConfig(), state = reportedState();
	const identity = (text: string) => text;
	const theme: EditorTheme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
	const editor = new GlanceEditor(
		{ terminal: { rows: 24 }, requestRender() {} } as unknown as TUI,
		theme, { matches: () => false } as unknown as KeybindingsManager, () => state, () => config,
	);
	editor.focused = true;
	editor.setText("keep my input 中文🙂");
	for (const width of [180, 140, 120, 100, 90, 84, 80, 76, 72, 60, 40, 80, 120, 140, 180]) {
		const preview = renderInputSurface(state, config, width)[config.editor.topMarginRows]!;
		assert.equal(stripAnsi(editor.render(width)[config.editor.topMarginRows]!), stripAnsi(preview));
		assert.equal(editor.getText(), "keep my input 中文🙂");
		assert.ok(visibleWidth(preview) <= width);
	}
});
