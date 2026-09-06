import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneConfig, configFromText, configToText, defaultConfig, normalizeConfig } from "../../src/config/model.js";
import { createConfigStore } from "../../src/config/store.js";

test("Working animation defaults on and preserves an explicit off value", () => {
	assert.equal(defaultConfig().editor.workingSweep, true);
	for (const value of [undefined, null, 0, 1, "false", "true", [], {}]) {
		assert.equal(normalizeConfig({ editor: { workingSweep: value } }).editor.workingSweep, true);
	}
	for (const workingSweep of [true, false]) {
		const config = normalizeConfig({ editor: { workingSweep } });
		assert.equal(config.editor.workingSweep, workingSweep);
		assert.equal(configFromText(configToText(config)).editor.workingSweep, workingSweep);
		const cloned = cloneConfig(config);
		cloned.editor.workingSweep = !workingSweep;
		assert.equal(config.editor.workingSweep, workingSweep);
	}
});

test("v8 migration adds only the Working setting and schema version", () => {
	const config = defaultConfig();
	config.theme = { light: "high-contrast-light", dark: "high-contrast-dark" };
	config.icons = "nerd";
	config.display.workspaceLabel = "smart";
	config.git.pollIntervalMs = 30000;
	const { workingSweep: _workingSweep, ...editor } = config.editor;
	const legacy = { ...config, version: 8, editor };
	const migrated = normalizeConfig(legacy);
	assert.deepEqual(migrated, config);
	assert.equal("workingSweep" in legacy.editor, false, "normalization must not mutate its input");
});

test("loading an old config never rewrites it; explicit save persists the new setting", async () => {
	const directory = await mkdtemp(join(tmpdir(), "glance-working-config-"));
	try {
		const path = join(directory, "config.json");
		const text = '{"version":8,"icons":"nerd","display":{"workspaceLabel":"smart"}}\n';
		await writeFile(path, text);
		const store = createConfigStore(path);
		const sync = store.loadConfigSync();
		assert.equal(sync.writable, true);
		assert.equal(sync.config.editor.workingSweep, true);
		assert.equal((await store.loadConfig()).config.editor.workingSweep, true);
		assert.equal(await readFile(path, "utf8"), text);
		sync.config.editor.workingSweep = false;
		await store.saveConfig(sync.config);
		const saved = JSON.parse(await readFile(path, "utf8"));
		assert.equal(saved.version, 9);
		assert.equal(saved.editor.workingSweep, false);
		assert.equal(saved.icons, "nerd");
		assert.equal(saved.display.workspaceLabel, "smart");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
