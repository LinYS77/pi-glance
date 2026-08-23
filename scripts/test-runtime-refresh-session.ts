import { strict as assert } from "node:assert";
import { RuntimeRefreshSession, type RuntimeRefreshSessionHost } from "../runtime-refresh-session.js";
import type { GlanceConfig } from "../types.js";
import { cloneConfig, branchSummary, compaction, createRuntimeRefreshContext as createContext, gitSnapshot, message } from "./runtime-refresh-harness.js";

interface SessionHarness {
	session: RuntimeRefreshSession;
	getRenderCount(): number;
	getEnsureConfigCount(): number;
	schedules: Array<boolean | undefined>;
	setConfig(config: GlanceConfig): void;
	setNowMs(nowMs: number): void;
	setOnRender(onRender: (() => void) | undefined): void;
}

function eventMessage(role: string, options: { usage?: Record<string, unknown>; stopReason?: string; responseId?: string; toolCallId?: string } = {}) {
	return {
		role,
		usage: options.usage,
		stopReason: options.stopReason,
		responseId: options.responseId,
		toolCallId: options.toolCallId,
	};
}

function messageEnd(message: ReturnType<typeof eventMessage>) {
	return { type: "message_end" as const, message };
}

function createSessionHarness(initialConfig: GlanceConfig = cloneConfig()): SessionHarness {
	let config = initialConfig;
	let renderCount = 0;
	let ensureConfigCount = 0;
	let nowMs = 1000;
	let onRender: (() => void) | undefined;
	const schedules: Array<boolean | undefined> = [];
	const host: RuntimeRefreshSessionHost = {
		getConfig: () => config,
		ensureConfig: async () => {
			ensureConfigCount++;
			return config;
		},
		getThinkingLevel: () => "medium",
		nowMs: () => nowMs,
		requestRender: () => {
			onRender?.();
			renderCount++;
		},
		scheduleGitRefresh: (immediate) => schedules.push(immediate),
	};
	return {
		session: new RuntimeRefreshSession(host),
		getRenderCount: () => renderCount,
		getEnsureConfigCount: () => ensureConfigCount,
		schedules,
		setConfig: (nextConfig) => {
			config = nextConfig;
		},
		setNowMs: (nextNowMs) => {
			nowMs = nextNowMs;
		},
		setOnRender: (nextOnRender) => {
			onRender = nextOnRender;
		},
	};
}

{
	const ctx = createContext({
		cwd: "/initial-repo",
		model: { id: "initial-model", provider: "anthropic", contextWindow: 300_000 },
		contextUsage: { tokens: 123_000, contextWindow: 300_000, percent: 41 },
		availableProviders: ["anthropic", "openai", "anthropic"],
		entries: [message("assistant", { usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.5 } } })],
		branch: [compaction()],
	});
	const harness = createSessionHarness();

	const state = harness.session.ensureState(ctx.ctx);
	assert.equal(ctx.getEntryReads(), 1, "ensureState should create initial state from one full entries scan");
	assert.equal(ctx.getBranchReads(), 0, "ensureState should trust ctx.getContextUsage without a direct branch scan");
	assert.equal(state.workspace.path, "/initial-repo", "ensureState should initialize workspace from full scan");
	assert.equal(state.providers.availableCount, 2, "ensureState should initialize provider count from full scan");
	assert.equal(state.model.id, "initial-model", "ensureState should initialize model from full scan");
	assert.deepEqual(state.usage, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5 }, "ensureState should initialize usage totals from entries");
	assert.equal(state.context.tokens, 123_000, "ensureState should trust public context tokens even when the branch contains a compaction");
	assert.equal(state.context.window, 300_000, "ensureState should initialize context window from public context facts");
	assert.equal(state.context.percent, 41, "ensureState should trust public context percent");

	const sameState = harness.session.ensureState(ctx.ctx);
	assert.equal(sameState, state, "repeated ensureState should return the same state object");
	assert.equal(ctx.getEntryReads(), 1, "repeated ensureState should not rescan entries");
	assert.equal(ctx.getBranchReads(), 0, "repeated ensureState should not scan branch");
}

{
	const ctx = createContext({
		cwd: "/compact-repo",
		model: { id: "compact-model", provider: "openai", contextWindow: 222_000 },
		contextUsage: { tokens: 88_000, contextWindow: 222_000, percent: 39.6 },
		entries: [message("assistant", { usage: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: { total: 0.25 } } })],
		branch: [message("assistant", { usage: { totalTokens: 1 } })],
	});
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	const entryBaseline = ctx.getEntryReads();
	const branchBaseline = ctx.getBranchReads();
	const compactEntry = compaction({ id: "compact-1", usage: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, cost: { total: 0.75 } } });

	ctx.setContextUsage({ tokens: null, contextWindow: 222_000, percent: null });
	await harness.session.sessionCompact({ compactionEntry: compactEntry }, ctx.ctx);
	assert.equal(ctx.getEntryReads(), entryBaseline, "session compact should apply event usage without rescanning entries");
	assert.equal(ctx.getBranchReads(), branchBaseline, "session compact should not directly scan branch");
	assert.deepEqual(state.usage, { input: 7, output: 9, cacheRead: 11, cacheWrite: 13, cost: 1 }, "session compact should add compaction-entry billed usage to existing session totals");
	assert.equal(state.context.tokens, null, "session compact should use public null context tokens");
	assert.equal(state.context.window, 222_000, "session compact should keep the public context window");
	assert.equal(state.context.percent, null, "session compact should use public null context percent");
	assert.deepEqual(harness.schedules, [true], "session compact should schedule immediate git refresh");
	assert.equal(harness.getRenderCount(), 1, "session compact should request one render after plan and delta application");

	await harness.session.sessionCompact({ compactionEntry: { ...compactEntry } }, ctx.ctx);
	assert.deepEqual(state.usage, { input: 7, output: 9, cacheRead: 11, cacheWrite: 13, cost: 1 }, "session compact should dedupe repeated entry ids");

	ctx.setContextUsage({ tokens: 55_000, contextWindow: 222_000, percent: 24.8 });
	await harness.session.execute("model_select", ctx.ctx);
	assert.equal(state.context.tokens, 55_000, "later lifecycle refresh should use newly known public context tokens directly");
	assert.equal(state.context.percent, 24.8, "later lifecycle refresh should use newly known public context percent directly");
}

{
	const ctx = createContext({
		cwd: "/reliable-repo",
		model: { id: "reliable-model", provider: "anthropic", contextWindow: 200_000 },
		contextUsage: { tokens: 66_000, contextWindow: 200_000, percent: 33 },
		entries: [
			message("assistant", { usage: { input: 1, output: 1, cost: { total: 0.1 } } }),
			message("toolResult", { usage: { input: 2, output: 3, cost: { total: 0.2 } } }),
			compaction({ id: "compact-reliable", usage: { input: 4, output: 5, cost: { total: 0.3 } } }),
			branchSummary({ id: "summary-reliable", usage: { input: 6, output: 7, cost: { total: 0.4 } } }),
		],
		branch: [compaction()],
	});
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	assert.deepEqual(state.usage, { input: 13, output: 16, cacheRead: 0, cacheWrite: 0, cost: 1 }, "initial reliable state should include every Pi 0.84 billed usage source");
	const branchBaseline = ctx.getBranchReads();

	ctx.setEntries([
		message("assistant", { usage: { input: 10, output: 20, cost: { total: 1 } } }),
		message("toolResult", { usage: { input: 30, output: 40, cost: { total: 2 } } }),
		branchSummary({ id: "summary-next", usage: { input: 50, output: 60, cost: { total: 3 } } }),
	]);
	ctx.setContextUsage({ tokens: null, contextWindow: 200_000, percent: null });
	await harness.session.execute("session_tree", ctx.ctx);
	assert.deepEqual(state.usage, { input: 90, output: 120, cacheRead: 0, cacheWrite: 0, cost: 6 }, "session_tree reliable reconciliation should include assistant, tool, and branch-summary usage");
	assert.equal(ctx.getBranchReads(), branchBaseline, "session_tree reconciliation should not duplicate public context truth with a branch scan");
	assert.equal(state.context.tokens, null, "session_tree should accept public unknown context tokens");
	assert.equal(state.context.percent, null, "session_tree should accept public unknown context percent");

	ctx.setContextUsage({ tokens: 88_000, contextWindow: 200_000, percent: 44 });
	await harness.session.execute("session_tree", ctx.ctx);
	assert.equal(state.context.tokens, 88_000, "session_tree should restore context directly when the public API reports known tokens");
	assert.equal(state.context.percent, 44, "session_tree should restore context directly when the public API reports known percent");
}

{
	const ctx = createContext({ cwd: "/git-repo" });
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	const baselineRenderCount = harness.getRenderCount();

	assert.equal(harness.session.applyGitSnapshot("/other-repo", gitSnapshot("other")), false, "stale git snapshot should be ignored");
	assert.equal(harness.getRenderCount(), baselineRenderCount, "stale git snapshot should not request render");
	assert.equal(state.git.branch, null, "stale git snapshot should not update state");

	assert.equal(harness.session.applyGitSnapshot("/git-repo", gitSnapshot("main", 1000)), true, "matching changed git snapshot should update state");
	assert.equal(harness.getRenderCount(), baselineRenderCount + 1, "matching changed git snapshot should request render");
	assert.equal(state.git.branch, "main", "matching git snapshot should update state branch");

	assert.equal(harness.session.applyGitSnapshot("/git-repo", gitSnapshot("main", 2000)), false, "same git facts with newer updatedAt should not count as a visible state change");
	assert.equal(harness.getRenderCount(), baselineRenderCount + 1, "same git facts should not request another render");
	assert.equal(state.git.updatedAt, 2000, "same git facts should still refresh snapshot timestamp");

	assert.equal(harness.session.applyGitSnapshot("/git-repo", gitSnapshot("feature", 3000)), true, "changed git facts should update state again");
	assert.equal(harness.getRenderCount(), baselineRenderCount + 2, "changed git facts should request another render");
	assert.equal(state.git.branch, "feature", "changed git facts should update branch");
}

{
	const ctx = createContext({ contextUsage: { tokens: 10_000, contextWindow: 200_000, percent: 5 } });
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	const entryBaseline = ctx.getEntryReads();
	const branchBaseline = ctx.getBranchReads();
	const assistant = eventMessage("assistant", {
		responseId: "response-1",
		usage: { input: 3, output: 4, cacheRead: 5, cacheWrite: 6, totalTokens: 18, cost: { total: 0.9 } },
	});

	await harness.session.messageEnd(messageEnd(assistant), ctx.ctx);
	assert.deepEqual(state.usage, { input: 3, output: 4, cacheRead: 5, cacheWrite: 6, cost: 0.9 }, "assistant messageEnd should apply responseId usage delta once");
	await harness.session.messageEnd(messageEnd({ ...assistant }), ctx.ctx);
	assert.deepEqual(state.usage, { input: 3, output: 4, cacheRead: 5, cacheWrite: 6, cost: 0.9 }, "assistant messageEnd should dedupe cloned messages by responseId");
	assert.equal(ctx.getEntryReads(), entryBaseline, "assistant messageEnd should not scan entries");
	assert.equal(ctx.getBranchReads(), branchBaseline, "assistant messageEnd should not scan branch");

	harness.session.resetAccumulators();
	await harness.session.messageEnd(messageEnd({ ...assistant }), ctx.ctx);
	assert.deepEqual(state.usage, { input: 6, output: 8, cacheRead: 10, cacheWrite: 12, cost: 1.8 }, "resetAccumulators should clear responseId usage dedupe");
}

{
	const ctx = createContext({ contextUsage: { tokens: 10_000, contextWindow: 200_000, percent: 5 } });
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	const assistant = eventMessage("assistant", {
		usage: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, totalTokens: 14, cost: { total: 0.7 } },
	});

	await harness.session.messageEnd(messageEnd(assistant), ctx.ctx);
	assert.deepEqual(state.usage, { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: 0.7 }, "assistant messageEnd should apply no-responseId usage delta once");
	await harness.session.messageEnd(messageEnd(assistant), ctx.ctx);
	assert.deepEqual(state.usage, { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: 0.7 }, "assistant messageEnd should dedupe no-responseId messages by object identity");
}

{
	const ctx = createContext({ contextUsage: { tokens: 10_000, contextWindow: 200_000, percent: 5 } });
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	const entryBaseline = ctx.getEntryReads();
	const branchBaseline = ctx.getBranchReads();
	const toolResult = eventMessage("toolResult", {
		toolCallId: "tool-call-1",
		usage: { input: 11, output: 12, cacheRead: 13, cacheWrite: 14, totalTokens: 50, cost: { total: 1.1 } },
	});

	await harness.session.messageEnd(messageEnd(toolResult), ctx.ctx);
	assert.deepEqual(state.usage, { input: 11, output: 12, cacheRead: 13, cacheWrite: 14, cost: 1.1 }, "usage-bearing toolResult messageEnd should update complete session totals incrementally");
	await harness.session.messageEnd(messageEnd({ ...toolResult }), ctx.ctx);
	assert.deepEqual(state.usage, { input: 11, output: 12, cacheRead: 13, cacheWrite: 14, cost: 1.1 }, "toolResult messageEnd should dedupe cloned events by toolCallId");
	assert.equal(ctx.getEntryReads(), entryBaseline, "toolResult messageEnd should not scan entries");
	assert.equal(ctx.getBranchReads(), branchBaseline, "toolResult messageEnd should not scan branch");
}

{
	const ctx = createContext({ contextUsage: { tokens: 10_000, contextWindow: 200_000, percent: 5 } });
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	const toolResult = eventMessage("toolResult", {
		usage: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, totalTokens: 14, cost: { total: 0.7 } },
	});

	await harness.session.messageEnd(messageEnd(toolResult), ctx.ctx);
	await harness.session.messageEnd(messageEnd(toolResult), ctx.ctx);
	assert.deepEqual(state.usage, { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: 0.7 }, "toolResult without toolCallId should dedupe by object identity");
}

{
	const ctx = createContext({
		contextUsage: { tokens: 10_000, contextWindow: 200_000, percent: 5 },
		entries: [message("assistant", { usage: { input: 9, output: 9, cost: { total: 0.9 } } })],
		branch: [compaction()],
	});
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	const entryBaseline = ctx.getEntryReads();
	const branchBaseline = ctx.getBranchReads();
	const renderBaseline = harness.getRenderCount();

	await harness.session.messageEnd(messageEnd(eventMessage("user", { usage: { input: 100, output: 200, totalTokens: 300, cost: { total: 99 } } })), ctx.ctx);
	assert.deepEqual(state.usage, { input: 9, output: 9, cacheRead: 0, cacheWrite: 0, cost: 0.9 }, "non-assistant messageEnd should not apply usage deltas");
	assert.equal(harness.getRenderCount(), renderBaseline, "non-assistant messageEnd should not render");
	assert.equal(ctx.getEntryReads(), entryBaseline, "non-assistant messageEnd should not scan entries");
	assert.equal(ctx.getBranchReads(), branchBaseline, "non-assistant messageEnd should not scan branch");
}

{
	const ctx = createContext({
		model: { id: "compact-message-model", provider: "anthropic", contextWindow: 200_000 },
		contextUsage: { tokens: 10_000, contextWindow: 200_000, percent: 5 },
	});
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	ctx.setContextUsage({ tokens: null, contextWindow: 200_000, percent: null });
	await harness.session.sessionCompact({ compactionEntry: compaction({ id: "context-compact" }) }, ctx.ctx);
	assert.equal(state.context.tokens, null, "public context null after compact should be reflected directly");

	ctx.setContextUsage({ tokens: 64_000, contextWindow: 200_000, percent: 32 });
	await harness.session.messageEnd(messageEnd(eventMessage("assistant", { responseId: "known-context", usage: { input: 1, output: 2, totalTokens: 3, cost: { total: 0.1 } } })), ctx.ctx);
	assert.equal(state.context.tokens, 64_000, "known assistant messageEnd should refresh directly from public context truth");
	assert.equal(state.context.percent, 32, "known assistant messageEnd should refresh public context percent");
}

{
	const ctx = createContext({ contextUsage: { tokens: 10_000, contextWindow: 200_000, percent: 5 } });
	const harness = createSessionHarness();
	harness.session.agentStart();
	assert.equal(harness.getRenderCount(), 0, "agentStart without state should not ensure state or render");
	assert.equal(ctx.getEntryReads(), 0, "agentStart without state should not scan entries");
	assert.equal(ctx.getBranchReads(), 0, "agentStart without state should not scan branch");

	const state = harness.session.ensureState(ctx.ctx);
	const entryBaseline = ctx.getEntryReads();
	const branchBaseline = ctx.getBranchReads();
	harness.session.agentStart();
	assert.equal(harness.getRenderCount(), 0, "agentStart with no visible throughput change should not render");
	harness.setNowMs(1000);
	harness.session.messageUpdate({ message: eventMessage("assistant", { usage: { output: 10, totalTokens: 10 } }), assistantMessageEvent: { type: "text_delta" } });
	harness.setNowMs(1500);
	harness.session.messageUpdate({ message: eventMessage("assistant", { usage: { output: 10, totalTokens: 10 } }), assistantMessageEvent: { type: "text_delta" } });
	harness.setOnRender(() => {
		assert.ok(state.throughput.currentRun, "messageEnd should set current-run model speed before render");
	});
	await harness.session.messageEnd(messageEnd(eventMessage("assistant", { usage: { output: 10, totalTokens: 10 } })), ctx.ctx);
	harness.setOnRender(undefined);
	assert.ok(state.throughput.currentRun, "completed message stream should leave current-run model speed visible");
	assert.equal(state.throughput.currentRun?.elapsedMs, 500, "model speed should use active stream time rather than task wall time");
	assert.equal(ctx.getEntryReads(), entryBaseline, "message stream events should not scan entries after baseline");
	assert.equal(ctx.getBranchReads(), branchBaseline, "message stream events should not scan branch after baseline");

	const renderAfterMessageEnd = harness.getRenderCount();
	harness.session.agentStart();
	assert.ok(state.throughput.currentRun, "continuation agentStart should preserve the provisional settled-run aggregate");
	assert.equal(harness.getRenderCount(), renderAfterMessageEnd, "continuation agentStart should not render when visible model speed is unchanged");
	await harness.session.agentEnd({ messages: [eventMessage("assistant", { usage: { output: 10, totalTokens: 10 } })] }, ctx.ctx);
	assert.equal(state.throughput.lastRun, null, "agentEnd should not finalize while retry or queued continuation may still follow");
	assert.ok(state.throughput.currentRun, "agentEnd should leave model speed provisional");
	harness.setOnRender(() => {
		assert.ok(state.throughput.lastRun, "agentSettled should set final model speed before render");
		assert.equal(state.throughput.currentRun, null, "agentSettled should clear provisional model speed before render");
	});
	harness.session.agentSettled();
	harness.setOnRender(undefined);
	const settledSpeed = state.throughput.lastRun as { elapsedMs: number } | null;
	assert.equal(settledSpeed?.elapsedMs, 500, "agentSettled should preserve active model stream duration");
	const renderAfterSettled = harness.getRenderCount();
	harness.session.agentStart();
	assert.ok(state.throughput.lastRun, "a new logical run should preserve the previous trusted model speed");
	assert.equal(state.throughput.currentRun, null, "a new logical run should begin without a provisional measurement");
	assert.equal(harness.getRenderCount(), renderAfterSettled, "new agentStart should not render when currentRun is already clear");
}

{
	const ctx = createContext({ contextUsage: { tokens: 10_000, contextWindow: 200_000, percent: 5 } });
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	const entryBaseline = ctx.getEntryReads();
	const branchBaseline = ctx.getBranchReads();
	harness.session.agentStart();
	harness.setNowMs(1000);
	harness.session.messageUpdate({ message: eventMessage("assistant", { usage: { output: 4, totalTokens: 4 } }), assistantMessageEvent: { type: "text_delta" } });
	harness.setNowMs(1400);
	harness.session.messageUpdate({ message: eventMessage("assistant", { usage: { output: 4, totalTokens: 4 } }), assistantMessageEvent: { type: "text_delta" } });
	await harness.session.messageEnd(messageEnd(eventMessage("assistant", { usage: { output: 4, totalTokens: 4 } })), ctx.ctx);
	assert.ok(state.throughput.currentRun, "setup message stream should set current-run model speed");
	harness.setOnRender(() => {
		assert.equal(state.throughput.lastRun, null, "agentEnd render should keep final model speed unchanged");
		assert.ok(state.throughput.currentRun, "agentEnd render should keep current-run model speed provisional");
	});
	await harness.session.agentEnd({ messages: [eventMessage("assistant", { usage: { output: 4, totalTokens: 4 } })] }, ctx.ctx);
	harness.setOnRender(undefined);
	assert.equal(state.throughput.lastRun, null, "agentEnd should not finalize model speed");
	assert.ok(state.throughput.currentRun, "agentEnd should leave current-run model speed visible");
	harness.setOnRender(() => {
		assert.ok(state.throughput.lastRun, "agentSettled should set last-run model speed before render");
		assert.equal(state.throughput.currentRun, null, "agentSettled should clear current-run model speed before render");
	});
	harness.session.agentSettled();
	harness.setOnRender(undefined);
	assert.ok(state.throughput.lastRun, "agentSettled should leave final model speed visible");
	assert.equal(state.throughput.currentRun, null, "agentSettled should leave provisional model speed cleared");
	const settledSpeed = state.throughput.lastRun as { elapsedMs: number } | null;
	assert.equal(settledSpeed?.elapsedMs, 400, "agentSettled should preserve active model stream duration");
	assert.equal(ctx.getEntryReads(), entryBaseline, "agentEnd/agentSettled should not scan entries after baseline");
	assert.equal(ctx.getBranchReads(), branchBaseline, "agentEnd/agentSettled should not scan branch after baseline");
}

{
	const ctx = createContext({ contextUsage: { tokens: 10_000, contextWindow: 200_000, percent: 5 } });
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	const assistant = eventMessage("assistant", { responseId: "reset-me", usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0.1 } } });
	await harness.session.messageEnd(messageEnd(assistant), ctx.ctx);
	await harness.session.messageEnd(messageEnd({ ...assistant }), ctx.ctx);
	assert.deepEqual(state.usage, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.1 }, "setup should confirm assistant responseId dedupe is active");

	harness.session.resetAccumulators();
	await harness.session.messageEnd(messageEnd({ ...assistant }), ctx.ctx);
	assert.deepEqual(state.usage, { input: 2, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.2 }, "resetAccumulators should clear assistant responseId dedupe");

	harness.session.agentStart();
	harness.setNowMs(2000);
	harness.session.sessionShutdown();
	await harness.session.agentEnd({ messages: [eventMessage("assistant", { usage: { output: 10, totalTokens: 10 } })] }, ctx.ctx);
	harness.session.agentSettled();
	assert.equal(state.throughput.lastRun, null, "sessionShutdown should reset the tracker so later end/settled events cannot create final model speed");
}

console.log("✓ runtime refresh session checks passed");
