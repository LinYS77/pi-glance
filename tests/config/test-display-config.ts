import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKING_SWEEP_COLOR_VALUES } from "../../src/config/options.js";
import { defaultConfig, normalizeConfig } from "../../src/config/model.js";
import { createConfigStore } from "../../src/config/store.js";
import type { SegmentConfig } from "../../src/types.js";

test("color validation accepts all presets and falls back to the original theme accent", () => {
	for (const value of [undefined, null, false, 0, "red", "#ff00ff", {}, []]) {
		assert.equal(normalizeConfig({ editor: { workingSweepColor: value } }).editor.workingSweepColor, "theme");
	}
	for (const color of WORKING_SWEEP_COLOR_VALUES) {
		const config = normalizeConfig({ editor: { workingSweepColor: color, workingSweep: "off", workingSweepSpeed: 82 } });
		assert.equal(config.editor.workingSweepColor, color);
		assert.equal(config.editor.workingSweep, "off");
		assert.equal(config.editor.workingSweepSpeed, 82);
	}
});

for (const version of [12, 13]) test(`v${version} display upgrade preserves preferences and remains in memory until Save`, async () => {
	const dir = await mkdtemp(join(tmpdir(), "glance-display-config-"));
	try {
		for (const changes of ["hidden", "marker", "summary"] as const) {
			const config = defaultConfig();
			const { workingSweepColor: _color, ...editor } = config.editor;
			const segments: SegmentConfig[] = [
				{ id: "cost", enabled: false }, { id: "model", enabled: false }, { id: "tokens", enabled: true },
				{ id: "git", enabled: false }, { id: "context", enabled: true }, { id: "throughput", enabled: true },
			];
			if (version === 13) segments.splice(3, 0, { id: "extensions", enabled: false });
			const raw = { ...config, version, editor, segments, git: { ...config.git, changes } };
			const path = join(dir, "config.json"), text = JSON.stringify(raw);
			await writeFile(path, text);
			const store = createConfigStore(path), loaded = store.loadConfigSync();
			assert.equal(loaded.writable, true);
			assert.equal(loaded.config.editor.workingSweepColor, "theme");
			assert.deepEqual(loaded.config.git, raw.git, "the Git migration threshold must stay pre-v12");
			const expected = [...segments];
			if (version === 12) expected.splice(1, 0, { id: "extensions", enabled: true });
			assert.deepEqual(loaded.config.segments, expected);
			assert.equal(await readFile(path, "utf8"), text);
			loaded.config.editor.workingSweepColor = "copper";
			loaded.config.segments.reverse(); loaded.config.segments.find(s => s.id === "extensions")!.enabled = false;
			await store.saveConfig(loaded.config);
			assert.deepEqual(store.loadConfigSync().config, loaded.config);
		}
	} finally { await rm(dir, { recursive: true, force: true }); }
});
