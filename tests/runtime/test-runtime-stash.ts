import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { createDraftStore } from "../../src/input/store.js";
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

test("forking a session whose directory moved uses the new workspace and Git, but not the original draft", { timeout: 10_000 }, async () => {
	const root = await mkdtemp(join(tmpdir(), "glance-fork-workspace-"));
	const originalCwd = join(root, "old-workspace");
	const nextCwd = join(root, "new-workspace");
	const sessions = join(root, "sessions");
	const drafts = createDraftStore(join(root, "drafts"));
	const config = defaultConfig();
	config.git.autoFetch = false;
	const harness = createRuntimeHarness({ ...drafts, loadConfigSyncConfig: config });
	const ui = createRuntimeTestContext({ cwd: originalCwd, trusted: false });
	let activeContext = ui.ctx;
	try {
		await Promise.all([mkdir(originalCwd), mkdir(nextCwd)]);
		execFileSync("git", ["init", "-q", "-b", "new-fork-branch"], { cwd: nextCwd });
		const original = SessionManager.create(originalCwd, sessions);
		original.appendMessage({ role: "user", content: "DEMO original session", timestamp: Date.now() });
		original.appendUsage("demo", "local", "fixture", { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
			cost: { total: 0.5, input: 0.25, output: 0.25, cacheRead: 0, cacheWrite: 0 } });
		const sessionFile = original.getSessionFile();
		assert.ok(sessionFile);
		drafts.saveDraft(original.getSessionId(), "private original draft");
		await rename(originalCwd, join(root, "moved-workspace"));
		const fork = SessionManager.forkFrom(sessionFile, nextCwd, sessions);
		assert.notEqual(fork.getSessionId(), original.getSessionId());

		// Exercise the Glance lifecycle interface with Pi's actual forked store.
		// The host cwd deliberately still names the missing directory.
		activeContext = { ...ui.ctx, sessionManager: fork };
		harness.runtime.events.sessionStart({}, activeContext);
		const editor = invokeEditorFactory(ui, 0, () => {}, keys) as GlanceEditor;
		editor.focused = true;
		function frame() { return stripTerminalSequences(editor.render(240).join("\n")); }
		for (let attempt = 0; attempt < 100 && !frame().includes("new-fork-branch"); attempt++) await sleep(25);
		const rendered = frame();
		assert.match(rendered, /new-workspace/);
		assert.match(rendered, /new-fork-branch/);
		assert.doesNotMatch(rendered, /old-workspace/);
		assert.match(rendered, /\$0\.500/, "the fork retains the copied billed history");
		editor.handleInput("\x1bs");
		assert.equal(editor.getText(), "", "the fork has its own empty stash");
		editor.setText("new fork draft");
		editor.handleInput("\x1bs");
		assert.equal(drafts.loadDraft(fork.getSessionId()), "new fork draft");
		assert.equal(drafts.loadDraft(original.getSessionId()), "private original draft");
	} finally {
		await harness.runtime.events.sessionShutdown({}, activeContext);
		await rm(root, { recursive: true, force: true });
	}
});
