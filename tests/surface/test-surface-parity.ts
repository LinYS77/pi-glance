import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth, type AutocompleteProvider, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { GlanceEditor, type GlanceEditorOptions } from "../../src/surface/editor.js";
import { renderInputSurface } from "../../src/surface/renderer.js";
import { resolveBuiltInGlanceStyles, type ResolvedGlanceStyles } from "../../src/theme/adapter.js";
import type { GlanceConfig, GlanceState } from "../../src/types.js";
import { testState } from "../support/helpers.js";
import { richInputSurfaceState, onlySegments, stripAnsi } from "../support/surface-test-harness.js";

const identity = (text: string) => text;
const theme: EditorTheme = { borderColor: identity, selectList: {
	selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity,
} };

function editorFor(config: GlanceConfig, state: GlanceState = richInputSurfaceState(), options?: GlanceEditorOptions,
	bindings: Record<string, string[]> = {}, rows = 40): GlanceEditor {
	const keys = { matches: (data: string, action: string) => bindings[action]?.includes(data) ?? false } as unknown as KeybindingsManager;
	const editor = new GlanceEditor({ terminal: { rows }, requestRender() {} } as unknown as TUI,
		theme, keys, () => state, () => config, options);
	editor.focused = true;
	return editor;
}

function assertFits(lines: string[], width: number): void {
	for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${stripAnsi(line)}`);
}

test("live and preview frames share workspace and status geometry across widths", () => {
	const state = richInputSurfaceState();
	for (const workspaceLabel of ["name", "smart", "path"] as const) for (const icons of ["plain", "nerd"] as const) {
		const config = defaultConfig(); config.display.workspaceLabel = workspaceLabel; config.icons = icons;
		const editor = editorFor(config, state); editor.setText("short 中文🙂");
		for (const width of [32, 56, 80, 120, 220]) {
			const preview = renderInputSurface(state, config, width);
			for (const focused of [true, false]) {
				editor.focused = focused;
				const live = editor.render(width);
				assert.equal(stripAnsi(live[config.editor.topMarginRows]!), stripAnsi(preview[config.editor.topMarginRows]!));
				assert.equal(stripAnsi(live.at(-1)!), stripAnsi(preview.at(-1)!));
				assertFits(live, width); assertFits(preview, width);
			}
		}
	}
	const config = defaultConfig(); onlySegments(config, []);
	const editor = editorFor(config, state);
	assert.equal(stripAnsi(editor.render(80)[1]!), stripAnsi(renderInputSurface(state, config, 80)[1]!), "empty status leaves the same frame");
});

test("live and preview use current palette, color capability and explicit overrides without stale status colors", () => {
	const config = defaultConfig(); config.icons = "plain"; config.editor.topMarginRows = 0;
	config.theme = { light: "one-light", dark: "tokyo-night" }; onlySegments(config, ["model"]);
	const state = testState();
	let tone: "light" | "dark" | "unknown" = "light", trueColor = true;
	let override: ResolvedGlanceStyles | undefined;
	const context = { getAmbientTone: () => tone, getTrueColor: () => trueColor, get styles() { return override; } };
	const editor = editorFor(config, state, { renderStyleContext: context }); editor.setText("keep my draft");
	for (const [nextTone, rgb, injected] of [
		["light", true, undefined], ["dark", true, undefined], ["dark", false, undefined],
		["unknown", true, undefined], ["light", true, resolveBuiltInGlanceStyles("nord")],
		["light", true, undefined],
	] as const) {
		tone = nextTone; trueColor = rgb; override = injected;
		const expected = injected ?? resolveBuiltInGlanceStyles(tone === "dark" ? "tokyo-night" : "one-light", rgb ? "truecolor" : "ansi256");
		const live = editor.render(120), preview = renderInputSurface(state, config, 120, {
			...context, contentLines: ["short", "long prompt ".repeat(30)], focused: true,
		});
		assert.equal(live[0], preview[0]);
		assert.ok(live[0]!.startsWith(expected.border("╭")));
		assert.ok(live[0]!.includes(expected.segments.model.fg("ai GPT 5.5")));
		assert.ok(preview[1]!.includes(expected.text("short")) && preview[1]!.includes(expected.dim("› ")));
		assert.ok(preview[2]!.includes(expected.dim("…")));
		assert.equal(editor.getText(), "keep my draft");
	}
});

test("unfocused chrome dims without changing workspace, status facts or prompt text", () => {
	const config = defaultConfig(); config.icons = "plain"; config.editor.topMarginRows = 0;
	onlySegments(config, ["model"]);
	const editor = editorFor(config, testState()); editor.setText("keep my draft");
	const focused = editor.render(120);
	editor.focused = false;
	const unfocused = editor.render(120), styles = resolveBuiltInGlanceStyles("light");
	assert.equal(stripAnsi(unfocused[0]!), stripAnsi(focused[0]!));
	assert.ok(unfocused[0]!.startsWith(styles.dim("╭")));
	assert.ok(unfocused[0]!.includes(styles.dim("ai GPT 5.5")));
	assert.ok(unfocused.at(-1)!.startsWith(styles.dim("╰")));
	assert.equal(editor.getText(), "keep my draft");
});

test("editor height and margins apply equally to short live input and the settings preview", () => {
	for (const topMarginRows of [0, 1, 2] as const) for (const minContentRows of [2, 3, 4]) {
		const config = defaultConfig(); config.editor.topMarginRows = topMarginRows; config.editor.minContentRows = minContentRows;
		const state = richInputSurfaceState(), editor = editorFor(config, state); editor.setText("short row");
		const live = editor.render(80).map(stripAnsi);
		const preview = renderInputSurface(state, config, 80, { contentLines: ["short row"], focused: true }).map(stripAnsi);
		for (const lines of [live, preview]) {
			assert.equal(lines.length, topMarginRows + minContentRows + 2);
			assert.deepEqual(lines.slice(0, topMarginRows), Array(topMarginRows).fill(" "));
			assert.ok(lines[topMarginRows]!.startsWith("╭")); assertFits(lines, 80);
		}
		assert.ok(preview[topMarginRows + 1]!.startsWith("│› "));
		assert.ok(live[topMarginRows + 1]!.startsWith("│ ") && live[topMarginRows + 1]!.endsWith(" │"));
		editor.setText("long prompt ".repeat(40));
		assert.ok(editor.render(80).length > live.length);
	}
});

test("tiny frames and truncated native scroll borders remain width-safe", () => {
	const config = defaultConfig(); config.editor.topMarginRows = 0; config.editor.minContentRows = 2;
	const editor = editorFor(config); editor.setText("x");
	const expected = [["", "", "", ""], ["╭", "│", "│", "╰"], ["╭╮", "││", "││", "╰╯"], ["╭─╮", "│ │", "│ │", "╰─╯"]];
	for (let width = 0; width <= 3; width++) assert.deepEqual(editor.render(width).map(stripAnsi), expected[width]);
	const scrolled = editorFor(config, testState(), undefined, {}, 10);
	scrolled.setText(Array.from({ length: 12 }, (_, i) => `line ${i} 中文🙂`).join("\n"));
	for (let i = 0; i < 20; i++) scrolled.handleInput("\x1b[A");
	for (const width of [4, 8, 16, 80]) {
		const lines = scrolled.render(width);
		assert.ok(stripAnsi(lines[0]!).startsWith("╭"));
		assert.ok(stripAnsi(lines.at(-1)!).startsWith("╰"));
		if (width === 80) assert.match(stripAnsi(lines.at(-1)!), /↓ \d+ more/);
		assertFits(lines, width);
	}
});

test("Pi retains shortcut, Unicode editing and history ownership", () => {
	const editor = editorFor(defaultConfig(), testState(), undefined, {
		"app.thinking.cycle": ["\x1b[Z"], "app.interrupt": ["\x1b"], "tui.input.newLine": ["\n"],
		"tui.editor.historyPrevious": ["\x10"], "tui.editor.historyNext": ["\x0e"], "app.model.cycleForward": ["\x10"],
	});
	let thinking = 0, interrupts = 0, modelCycles = 0;
	editor.onAction("app.thinking.cycle", () => { thinking++; });
	editor.onEscape = () => { interrupts++; };
	editor.onAction("app.model.cycleForward", () => { modelCycles++; });
	editor.setText("中文🙂wide"); editor.handleInput("\n"); editor.handleInput("下一行");
	editor.handleInput("\x1b[Z"); editor.handleInput("\x1b");
	assert.equal(thinking, 1); assert.equal(interrupts, 1);
	assert.equal(editor.getText(), "中文🙂wide\n下一行");
	assertFits(editor.render(48), 48);
	editor.setText("abc"); editor.handleInput("\x1b[D"); editor.handleInput("\x7f");
	assert.equal(editor.getText(), "ac");
	editor.addToHistory("older prompt"); editor.addToHistory("newer prompt"); editor.setText("draft");
	editor.handleInput("\x10"); assert.equal(modelCycles, 0, "native history takes precedence over a conflicting app shortcut");
	editor.setText("draft"); editor.render(80); editor.handleInput("\x1b[H");
	for (const [key, text] of [["\x1b[A", "newer prompt"], ["\x1b[A", "older prompt"], ["\x1b[B", "newer prompt"], ["\x1b[B", "draft"]]) {
		editor.handleInput(key!); assert.equal(editor.getText(), text);
	}
});

test("native autocomplete stays outside the frame, including scrolled narrow input", async () => {
	const config = defaultConfig(); config.editor.topMarginRows = 0;
	const provider: AutocompleteProvider = {
		getSuggestions: async () => ({ prefix: "src", items: [
			{ value: "src/中文-file.ts", label: "src/中文-file.ts", description: "wide path" },
			{ value: "src/other.ts", label: "src/other.ts" },
		] }),
		applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
		shouldTriggerFileCompletion: () => true,
	};
	for (const scrolled of [false, true]) {
		const editor = editorFor(config, testState(), { editorOptions: { autocompleteMaxVisible: 7 } }, { "tui.input.tab": ["\t"] }, scrolled ? 10 : 40);
		assert.equal(editor.getAutocompleteMaxVisible(), 7);
		editor.setText(scrolled ? ["src", ...Array(11).fill("other line")].join("\n") : "src");
		if (scrolled) for (let i = 0; i < 20; i++) editor.handleInput("\x1b[A");
		editor.setAutocompleteProvider(provider); editor.handleInput("\t");
		await Promise.resolve(); await Promise.resolve();
		for (const width of scrolled ? [4, 16, 80] : [80]) {
			const lines = editor.render(width).map(stripAnsi);
			const bottom = lines.findIndex(line => line.startsWith("╰"));
			assert.ok(bottom > 0 && lines.length > bottom + 1);
			if (width === 80) assert.ok(lines.slice(bottom + 1).some(line => line.startsWith("  ") && line.includes("src/中文-file.ts")));
			assertFits(lines, width);
		}
	}
});
