import { strict as assert } from "node:assert";
import { visibleWidth, type AutocompleteItem, type AutocompleteProvider, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
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
	selectList: {
		selectedPrefix: (text: string) => text,
		selectedText: (text: string) => text,
		description: (text: string) => text,
		scrollInfo: (text: string) => text,
		noMatch: (text: string) => text,
	},
} as unknown as EditorTheme;

function keybindingsWith(matches: Partial<Record<string, string[]>> = {}): KeybindingsManager {
	return {
		matches: (data: string, action: string) => matches[action]?.includes(data) ?? false,
	} as unknown as KeybindingsManager;
}

const keybindings = keybindingsWith();

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

function makeLiveEditor(state: GlanceState, config: GlanceConfig, focused: boolean, rows = 40, bindings = keybindings): GlanceEditor {
	const editor = new GlanceEditor(
		{ terminal: { rows }, requestRender: () => undefined } as unknown as TUI,
		theme,
		bindings,
		() => state,
		() => config,
	);
	editor.focused = focused;
	return editor;
}

function topBorderIndex(lines: readonly string[]): number {
	return lines.findIndex((line) => line.startsWith("╭"));
}

function findTopBorder(lines: readonly string[]): string {
	return lines[topBorderIndex(lines)] ?? "";
}

function assertTopMargin(frame: readonly string[], rows: number, label: string, width: number): void {
	assert.equal(topBorderIndex(frame), rows, `${label} top border follows ${rows} margin rows at width ${width}`);
	for (let i = 0; i < rows; i++) {
		assert.equal(frame[i], " ", `${label} margin row ${i} is the shared top margin at width ${width}`);
		assert.equal(frame[i]?.trim(), "", `${label} margin row ${i} is blank after trim at width ${width}`);
		assert.ok(visibleWidth(frame[i] ?? "") <= width, `${label} margin row ${i} fits width ${width}`);
	}
}

function liveTop(state: GlanceState, config: GlanceConfig, width: number, focused: boolean): string {
	const editor = makeLiveEditor(state, config, focused);
	editor.setText("Ask pi to improve the input surface...");
	return findTopBorder(editor.render(width).map(stripAnsi));
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
	return findTopBorder(previewFrame(state, config, width, ["Ask pi to improve the input surface..."], true));
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
		const preview = previewFrame(scenario.state, config, width, ["Ask pi to improve the input surface..."], true);
		assertTopMargin(preview, config.editor.topMarginRows, `${scenario.name} preview`, width);
		const expectedTop = findTopBorder(preview);
		const expectedBottom = previewBottom(scenario.state, config, width);
		assert.ok(expectedTop.startsWith("╭"), `${scenario.name} preview top border should follow the margin at width ${width}`);
		assert.ok(visibleWidth(expectedTop) <= width, `${scenario.name} preview top should fit width ${width}`);
		assert.ok(visibleWidth(expectedBottom) <= width, `${scenario.name} preview bottom should fit width ${width}`);
		for (const focused of [true, false]) {
			const live = liveFrame(scenario.state, config, width, focused, "Ask pi to improve the input surface...");
			assertTopMargin(live, config.editor.topMarginRows, `${scenario.name} live ${focused ? "focused" : "unfocused"}`, width);
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

{
	const config = defaultConfig();
	config.editor.topMarginRows = 0;
	config.editor.minContentRows = 2;
	const editor = makeLiveEditor(dirtyState(), config, true, 40, keybindingsWith({ "tui.input.newLine": ["\u000a"], "app.thinking.cycle": ["\u001b[Z"] }));
	let thinkingNotifications = 0;
	const thinkingEditor = new GlanceEditor(
		{ terminal: { rows: 40 }, requestRender: () => undefined } as unknown as TUI,
		theme,
		keybindingsWith({ "tui.input.newLine": ["\u000a"], "app.thinking.cycle": ["\u001b[Z"] }),
		() => dirtyState(),
		() => config,
		() => {
			thinkingNotifications++;
		},
	);
	thinkingEditor.handleInput("\u001b[Z");
	assert.equal(thinkingNotifications, 1, "GlanceEditor should keep app thinking-cycle keybinding delegation");

	editor.setText("中文🙂wide");
	editor.handleInput("\u000a");
	editor.handleInput("下一行");
	assert.equal(editor.getText(), "中文🙂wide\n下一行", "Ctrl+J/newline should delegate to Pi editor input behavior");
	const frame = editor.render(48).map(stripAnsi);
	assert.ok(frame.some((line) => line.includes("中文🙂wide")), "wide CJK/emoji content should render inside GlanceEditor frame");
	assert.ok(frame.some((line) => line.includes("下一行")), "unicode line after Ctrl+J should render inside GlanceEditor frame");
	for (const line of frame) {
		assert.ok(visibleWidth(line) <= 48, `unicode editor frame line should fit width 48: ${line}`);
	}
}

{
	const config = defaultConfig();
	config.editor.topMarginRows = 0;
	const editor = makeLiveEditor(dirtyState(), config, true, 40, keybindingsWith({ "tui.input.tab": ["\t"] }));
	const completion: AutocompleteItem = { value: "src/中文-file.ts", label: "src/中文-file.ts", description: "wide path" };
	const provider: AutocompleteProvider = {
		getSuggestions: async () => ({ prefix: "src", items: [completion, { value: "src/other.ts", label: "src/other.ts" }] }),
		applyCompletion: (lines, cursorLine, cursorCol, item, prefix) => {
			const line = lines[cursorLine] ?? "";
			const start = Math.max(0, cursorCol - prefix.length);
			return {
				lines: [...lines.slice(0, cursorLine), `${line.slice(0, start)}${item.value}${line.slice(cursorCol)}`, ...lines.slice(cursorLine + 1)],
				cursorLine,
				cursorCol: start + item.value.length,
			};
		},
		shouldTriggerFileCompletion: () => true,
	};
	editor.setAutocompleteProvider(provider);
	editor.setText("src");
	editor.handleInput("\t");
	await Promise.resolve();
	await Promise.resolve();
	const autocompleteFrame = editor.render(80).map(stripAnsi);
	const autocompleteLine = autocompleteFrame.find((line) => line.includes("src/中文-file.ts"));
	assert.ok(autocompleteLine, "autocomplete suggestions with CJK text should render below GlanceEditor frame");
	assert.ok(autocompleteLine?.startsWith("  "), "autocomplete lines should keep pi-glance indentation outside the framed editor");
	for (const line of autocompleteFrame) {
		assert.ok(visibleWidth(line) <= 80, `autocomplete editor frame line should fit width 80: ${line}`);
	}
}

for (const topMarginRows of [0, 1, 2] as const) {
	for (const minContentRows of [2, 3, 4]) {
		for (const width of WIDTHS) {
			const config = defaultConfig();
			config.editor.minContentRows = minContentRows;
			config.editor.topMarginRows = topMarginRows;
			const shortText = "short row";
			const longText = "Ask pi to improve the input surface with a long prompt that must be clipped by the row planner";
			const contentLines = [longText, shortText];
			const expectedPreviewLines = Math.max(minContentRows, contentLines.length) + topMarginRows + 2;
			const previewFocused = previewFrame(dirtyState(), config, width, contentLines, true);
			const previewUnfocused = previewFrame(dirtyState(), config, width, contentLines, false);
			const liveShort = liveFrame(dirtyState(), config, width, true, shortText);
			const liveLong = liveFrame(dirtyState(), config, width, true, `${longText}\n${shortText}`);
			const firstContentIndex = topMarginRows + 1;

			assert.equal(previewFocused.length, expectedPreviewLines, `focused preview frame line count honors margin ${topMarginRows} and minRows ${minContentRows}`);
			assert.equal(previewUnfocused.length, expectedPreviewLines, `unfocused preview frame line count honors margin ${topMarginRows} and minRows ${minContentRows}`);
			assert.equal(liveShort.length, minContentRows + topMarginRows + 2, `short live frame line count honors margin ${topMarginRows} and minRows ${minContentRows}`);
			assert.ok(liveLong.length >= minContentRows + topMarginRows + 2, `long live frame keeps at least margin ${topMarginRows} and minRows ${minContentRows}`);
			assertTopMargin(previewFocused, topMarginRows, "focused preview", width);
			assertTopMargin(previewUnfocused, topMarginRows, "unfocused preview", width);
			assertTopMargin(liveShort, topMarginRows, "live short", width);
			assertTopMargin(liveLong, topMarginRows, "live long", width);
			assert.ok(previewFocused[topMarginRows]?.startsWith("╭"), `focused preview top border follows configured margin at width ${width}`);
			assert.ok(liveShort[topMarginRows]?.startsWith("╭"), `live top border follows configured margin at width ${width}`);
			assert.ok(previewFocused[firstContentIndex]?.includes("› "), `focused preview first row keeps dim prefix at width ${width}`);
			assert.ok(!(previewUnfocused[firstContentIndex] ?? "").includes("› "), `unfocused preview first row omits focus prefix at width ${width}`);
			assert.ok(previewUnfocused[firstContentIndex]?.startsWith("│  "), `unfocused preview first row keeps two-column plain prefix at width ${width}`);
			assert.ok(liveShort[firstContentIndex]?.startsWith("│ "), `live row keeps left content padding at width ${width}`);
			assert.ok(liveShort[firstContentIndex]?.endsWith(" │"), `live row keeps right content padding at width ${width}`);
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
}

console.log("✓ surface preview/live frame parity checks passed");
