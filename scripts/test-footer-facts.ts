import { strict as assert } from "node:assert";
import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { GlanceFooterBridge } from "../footer-bridge.js";
import type { GlanceState } from "../types.js";
import { testState } from "./helpers.js";

type SetProviderCount = (state: GlanceState, availableCount: number) => boolean;

interface StateModule {
	setProviderCount?: SetProviderCount;
}

class MutableFooterDataProvider {
	constructor(private availableCount: number) {}

	setAvailableProviderCount(availableCount: number): void {
		this.availableCount = availableCount;
	}

	getAvailableProviderCount(): number {
		return this.availableCount;
	}
}

function providerState(availableCount: number, version = 0): GlanceState {
	return testState({ providers: { availableCount }, version });
}

function asFooterData(footerData: MutableFooterDataProvider): ReadonlyFooterDataProvider {
	return footerData as unknown as ReadonlyFooterDataProvider;
}

const stateModulePath: string = "../state.js";
const { setProviderCount } = (await import(stateModulePath)) as StateModule;

assert.equal(typeof setProviderCount, "function", "state.ts should export setProviderCount(state, availableCount)");
if (typeof setProviderCount !== "function") throw new Error("setProviderCount missing");

{
	const state = providerState(2, 7);
	assert.equal(setProviderCount(state, 2), false, "same provider count should report no change");
	assert.equal(state.providers.availableCount, 2, "same provider count should preserve availableCount");
	assert.equal(state.version, 7, "same provider count should not bump version");
}

{
	const state = providerState(2, 7);
	assert.equal(setProviderCount(state, 3), true, "different provider count should report changed");
	assert.equal(state.providers.availableCount, 3, "different provider count should update availableCount");
	assert.equal(state.version, 8, "different provider count should bump version once");
	assert.equal(setProviderCount(state, 3), false, "repeated same provider count should report no change");
	assert.equal(state.version, 8, "repeated same provider count should not bump version again");
}

{
	const state = providerState(1, 0);
	const footerData = new MutableFooterDataProvider(4);
	new GlanceFooterBridge(() => state, asFooterData(footerData));
	assert.equal(state.providers.availableCount, 4, "footer bridge constructor should sync provider count");
	assert.equal(state.version, 1, "constructor sync should bump version exactly once when count changes");
}

{
	const state = providerState(1, 0);
	const footerData = new MutableFooterDataProvider(1);
	const bridge = new GlanceFooterBridge(() => state, asFooterData(footerData));
	assert.equal(state.version, 0, "constructor sync with same count should not bump version");

	footerData.setAvailableProviderCount(5);
	bridge.invalidate();
	assert.equal(state.providers.availableCount, 5, "invalidate should sync changed provider count");
	assert.equal(state.version, 1, "invalidate should bump version exactly once when count changes");

	bridge.invalidate();
	assert.equal(state.version, 1, "repeated invalidate with same count should not bump version again");
}

{
	const state = providerState(2, 3);
	const footerData = new MutableFooterDataProvider(2);
	const bridge = new GlanceFooterBridge(() => state, asFooterData(footerData));
	assert.equal(state.version, 3, "constructor sync with same count should preserve version before render checks");

	footerData.setAvailableProviderCount(6);
	assert.deepEqual(bridge.render(80), [], "footer bridge render should remain visually empty");
	assert.equal(state.providers.availableCount, 6, "render should sync changed provider count");
	assert.equal(state.version, 4, "render sync should bump version exactly once when count changes");

	assert.deepEqual(bridge.render(80), [], "footer bridge render should stay visually empty on repeated render");
	assert.equal(state.version, 4, "repeated render with same count should not bump version again");
}

console.log("✓ footer/provider facts checks passed");
