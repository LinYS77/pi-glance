import { strict as assert } from "node:assert";
import { dependencyPath, IO_NETWORK_PROCESS_IMPORTS, readProductionSources } from "../support/source-graph.js";

const FEATURE_FILE_PATTERN = /^src\/segments\/(?:git|cost|context|tokens|throughput|model)\.ts$/;
const files = await readProductionSources();
const features = files.filter((file) => FEATURE_FILE_PATTERN.test(file.path));
assert.ok(features.length > 0, "at least one segment feature should exist");

for (const feature of features) {
	const forbidden = dependencyPath(files, feature.path, (specifier) => IO_NETWORK_PROCESS_IMPORTS.has(specifier) || specifier.startsWith("@earendil-works/pi-"));
	assert.equal(forbidden, undefined, forbidden?.join(" -> "));
	assert.equal(/\b(?:setInterval|setTimeout|setImmediate|requestAnimationFrame)\s*\(/.test(feature.text), false, `${feature.path}: segment features should not own timers`);
	assert.equal(/\.notify\s*\(/.test(feature.text), false, `${feature.path}: segment features should not notify`);
}

console.log(`✓ ${features.length} segment feature dependency guardrails passed`);
