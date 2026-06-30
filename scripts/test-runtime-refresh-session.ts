import { strict as assert } from "node:assert";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../config.js";
import { RuntimeRefreshSession, type RuntimeRefreshSessionHost } from "../runtime-refresh-session.js";
import type { StateSessionEntry } from "../runtime-snapshot.js";
import type { GitSnapshot, GlanceConfig } from "../types.js";

interface MutableModelInfo {
	id?: string;
	provider?: string;
	contextWindow?: number;
}

interface MutableContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

interface ContextHarness {
	ctx: ExtensionContext;
	getEntryReads(): number;
	getBranchReads(): number;
	setCwd(cwd: string): void;
	setEntries(entries: readonly StateSessionEntry[]): void;
	setBranch(branch: readonly StateSessionEntry[]): void;
	setContextUsage(contextUsage: MutableContextUsage | undefined): void;
	setModel(model: MutableModelInfo | undefined): void;
	setAvailableProviders(providers: readonly string[]): void;
}

interface SessionHarness {
	session: RuntimeRefreshSession;
	getRenderCount(): number;
	getEnsureConfigCount(): number;
	schedules: Array<boolean | undefined>;
	setConfig(config: GlanceConfig): void;
}

function cloneConfig(config: GlanceConfig = defaultConfig()): GlanceConfig {
	return JSON.parse(JSON.stringify(config)) as GlanceConfig;
}

function message(role: string, options: { usage?: Record<string, unknown>; stopReason?: string } = {}): StateSessionEntry {
	return {
		type: "message",
		message: {
			role,
			usage: options.usage,
			stopReason: options.stopReason,
		},
	};
}

function compaction(): StateSessionEntry {
	return { type: "compaction" };
}

function gitSnapshot(branch = "main", updatedAt = 1000): GitSnapshot {
	return {
		repo: true,
		branch,
		detached: false,
		sha: "abcdef1",
		upstream: null,
		ahead: 0,
		behind: 0,
		staged: 0,
		unstaged: 1,
		untracked: 0,
		conflicts: 0,
		dirty: true,
		status: "dirty",
		updatedAt,
	};
}

function createContext(options: { cwd?: string; model?: MutableModelInfo; contextUsage?: MutableContextUsage; availableProviders?: readonly string[]; entries?: readonly StateSessionEntry[]; branch?: readonly StateSessionEntry[] } = {}): ContextHarness {
	let cwd = options.cwd ?? "/repo";
	let model: MutableModelInfo | undefined = options.model ?? { id: "test-model", provider: "test-provider", contextWindow: 200_000 };
	let contextUsage: MutableContextUsage | undefined = options.contextUsage ?? { tokens: 42_000, contextWindow: model.contextWindow ?? 200_000, percent: 21 };
	let availableProviders = options.availableProviders ?? [model.provider ?? "test-provider"];
	let entries = options.entries ?? [];
	let branch = options.branch ?? [];
	let entryReads = 0;
	let branchReads = 0;

	const ctx = {
		get cwd() {
			return cwd;
		},
		get model() {
			return model;
		},
		modelRegistry: {
			getAvailable: () => availableProviders.map((provider, index) => ({ provider, id: `${provider}-model-${index}` })),
		},
		getContextUsage: () => contextUsage,
		sessionManager: {
			getCwd: () => cwd,
			getEntries: () => {
				entryReads++;
				return entries;
			},
			getBranch: () => {
				branchReads++;
				return branch;
			},
		},
	} as unknown as ExtensionContext;

	return {
		ctx,
		getEntryReads: () => entryReads,
		getBranchReads: () => branchReads,
		setCwd: (nextCwd) => {
			cwd = nextCwd;
		},
		setEntries: (nextEntries) => {
			entries = nextEntries;
		},
		setBranch: (nextBranch) => {
			branch = nextBranch;
		},
		setContextUsage: (nextContextUsage) => {
			contextUsage = nextContextUsage;
		},
		setModel: (nextModel) => {
			model = nextModel;
		},
		setAvailableProviders: (nextProviders) => {
			availableProviders = nextProviders;
		},
	};
}

function createSessionHarness(initialConfig: GlanceConfig = cloneConfig()): SessionHarness {
	let config = initialConfig;
	let renderCount = 0;
	let ensureConfigCount = 0;
	const schedules: Array<boolean | undefined> = [];
	const host: RuntimeRefreshSessionHost = {
		getConfig: () => config,
		ensureConfig: async () => {
			ensureConfigCount++;
			return config;
		},
		getThinkingLevel: () => "medium",
		requestRender: () => {
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
	assert.equal(ctx.getBranchReads(), 1, "ensureState should sync context-unknown state from one full branch scan");
	assert.equal(state.workspace.path, "/initial-repo", "ensureState should initialize workspace from full scan");
	assert.equal(state.providers.availableCount, 2, "ensureState should initialize provider count from full scan");
	assert.equal(state.model.id, "initial-model", "ensureState should initialize model from full scan");
	assert.deepEqual(state.usage, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5 }, "ensureState should initialize usage totals from entries");
	assert.equal(state.context.tokens, null, "ensureState should suppress context tokens when the full scan marks context unknown");
	assert.equal(state.context.window, 300_000, "ensureState should still initialize context window when context is unknown");
	assert.equal(state.context.percent, null, "ensureState should suppress context percent when the full scan marks context unknown");

	const sameState = harness.session.ensureState(ctx.ctx);
	assert.equal(sameState, state, "repeated ensureState should return the same state object");
	assert.equal(ctx.getEntryReads(), 1, "repeated ensureState should not rescan entries");
	assert.equal(ctx.getBranchReads(), 1, "repeated ensureState should not rescan branch");
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
	assert.equal(state.context.tokens, 88_000, "baseline state should start with known context usage");
	const entryBaseline = ctx.getEntryReads();
	const branchBaseline = ctx.getBranchReads();

	ctx.setEntries([message("assistant", { usage: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, cost: { total: 0.75 } } })]);
	ctx.setContextUsage({ tokens: 99_000, contextWindow: 222_000, percent: 44.5 });
	await harness.session.execute("session_compact", ctx.ctx);
	assert.equal(ctx.getEntryReads(), entryBaseline + 1, "session compact execute should scan entries for usage totals");
	assert.equal(ctx.getBranchReads(), branchBaseline, "session compact execute should not scan branch");
	assert.deepEqual(state.usage, { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, cost: 0.75 }, "session compact should update usage totals");
	assert.equal(state.context.tokens, null, "session compact should clear visible context tokens");
	assert.equal(state.context.window, 222_000, "session compact should keep context window from current model");
	assert.equal(state.context.percent, null, "session compact should clear visible context percent");
	assert.deepEqual(harness.schedules, [true], "session compact should schedule immediate git refresh");
	assert.equal(harness.getRenderCount(), 1, "session compact should request one render after plan application");

	ctx.setContextUsage({ tokens: 55_000, contextWindow: 222_000, percent: 24.8 });
	await harness.session.execute("model_select", ctx.ctx);
	assert.equal(state.context.tokens, null, "lifecycle execute should not refill stale context while session context is unknown");
	assert.equal(state.context.percent, null, "lifecycle execute should keep percent unknown while session context is unknown");

	harness.session.clearContextUnknownAfterKnownAssistantUsage({ role: "assistant", usage: { totalTokens: 1 } });
	await harness.session.execute("model_select", ctx.ctx);
	assert.equal(state.context.tokens, 55_000, "known assistant usage should clear session context-unknown state before the next lifecycle refresh");
	assert.equal(state.context.percent, 24.8, "known assistant usage should allow lifecycle context percent to refresh");
}

{
	const ctx = createContext({
		cwd: "/reliable-repo",
		model: { id: "reliable-model", provider: "anthropic", contextWindow: 200_000 },
		contextUsage: { tokens: 66_000, contextWindow: 200_000, percent: 33 },
		entries: [message("assistant", { usage: { input: 1, output: 1, cost: { total: 0.1 } } })],
		branch: [message("assistant", { usage: { totalTokens: 1 } })],
	});
	const harness = createSessionHarness();
	const state = harness.session.ensureState(ctx.ctx);
	assert.equal(state.context.tokens, 66_000, "baseline reliable-sync state should start known");

	ctx.setBranch([compaction()]);
	ctx.setContextUsage({ tokens: 77_000, contextWindow: 200_000, percent: 38.5 });
	await harness.session.execute("session_tree", ctx.ctx);
	assert.equal(state.context.tokens, null, "reliable execute should sync unknown=true from full branch scan");
	assert.equal(state.context.percent, null, "reliable execute should clear percent when branch says context is unknown");

	ctx.setBranch([compaction(), message("assistant", { usage: { totalTokens: 1 } })]);
	ctx.setContextUsage({ tokens: 88_000, contextWindow: 200_000, percent: 44 });
	await harness.session.execute("session_tree", ctx.ctx);
	assert.equal(state.context.tokens, 88_000, "reliable execute should sync unknown=false from full branch scan");
	assert.equal(state.context.percent, 44, "reliable execute should restore context percent after full branch scan clears unknown");
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

console.log("✓ runtime refresh session checks passed");
