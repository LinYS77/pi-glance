import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { defaultConfig } from "../../src/config/model.js";
import { RuntimeRefreshSession } from "../../src/runtime/refresh-session.js";
import { createRuntimeRefreshContext } from "../support/runtime-refresh-harness.js";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext } from "../support/runtime-harness.js";

const usage = (cost: number): Usage => ({ input: 100, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 101,
	cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } });

function ledger() {
	const manager = SessionManager.inMemory("/demo");
	const first = manager.appendMessage({ role: "user", content: "DEMO", timestamp: 1 });
	const context = createRuntimeRefreshContext();
	const ctx = { ...context.ctx, sessionManager: manager };
	const config = defaultConfig();
	const refresh = new RuntimeRefreshSession({ getConfig: () => config, ensureConfig: async () => config,
		getThinkingLevel: () => "off", nowMs: () => 0, requestRender() {}, scheduleGitRefresh() {} });
	refresh.sessionStart(ctx);
	return { manager, first, ctx, refresh, context };
}

test("persisted summaries without a session_compact event enter the billed ledger exactly once", async () => {
	const { manager, first, ctx, refresh } = ledger();
	const id = manager.appendCompaction("DEMO boundary summary", first, 100, undefined, true, usage(0.25));
	assert.equal(refresh.ensureState(ctx).usage.cost, 0.25, "boundary compactions are settled facts, not just native compact events");
	const entry = manager.getEntry(id)!;
	await refresh.sessionCompact({ compactionEntry: entry }, ctx);
	assert.equal(refresh.ensureState(ctx).usage.cost, 0.25, "a later event must not duplicate a cursor-settled receipt");
	manager.branchWithSummary(first, "DEMO branch summary", undefined, true, usage(0.5));
	assert.equal(refresh.ensureState(ctx).usage.cost, 0.75, "branch summaries retain earlier billed branches");
	for (let i = 0; i < 10; i++) assert.equal(refresh.ensureState(ctx).usage.cost, 0.75);
	await refresh.sessionTree(ctx);
	assert.equal(refresh.ensureState(ctx).usage.cost, 0.75, "reconciliation cannot duplicate receipts");
	const next = manager.appendCompaction("DEMO native summary", first, 200, undefined, false, usage(0.125));
	await refresh.sessionCompact({ compactionEntry: manager.getEntry(next)! }, ctx);
	assert.equal(refresh.ensureState(ctx).usage.cost, 0.875, "event-first and cursor-first orders agree");
});

test("a reliable snapshot also claims receipts before any delayed event can repeat them", async () => {
	const { manager, first, ctx, refresh } = ledger();
	const id = manager.appendCompaction("DEMO already persisted", first, 100, undefined, true, usage(0.25));
	await refresh.sessionTree(ctx);
	await refresh.sessionCompact({ compactionEntry: manager.getEntry(id)! }, ctx);
	assert.equal(refresh.ensureState(ctx).usage.cost, 0.25);
});

test("final settlement reads Pi's context truth after boundary edits, without replacing billed history", async () => {
	const context = createRuntimeTestContext();
	const h = createRuntimeHarness({ git: createGitHarness(), showPaneResults: [{ action: "cancel" }] });
	h.runtime.events.sessionStart({}, context.ctx);
	await h.runtime.commands.openPane("", context.ctx);
	const state = h.showPanePreviewStates[0]!;
	context.setContextUsage({ tokens: null, contextWindow: 200_000, percent: null });
	context.setSessionEntries([{ type: "compaction", id: "boundary", parentId: null, usage: usage(0.5) }]);
	h.runtime.events.agentSettled({}, context.ctx);
	assert.equal(state.context.tokens, null, "before-settle compaction makes context unknown before another turn starts");
	assert.equal(state.context.percent, null);
	assert.equal(state.usage.cost, 0.5, "settlement also catches receipts while the editor is not rendered");
	const renders = context.getRenderRequests();
	h.runtime.events.agentSettled({}, context.ctx);
	assert.equal(context.getRenderRequests(), renders, "unchanged settlement does not redraw");
	await h.runtime.events.sessionShutdown({}, context.ctx);
});
