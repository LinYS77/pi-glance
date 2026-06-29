import { strict as assert } from "node:assert";
import { GlanceFooter } from "../footer.js";
import { setProviderCount } from "../state.js";
import type { GlanceState } from "../types.js";
import { testState } from "./helpers.js";

function providerState(availableCount: number, version = 0): GlanceState {
	return testState({ providers: { availableCount }, version });
}

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
	const footer = new GlanceFooter();
	assert.deepEqual(footer.render(80), [], "custom footer should stay visually empty");
	assert.doesNotThrow(() => footer.invalidate(), "empty footer invalidate should be a no-op");
	assert.doesNotThrow(() => footer.dispose(), "empty footer dispose should be a no-op");
}

console.log("✓ footer/provider facts checks passed");
