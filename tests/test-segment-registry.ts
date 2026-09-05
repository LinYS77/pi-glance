import { strict as assert } from "node:assert";
import { defaultConfig } from "../src/config/model.js";
import { contextSegmentFeature } from "../src/segments/context.js";
import { ICONS, PALETTES } from "../src/theme/palette.js";
import { costSegmentFeature } from "../src/segments/cost.js";
import { getSettingsRows } from "../src/settings/catalog.js";
import { gitSegmentFeature } from "../src/segments/git.js";
import { GLANCE_THEME_IDS } from "../src/theme/themes.js";
import { modelSegmentFeature } from "../src/segments/model.js";
import { throughputSegmentFeature } from "../src/segments/throughput.js";
import { tokensSegmentFeature } from "../src/segments/tokens.js";
import type { SegmentConfig, SegmentDefinition, SegmentId } from "../src/types.js";

const EXPECTED_SEGMENT_IDS = ["git", "cost", "throughput", "context", "tokens", "model"] as const satisfies readonly SegmentId[];
type ExpectedSegmentId = (typeof EXPECTED_SEGMENT_IDS)[number];

const EXPECTED_DEFAULT_SEGMENTS: SegmentConfig[] = [
	{ id: "git", enabled: true },
	{ id: "cost", enabled: true },
	{ id: "throughput", enabled: true },
	{ id: "context", enabled: true },
	{ id: "tokens", enabled: false },
	{ id: "model", enabled: true },
];

const EXPECTED_LABELS: Record<ExpectedSegmentId, string> = {
	git: "Git",
	context: "Context",
	cost: "Cost",
	tokens: "Tokens",
	model: "Model",
	throughput: "Model speed",
};

const EXPECTED_SEGMENT_SETTING_IDS: Record<ExpectedSegmentId, string[]> = {
	git: ["git.dirtyMarker", "git.aheadBehind", "git.sha", "git.polling"],
	context: ["context.display", "context.unknown"],
	cost: ["cost.hideZero", "cost.display"],
	tokens: ["tokens.display", "tokens.cache"],
	model: ["model.providerLabel", "model.thinkingLabel"],
	throughput: ["throughput.precision"],
};

import * as registry from "../src/segments/registry.js";

assert.deepEqual(registry.SEGMENT_IDS, EXPECTED_SEGMENT_IDS, "SEGMENT_IDS should preserve the canonical segment order");
assert.equal(new Set(registry.SEGMENT_IDS).size, registry.SEGMENT_IDS.length, "SEGMENT_IDS should be unique");

const registryDefaults = registry.defaultSegmentConfigs();
assert.deepEqual(registryDefaults, EXPECTED_DEFAULT_SEGMENTS, "defaultSegmentConfigs() should preserve default order/enabled flags");
assert.deepEqual(registryDefaults, defaultConfig().segments, "defaultSegmentConfigs() should match defaultConfig().segments exactly");
assert.notEqual(registryDefaults, registry.defaultSegmentConfigs(), "defaultSegmentConfigs() should return a fresh array");
registryDefaults[0]!.enabled = false;
assert.equal(registry.defaultSegmentConfigs()[0]?.enabled, true, "mutating returned defaults should not mutate registry defaults");

for (const id of EXPECTED_SEGMENT_IDS) {
	assert.equal(registry.isSegmentId(id), true, `${id} should validate as a SegmentId`);
	assert.equal(registry.segmentLabel(id), EXPECTED_LABELS[id], `${id} should expose the expected user-facing label`);
	assert.ok(registry.segmentLabel(id).trim(), `${id} label should be non-empty`);
}

for (const value of ["general", "session", "unknown", "", null, undefined, 0, 1, false, true, {}, []]) {
	assert.equal(registry.isSegmentId(value), false, `${JSON.stringify(value)} should not validate as a SegmentId`);
}

assert.ok(registry.SEGMENT_BY_ID instanceof Map, "SEGMENT_BY_ID should be a Map for stable lookup/order");
assert.deepEqual([...registry.SEGMENT_BY_ID.keys()], EXPECTED_SEGMENT_IDS, "SEGMENT_BY_ID keys should exactly match SEGMENT_IDS order");
assert.equal(registry.SEGMENT_BY_ID.size, EXPECTED_SEGMENT_IDS.length, "SEGMENT_BY_ID should not have missing or extra entries");
assert.equal(registry.SEGMENT_BY_ID.get("git"), gitSegmentFeature, "git registry entry should be the extracted SegmentFeature object");
assert.equal(registry.SEGMENT_BY_ID.get("cost"), costSegmentFeature, "cost registry entry should be the extracted SegmentFeature object");
assert.equal(registry.SEGMENT_BY_ID.get("throughput"), throughputSegmentFeature, "throughput registry entry should be the extracted SegmentFeature object");
assert.equal(registry.SEGMENT_BY_ID.get("context"), contextSegmentFeature, "context registry entry should be the extracted SegmentFeature object");
assert.equal(registry.SEGMENT_BY_ID.get("tokens"), tokensSegmentFeature, "tokens registry entry should be the extracted SegmentFeature object");
assert.equal(registry.SEGMENT_BY_ID.get("model"), modelSegmentFeature, "model registry entry should be the extracted SegmentFeature object");

for (const id of EXPECTED_SEGMENT_IDS) {
	const entry = registry.SEGMENT_BY_ID.get(id);
	assert.ok(entry, `SEGMENT_BY_ID should include ${id}`);
	assert.equal(entry.id, id, `${id} entry id should match its key`);
	assert.equal(entry.label, EXPECTED_LABELS[id], `${id} entry label should match the canonical label`);
	assert.equal(entry.defaultEnabled, EXPECTED_DEFAULT_SEGMENTS.find((segment) => segment.id === id)?.enabled, `${id} defaultEnabled should match defaultSegmentConfigs()`);
	assert.equal(typeof entry.collect, "function", `${id} entry should expose a collect function`);
}

function assertExactCoverage(name: string, record: Record<string, unknown>): void {
	assert.deepEqual(registry.segmentRecordCoverage(record), { missing: [], extra: [] }, `${name} should exactly cover registry segment ids`);
}

assert.deepEqual(
	registry.segmentRecordCoverage({ git: true, cost: true, extra: true }),
	{ missing: ["throughput", "context", "tokens", "model"], extra: ["extra"] },
	"segmentRecordCoverage() should report missing ids in registry order and extra keys in record order",
);

for (const themeId of GLANCE_THEME_IDS) {
	assertExactCoverage(`${themeId} palette segments`, PALETTES[themeId].segments);
}

assert.deepEqual(Object.keys(ICONS).sort(), ["nerd", "plain"], "icon modes should remain plain and nerd");
for (const [mode, icons] of Object.entries(ICONS)) {
	assertExactCoverage(`${mode} icons`, icons);
}

const config = defaultConfig();
for (const id of EXPECTED_SEGMENT_IDS) {
	const descriptors = registry.getSegmentSettings(id);
	assert.deepEqual(
		descriptors.map((descriptor) => descriptor.id),
		EXPECTED_SEGMENT_SETTING_IDS[id],
		`${id} settings descriptors should preserve current per-segment setting order`,
	);
	for (const descriptor of descriptors) {
		assert.ok(descriptor.label.trim(), `${descriptor.id} descriptor should have a non-empty label`);
		assert.ok(descriptor.hint.trim(), `${descriptor.id} descriptor should have a non-empty hint`);
		assert.ok(["toggle", "cycle", "info"].includes(descriptor.kind), `${descriptor.id} descriptor should have a known kind`);
	}

	assert.deepEqual(
		getSettingsRows(config, id).map((row) => row.id),
		[`${id}.enabled`, ...EXPECTED_SEGMENT_SETTING_IDS[id]],
		`${id} catalog rows should keep enabled plus registry-covered segment setting ids`,
	);
}

console.log("✓ segment registry checks passed");
