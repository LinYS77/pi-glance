import { strict as assert } from "node:assert";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../config.js";
import { lifecycleInputsFromContext, stateInputsFromContext, thinkingInputsFromContext, usageTotalsFromEntries, usageTotalsFromMessage, type StateSessionEntry } from "../runtime-snapshot.js";
import { createInitialState } from "../state.js";

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
	entries?: readonly StateSessionEntry[];
	branch?: readonly StateSessionEntry[];
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
			getEntries: () => options.entries ?? [],
			getBranch: () => options.branch ?? [],
		},
	} as unknown as ExtensionContext;
}

const fallbackInputs = stateInputsFromContext(fakeContext({ cwd: "/fallback", sessionCwd: "" }), "medium");
assert.equal(fallbackInputs.cwd, "/fallback", "cwd should fall back to ctx.cwd when session cwd is empty");
assert.equal(fallbackInputs.thinkingLevel, "medium", "thinking level should be copied from caller input");

const sessionCwdInputs = stateInputsFromContext(fakeContext({ cwd: "/fallback", sessionCwd: "/workspace" }), "high");
assert.equal(sessionCwdInputs.cwd, "/workspace", "session cwd should win over ctx.cwd");

const modelInputs = stateInputsFromContext(
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
assert.equal(stateInputsFromContext(fakeContext({ model: undefined }), "off").model, undefined, "undefined ctx.model should produce undefined model inputs");

const contextUsageInputs = stateInputsFromContext(
	fakeContext({ contextUsage: { tokens: null, contextWindow: 128000, percent: null } }),
	"off",
);
assert.deepEqual(
	contextUsageInputs.contextUsage,
	{ tokens: null, contextWindow: 128000, percent: null },
	"present context usage should be copied exactly",
);
assert.equal(stateInputsFromContext(fakeContext({ contextUsage: undefined }), "off").contextUsage, undefined, "missing context usage should stay undefined");
assert.equal(stateInputsFromContext(fakeContext({ availableProviders: ["openai", "anthropic", "openai", ""] }), "off").availableProviderCount, 2, "provider count should deduplicate non-empty available provider names from modelRegistry");
assert.equal(stateInputsFromContext(fakeContext({ availableProviders: [] }), "off").availableProviderCount, 1, "provider count should keep one-provider fallback when no available models are configured");
assert.equal(stateInputsFromContext(fakeContext({ availableProviders: [undefined, 123] }), "off").availableProviderCount, 1, "provider count should ignore invalid provider names and keep fallback minimum");
assert.equal(
	stateInputsFromContext(fakeContext({ availableProviders: ["openai", "anthropic", "local"], scopedProviders: ["anthropic", "anthropic"] }), "off").availableProviderCount,
	1,
	"non-empty ctx.scopedModels should define the provider count instead of the full model registry",
);
assert.equal(
	stateInputsFromContext(fakeContext({ availableProviders: ["openai", "anthropic"], scopedProviders: [] }), "off").availableProviderCount,
	2,
	"empty ctx.scopedModels should fall back to every available registry model",
);

const friendlyModelState = createInitialState(modelInputs, defaultConfig());
assert.equal(friendlyModelState.model.displayName, "Claude Test Friendly", "state should prefer Pi's public model.name over id shortening");
const customNameConfig = defaultConfig();
customNameConfig.model.customNames["claude-test"] = "User Override";
assert.equal(createInitialState(modelInputs, customNameConfig).model.displayName, "User Override", "configured custom model names should continue to override Pi model.name");

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
	usageTotalsFromMessage(message("user", { usage: { input: 100, output: 200, cacheRead: 300, cacheWrite: 400, cost: { total: 999 } } }).message ?? {}),
	{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
	"usageTotalsFromMessage should ignore user messages",
);
assert.deepEqual(
	usageTotalsFromMessage(message("assistant", { usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.25, input: 10 } } }).message ?? {}),
	{ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.25 },
	"usageTotalsFromMessage should prefer finite cost.total over cost components",
);
assert.deepEqual(
	usageTotalsFromMessage(message("toolResult", { usage: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4 } } }).message ?? {}),
	{ input: 5, output: 6, cacheRead: 7, cacheWrite: 8, cost: 1 },
	"usageTotalsFromMessage should include usage-bearing tool results and fall back to cost components",
);
assert.deepEqual(
	usageTotalsFromMessage(message("assistant").message ?? {}),
	{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
	"usageTotalsFromMessage should default missing usage to zero",
);

assert.deepEqual(
	usageTotalsFromEntries([
		message("user", { usage: { input: 100, output: 200, cacheRead: 300, cacheWrite: 400, cost: { total: 999 } } }),
		{ type: "tool", message: { role: "assistant", usage: { input: 100 } } } as StateSessionEntry,
		message("assistant", { usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.25, input: 10 } } }),
		message("assistant", { usage: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4 } } }),
		message("assistant"),
	]),
	{ input: 6, output: 8, cacheRead: 10, cacheWrite: 12, cost: 1.25 },
	"usage totals should include assistant messages only, prefer finite cost.total, fall back to cost components, and default missing usage to 0",
);

assert.deepEqual(
	usageTotalsFromEntries([
		message("assistant", { usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.1 } } }),
		message("toolResult", { usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cost: { total: 1 } } }),
		{ type: "compaction", usage: { input: 100, output: 200, cacheRead: 300, cacheWrite: 400, cost: { total: 10 } } } as unknown as StateSessionEntry,
		{ type: "branch_summary", usage: { input: 1000, output: 2000, cacheRead: 3000, cacheWrite: 4000, cost: { total: 100 } } } as unknown as StateSessionEntry,
	]),
	{ input: 1111, output: 2222, cacheRead: 3333, cacheWrite: 4444, cost: 111.1 },
	"usage totals should match Pi 0.84 billed-session semantics across assistant, toolResult, compaction, and branch-summary usage",
);

const publicContextTruthInputs = stateInputsFromContext(
	{
		cwd: "/public-context-truth",
		model: { id: "truth-model", provider: "truth-provider", contextWindow: 100_000 },
		modelRegistry: { getAvailable: () => [{ provider: "truth-provider" }] },
		getContextUsage: () => ({ tokens: null, contextWindow: 100_000, percent: null }),
		sessionManager: {
			getCwd: () => "/public-context-truth",
			getEntries: () => [],
			getBranch: () => {
				throw new Error("stateInputsFromContext must not derive context truth from the session branch");
			},
		},
	} as unknown as ExtensionContext,
	"off",
);
assert.deepEqual(publicContextTruthInputs.contextUsage, { tokens: null, contextWindow: 100_000, percent: null }, "state inputs should trust ctx.getContextUsage nulls directly without a branch-derived shadow state");

assert.deepEqual(
	stateInputsFromContext(
		fakeContext({
			entries: [message("assistant", { usage: { input: 2, output: 3, cost: { total: 0.5 } } })],
		}),
		"low",
	),
	{
		cwd: "/fallback",
		model: undefined,
		thinkingLevel: "low",
		contextUsage: undefined,
		usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, cost: 0.5 },
		availableProviderCount: 1,
	},
	"stateInputsFromContext should combine cwd, thinking, complete session usage totals, and public context facts",
);

console.log("✓ state input extraction checks passed");
