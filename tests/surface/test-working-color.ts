import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { WORKING_SWEEP_COLOR_VALUES } from "../../src/config/options.js";
import { GlanceEditor } from "../../src/surface/editor.js";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { createInputSurfaceRenderer } from "../../src/surface/renderer.js";
import { richInputSurfaceState, stripAnsi } from "../support/surface-test-harness.js";

test("changing sweep color changes only the active beam, in both animation modes", () => {
	for (const mode of ["top", "perimeter"] as const) {
		const state = richInputSurfaceState(), render = createInputSurfaceRenderer(state);
		const config = defaultConfig(); config.editor.workingSweep = mode;
		const changed = { ...config, editor: { ...config.editor, workingSweepColor: "blue" as const } };
		const idle = render(config, 220);
		const original = render(config, 220, { workingElapsedMs: 1200 });
		const blue = render(changed, 220, { workingElapsedMs: 1200 });
		assert.notDeepEqual(blue, original, `${mode}: the beam should pick up the chosen color`);
		assert.deepEqual(blue.map(stripAnsi), original.map(stripAnsi));
		assert.deepEqual(render(changed, 220), idle, "idle colors must stay identical");
	}
});

test("live and preview frames agree for every color, with no stale colors when resized or changed back", () => {
	const state = richInputSurfaceState(), render = createInputSurfaceRenderer(state);
	const identity = (text: string) => text;
	const theme: EditorTheme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
	let config = defaultConfig();
	const statuses = new Map([["external", "\x1b[31mExternal ready\x1b[0m"]]);
	const editor = new GlanceEditor({ terminal: { rows: 24 }, requestRender() {} } as unknown as TUI,
		theme, { matches: () => false } as unknown as KeybindingsManager, () => state, () => config,
		{ getWorkingElapsedMs: () => 1200, getExtensionStatuses: () => statuses });
	editor.focused = true; editor.setText("untouched input");
	for (const mode of ["top", "perimeter"] as const) {
		for (const color of [...WORKING_SWEEP_COLOR_VALUES, "theme"] as const) {
			config = { ...config, editor: { ...config.editor, workingSweep: mode, workingSweepColor: color } };
			for (const width of [220, 80, 1, 220]) {
				const live = editor.render(width);
				const preview = render(config, width, { workingElapsedMs: 1200, extensionStatuses: statuses });
				if (width === 220) assert.ok(live[config.editor.topMarginRows]!.includes("\x1b[31mExternal ready"), "sweep colors cannot recolor a publisher's text");
				assert.equal(live[config.editor.topMarginRows], preview[config.editor.topMarginRows]);
				for (const line of live) assert.ok(visibleWidth(line) <= width);
			}
		}
	}
	assert.equal(editor.getText(), "untouched input");
});
