import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext } from "../support/runtime-harness.js";

test("thinking changes cannot replace the physical Context limit with the virtual selection's limit", async () => {
	let thinking = "high";
	const ctx = createRuntimeTestContext({
		model: { id: "auto", provider: "router", contextWindow: 1_000_000 },
		contextUsage: { tokens: 110, contextWindow: 200_000, percent: 0.055 },
	});
	const h = createRuntimeHarness({ getThinkingLevel: () => thinking, git: createGitHarness(), showPaneResults: [{ action: "cancel" }] });
	h.runtime.events.sessionStart({}, ctx.ctx);
	await h.runtime.commands.openPane("", ctx.ctx);
	const state = h.showPanePreviewStates[0]!;
	const expected = { tokens: 110, window: 200_000, percent: 0.055 };
	assert.deepEqual(state.context, expected);
	const reads = ctx.getEntryReads();
	thinking = "low";
	await h.runtime.events.thinkingLevelSelect({}, ctx.ctx);
	assert.equal(state.model.thinking, "low");
	assert.deepEqual(state.context, expected);
	const version = state.version;
	await h.runtime.events.modelSelect({}, ctx.ctx);
	assert.deepEqual(state.context, expected);
	assert.equal(state.version, version, "unchanged lifecycle facts must not briefly replace then restore Context");
	ctx.setContextUsage({ tokens: null, contextWindow: 200_000, percent: null });
	h.runtime.events.agentSettled({}, ctx.ctx);
	thinking = "high";
	await h.runtime.events.thinkingLevelSelect({}, ctx.ctx);
	assert.deepEqual(state.context, { tokens: null, window: 200_000, percent: null });
	ctx.setContextUsage(undefined);
	await h.runtime.events.modelSelect({}, ctx.ctx);
	assert.deepEqual(state.context, { tokens: null, window: 1_000_000, percent: null }, "selection capacity remains a fallback when Pi has no usage");
	assert.equal(ctx.getEntryReads(), reads);
	assert.equal(ctx.getBranchReads(), 0);
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
});
