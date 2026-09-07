import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { choiceSetting, toggleSetting } from "../../src/config/settings.js";

test("choice descriptors read once and preserve values outside the presets", () => {
	const config = defaultConfig();
	let reads = 0;
	const descriptor = choiceSetting("polling", "Refresh", "", [1000, 5000, 10000].map(value => ({ value, label: `${value / 1000}s` })),
		c => { reads++; return c.git.pollIntervalMs; }, (c, value) => { c.git.pollIntervalMs = value; }, value => `${value / 1000}s`);
	assert.equal(descriptor.value(config), "5s");
	assert.equal(reads, 1);
	assert.equal(descriptor.selectedIndex(config), 1);
	assert.equal(reads, 2);
	config.git.pollIntervalMs = 7500;
	assert.equal(descriptor.value(config), "7.5s");
	assert.equal(descriptor.selectedIndex(config), -1);
	descriptor.select(config, -1);
	assert.equal(config.git.pollIntervalMs, 7500);
	descriptor.select(config, 2);
	assert.equal(config.git.pollIntervalMs, 10000);
});

test("toggle descriptors use explicit On and Off choices", () => {
	const config = defaultConfig();
	const descriptor = toggleSetting("enabled", "Glance", "", c => c.enabled, (c, value) => { c.enabled = value; });
	assert.equal(descriptor.kind, "toggle");
	assert.equal(descriptor.value(config), "On");
	descriptor.select(config, 1);
	assert.equal(config.enabled, false);
	assert.equal(descriptor.value(config), "Off");
	descriptor.select(config, 0);
	assert.equal(config.enabled, true);
});
