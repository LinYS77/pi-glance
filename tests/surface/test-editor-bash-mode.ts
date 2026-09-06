import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { GlanceEditor } from "../../src/surface/editor.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { testState } from "../support/helpers.js";
import { stripAnsi } from "../support/surface-test-harness.js";

const identity = (text: string) => text;
const theme: EditorTheme = {
	borderColor: identity,
	selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity },
};
const keybindings = { matches: () => false } as unknown as KeybindingsManager;

function createEditor(trueColor = true) {
	const config = defaultConfig();
	config.editor.topMarginRows = 0;
	config.segments = [{ id: "model", enabled: true }];
	const styles = resolveBuiltInGlanceStyles("light", trueColor ? "truecolor" : "ansi256");
	const editor = new GlanceEditor(
		{ terminal: { rows: 12 }, requestRender: () => undefined } as unknown as TUI,
		theme, keybindings, () => testState(), () => config, undefined,
		{ renderStyleContext: { styles } },
	);
	editor.focused = true;
	const bashColor = trueColor ? "\x1b[38;2;255;120;20m" : "\x1b[38;5;208m";
	const bashBorder = (text: string) => `${bashColor}${text}\x1b[39m`;
	// Pi owns this callback and updates the public borderColor property.
	editor.onChange = (text) => { editor.borderColor = text.trimStart().startsWith("!") ? bashBorder : identity; };
	return { editor, styles, config, bashBorder, bashColor };
}

for (const trueColor of [true, false]) {
	test(`Bash inputs inherit the Pi border without recoloring title/status (${trueColor ? "RGB" : "ANSI256"})`, () => {
		const { editor, styles, bashBorder, bashColor } = createEditor(trueColor);
		for (const text of ["!pwd", "!!pwd", "  !pwd", "\n\t!!echo hello"]) {
			editor.setText(text);
			const lines = editor.render(120);
			assert.ok(lines[0]!.startsWith(bashBorder("╭")), `Bash top border for ${JSON.stringify(text)}`);
			assert.ok(lines[1]!.startsWith(bashBorder("│")), "side border follows the host");
			assert.ok(lines.at(-1)!.startsWith(bashBorder("╰")), "bottom border follows the host");
			assert.ok(lines[0]!.includes(styles.title(" repo ")), "workspace title stays in Glance palette");
			assert.ok(lines[0]!.includes(styles.segments.model.fg("󰚩 GPT 5.5")), "status keeps Glance styles");
			assert.equal(lines[0]!.includes(`${bashColor}󰚩 GPT`), false);
		}
	});
}

test("ordinary input and leaving Bash mode restore Glance without stale border colors", () => {
	const { editor, styles, bashColor } = createEditor();
	for (const text of ["hello!", "say !pwd", "", "!pwd", "regular prompt", "   "]) {
		editor.setText(text);
		const lines = editor.render(120);
		if (text === "!pwd") assert.ok(lines[0]!.includes(bashColor));
		else {
			assert.ok(lines[0]!.startsWith(styles.border("╭")));
			assert.equal(lines.join("\n").includes(bashColor), false);
		}
	}
});

test("Bash borders follow host theme changes while preserving unfocused dimming", () => {
	const { editor, styles } = createEditor();
	editor.setText("!pwd");
	const nextBorder = (text: string) => `\x1b[38;5;99m${text}\x1b[39m`;
	editor.borderColor = nextBorder;
	assert.ok(editor.render(120)[0]!.startsWith(nextBorder("╭")), "read the current host callback on every render");
	editor.focused = false;
	assert.ok(editor.render(120)[0]!.startsWith(styles.dim("╭")), "unfocused Glance chrome remains dimmed");
	editor.focused = true;
	assert.ok(editor.render(120)[0]!.startsWith(nextBorder("╭")), "focus restores the host's current Bash cue");
});

test("Bash multiline, scroll borders and narrow frames remain width-safe", () => {
	const { editor, bashBorder } = createEditor();
	editor.setText("!echo hello\n" + Array.from({ length: 12 }, (_, i) => `line ${i} 中文🙂`).join("\n"));
	for (const width of [4, 16, 56, 120]) {
		const lines = editor.render(width);
		assert.ok(lines[0]!.startsWith(bashBorder("╭")));
		assert.ok(lines.some((line) => /↑ \d+ more/.test(stripAnsi(line))) || width < 56, "roomy frames retain the native scroll indicator; narrow ones may truncate it");
		for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${stripAnsi(line)}`);
	}
});

test("tiny frames never send wide Unicode into Pi's one-column word wrapper", () => {
	const { editor } = createEditor();
	const text = "!echo 中文🙂";
	for (const padding of [0, 1, 2]) {
		editor.setPaddingX(padding);
		editor.setText(text);
		for (let width = 0; width <= 8; width++) {
			for (const line of editor.render(width)) assert.ok(visibleWidth(line) <= width, `padding ${padding}, width ${width}`);
			assert.equal(editor.getText(), text, "clipping must not alter Pi's editing state");
		}
	}
});

test("disabled Glance leaves the inherited Pi editor rendering untouched", () => {
	const { editor, config } = createEditor();
	config.enabled = false;
	editor.setText("!pwd");
	assert.deepEqual(editor.render(120), CustomEditor.prototype.render.call(editor, 120));
});
