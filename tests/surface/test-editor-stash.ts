import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { PromptStash } from "../../src/input/stash.js";
import { GlanceEditor } from "../../src/surface/editor.js";
import { testState } from "../support/helpers.js";

const identity = (s: string) => s;
const theme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };

test("Alt+S keeps expanded long pastes, swaps drafts, and shows a width-safe hint only while occupied", () => {
	const config = defaultConfig(); config.icons = "plain";
	const stash = new PromptStash(null, () => {});
	const editor = new GlanceEditor({ terminal: { rows: 40 }, requestRender() {} } as unknown as TUI,
		theme, { matches: () => false, getEffectiveConfig: () => ({}) } as unknown as KeybindingsManager,
		() => testState(), () => config, undefined, { stash });
	editor.focused = true;
	const original = "中文🐾\n".repeat(30);
	editor.handleInput(`\x1b[200~${original}\x1b[201~`);
	assert.notEqual(editor.getText(), original);
	editor.handleInput("\x1bs");
	assert.equal(editor.getText(), "");
	assert.equal(stash.hasDraft, true);
	assert.match(editor.render(100).join("\n"), /draft/);
	editor.handleInput("new question");
	editor.handleInput("\x1b[115;3u");
	assert.equal(editor.getExpandedText(), original);
	editor.setText("");
	editor.handleInput("\x1bs");
	assert.equal(editor.getText(), "new question");
	assert.equal(stash.hasDraft, false);
	assert.doesNotMatch(editor.render(100).join("\n"), /draft/);
	for (let width = 0; width < 100; width++) for (const line of editor.render(width)) assert.ok(visibleWidth(line) <= width);
});
