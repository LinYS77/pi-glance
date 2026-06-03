import { strict as assert } from "node:assert";
import { visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../config.js";
import { GlanceEditor } from "../editor.js";
import { renderInputSurface } from "../renderer.js";
import { testState } from "./helpers.js";
import type { GlanceConfig, GlanceState, SegmentId } from "../types.js";

const ANSI_PATTERN = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|_[^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])/g;
const WIDTHS = [56, 64, 72, 96, 120, 160];

const theme = {
	borderColor: (text: string) => text,
	selectList: {},
} as unknown as EditorTheme;

const keybindings = {
	matches: () => false,
} as unknown as KeybindingsManager;

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}

function onlySegments(config: GlanceConfig, ids: SegmentId[]): void {
	const enabled = new Set(ids);
	config.segments = config.segments.map((segment) => ({ ...segment, enabled: enabled.has(segment.id) }));
}

function dirtyState(): GlanceState {
	return testState({
		workspace: { name: "07_pi-glance", path: "/Users/winnie/00_project/07_pi-glance" },
		git: {
			repo: true,
			branch: "main",
			detached: false,
			sha: "a1b2c3d",
			upstream: "origin/main",
			ahead: 2,
			behind: 1,
			staged: 1,
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

function cleanGitState(): GlanceState {
	return testState({
		workspace: { name: "repo", path: "/repo" },
		git: {
			repo: true,
			branch: "main",
			detached: false,
			sha: "a1b2c3d",
			upstream: "origin/main",
			ahead: 0,
			behind: 0,
			staged: 0,
			unstaged: 0,
			untracked: 0,
			conflicts: 0,
			dirty: false,
			status: "clean",
			updatedAt: 0,
		},
	});
}

function noGitState(): GlanceState {
	return testState({
		workspace: { name: "repo", path: "/repo" },
		git: {
			repo: false,
			branch: null,
			detached: false,
			sha: null,
			upstream: null,
			ahead: 0,
			behind: 0,
			staged: 0,
			unstaged: 0,
			untracked: 0,
			conflicts: 0,
			dirty: false,
			status: "unknown",
			updatedAt: 0,
		},
	});
}

function makeLiveEditor(state: GlanceState, config: GlanceConfig, focused: boolean, rows = 40): GlanceEditor {
	const editor = new GlanceEditor(
		{ terminal: { rows }, requestRender: () => undefined } as unknown as TUI,
		theme,
		keybindings,
		() => state,
		() => config,
	);
	editor.focused = focused;
	return editor;
}

function liveTop(state: GlanceState, config: GlanceConfig, width: number, focused: boolean): string {
	const editor = makeLiveEditor(state, config, focused);
	editor.setText("Ask pi to improve the input surface...");
	return stripAnsi(editor.render(width)[0] ?? "");
}

function liveFrame(state: GlanceState, config: GlanceConfig, width: number, focused: boolean, text: string): string[] {
	const editor = makeLiveEditor(state, config, focused);
	editor.setText(text);
	return editor.render(width).map(stripAnsi);
}

function liveBottom(state: GlanceState, config: GlanceConfig, width: number, focused: boolean): string {
	return liveFrame(state, config, width, focused, "Ask pi to improve the input surface...").at(-1) ?? "";
}

function liveScrolledBottom(state: GlanceState, config: GlanceConfig, width: number, focused: boolean): string {
	const editor = makeLiveEditor(state, config, focused, 10);
	editor.setText(Array.from({ length: 12 }, (_, index) => `line${index + 1}`).join("\n"));
	for (let i = 0; i < 20; i++) editor.handleInput("\x1b[A");
	return stripAnsi(editor.render(width).at(-1) ?? "");
}

function previewFrame(state: GlanceState, config: GlanceConfig, width: number, contentLines: string[], focused: boolean): string[] {
	return renderInputSurface(state, config, width, { contentLines, focused }).map(stripAnsi);
}

function previewTop(state: GlanceState, config: GlanceConfig, width: number): string {
	return previewFrame(state, config, width, ["Ask pi to improve the input surface..."], true)[0] ?? "";
}

function previewBottom(state: GlanceState, config: GlanceConfig, width: number): string {
	return previewFrame(state, config, width, ["Ask pi to improve the input surface..."], true).at(-1) ?? "";
}

interface Scenario {
	name: string;
	state: GlanceState;
	configure?: (config: GlanceConfig) => void;
}

const scenarios: Scenario[] = [
	{
		name: "default dirty plain provider2 long model",
		state: dirtyState(),
	},
	{
		name: "clean git branch-only quiet status",
		state: cleanGitState(),
		configure: (config) => onlySegments(config, ["git"]),
	},
	{
		name: "no git repo hidden empty status",
		state: noGitState(),
		configure: (config) => onlySegments(config, ["git"]),
	},
	{
		name: "workspace label smart",
		state: dirtyState(),
		configure: (config) => {
			config.display.workspaceLabel = "smart";
		},
	},
	{
		name: "workspace label path",
		state: dirtyState(),
		configure: (config) => {
			config.display.workspaceLabel = "path";
		},
	},
	{
		name: "nerd icons",
		state: dirtyState(),
		configure: (config) => {
			config.icons = "nerd";
		},
	},
];

for (const scenario of scenarios) {
	for (const width of WIDTHS) {
		const config = defaultConfig();
		scenario.configure?.(config);
		const expectedTop = previewTop(scenario.state, config, width);
		const expectedBottom = previewBottom(scenario.state, config, width);
		assert.ok(visibleWidth(expectedTop) <= width, `${scenario.name} preview top should fit width ${width}`);
		assert.ok(visibleWidth(expectedBottom) <= width, `${scenario.name} preview bottom should fit width ${width}`);
		for (const focused of [true, false]) {
			const actualTop = liveTop(scenario.state, config, width, focused);
			assert.equal(
				actualTop,
				expectedTop,
				`${scenario.name} live top should match preview at width ${width} when ${focused ? "focused" : "unfocused"}`,
			);
			assert.ok(visibleWidth(actualTop) <= width, `${scenario.name} live top should fit width ${width}`);

			const actualBottom = liveBottom(scenario.state, config, width, focused);
			assert.equal(
				actualBottom,
				expectedBottom,
				`${scenario.name} live bottom should match preview at width ${width} when ${focused ? "focused" : "unfocused"}`,
			);
			assert.ok(visibleWidth(actualBottom) <= width, `${scenario.name} live bottom should fit width ${width}`);
		}
	}
}

for (const width of WIDTHS) {
	const config = defaultConfig();
	const scrolledBottom = liveScrolledBottom(dirtyState(), config, width, true);
	assert.ok(scrolledBottom.includes("↓"), `live bottom should show a down scroll indicator at width ${width}`);
	assert.ok(scrolledBottom.includes("more"), `live bottom should include scroll count copy at width ${width}`);
	assert.ok(visibleWidth(scrolledBottom) <= width, `live scrolled bottom should fit width ${width}`);
}

for (const minContentRows of [2, 3, 4]) {
	for (const width of WIDTHS) {
		const config = defaultConfig();
		config.editor.minContentRows = minContentRows;
		const shortText = "short row";
		const longText = "Ask pi to improve the input surface with a long prompt that must be clipped by the row planner";
		const contentLines = [longText, shortText];
		const expectedPreviewLines = Math.max(minContentRows, contentLines.length) + 2;
		const previewFocused = previewFrame(dirtyState(), config, width, contentLines, true);
		const previewUnfocused = previewFrame(dirtyState(), config, width, contentLines, false);
		const liveShort = liveFrame(dirtyState(), config, width, true, shortText);
		const liveLong = liveFrame(dirtyState(), config, width, true, `${longText}\n${shortText}`);

		assert.equal(previewFocused.length, expectedPreviewLines, `focused preview frame line count honors minRows ${minContentRows}`);
		assert.equal(previewUnfocused.length, expectedPreviewLines, `unfocused preview frame line count honors minRows ${minContentRows}`);
		assert.equal(liveShort.length, minContentRows + 2, `short live frame line count honors minRows ${minContentRows}`);
		assert.ok(liveLong.length >= minContentRows + 2, `long live frame keeps at least minRows ${minContentRows}`);
		assert.ok(previewFocused[1]?.includes("› "), `focused preview first row keeps dim prefix at width ${width}`);
		assert.ok(!(previewUnfocused[1] ?? "").includes("› "), `unfocused preview first row omits focus prefix at width ${width}`);
		assert.ok(previewUnfocused[1]?.startsWith("│  "), `unfocused preview first row keeps two-column plain prefix at width ${width}`);
		assert.ok(liveShort[1]?.startsWith("│ "), `live row keeps left content padding at width ${width}`);
		assert.ok(liveShort[1]?.endsWith(" │"), `live row keeps right content padding at width ${width}`);
		for (const [label, frame] of [
			["preview focused", previewFocused],
			["preview unfocused", previewUnfocused],
			["live short", liveShort],
			["live long", liveLong],
		] as const) {
			for (const line of frame) {
				assert.ok(visibleWidth(line) <= width, `${label} line should fit width ${width}: ${line}`);
			}
		}
	}
}

console.log("✓ surface preview/live frame parity checks passed");
