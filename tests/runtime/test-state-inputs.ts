import { strict as assert } from "node:assert";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { BilledSessionLedger, type StateSessionEntry } from "../../src/runtime/billed-session-ledger.js";
import { lifecycleInputsFromContext, thinkingInputsFromContext } from "../../src/runtime/snapshot.js";
import { createInitialState, setProviderCount } from "../../src/runtime/state.js";

function message(role: string, options: { usage?: Record<string, unknown>; stopReason?: string } = {}): StateSessionEntry {
	return {
		type: "message",
		message: {
			role,
			usage: options.usage,
			stopReason: options.stopReason,
		},
	} as StateSessionEntry;
}

interface FakeContextOptions {
	cwd?: string;
	sessionCwd?: string;
	model?: { id?: string; name?: string; provider?: string; contextWindow?: number };
	contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
	availableProviders?: readonly unknown[];
	scopedProviders?: readonly unknown[];
}

function fakeContext(options: FakeContextOptions = {}): ExtensionContext {
	return {
		cwd: options.cwd ?? "/fallback",
		model: options.model,
		modelRegistry: {
			getAvailable: () => (options.availableProviders ?? ["test-provider"]).map((provider, index) => ({ provider, id: `model-${index}` })),
		},
		scopedModels: (options.scopedProviders ?? []).map((provider, index) => ({ model: { provider, id: `scoped-model-${index}` } })),
		getContextUsage: () => options.contextUsage,
		sessionManager: {
			getCwd: () => options.sessionCwd,
		},
	} as unknown as ExtensionContext;
}

const emptyUsage = new BilledSessionLedger().totals;

const fallbackInputs = lifecycleInputsFromContext(fakeContext({ cwd: "/fallback", sessionCwd: "" }), "medium");
assert.equal(fallbackInputs.cwd, "/fallback", "cwd should fall back to ctx.cwd when session cwd is empty");
assert.equal(fallbackInputs.thinkingLevel, "medium", "thinking level should be copied from caller input");

const sessionCwdInputs = lifecycleInputsFromContext(fakeContext({ cwd: "/fallback", sessionCwd: "/workspace" }), "high");
assert.equal(sessionCwdInputs.cwd, "/workspace", "session cwd should win over ctx.cwd");

const modelInputs = lifecycleInputsFromContext(
	fakeContext({
		model: {
			id: "claude-test",
			name: "Claude Test Friendly",
			provider: "anthropic",
			contextWindow: 200000,
			ignored: "drop-me",
		} as { id?: string; name?: string; provider?: string; contextWindow?: number } & { ignored?: string },
	}),
	"off",
);
assert.deepEqual(
	modelInputs.model,
	{ id: "claude-test", name: "Claude Test Friendly", provider: "anthropic", contextWindow: 200000 },
	"model extraction should copy the public id/name/provider/contextWindow facts",
);
assert.equal(lifecycleInputsFromContext(fakeContext({ model: undefined }), "off").model, undefined, "undefined ctx.model should produce undefined model inputs");

const contextUsageInputs = lifecycleInputsFromContext(
	fakeContext({ contextUsage: { tokens: null, contextWindow: 128000, percent: null } }),
	"off",
);
assert.deepEqual(
	contextUsageInputs.contextUsage,
	{ tokens: null, contextWindow: 128000, percent: null },
	"present context usage should be copied exactly",
);
assert.equal(lifecycleInputsFromContext(fakeContext({ contextUsage: undefined }), "off").contextUsage, undefined, "missing context usage should stay undefined");
assert.equal(lifecycleInputsFromContext(fakeContext({ availableProviders: ["openai", "anthropic", "openai", ""] }), "off").availableProviderCount, 2, "provider count should deduplicate non-empty available provider names from modelRegistry");
assert.equal(lifecycleInputsFromContext(fakeContext({ availableProviders: [] }), "off").availableProviderCount, 1, "provider count should keep one-provider fallback when no available models are configured");
assert.equal(lifecycleInputsFromContext(fakeContext({ availableProviders: [undefined, 123] }), "off").availableProviderCount, 1, "provider count should ignore invalid provider names and keep fallback minimum");
assert.equal(
	lifecycleInputsFromContext(fakeContext({ availableProviders: ["openai", "anthropic", "local"], scopedProviders: ["anthropic", "anthropic"] }), "off").availableProviderCount,
	1,
	"non-empty ctx.scopedModels should define the provider count instead of the full model registry",
);
assert.equal(
	lifecycleInputsFromContext(fakeContext({ availableProviders: ["openai", "anthropic"], scopedProviders: [] }), "off").availableProviderCount,
	2,
	"empty ctx.scopedModels should fall back to every available registry model",
);

{
	const state = createInitialState({ ...lifecycleInputsFromContext(fakeContext({ availableProviders: ["a", "b"] }), "off"), usage: emptyUsage }, defaultConfig());
	const version = state.version;
	assert.equal(setProviderCount(state, 2), false);
	assert.equal(state.version, version, "an unchanged provider count cannot invalidate the display");
	assert.equal(setProviderCount(state, 3), true);
	assert.equal(state.providers.availableCount, 3);
	assert.equal(state.version, version + 1);
	assert.equal(setProviderCount(state, 3), false);
	assert.equal(state.version, version + 1);
}

const friendlyModelState = createInitialState({ ...modelInputs, usage: emptyUsage }, defaultConfig());
assert.equal(friendlyModelState.model.displayName, "Claude Test Friendly", "state should prefer Pi's public model.name over id shortening");
const customNameConfig = defaultConfig();
customNameConfig.model.customNames["claude-test"] = "User Override";
assert.equal(createInitialState({ ...modelInputs, usage: emptyUsage }, customNameConfig).model.displayName, "User Override", "configured custom model names should continue to override Pi model.name");

const cheapThinkingInputs = thinkingInputsFromContext(
	{
		model: { id: "cheap-model", provider: "cheap-provider", contextWindow: 123000 },
		modelRegistry: {
			getAvailable: () => [{ provider: "cheap-provider" }, { provider: "other-provider" }, { provider: "cheap-provider" }],
		},
		getContextUsage: () => {
			throw new Error("thinking inputs should not read context usage");
		},
		sessionManager: {
			getCwd: () => {
				throw new Error("thinking inputs should not read session cwd");
			},
			getEntries: () => {
				throw new Error("thinking inputs should not scan session entries");
			},
			getBranch: () => {
				throw new Error("thinking inputs should not scan session branch");
			},
		},
	} as unknown as ExtensionContext,
	"high",
);
assert.deepEqual(
	cheapThinkingInputs,
	{
		model: { id: "cheap-model", provider: "cheap-provider", contextWindow: 123000 },
		thinkingLevel: "high",
		availableProviderCount: 2,
	},
	"thinkingInputsFromContext should read only cheap model/thinking/provider facts",
);

const narrowLifecycleInputs = lifecycleInputsFromContext(
	{
		cwd: "/fallback-lifecycle",
		model: { id: "lifecycle-model", provider: "lifecycle-provider", contextWindow: 456000 },
		modelRegistry: {
			getAvailable: () => [{ provider: "lifecycle-provider" }, { provider: "other-provider" }, { provider: "" }],
		},
		getContextUsage: () => ({ tokens: 456, contextWindow: 456000, percent: 0.1 }),
		sessionManager: {
			getCwd: () => "/workspace-lifecycle",
			getEntries: () => {
				throw new Error("lifecycle inputs should not scan session entries");
			},
			getBranch: () => {
				throw new Error("lifecycle inputs should not scan session branch");
			},
		},
	} as unknown as ExtensionContext,
	"medium",
);
assert.deepEqual(
	narrowLifecycleInputs,
	{
		cwd: "/workspace-lifecycle",
		model: { id: "lifecycle-model", provider: "lifecycle-provider", contextWindow: 456000 },
		thinkingLevel: "medium",
		availableProviderCount: 2,
		contextUsage: { tokens: 456, contextWindow: 456000, percent: 0.1 },
	},
	"lifecycleInputsFromContext should read workspace/model/thinking/provider/context without entries or branch scans",
);

assert.deepEqual(
	new BilledSessionLedger().rebuild([
		message("user", { usage: { input: 100, output: 200, cacheRead: 300, cacheWrite: 400, cost: { total: 999 } } }),
		{ type: "tool", message: { role: "assistant", usage: { input: 100 } } } as StateSessionEntry,
		message("assistant", { usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.25, input: 10 } } }),
		message("toolResult", { usage: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4 } } }),
		message("assistant"),
	]),
	{ input: 6, output: 8, cacheRead: 10, cacheWrite: 12, cost: 1.25 },
	"billed messages prefer finite cost.total, fall back to cost components, and default missing usage to 0",
);

assert.deepEqual(
	new BilledSessionLedger().rebuild([
		message("assistant", { usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.1 } } }),
		message("toolResult", { usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cost: { total: 1 } } }),
		{ type: "compaction", usage: { input: 100, output: 200, cacheRead: 300, cacheWrite: 400, cost: { total: 10 } } },
		{ type: "branch_summary", usage: { input: 1000, output: 2000, cacheRead: 3000, cacheWrite: 4000, cost: { total: 100 } } },
	]),
	{ input: 1111, output: 2222, cacheRead: 3333, cacheWrite: 4444, cost: 111.1 },
	"usage totals should match Pi billed-session semantics across assistant, toolResult, compaction, and branch-summary usage",
);

const usageEntries = [
	{ type: "usage", kind: "cache_warm", usage: { output: 1, cacheRead: 50_000, cost: { total: 0.015015 } } },
	{ type: "usage", kind: "future-operation", usage: { input: 20, output: 2, cacheWrite: 30, cost: { total: 0.25 } } },
	{ type: "message", message: { role: "system", usage: { input: 999, cost: { total: 999 } } } },
];
const persistedUsage = new BilledSessionLedger().rebuild(usageEntries);
assert.deepEqual(persistedUsage, { input: 20, output: 3, cacheRead: 50_000, cacheWrite: 30, cost: 0.265015 },
	"all standalone usage kinds must count as billed work, without treating system messages as usage");

const publicContextTruthInputs = lifecycleInputsFromContext(
	{
		cwd: "/public-context-truth",
		model: { id: "truth-model", provider: "truth-provider", contextWindow: 100_000 },
		modelRegistry: { getAvailable: () => [{ provider: "truth-provider" }] },
		getContextUsage: () => ({ tokens: null, contextWindow: 100_000, percent: null }),
		sessionManager: {
			getCwd: () => "/public-context-truth",
			getEntries: () => [],
			getBranch: () => {
				throw new Error("Context truth must not come from the session branch");
			},
		},
	} as unknown as ExtensionContext,
	"off",
);
assert.deepEqual(publicContextTruthInputs.contextUsage, { tokens: null, contextWindow: 100_000, percent: null }, "state inputs should trust ctx.getContextUsage nulls directly without a branch-derived shadow state");

console.log("✓ state input extraction checks passed");
