import { strict as assert } from "node:assert";
import { test } from "node:test";
import { configFromText, configToText, defaultConfig, normalizeConfig } from "../../src/config/model.js";

test("new and legacy configurations use Text, retaining the user's sweep preferences", () => {
	const defaults = defaultConfig();
	assert.deepEqual(defaults.editor, { ...defaults.editor, activityMode: "text", summarySpeedMultiplier: 0.5, retryBlinkHz: 0.5 });
	for (const workingSweep of ["top", "perimeter", "off", true, false]) {
		const config = normalizeConfig({ version: 14, enabled: false, editor: { workingSweep, workingSweepSpeed: 80, workingSweepColor: "teal", activityMode: "sweep" } });
		assert.deepEqual(config.editor, {
			...defaults.editor, activityMode: "text", workingSweep: workingSweep === "top" || workingSweep === true ? "top" : "perimeter",
			workingSweepSpeed: 80, workingSweepColor: "teal",
		});
		assert.equal(config.enabled, false, "migration must not turn Glance on");
		assert.equal(config.version, 15);
	}
});

test("saving Sweep after migration retains mode, fractional controls and other preferences on reload", () => {
	const config = normalizeConfig({ version: 14, editor: { workingSweep: "top", workingSweepSpeed: 80, workingSweepColor: "copper" } });
	config.editor.activityMode = "sweep";
	config.editor.summarySpeedMultiplier = 1.35;
	config.editor.retryBlinkHz = 0.75;
	assert.deepEqual(configFromText(configToText(config)), config);
});

test("all pre-Activity schemas force Text while current-schema parameters normalize safely", () => {
	for (let version = 0; version < 15; version++) {
		assert.equal(normalizeConfig({ version, editor: { activityMode: "sweep", workingSweep: "top" } }).editor.activityMode, "text");
	}
	for (const field of ["summarySpeedMultiplier", "retryBlinkHz"] as const) {
		for (const value of [undefined, null, NaN, Infinity, "1", true, {}])
			assert.equal(normalizeConfig({ version: 15, editor: { [field]: value } }).editor[field], 0.5);
		for (const [value, expected] of [[-1, 0.25], [0, 0.25], [0.375, 0.38], [999, 2]])
			assert.equal(normalizeConfig({ version: 15, editor: { [field]: value } }).editor[field], expected);
	}
});
