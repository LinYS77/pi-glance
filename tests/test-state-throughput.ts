import { strict as assert } from "node:assert";
import { defaultConfig } from "../src/config/model.js";
import { createInitialState, setLastRunModelSpeed, clearLastRunModelSpeed, setCurrentRunModelSpeed, clearCurrentRunModelSpeed } from "../src/runtime/state.js";
import type { StateInputs } from "../src/runtime/snapshot.js";
import { testState } from "./helpers.js";

import type { GlanceState, ModelSpeedMeasurement as ModelSpeedFixture } from "../src/types.js";

function throughput(state: GlanceState): GlanceState["throughput"] {
	return state.throughput;
}

const inputs: StateInputs = {
	cwd: "/repo",
	model: { id: "gpt-5.5", provider: "openai", contextWindow: 200_000 },
	thinkingLevel: "off",
	contextUsage: undefined,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
	availableProviderCount: 1,
};

const initial = createInitialState(inputs, defaultConfig());
assert.deepEqual(
	throughput(initial),
	{ lastRun: null, currentRun: null },
	"createInitialState should initialize throughput.lastRun and throughput.currentRun to null so unknown/provisional/final render states are explicit",
);

const finalSample: ModelSpeedFixture = {
	startedAtMs: 1_000,
	endedAtMs: 3_500,
	elapsedMs: 2_500,
	tokensPerSecond: 20,
	usage: {
		input: 10,
		output: 50,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 60,
		assistantMessages: 1,
	},
};

const currentSample: ModelSpeedFixture = {
	startedAtMs: 5_000,
	endedAtMs: 6_250,
	elapsedMs: 1_250,
	tokensPerSecond: 32,
	usage: {
		input: 4,
		output: 40,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 44,
		assistantMessages: 1,
	},
};

const state = testState({ version: 7 });
(state).throughput = { lastRun: null, currentRun: null };

assert.equal(setLastRunModelSpeed(state, finalSample), true, "setting final throughput from null should report a state change");
assert.deepEqual(throughput(state).lastRun, finalSample, "setLastRunModelSpeed should store the latest finalized settled-run model-speed snapshot");
assert.deepEqual(throughput(state).currentRun, null, "setting final throughput should not implicitly mutate currentRun; runtime clears currentRun explicitly");
assert.equal(state.version, 8, "setting a changed final throughput snapshot should increment state.version exactly once");

assert.equal(setLastRunModelSpeed(state, { ...finalSample }), false, "setting an equivalent final throughput snapshot should be a no-op");
assert.equal(state.version, 8, "equivalent final throughput snapshots should not increment version");

const changedFinal: ModelSpeedFixture = { ...finalSample, endedAtMs: 4_000, elapsedMs: 3_000, tokensPerSecond: 16.6666666667 };
assert.equal(setLastRunModelSpeed(state, changedFinal), true, "setting a different final throughput snapshot should report a change");
assert.deepEqual(throughput(state).lastRun, changedFinal, "different final throughput snapshot should replace the previous final");
assert.equal(state.version, 9, "different final throughput snapshot should increment state.version");

assert.equal(setCurrentRunModelSpeed(state, currentSample), true, "setting currentRun from null should report a state change");
assert.deepEqual(throughput(state).currentRun, currentSample, "setCurrentRunModelSpeed should store the latest provisional current run snapshot");
assert.deepEqual(throughput(state).lastRun, changedFinal, "setting currentRun should preserve the last finalized throughput snapshot");
assert.equal(state.version, 10, "setting changed currentRun should increment state.version exactly once");

assert.equal(setCurrentRunModelSpeed(state, { ...currentSample }), false, "setting an equivalent currentRun snapshot should be a no-op");
assert.equal(state.version, 10, "equivalent currentRun snapshots should not increment version");

const changedCurrent: ModelSpeedFixture = { ...currentSample, endedAtMs: 7_000, elapsedMs: 2_000, tokensPerSecond: 20 };
assert.equal(setCurrentRunModelSpeed(state, changedCurrent), true, "setting a different currentRun snapshot should report a change");
assert.deepEqual(throughput(state).currentRun, changedCurrent, "different currentRun snapshot should replace the previous provisional snapshot");
assert.deepEqual(throughput(state).lastRun, changedFinal, "changing currentRun should still preserve lastRun");
assert.equal(state.version, 11, "different currentRun snapshot should increment state.version");

assert.equal(clearCurrentRunModelSpeed(state), true, "clearing a present currentRun snapshot should report a state change");
assert.deepEqual(throughput(state), { lastRun: changedFinal, currentRun: null }, "clearCurrentRunModelSpeed should leave lastRun intact and only clear currentRun");
assert.equal(state.version, 12, "clearing present currentRun should increment state.version");

assert.equal(clearCurrentRunModelSpeed(state), false, "clearing an already-null currentRun should be a no-op");
assert.equal(state.version, 12, "clearing an already-null currentRun should not increment version");

assert.equal(clearLastRunModelSpeed(state), true, "clearing a present final throughput snapshot should report a state change");
assert.deepEqual(throughput(state), { lastRun: null, currentRun: null }, "clearLastRunModelSpeed should leave throughput slots null when currentRun is already null");
assert.equal(state.version, 13, "clearing present lastRun should increment state.version");

console.log("✓ throughput state checks passed");
