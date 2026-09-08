import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { GlanceEditor } from "../../src/surface/editor.js";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext, invokeEditorFactory, loadedConfigResult } from "../support/runtime-harness.js";

for (const mode of ["rpc", "json", "print"] as const) test(`${mode} does not read drafts or start background Git`, async () => {
	const git = createGitHarness();
	const h = createRuntimeHarness({ git, loadDraft: () => { throw new Error("must not read"); }, saveDraft: () => { throw new Error("must not write"); } });
	const ctx = createRuntimeTestContext({ mode });
	h.runtime.events.sessionStart({}, ctx.ctx);
	assert.equal(git.created, 0);
	assert.deepEqual(ctx.notifications, []);
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
});

test("no-session Stash works in memory without reading or saving personal drafts", async () => {
	const h = createRuntimeHarness({ git: createGitHarness(), loadDraft: () => { throw new Error("must not read"); }, saveDraft: () => { throw new Error("must not write"); } });
	const ctx = createRuntimeTestContext({ persistent: false });
	h.runtime.events.sessionStart({}, ctx.ctx);
	const editor = invokeEditorFactory(ctx, 0, () => {}, { matches: () => false, getEffectiveConfig: () => ({}) } as never) as GlanceEditor;
	editor.focused = true; editor.setText("memory only"); editor.handleInput("\x1bs");
	assert.equal(editor.getText(), ""); editor.handleInput("\x1bs");
	assert.equal(editor.getText(), "memory only"); assert.deepEqual(ctx.notifications, []);
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
});

test("untrusted projects keep local status but cannot auto-fetch", async () => {
	const git = createGitHarness();
	const h = createRuntimeHarness({ git });
	const ctx = createRuntimeTestContext({ trusted: false });
	h.runtime.events.sessionStart({}, ctx.ctx);
	assert.equal(git.created, 1);
	assert.equal(git.options!.canFetch(), false);
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
});

test("unreadable or future config never opts into network access through fallback defaults", async () => {
	const git = createGitHarness();
	const h = createRuntimeHarness({ git, loadConfigSyncResult: { ...loadedConfigResult(), status: "invalid", writable: false } });
	const ctx = createRuntimeTestContext({ trusted: true });
	h.runtime.events.sessionStart({}, ctx.ctx);
	assert.equal(git.options!.canFetch(), false);
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
});

test("a malformed draft is reported without taking editor ownership away or replacing the file", async () => {
	let writes = 0;
	const h = createRuntimeHarness({ git: createGitHarness(), loadDraft: () => { throw new Error("bad json"); }, saveDraft: () => { writes++; } });
	const ctx = createRuntimeTestContext();
	h.runtime.events.sessionStart({}, ctx.ctx);
	assert.equal(ctx.editorFactories.length, 1);
	assert.match(ctx.notifications[0]!.message, /saved draft/);
	assert.equal(writes, 0);
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
});
