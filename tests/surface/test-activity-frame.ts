import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { WORKING_SWEEP_COLOR_VALUES } from "../../src/config/options.js";
import { renderInputSurfaceFrame } from "../../src/surface/frame.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { GLANCE_THEMES } from "../../src/theme/themes.js";
import { richInputSurfaceState, stripAnsi } from "../support/surface-test-harness.js";
import { ActivityClock, activityMotion } from "../../src/runtime/activity-animation.js";
import { createInputSurfaceRenderer } from "../../src/surface/renderer.js";
import { GlanceEditor } from "../../src/surface/editor.js";
import { animationTime, nativeActivity } from "../support/activity-harness.js";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";

test("retry blinks only the selected border area for every palette, effect color and terminal depth", () => {
	const state = richInputSurfaceState(); state.workspace = { name: "DEMO", path: "/DEMO" };
	const content = `\x1b[4m中文🙂 draft\x1b[24m${CURSOR_MARKER}`;
	const fact = "\x1b[31mDEMO FACTS\x1b[39m";
	for (const palette of GLANCE_THEMES) for (const depth of ["truecolor", "ansi256"] as const)
		for (const color of WORKING_SWEEP_COLOR_VALUES) for (const area of ["top", "perimeter"] as const) {
			const config = defaultConfig(); config.editor.activityMode = "sweep"; config.editor.workingSweep = area;
			config.icons = "plain"; config.editor.topMarginRows = 0; config.display.workspaceLabel = "name";
			const styles = resolveBuiltInGlanceStyles(palette.id, depth, color);
			const input = { state, config, width: 100, styles, body: { kind: "editor" as const, lines: [content] },
				status: { render: () => fact }, chrome: { hasDraft: true } };
			const idle = renderInputSurfaceFrame(input);
			const bright = renderInputSurfaceFrame({ ...input, chrome: { ...input.chrome, animation: { kind: "blink", bright: true } } });
			assert.deepEqual(bright.map(stripAnsi), idle.map(stripAnsi));
			assert.ok(bright[0]!.startsWith(styles.highlight!(styles.border, 1)("╭")));
			assert.ok(bright[0]!.includes(styles.title(" DEMO ")) && bright[0]!.includes(fact));
			assert.ok(bright[1]!.includes(content));
			assert.ok(bright.at(-1)!.includes(styles.title(" draft · alt+s ")));
			if (area === "top") assert.deepEqual(bright.slice(1), idle.slice(1));
			else assert.ok(bright.at(-1)!.startsWith(styles.highlight!(styles.border, 1)("╰")));
			assert.deepEqual(renderInputSurfaceFrame({ ...input, chrome: { ...input.chrome, animation: { kind: "blink", bright: false } } }), idle);
		}
});

test("text activity shares the border with scrolling, not the stash, and never enables a supplied animation", () => {
	const config = defaultConfig(); config.icons = "plain";
	const styles = resolveBuiltInGlanceStyles("dark");
	const input = { state: richInputSurfaceState(), config, width: 100, styles, body: { kind: "preview" as const },
		chrome: { hasDraft: true, bottomScrollIndicator: "─── ↓ 3 more ", activity: { kind: "retry" as const, render: () => "Retrying (2/3) in 8s (esc to cancel)" } } };
	const idle = renderInputSurfaceFrame(input);
	assert.match(stripAnsi(idle.at(-1)!), /^╰─ Retrying.*↓ 3 more ╯$/);
	assert.ok(!idle.at(-1)!.includes("draft"));
	assert.deepEqual(renderInputSurfaceFrame({ ...input, chrome: { ...input.chrome, animation: { kind: "blink", bright: true } } }), idle);
	for (const width of [0, 1, 2, 4, 8, 16, 40, 100]) for (const line of renderInputSurfaceFrame({ ...input, width })) assert.ok(visibleWidth(line) <= width);
});

test("native editor and preview use identical activity geometry and motion for every phase", () => {
	const state = richInputSurfaceState(), config = defaultConfig(), time = animationTime();
	const identity = (text: string) => text;
	const theme: EditorTheme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
	let kind: "working" | "compaction" | "branchSummary" | "retry" | undefined;
	const editor = new GlanceEditor({ terminal: { rows: 38 }, requestRender() {} } as unknown as TUI,
		theme, { matches: () => false } as unknown as KeybindingsManager, () => state, () => config,
		{ animationNowMs: time.now, scheduleAnimationFrame: time.schedule });
	editor.focused = true;
	const clock = new ActivityClock({ getMotion: () => activityMotion(config, kind), isPaused: () => false,
		nowMs: time.now, schedule: time.schedule, requestRender() {} });
	const preview = createInputSurfaceRenderer(state);
	try {
		for (const mode of ["text", "sweep"] as const) for (const area of ["top", "perimeter"] as const) {
			config.editor.activityMode = mode; config.editor.workingSweep = area;
			for (const next of ["working", "compaction", "branchSummary", "retry", undefined] as const) {
				kind = next; const native = kind ? nativeActivity(kind) : undefined;
				editor.setWorkingStatusIndicator(native);
				editor.render(180); clock.frame();
				for (const elapsed of [0, 250, 750, 1000]) for (const width of [180, 40, 8, 1]) {
					time.advance(elapsed);
					const live = editor.render(width);
					const lines = preview(config, width, { animation: clock.frame(), activity: native ? { kind: native.kind, render: w => native.renderInBorder(w) } : undefined });
					assert.equal(live[config.editor.topMarginRows], lines[config.editor.topMarginRows]);
					assert.equal(live.at(-1), lines.at(-1));
				}
			}
		}
	} finally { editor.dispose(); clock.dispose(); }
	assert.equal(time.pending(), 0);
});
