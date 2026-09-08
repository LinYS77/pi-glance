import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import type { GlanceEditor } from "../../src/surface/editor.js";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext, invokeEditorFactory } from "../support/runtime-harness.js";

const keys = { matches: () => false, getEffectiveConfig: () => ({}) };

test("runtime retains the same editor and draft across config save, reload, resume and session isolation", async () => {
	const drafts = new Map<string, string>();
	const config = defaultConfig();
	const next = structuredClone(config); next.editor.stashShortcut = "alt+x";
	const storage = {
		loadDraft: (id: string) => drafts.get(id) ?? null,
		saveDraft: (id: string, text: string | null) => { if (text === null) drafts.delete(id); else drafts.set(id, text); },
	};
	const h = createRuntimeHarness({ ...storage, git: createGitHarness(), showPaneResults: [{ action: "save", config: next }] });
	const ctx = createRuntimeTestContext({ sessionId: "one" });
	h.runtime.events.sessionStart({}, ctx.ctx);
	const editor = invokeEditorFactory(ctx, 0, () => {}, keys) as GlanceEditor;
	editor.focused = true;
	editor.setText("original"); editor.handleInput("\x1bs");
	assert.equal(drafts.get("one"), "original");
	editor.setText("new text");
	await h.runtime.commands.openPane("", ctx.ctx);
	assert.equal(ctx.editorFactories.length, 1);
	assert.equal(editor.getText(), "new text");
	editor.handleInput("\x1bx");
	assert.equal(editor.getText(), "original");
	assert.equal(drafts.get("one"), "new text");
	await h.runtime.events.sessionShutdown({ reason: "reload" }, ctx.ctx);
	const resumed = createRuntimeHarness({ ...storage, git: createGitHarness() });
	const same = createRuntimeTestContext({ sessionId: "one" });
	resumed.runtime.events.sessionStart({ reason: "reload" }, same.ctx);
	const restored = invokeEditorFactory(same, 0, () => {}, keys) as GlanceEditor;
	restored.focused = true;
	assert.equal(restored.getText(), "", "reload must not replace current input automatically");
	restored.handleInput("\x1bs");
	assert.equal(restored.getText(), "new text");
	assert.equal(drafts.has("one"), false);
	await resumed.runtime.events.sessionShutdown({}, same.ctx);
	drafts.set("one", "private");
	const other = createRuntimeHarness({ ...storage, git: createGitHarness() });
	const second = createRuntimeTestContext({ sessionId: "two" });
	other.runtime.events.sessionStart({ reason: "fork" }, second.ctx);
	const isolated = invokeEditorFactory(second, 0, () => {}, keys) as GlanceEditor;
	isolated.focused = true; isolated.handleInput("\x1bs");
	assert.equal(isolated.getText(), "");
	await other.runtime.events.sessionShutdown({}, second.ctx);
});
