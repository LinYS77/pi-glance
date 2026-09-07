import { strict as assert } from "node:assert";
import { defaultConfig, normalizeConfig } from "../../src/config/model.js";
import { THROUGHPUT_PRECISION_VALUES } from "../../src/config/options.js";
import { THROUGHPUT_PRECISION_DESCRIPTOR } from "../../src/config/schema.js";
import { throughputSegmentFeature } from "../../src/segments/throughput.js";
import type { ThroughputPrecision } from "../../src/types.js";

const descriptor = THROUGHPUT_PRECISION_DESCRIPTOR;

assert.equal(descriptor.defaultValue, "auto", "throughput precision default should be auto");
assert.deepEqual(descriptor.values, ["auto", 1, 0], "throughput precision values should preserve literal order");
assert.equal(THROUGHPUT_PRECISION_VALUES, descriptor.values, "config options should reuse the descriptor values");

for (const value of descriptor.values) {
	assert.equal(descriptor.normalize(value), value, `${value} should normalize as itself`);
}
for (const value of ["1", "0", "manual", 2, -1, Number.NaN, null, undefined, true, false, {}, []]) {
	assert.equal(descriptor.normalize(value), "auto", `${String(value)} should normalize to auto`);
}

const values: readonly ThroughputPrecision[] = descriptor.values;
assert.deepEqual(values, ["auto", 1, 0], "descriptor values should satisfy the public config type");
assert.equal(defaultConfig().throughput.precision, descriptor.defaultValue, "default config should use the descriptor default");
for (const value of descriptor.values) {
	assert.equal(normalizeConfig({ throughput: { precision: value } }).throughput.precision, value, `${value} should normalize through config`);
}
assert.equal(normalizeConfig({ throughput: { precision: "manual" } }).throughput.precision, descriptor.defaultValue, "invalid config precision should use the descriptor default");

const precisionSetting = throughputSegmentFeature.settings.find((setting) => setting.id === "throughput.precision");
assert.ok(precisionSetting, "Model speed feature should expose its precision setting");
const config = defaultConfig();
assert.equal(precisionSetting.value(config), "Automatic", "setting uses a readable automatic label");
precisionSetting.select(config, 1);
assert.equal(config.throughput.precision, 1, "setting can choose precision directly");
assert.equal(precisionSetting.value(config), "1 decimal", "setting label follows the selected precision");

console.log("✓ config schema descriptor behavior checks passed");
