import { strict as assert } from "node:assert";
import { test } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { GlanceConfigPane } from "../../src/settings/pane.js";
import type { GlanceEditor } from "../../src/surface/editor.js";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext, invokeEditorFactory } from "../support/runtime-harness.js";

const assistant = {
	type: "message", id: "assistant", parentId: null,
	message: { role: "assistant", responseId: "response", usage: { input: 100, output: 10, cost: { total: 0.1 } } },
};
const warming = {
	type: "usage", id: "warming", parentId: assistant.id, kind: "cache_warm",
	usage: { output: 1, cacheRead: 50_000, cost: { total: 0.015015 } },
};

test("Pi's ordinary redraw includes newly persisted warming usage without an agent event or a full rescan", async () => {
	const config = defaultConfig();
	config.editor.activityMode = "text";
	const ctx = createRuntimeTestContext({ entries: [assistant] });
	const harness = createRuntimeHarness({ loadConfigSyncConfig: config, git: createGitHarness(), showPaneResults: [{ action: "cancel" }] });
	harness.runtime.events.sessionStart({}, ctx.ctx);
	const editor = invokeEditorFactory(ctx, 0, () => {}) as GlanceEditor;
	editor.focused = true;
	editor.setText("draft 中文🙂 tail");
	const render = () => stripTerminalSequences(editor.render(240).join("\n"));
	assert.match(render(), /\$0\.100/);
	const reads = ctx.getEntryReads();
	const renders = ctx.getRenderRequests();
	// Pi persists warming as a usage entry and requests a TUI redraw, not message_end.
	ctx.setSessionEntries([assistant, warming]);
	assert.match(render(), /\$0\.115/, "idle redraw must show the actual settled warming bill");
	for (let i = 0; i < 20; i++) assert.match(render(), /\$0\.115/, "repeated draws cannot count the same entry twice");
	assert.equal(ctx.getEntryReads(), reads, "rendering must not rescan the full ledger");
	assert.equal(ctx.getBranchReads(), 0);
	assert.equal(ctx.getRenderRequests(), renders, "reading an already scheduled frame must not schedule another frame");
	assert.equal(editor.getText(), "draft 中文🙂 tail");
	await harness.runtime.commands.openPane("", ctx.ctx);
	const state = harness.showPanePreviewStates[0]!;
	assert.deepEqual(state.usage, { input: 100, output: 11, cacheRead: 50_000, cacheWrite: 0, cost: 0.115015 });
	assert.deepEqual(state.throughput, { lastRun: null, currentRun: null }, "warming is not a model-speed sample");
	assert.equal(state.context.tokens, 42, "context remains Pi's public context usage, not warming's token count");
});

test("an open settings preview reads new usage even when the Glance editor is disabled", async () => {
	const config = defaultConfig(); config.enabled = false;
	const ctx = createRuntimeTestContext({ entries: [assistant] });
	const harness = createRuntimeHarness({ loadConfigSyncConfig: config, git: createGitHarness(), showPaneResults: [{ action: "cancel" }] });
	harness.runtime.events.sessionStart({}, ctx.ctx);
	assert.equal(ctx.editorFactories.length, 0);
	await harness.runtime.commands.openPane("", ctx.ctx);
	const pane = new GlanceConfigPane(config, { fg: (_tone, text) => text }, () => {}, () => {},
		undefined, () => 40, harness.showPanePreviewStates[0], harness.showPaneOptions[0]);
	try {
		pane.handleInput(" "); // Preview turning Glance on without saving it.
		const render = () => stripTerminalSequences(pane.render(240).join("\n"));
		assert.match(render(), /\$0\.100/);
		const reads = ctx.getEntryReads();
		ctx.setSessionEntries([assistant, warming]);
		assert.match(render(), /\$0\.115/, "the preview must not depend on the underlying editor being rendered");
		assert.equal(ctx.getEntryReads(), reads);
		assert.equal(config.enabled, false);
		assert.equal(harness.savedConfigs.length, 0);
	} finally { pane.dispose(); }
});

test("usage behind later entries is counted once across message events, branch reconciliation and reload", async () => {
	const ctx = createRuntimeTestContext({ entries: [assistant] });
	const harness = createRuntimeHarness({ git: createGitHarness(), showPaneResults: [{ action: "cancel" }] });
	harness.runtime.events.sessionStart({}, ctx.ctx);
	const editor = invokeEditorFactory(ctx, 0, () => {}) as GlanceEditor;
	await harness.runtime.commands.openPane("", ctx.ctx);
	const state = harness.showPanePreviewStates[0]!;
	const system = { type: "message", id: "instructions", parentId: warming.id, message: { role: "system" } };
	const reply = { type: "message", id: "reply", parentId: system.id,
		message: { role: "assistant", responseId: "reply-response", usage: { output: 20, cost: { total: 0.25 } } } };
	await harness.runtime.events.messageEnd({ message: reply.message }, ctx.ctx);
	const entries = [assistant, warming, system, reply];
	ctx.setSessionEntries(entries);
	editor.render(240);
	assert.equal(state.usage.output, 31, "walking persisted entries must not recount an assistant message_end delta");
	assert.equal(state.usage.cacheRead, 50_000, "usage can be beneath newer non-usage entries");
	assert.ok(Math.abs(state.usage.cost - 0.365015) < 1e-12);
	await harness.runtime.events.sessionTree({}, ctx.ctx);
	const reconciled = structuredClone(state.usage);
	for (let i = 0; i < 10; i++) editor.render(240);
	assert.deepEqual(state.usage, reconciled, "a full reconciliation must also advance the incremental cursor");
	const otherBranch = { ...warming, id: "other-branch", parentId: assistant.id, kind: "future-operation" };
	ctx.setSessionEntries([...entries, otherBranch]);
	editor.render(240);
	assert.equal(state.usage.output, 32);
	assert.equal(state.usage.cacheRead, 100_000, "new branches retain billed usage from the abandoned branch");
	assert.ok(Math.abs(state.usage.cost - 0.38003) < 1e-12);
	harness.runtime.events.sessionStart({}, ctx.ctx);
	const reloaded = invokeEditorFactory(ctx, 1, () => {}) as GlanceEditor;
	const restoredFrame = stripTerminalSequences(reloaded.render(240).join("\n"));
	assert.match(restoredFrame, /\$0\.380/);
	assert.match(restoredFrame, /↓32/);
	let lookups = 0;
	const getEntry = ctx.ctx.sessionManager.getEntry;
	ctx.ctx.sessionManager.getEntry = id => { lookups++; return getEntry(id); };
	const reads = ctx.getEntryReads();
	for (let i = 0; i < 100; i++) reloaded.render(240);
	assert.equal(lookups, 0, "animation frames with an unchanged leaf must not walk any entries");
	assert.equal(ctx.getEntryReads(), reads);
});

test("old editor and preview callbacks never read a retired session or contaminate the next one", async () => {
	const first = createRuntimeTestContext({ entries: [assistant] });
	const harness = createRuntimeHarness({ git: createGitHarness(), showPaneResults: [{ action: "cancel" }] });
	harness.runtime.events.sessionStart({}, first.ctx);
	const oldEditor = invokeEditorFactory(first, 0, () => {}) as GlanceEditor;
	await harness.runtime.commands.openPane("", first.ctx);
	const readOldPreview = harness.showPaneOptions[0]!.getPreviewState!;
	await harness.runtime.events.sessionShutdown({}, first.ctx);
	first.ctx.sessionManager.getLeafId = () => { throw new Error("retired session"); };
	const next = createRuntimeTestContext({ entries: [warming] });
	harness.runtime.events.sessionStart({}, next.ctx);
	const editor = invokeEditorFactory(next, 0, () => {}) as GlanceEditor;
	assert.match(stripTerminalSequences(editor.render(240).join("\n")), /\$0\.015/);
	assert.match(stripTerminalSequences(oldEditor.render(240).join("\n")), /\$0\.100/);
	assert.equal(readOldPreview().usage.cost, 0.1);
	const again = { ...warming, id: "new-warm", parentId: warming.id };
	next.setSessionEntries([warming, again]);
	assert.match(stripTerminalSequences(editor.render(240).join("\n")), /\$0\.030/);
});
