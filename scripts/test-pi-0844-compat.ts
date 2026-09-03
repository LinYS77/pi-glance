import { strict as assert } from "node:assert";
import type { ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen, isViewportTUI, visibleWidth, type EditorTheme, type Terminal, type TUI } from "@earendil-works/pi-tui";
import { defaultConfig } from "../config.js";
import { GlanceEditor } from "../editor.js";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext } from "./runtime-harness.js";
import { stripAnsi } from "./surface-test-harness.js";

interface TestTerminal extends Terminal {
	readonly writes: string[];
}

function createTerminal(columns = 120, rows = 24): TestTerminal {
	const writes: string[] = [];
	return {
		writes,
		start: () => undefined,
		stop: () => undefined,
		drainInput: async () => undefined,
		write: (data) => writes.push(data),
		columns,
		rows,
		kittyProtocolActive: false,
		moveBy: () => undefined,
		hideCursor: () => undefined,
		showCursor: () => undefined,
		clearLine: () => undefined,
		clearFromCursor: () => undefined,
		clearScreen: () => undefined,
		setTitle: () => undefined,
		setProgress: () => undefined,
	};
}

const editorTheme = {
	borderColor: (text: string) => text,
	selectList: {
		selectedPrefix: (text: string) => text,
		selectedText: (text: string) => text,
		description: (text: string) => text,
		scrollInfo: (text: string) => text,
		noMatch: (text: string) => text,
	},
} as unknown as EditorTheme;

const keybindings = {
	matches: () => false,
} as unknown as KeybindingsManager;

const config = defaultConfig();
config.editor.topMarginRows = 0;
config.segments = config.segments.map((segment) => ({ ...segment, enabled: segment.id === "model" }));
let thinkingLevel = "off";
const test = createRuntimeTestContext({
	model: { id: "gpt-5.6-sol", name: "GPT 5.6 sol", provider: "openai", contextWindow: 272_000 },
});
const harness = createRuntimeHarness({
	loadConfigSyncConfig: config,
	getThinkingLevel: () => thinkingLevel,
	getTrueColor: () => true,
	git: createGitHarness(),
});

harness.runtime.events.sessionStart({ type: "session_start" }, test.ctx as ExtensionContext);
const editorFactory = test.editorFactories[0] as unknown as (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => GlanceEditor;
assert.ok(editorFactory, "enabled session should expose the Glance custom-editor factory for Pi fullscreen mode");

const terminal = createTerminal();
const fullscreen = new TuiAltScreen(terminal, false, undefined, { mouse: false });
assert.equal(fullscreen.mode, "fullscreen", "Pi 0.84.4 TuiAltScreen should expose fullscreen mode");
assert.equal(isViewportTUI(fullscreen), true, "Pi 0.84.4 TuiAltScreen should satisfy the public viewport TUI guard");

let fullscreenRenderRequests = 0;
fullscreen.requestRender = () => {
	fullscreenRenderRequests++;
};
const editor = editorFactory(fullscreen, editorTheme, keybindings);
fullscreen.addChild(editor);
fullscreen.setFocus(editor);
assert.equal(editor.focused, true, "Pi fullscreen focus should propagate to GlanceEditor through the public Focusable seam");
editor.setText("first fullscreen line\n第二行🙂");
assert.equal(editor.getText(), "first fullscreen line\n第二行🙂", "fullscreen GlanceEditor should retain inherited multiline and Unicode editing state");

function assertFullscreenFrame(width: number, label: string): string {
	const direct = editor.render(width);
	const mounted = fullscreen.render(width);
	assert.deepEqual(mounted, direct, `${label}: the fullscreen TUI should render the mounted GlanceEditor without a mode-specific wrapper`);
	for (const [index, line] of mounted.entries()) {
		assert.ok(visibleWidth(line) <= width, `${label}: fullscreen line ${index} should fit width ${width}: ${stripAnsi(line)}`);
	}
	return mounted.map(stripAnsi).join("\n");
}

const initialFrame = assertFullscreenFrame(120, "initial /thinking state");
assert.ok(initialFrame.includes("ai GPT 5.6 sol"), "fullscreen Glance status should show the current model");
assert.equal(initialFrame.includes("GPT 5.6 sol max"), false, "thinking off should not add a label before /thinking changes it");

const renderBaseline = fullscreenRenderRequests;
const entryBaseline = test.getEntryReads();
const branchBaseline = test.getBranchReads();
thinkingLevel = "max";
await harness.runtime.events.thinkingLevelSelect(
	{ type: "thinking_level_select", level: "max", previousLevel: "off" },
	test.ctx as ExtensionContext,
);
const maxFrame = assertFullscreenFrame(120, "Pi /thinking max");
assert.ok(maxFrame.includes("ai GPT 5.6 sol max"), "Pi /thinking selection should refresh the thinking label in the existing fullscreen editor");
assert.ok(fullscreenRenderRequests > renderBaseline, "Pi /thinking selection should request a render from the active fullscreen TUI");
assert.equal(test.getEntryReads(), entryBaseline, "Pi /thinking selection should not rescan persisted session entries");
assert.equal(test.getBranchReads(), branchBaseline, "Pi /thinking selection should not read the production session branch");
assert.deepEqual(harness.savedConfigs, [], "session-scoped Pi /thinking selection should not write pi-glance configuration");

thinkingLevel = "off";
test.setModel({ id: "non-reasoning-mini", name: "Mini", provider: "openai", contextWindow: 128_000 });
await harness.runtime.events.thinkingLevelSelect(
	{ type: "thinking_level_select", level: "off", previousLevel: "max" },
	test.ctx as ExtensionContext,
);
const clampedFrame = assertFullscreenFrame(120, "model-clamped /thinking state");
assert.ok(clampedFrame.includes("ai Mini"), "thinking-level clamp event should refresh the current model through Pi's cheap selector path");
assert.equal(clampedFrame.includes("Mini max"), false, "thinking-level clamp to off should remove the prior max label");

editor.setText("x");
for (const width of [4, 16, 56, 80]) {
	assertFullscreenFrame(width, `Pi fullscreen width ${width}`);
}
assert.deepEqual(terminal.writes, [], "fullscreen compatibility test should not start or write directly to the terminal");

fullscreen.setFocus(null);
fullscreen.clear();
console.log("✓ Pi 0.84.4 /thinking and fullscreen compatibility checks passed");
