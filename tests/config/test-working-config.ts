import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneConfig, configFromText, configToText, defaultConfig, normalizeConfig } from "../../src/config/model.js";
import { createConfigStore } from "../../src/config/store.js";
import { WORKING_SWEEP_MODE_VALUES } from "../../src/config/options.js";

test("Working animation defaults to full border and round-trips all three modes", () => {
	assert.equal(defaultConfig().editor.workingSweep, "perimeter");
	assert.deepEqual(WORKING_SWEEP_MODE_VALUES, ["top", "perimeter", "off"]);
	for (const value of [undefined, null, 0, 1, "false", "true", "border", [], {}]) {
		assert.equal(normalizeConfig({ editor: { workingSweep: value } }).editor.workingSweep, "perimeter");
	}
	for (const workingSweep of WORKING_SWEEP_MODE_VALUES) {
		const config = normalizeConfig({ editor: { workingSweep } });
		assert.equal(config.editor.workingSweep, workingSweep);
		assert.equal(configFromText(configToText(config)).editor.workingSweep, workingSweep);
		const cloned = cloneConfig(config);
		cloned.editor.workingSweep = workingSweep === "off" ? "top" : "off";
		assert.equal(config.editor.workingSweep, workingSweep);
	}
});

test("v8 and v9 migration preserve choices without mutating the source", () => {
	const config = defaultConfig();
	config.theme = { light: "high-contrast-light", dark: "high-contrast-dark" };
	config.git.pollIntervalMs = 30000;
	const { workingSweep: _workingSweep, ...editor } = config.editor;
	const legacy = { ...config, version: 8, editor };
	assert.deepEqual(normalizeConfig(legacy), config);
	assert.equal("workingSweep" in legacy.editor, false);
	for (const workingSweep of [true, false]) {
		const v9 = { ...config, version: 9, editor: { ...editor, workingSweep } };
		const migrated = normalizeConfig(v9);
		assert.equal(migrated.editor.workingSweep, workingSweep ? "top" : "off");
		assert.deepEqual({ ...migrated, editor: config.editor }, config);
		assert.equal(v9.editor.workingSweep, workingSweep);
	}
});

test("loading old configs never rewrites them; explicit save persists the selected mode", async () => {
	const directory = await mkdtemp(join(tmpdir(), "glance-working-config-"));
	try {
		const path = join(directory, "config.json");
		for (const version of [8, 9]) for (const workingSweep of [true, false]) {
			const text = JSON.stringify({ version, icons: "nerd", display: { workspaceLabel: "smart" }, editor: { workingSweep } }) + "\n";
			await writeFile(path, text);
			const store = createConfigStore(path);
			const sync = store.loadConfigSync();
			assert.equal(sync.writable, true);
			assert.equal(sync.config.editor.workingSweep, workingSweep ? "top" : "off");
			assert.deepEqual((await store.loadConfig()).config, sync.config);
			assert.equal(await readFile(path, "utf8"), text);
			sync.config.editor.workingSweep = "perimeter";
			await store.saveConfig(sync.config);
			const saved = JSON.parse(await readFile(path, "utf8"));
			assert.equal(saved.version, 12);
			assert.equal(saved.editor.workingSweep, "perimeter");
			assert.equal(saved.icons, "nerd");
			assert.equal(saved.display.workspaceLabel, "smart");
			assert.deepEqual((await store.loadConfig()).config, sync.config);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
