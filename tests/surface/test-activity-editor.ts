import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { CustomEditor, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { PromptStash } from "../../src/input/stash.js";
import { GlanceEditor } from "../../src/surface/editor.js";
import { richInputSurfaceState } from "../support/surface-test-harness.js";

type NativeIndicator = NonNullable<Parameters<CustomEditor["setWorkingStatusIndicator"]>[0]>;
const theme = { borderColor: (s: string) => s, selectList: { selectedPrefix: (s: string) => s, selectedText: (s: string) => s,
	description: (s: string) => s, scrollInfo: (s: string) => s, noMatch: (s: string) => s } } satisfies EditorTheme;
const keys = { matches: () => false } as unknown as KeybindingsManager;

function indicator(kind: NativeIndicator["kind"], text: () => string): NativeIndicator {
	return { kind, renderInBorder: text, renderSpinnerInBorder: () => "◌",
		dispose() { throw new Error("Pi owns the indicator"); }, stop() { throw new Error("Pi owns its clock"); } } as unknown as NativeIndicator;
}

test("native activity belongs in the bottom border and exclusively replaces the current draft hint", () => {
	const config = defaultConfig();
	const stash = new PromptStash("saved draft", () => {});
	const editor = new GlanceEditor({ terminal: { rows: 38 }, requestRender() {} } as unknown as TUI,
		theme, keys, richInputSurfaceState, () => config, { stash });
	editor.focused = true; editor.setText("input 中文🙂");
	assert.equal(editor.embedWorkingStatus, true, "Pi must route every status into the editor, never a separate row");
	const idle = editor.render(180);
	assert.ok(stripTerminalSequences(idle.at(-1)!).includes("alt+s"));
	for (const kind of ["working", "compaction", "branchSummary", "retry"] as const) {
		let text = `◌ DEMO ${kind} (esc to cancel)`;
		editor.setWorkingStatusIndicator(indicator(kind, () => `\x1b[31m${text}\x1b[39m`));
		const frame = editor.render(180);
		assert.equal(frame.length, idle.length);
		assert.equal(frame[config.editor.topMarginRows], idle[config.editor.topMarginRows], "top facts remain unchanged");
		assert.ok(stripTerminalSequences(frame.at(-1)!).includes(text));
		assert.ok(!frame.at(-1)!.includes("alt+s"));
		assert.ok(!frame.at(-1)!.includes("\x1b[31m"), "native text receives Glance colors");
		text = "◌ DEMO updated in 3s";
		assert.ok(stripTerminalSequences(editor.render(180).at(-1)!).includes(text), "do not cache live native countdown text");
		for (const width of [0, 1, 2, 4, 8, 24, 80]) for (const line of editor.render(width)) assert.ok(visibleWidth(line) <= width);
	}
	stash.exchange(""); // Take the stash while its hint is hidden.
	editor.setWorkingStatusIndicator(undefined);
	assert.ok(!editor.render(180).at(-1)!.includes("alt+s"), "restore actual stash state, not the previously displayed hint");
	assert.equal(editor.getText(), "input 中文🙂");
	editor.dispose();
	editor.setWorkingStatusIndicator(indicator("retry", () => { throw new Error("retired native indicator"); }));
	assert.doesNotThrow(() => editor.render(180), "late native callbacks cannot revive a disposed surface");
});
