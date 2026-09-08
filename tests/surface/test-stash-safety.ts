import { strict as assert } from "node:assert";
import { test } from "node:test";
import { matchesKey, type TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { PromptStash } from "../../src/input/stash.js";
import { GlanceEditor } from "../../src/surface/editor.js";
import { testState } from "../support/helpers.js";

function harness(bindings: Record<string, string> = {}) {
	const config = defaultConfig();
	let persisted: string | null = null;
	const errors: string[] = [];
	const stash = new PromptStash(null, text => { persisted = text; });
	const identity = (text: string) => text;
	const theme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
	const keys = {
		getEffectiveConfig: () => bindings,
		matches: (data: string, action: string) => bindings[action] ? matchesKey(data, bindings[action] as never) : false,
	} as unknown as KeybindingsManager;
	const editor = new GlanceEditor({ terminal: { rows: 40 }, requestRender() {} } as unknown as TUI, theme, keys,
		() => testState(), () => config, undefined, { stash, onStashError: message => errors.push(message) });
	editor.focused = true;
	return { editor, config, stash, errors, persisted: () => persisted };
}

test("user Pi bindings and other extensions retain precedence over Stash", () => {
	const pi = harness({ "app.thinking.toggle": "alt+s" });
	let called = 0;
	pi.editor.onAction("app.thinking.toggle", () => called++);
	pi.editor.setText("keep"); pi.editor.handleInput("\x1bs");
	assert.equal(called, 1); assert.equal(pi.editor.getText(), "keep"); assert.equal(pi.persisted(), null);
	assert.match(pi.errors[0]!, /app.thinking.toggle/);
	const extension = harness();
	extension.editor.onExtensionShortcut = () => { called++; return true; };
	extension.editor.setText("keep"); extension.editor.handleInput("\x1bs");
	assert.equal(called, 2); assert.equal(extension.persisted(), null);
});

test("unfocused, disabled, repeated and bracketed-paste keys never exchange drafts", () => {
	const h = harness();
	h.editor.setText("keep");
	h.editor.focused = false; h.editor.handleInput("\x1bs");
	assert.equal(h.persisted(), null);
	h.editor.focused = true; h.config.editor.stashEnabled = false; h.editor.handleInput("\x1bs");
	assert.equal(h.persisted(), null);
	h.config.editor.stashEnabled = true;
	h.editor.handleInput("\x1b[115;3:2u");
	assert.equal(h.persisted(), null);
	h.editor.handleInput("\x1b[200~");
	h.editor.handleInput("\x1bs");
	h.editor.handleInput("\x1b[201~");
	assert.equal(h.persisted(), null);
	h.editor.handleInput("\x1bs");
	assert.equal(h.stash.hasDraft, true);
	assert.equal(h.editor.getText(), "");
});
