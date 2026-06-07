import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { THROUGHPUT_PRECISION_DESCRIPTOR } from "../config-schema.js";
import { THROUGHPUT_PRECISION_VALUES } from "../config-options.js";
import type { ThroughputPrecision } from "../types.js";

const descriptor = THROUGHPUT_PRECISION_DESCRIPTOR;

assert.equal(descriptor.defaultValue, "auto", "throughput precision default should be auto");
assert.deepEqual(descriptor.values, ["auto", 1, 0], "throughput precision values should preserve literal order");
assert.equal(THROUGHPUT_PRECISION_VALUES, descriptor.values, "config-options throughput precision values should reuse descriptor values");
assert.deepEqual(THROUGHPUT_PRECISION_VALUES, ["auto", 1, 0], "config-options throughput precision values should preserve compatibility order");

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
assert.deepEqual(values, ["auto", 1, 0], "descriptor values should be assignable to readonly throughput precision values");

function assertSourceIncludes(path: string, source: string, snippet: string): void {
	assert.equal(source.includes(snippet), true, `${path} should contain source snippet ${snippet}`);
}

function assertSourceExcludes(path: string, source: string, snippet: string): void {
	assert.equal(source.includes(snippet), false, `${path} should not contain source snippet ${snippet}`);
}

const source = await readFile("config-schema.ts", "utf8");
const configSource = await readFile("config.ts", "utf8");
const configOptionsSource = await readFile("config-options.ts", "utf8");
const throughputFeatureSource = await readFile("throughput-segment-feature.ts", "utf8");
const specifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g)].map((match) => match[1] ?? match[2]!);
const forbiddenLocalImports = new Set([
	"./config-options",
	"./config",
	"./settings-catalog",
	"./throughput-segment-feature",
	"./throughput",
	"./runtime",
	"./runtime-policy",
	"./runtime-snapshot",
	"./pane",
	"./pane-model",
	"./renderer",
	"./editor",
	"./status-line",
]);

for (const specifier of specifiers) {
	const normalized = specifier.endsWith(".js") ? specifier.slice(0, -3) : specifier;
	assert.equal(forbiddenLocalImports.has(normalized), false, `config-schema.ts should not import ${specifier}`);
	assert.equal(specifier.startsWith("@earendil-works/pi-"), false, `config-schema.ts should not import ${specifier}`);
	assert.equal(specifier.startsWith("node:"), false, `config-schema.ts should not import ${specifier}`);
}

assertSourceIncludes("config-options.ts", configOptionsSource, "export const THROUGHPUT_PRECISION_VALUES: ReadonlyArray<ThroughputPrecision> = THROUGHPUT_PRECISION_DESCRIPTOR.values;");
assertSourceIncludes("config.ts", configSource, "precision: THROUGHPUT_PRECISION_DESCRIPTOR.defaultValue");
assertSourceIncludes("config.ts", configSource, "precision: THROUGHPUT_PRECISION_DESCRIPTOR.normalize(throughput.precision)");
assertSourceExcludes("config.ts", configSource, "THROUGHPUT_PRECISIONS");
assertSourceExcludes("config.ts", configSource, "parseThroughputPrecision");
assertSourceIncludes("throughput-segment-feature.ts", throughputFeatureSource, "THROUGHPUT_PRECISION_DESCRIPTOR.label(config.throughput.precision)");
assertSourceIncludes("throughput-segment-feature.ts", throughputFeatureSource, "THROUGHPUT_PRECISION_DESCRIPTOR.next(config.throughput.precision)");
assertSourceExcludes("throughput-segment-feature.ts", throughputFeatureSource, "function throughputPrecisionLabel");
assertSourceExcludes("throughput-segment-feature.ts", throughputFeatureSource, "THROUGHPUT_PRECISION_VALUES");

console.log("✓ config schema descriptor checks passed");
