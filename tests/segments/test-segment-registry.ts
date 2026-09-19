import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { defaultSegmentConfigs, isSegmentId } from "../../src/segments/registry.js";
import { getSettingsRows } from "../../src/settings/catalog.js";
import { ICONS } from "../../src/theme/palette.js";
import type { SegmentId } from "../../src/types.js";

const ids = ["git", "cost", "throughput", "context", "tokens", "extensions", "model"] as const;

test("status settings expose the curated order, labels and enabled defaults", () => {
	const config = defaultConfig();
	assert.deepEqual(config.segments, ids.map(id => ({ id, enabled: true })));
	assert.deepEqual(getSettingsRows(config, "status").map(row => [row.label, row.value]), [
		["Git", "On"], ["Cost", "On"], ["Model speed", "On"], ["Context", "On"],
		["Tokens", "On"], ["Extensions", "On"], ["Model", "On"],
	]);
	const changed = defaultSegmentConfigs(); changed[0]!.enabled = false;
	assert.equal(defaultSegmentConfigs()[0]!.enabled, true, "callers cannot mutate the default list");
});

test("segment validation accepts built-ins and the external group, while only built-ins own icons", () => {
	for (const id of ids) assert.equal(isSegmentId(id), true);
	for (const value of ["unknown", "", null, undefined, 0, true, {}, []]) assert.equal(isSegmentId(value), false);
	for (const icons of Object.values(ICONS)) {
		assert.deepEqual(Object.keys(icons).sort(), ids.filter(id => id !== "extensions").sort());
	}
});

test("segment detail pages contain their settings, not a duplicate visibility toggle", () => {
	const expected: Record<SegmentId, string[]> = {
		git: ["git.changes", "git.aheadBehind", "git.sha", "git.fetch", "git.polling"],
		context: ["context.display", "context.unknown"], cost: ["cost.hideZero"],
		tokens: ["tokens.display", "tokens.cache"], model: ["model.providerLabel", "model.thinkingLabel"],
		throughput: ["throughput.precision"], extensions: [],
	};
	for (const id of ids) assert.deepEqual(getSettingsRows(defaultConfig(), "status", id).map(row => row.id), expected[id]);
});
