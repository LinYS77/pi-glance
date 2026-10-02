import { strict as assert } from "node:assert";
import { test } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext, invokeEditorFactory } from "../support/runtime-harness.js";
import type { GlanceEditor } from "../../src/surface/editor.js";

const summary = (type: string, id: string, parentId: string | null, cost: number) => ({
	type, id, parentId, usage: { input: 100, output: 10, cost: { total: cost } },
});

test("persisted boundary summaries settle once without compact events, including preview and final Context", async () => {
	const ctx = createRuntimeTestContext();
	const h = createRuntimeHarness({ git: createGitHarness(), showPaneResults: [{ action: "cancel" }] });
	h.runtime.events.sessionStart({}, ctx.ctx);
	await h.runtime.commands.openPane("", ctx.ctx);
	const state = h.showPanePreviewStates[0]!;
	let renderRequests = 0;
	const editor = invokeEditorFactory(ctx, 0, () => { renderRequests++; }) as GlanceEditor;
	const reads = ctx.getEntryReads();
	const compact = summary("compaction", "boundary", null, 0.25);
	ctx.setSessionEntries([compact]);
	h.showPaneOptions[0]!.getPreviewState!();
	assert.equal(state.usage.cost, 0.25);
	await h.runtime.events.sessionCompact({ compactionEntry: { ...compact } }, ctx.ctx);
	assert.equal(state.usage.cost, 0.25, "late compact notification must not double-count");
	const branch = summary("branch_summary", "branch", compact.id, 0.5);
	ctx.setSessionEntries([compact, branch]);
	ctx.setContextUsage({ tokens: null, contextWindow: 200_000, percent: null });
	const renders = renderRequests;
	h.runtime.events.agentSettled({}, ctx.ctx);
	assert.equal(state.usage.cost, 0.75, "settlement must reconcile even before an editor render");
	assert.deepEqual(state.context, { tokens: null, window: 200_000, percent: null });
	assert.equal(renderRequests, renders + 1);
	h.runtime.events.agentSettled({}, ctx.ctx);
	assert.equal(renderRequests, renders + 1, "unchanged settlement is silent");
	for (let i = 0; i < 20; i++) editor.render(120);
	assert.equal(state.usage.cost, 0.75);
	let lookups = 0;
	const getEntry = ctx.ctx.sessionManager.getEntry;
	ctx.ctx.sessionManager.getEntry = id => { lookups++; return getEntry(id); };
	for (let i = 0; i < 20; i++) editor.render(120);
	assert.equal(lookups, 0, "unchanged frames do not walk entries");
	assert.equal(ctx.getEntryReads(), reads, "no full-history rescan");
	assert.equal(ctx.getBranchReads(), 0);
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
});

test("summary events deduplicate against startup, event-first persistence and tree reconciliation", async () => {
	const initial = summary("compaction", "initial", null, 0.25);
	const ctx = createRuntimeTestContext({ entries: [initial] });
	const h = createRuntimeHarness({ git: createGitHarness(), showPaneResults: [{ action: "cancel" }] });
	h.runtime.events.sessionStart({}, ctx.ctx);
	await h.runtime.commands.openPane("", ctx.ctx);
	const state = h.showPanePreviewStates[0]!;
	await h.runtime.events.sessionCompact({ compactionEntry: { ...initial } }, ctx.ctx);
	assert.equal(state.usage.cost, 0.25, "startup snapshot already includes this entry");
	const next = summary("compaction", "next", initial.id, 0.5);
	await h.runtime.events.sessionCompact({ compactionEntry: next }, ctx.ctx);
	ctx.setSessionEntries([initial, next]);
	h.runtime.events.agentSettled({}, ctx.ctx);
	assert.equal(state.usage.cost, 0.75, "event first, persisted cursor second");
	const reconciled = summary("compaction", "reconciled", next.id, 1);
	ctx.setSessionEntries([initial, next, reconciled]);
	await h.runtime.events.sessionTree({}, ctx.ctx);
	await h.runtime.events.sessionCompact({ compactionEntry: { ...reconciled } }, ctx.ctx);
	assert.equal(state.usage.cost, 1.75, "tree snapshot already includes this entry");
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
	h.runtime.events.sessionStart({}, ctx.ctx);
	assert.equal(h.showPaneOptions[0]!.getPreviewState!().usage.cost, 1.75, "retired preview remains unchanged");
	await h.runtime.events.sessionCompact({ compactionEntry: { ...reconciled } }, ctx.ctx);
	const editor = invokeEditorFactory(ctx, 1, () => {}) as GlanceEditor;
	assert.match(stripTerminalSequences(editor.render(240).join("\n")), /\$1\.75\b/, "reload must retain exact billed totals");
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
});

test("final context edits refresh Context without removing billed messages or counting nested execution events", async () => {
	const assistant = { type: "message", id: "assistant", parentId: null,
		message: { role: "assistant", responseId: "response", usage: { input: 100, cost: { total: 0.25 } } } };
	const tool = { type: "message", id: "tool", parentId: assistant.id,
		message: { role: "toolResult", toolCallId: "parent", usage: { output: 10, cost: { total: 0.5 } } } };
	const ctx = createRuntimeTestContext({ entries: [assistant, tool] });
	const h = createRuntimeHarness({ git: createGitHarness(), showPaneResults: [{ action: "cancel" }] });
	h.runtime.events.sessionStart({}, ctx.ctx);
	await h.runtime.commands.openPane("", ctx.ctx);
	const state = h.showPanePreviewStates[0]!;
	await h.runtime.events.messageEnd({ message: { ...assistant.message } }, ctx.ctx);
	await h.runtime.events.messageEnd({ message: { ...tool.message } }, ctx.ctx);
	await h.runtime.events.toolExecutionEnd({ toolCallId: "parent/1", parentToolCallId: "parent", result: { usage: { cost: { total: 0.2 } } } }, ctx.ctx);
	const reads = ctx.getEntryReads();
	const edit = { type: "context_edit", id: "omission", parentId: tool.id, targetId: assistant.id, replacement: null };
	ctx.setSessionEntries([assistant, tool, edit]);
	ctx.setContextUsage({ tokens: 5, contextWindow: 200_000, percent: 0.0025 });
	h.runtime.events.agentSettled({}, ctx.ctx);
	assert.equal(state.usage.cost, 0.75, "context omission and nested events do not change the billed ledger");
	assert.deepEqual(state.context, { tokens: 5, window: 200_000, percent: 0.0025 });
	ctx.setContextUsage(undefined);
	h.runtime.events.agentSettled({}, ctx.ctx);
	assert.equal(state.context.tokens, null, "absent public Context must clear stale known values");
	assert.equal(state.context.percent, null);
	assert.equal(ctx.getEntryReads(), reads);
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
});
