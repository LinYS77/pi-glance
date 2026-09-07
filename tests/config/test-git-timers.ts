import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeConfig } from "../../src/config/model.js";

test("Git delays cannot overflow Node timers into a one-millisecond loop", () => {
	for (const field of ["timeoutMs", "refreshDebounceMs", "pollIntervalMs"] as const) {
		for (const value of [Number.MAX_SAFE_INTEGER, 1e100]) {
			assert.equal(normalizeConfig({ git: { [field]: value } }).git[field], 2_147_483_647);
		}
		for (const value of [1000, 7500, 2_147_483_647]) {
			assert.equal(normalizeConfig({ git: { [field]: value } }).git[field], value);
		}
	}
});
