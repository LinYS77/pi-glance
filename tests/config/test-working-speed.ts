import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, normalizeConfig, configToText, configFromText } from "../../src/config/model.js";
import { createConfigStore } from "../../src/config/store.js";
import { sweepProfile } from "../../src/surface/top-edge-sweep.js";
import { perimeterSweepProfile } from "../../src/surface/perimeter-sweep.js";

test("speed defaults to 47, normalizes to 10–120 and preserves all saved modes", () => {
	assert.equal(defaultConfig().editor.workingSweepSpeed, 47);
	for (const value of [undefined, null, "60", true, NaN, Infinity, {}, []]) assert.equal(normalizeConfig({ editor: { workingSweepSpeed: value } }).editor.workingSweepSpeed, 47);
	for (const [value, expected] of [[0, 10], [9, 10], [47.4, 47], [47.6, 48], [999, 120]]) assert.equal(normalizeConfig({ editor: { workingSweepSpeed: value } }).editor.workingSweepSpeed, expected);
	for (const workingSweep of ["top", "perimeter", "off"] as const) for (const speed of [10, 47, 85, 120]) {
		const config = normalizeConfig({ editor: { workingSweep, workingSweepSpeed: speed } });
		assert.deepEqual(configFromText(configToText(config)), config);
		assert.equal(config.editor.workingSweep, workingSweep);
		assert.equal(config.editor.workingSweepSpeed, speed);
	}
});

test("schema v10 picks up speed in memory only and explicit save persists it atomically", async () => {
	const directory = await mkdtemp(join(tmpdir(), "glance-speed-"));
	try {
		const path = join(directory, "config.json"), store = createConfigStore(path);
		const config = defaultConfig();
		const { workingSweepSpeed: _speed, ...editor } = config.editor;
		const text = JSON.stringify({ ...config, version: 10, editor: { ...editor, workingSweep: "top" } });
		await writeFile(path, text);
		const loaded = store.loadConfigSync();
		assert.equal(loaded.writable, true);
		assert.equal(loaded.config.editor.workingSweepSpeed, 47);
		assert.equal(loaded.config.editor.workingSweep, "top");
		assert.equal(await readFile(path, "utf8"), text);
		loaded.config.editor.workingSweepSpeed = 60;
		await store.saveConfig(loaded.config);
		const saved = JSON.parse(await readFile(path, "utf8"));
		assert.equal(saved.version, 11);
		assert.equal(saved.editor.workingSweepSpeed, 60);
		assert.equal(saved.editor.workingSweep, "top");
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("configured speed reaches both sweep paths, including narrow frames and status gaps", () => {
	for (const speed of [10, 47, 85, 120]) for (const width of [4, 40, 120, 220]) {
		const top = sweepProfile(width, 0, speed);
		assert.ok(Math.abs((width + 2 * top.radius) / top.periodMs * 1000 - speed) < 1e-8);
		for (const rows of [2, 4, 12]) {
			const loop = perimeterSweepProfile(width, rows, 0, { column: 1, width: width / 2 }, speed);
			assert.ok(Math.abs(loop.length / loop.periodMs * 1000 - speed) < 1e-8);
		}
	}
});
