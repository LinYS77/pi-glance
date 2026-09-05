import { strict as assert } from "node:assert";
import { defaultConfig, normalizeConfig } from "../src/config/model.js";
import { THROUGHPUT_PRECISION_VALUES } from "../src/config/options.js";
import { THROUGHPUT_PRECISION_DESCRIPTOR } from "../src/config/schema.js";
import { throughputSegmentFeature } from "../src/segments/throughput.js";
import type { ThroughputPrecision } from "../src/types.js";

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

assert.equal(descriptor.label("auto"), "auto", "auto label should be exact");
assert.equal(descriptor.label(1), "1 digit", "one-digit label should be exact");
assert.equal(descriptor.label(0), "0 digits", "zero-digit label should be exact");
assert.equal(descriptor.next("auto"), 1, "auto should cycle to one digit");
assert.equal(descriptor.next(1), 0, "one digit should cycle to zero digits");
assert.equal(descriptor.next(0), "auto", "zero digits should cycle to auto");

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
assert.equal(precisionSetting.value(config), descriptor.label(descriptor.defaultValue), "setting label should match descriptor behavior");
precisionSetting.mutate(config);
assert.equal(config.throughput.precision, descriptor.next(descriptor.defaultValue), "setting mutation should use descriptor cycling");
assert.equal(precisionSetting.value(config), descriptor.label(config.throughput.precision), "setting label should follow the mutated value");

console.log("✓ config schema descriptor behavior checks passed");
