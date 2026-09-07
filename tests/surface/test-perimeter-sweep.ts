import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CURSOR_MARKER, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { GlanceEditor } from "../../src/surface/editor.js";
import { renderInputSurfaceFrame } from "../../src/surface/frame.js";
import { sweepProfile } from "../../src/surface/top-edge-sweep.js";
import { createPerimeterSweep, perimeterSweepProfile } from "../../src/surface/perimeter-sweep.js";
import { renderGlanceLine } from "../../src/surface/status-line.js";
import { resolveBuiltInGlanceStyles, type ResolvedGlanceStyles, type TextStyler } from "../../src/theme/adapter.js";
import { GLANCE_THEMES } from "../../src/theme/themes.js";
import { richInputSurfaceState, stripAnsi } from "../support/surface-test-harness.js";

const identity = (text: string) => text;
const theme: EditorTheme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
const styles = resolveBuiltInGlanceStyles("dark");
const keys = { matches: () => false } as unknown as KeybindingsManager;

function configForLoop() {
	const config = defaultConfig();
	config.editor.workingSweep = "perimeter";
	return config;
}

function intensityAt(width: number, rows: number, elapsed: number, column: number, row: number): number {
	let intensity = 0;
	const sweep = createPerimeterSweep(width, rows, elapsed, { ...styles, highlight: (style, amount) => { intensity = amount; return style; } });
	sweep("─", styles.border, column, row);
	return intensity;
}

test("both modes travel at 47 columns per second regardless of width, height or status gaps", () => {
	for (const width of [0, 1, 2, 4, 40, 80, 120, 220, 4000]) {
		const top = sweepProfile(width, 0);
		const topLength = width + top.radius * 2;
		assert.ok(Math.abs(topLength / top.periodMs * 1000 - 47) < 1e-10);
		for (const rows of [2, 4, 12]) for (const gap of [undefined, { column: 1, width: Math.floor(width / 3) }]) {
			const loop = perimeterSweepProfile(width, rows, 0, gap);
			assert.ok(Math.abs(loop.length / loop.periodMs * 1000 - 47) < 1e-10);
			const stepMs = Math.min(top.periodMs, loop.periodMs) / 20;
			for (const lap of [0, 1, 10]) {
				const topStart = top.periodMs * (lap + 0.25), loopStart = loop.periodMs * (lap + 0.25);
				const topDistance = sweepProfile(width, topStart + stepMs).center - sweepProfile(width, topStart).center;
				const loopDistance = perimeterSweepProfile(width, rows, loopStart + stepMs, gap).center - perimeterSweepProfile(width, rows, loopStart, gap).center;
				assert.ok(Math.abs(topDistance - stepMs * 47 / 1000) < 1e-8);
				assert.ok(Math.abs(topDistance - loopDistance) < 1e-8, `${width}/${rows}: equal elapsed time means equal distance`);
			}
		}
	}
	assert.ok(perimeterSweepProfile(180, 3, 0).periodMs > sweepProfile(180, 0).periodMs, "a longer route takes longer, not a faster beam");
});

test("one clockwise coordinate reaches each edge and corner with no restart at the seam", () => {
	for (const [width, rows] of [[40, 3], [120, 8], [220, 16]]) {
		const w = width!, h = rows!;
		const period = perimeterSweepProfile(w, h, 0).periodMs;
		// Independent path: horizontal cells cost 1, vertical rows cost 2.
		const length = 2 * (w - 1) + 4 * (h + 1);
		const points = [
			[0, 0, 0], [(w - 1) / 2, 0, (w - 1) / 2], [w - 1, 0, w - 1],
			[w - 1, 1, w + 1], [w - 1, h + 1, w - 1 + 2 * (h + 1)],
			[(w - 1) / 2, h + 1, (w - 1) * 1.5 + 2 * (h + 1)],
			[0, h + 1, 2 * (w - 1) + 2 * (h + 1)], [0, 1, length - 2],
		];
		for (const [column, row, distance] of points) {
			const elapsed = distance! / length * period;
			assert.equal(intensityAt(w, h, elapsed, column!, row!), 1, `${w}/${h} at ${column},${row}`);
			assert.equal(intensityAt(w, h, elapsed + period, column!, row!), 1);
		}
		assert.equal(intensityAt(w, h, 0, 0, 0), 1, "starts lit, not outside the frame");
		assert.equal(intensityAt(w, h, period - 1, 0, 0), 1);
		assert.equal(intensityAt(w, h, period + 1, 0, 0), 1);
		for (const [column, row] of [[3, 0], [0, 2]]) {
			assert.ok(Math.abs(intensityAt(w, h, period - 1, column!, row!) - intensityAt(w, h, 1, column!, row!)) < 0.03);
		}
		assert.equal(intensityAt(w, h, period / 2, 0, 0), 0, "no second beam on the opposite corner");
	}
});

test("rendered full-border loop visits all four corners and both sides", () => {
	const config = configForLoop(); config.editor.topMarginRows = 0;
	config.segments.forEach(segment => { segment.enabled = false; });
	const input = { config, state: richInputSurfaceState(), styles, width: 100, body: { kind: "editor" as const, lines: ["draft"] } };
	const rows = config.editor.minContentRows, lastRow = rows + 1;
	const period = perimeterSweepProfile(input.width, rows, 0).periodMs;
	const length = 2 * (99 + 2 * (rows + 1));
	for (const [text, row, distance] of [["╭", 0, 0], ["╮", 0, 99], ["╯", lastRow, 99 + 2 * lastRow], ["╰", lastRow, 198 + 2 * lastRow], ["│", 1, 101], ["│", 1, length - 2]] as const) {
		const frame = renderInputSurfaceFrame({ ...input, chrome: { workingElapsedMs: period * distance / length } });
		assert.ok(frame[row]!.includes(styles.highlight!(styles.border, 1)(text)), `lit ${text} at row ${row}`);
	}
	const idle = renderInputSurfaceFrame(input);
	let bottomChanges = 0;
	for (let elapsed = 0; elapsed < period; elapsed += 70) {
		const frame = renderInputSurfaceFrame({ ...input, chrome: { workingElapsedMs: elapsed } });
		assert.deepEqual(frame.map(stripAnsi), idle.map(stripAnsi));
		if (frame.at(-1) !== idle.at(-1)) bottomChanges++;
	}
	assert.ok(bottomChanges > 10, "the bottom is a moving beam, not just lit corners");
	assert.deepEqual(renderInputSurfaceFrame({ ...input, chrome: { workingElapsedMs: 0 } }), renderInputSurfaceFrame({ ...input, chrome: { workingElapsedMs: period } }));
});

test("wide status areas never hide the beam for a timed gap", () => {
	const config = configForLoop(); config.editor.topMarginRows = 0;
	const state = richInputSurfaceState();
	state.workspace = { name: "p", path: "/p" };
	for (const width of [40, 56, 80, 120, 180, 220]) {
		let lit = false, status = "";
		const observed = { ...styles, highlight: (style: TextStyler, amount: number) => amount > 0.01
			? (text: string) => { if (/\S/.test(text)) lit = true; return style(text); }
			: style };
		const input = { config, state, width, styles: observed, body: { kind: "editor" as const, lines: [""] },
			status: { render: (budget: number) => status = renderGlanceLine(state, config, budget, 2, { styles }) } };
		for (let elapsed = 0; elapsed < 8000; elapsed += 33) {
			lit = false;
			const frame = renderInputSurfaceFrame({ ...input, chrome: { workingElapsedMs: elapsed } });
			assert.ok(lit, `${width}/${elapsed}: at least one visible part of the beam survives`);
			assert.ok(frame[0]!.includes(status), "metadata retains its exact bytes");
		}
	}
});

test("loop uses the same gradient in reverse on the bottom without splitting Unicode", () => {
	const width = 120, rows = 3, period = perimeterSweepProfile(width, rows, 0).periodMs;
	const amounts = (row: number) => {
		const recorded: number[] = [];
		const observed = { ...styles, highlight: (style: TextStyler, amount: number) => { if (amount > 0) recorded.push(amount); return style; } };
		const elapsed = row === 0 ? period / 4 - period * 4 / 254 : period * 3 / 4 - period * 4 / 254;
		createPerimeterSweep(width, rows, elapsed, observed)("─".repeat(width), styles.border, 0, row);
		return recorded;
	};
	const top = amounts(0), bottom = amounts(rows + 1).reverse();
	assert.equal(top.length, bottom.length);
	for (let i = 0; i < top.length; i++) assert.ok(Math.abs(top[i]! - bottom[i]!) < 1e-10);
	const text = "路径/👩🏽‍💻/e\u0301";
	const painted = createPerimeterSweep(width, rows, 200, styles)(text, styles.title, 0, 0);
	assert.equal(stripAnsi(painted), text);
	assert.ok(painted.includes("👩🏽‍💻") && painted.includes("e\u0301"));
});

test("all palettes preserve dimensions and text across heights, widths and phases", () => {
	const config = configForLoop();
	const state = richInputSurfaceState();
	for (const palette of GLANCE_THEMES) for (const mode of ["truecolor", "ansi256"] as const) {
		const styles = resolveBuiltInGlanceStyles(palette.id, mode);
		for (const width of [0, 1, 2, 4, 16, 40, 80, 120, 220]) for (const rows of [2, 4, 12]) {
			config.editor.minContentRows = Math.min(rows, 4);
			const body = { kind: "editor" as const, lines: Array.from({ length: rows }, () => "中文👩🏽‍💻e\u0301") };
			const input = { config, state, width, styles, body };
			const idle = renderInputSurfaceFrame(input);
			const period = perimeterSweepProfile(width, rows, 0).periodMs;
			for (const fraction of [0, 0.2, 0.45, 0.5, 0.75, 0.9999, 1]) {
				const frame = renderInputSurfaceFrame({ ...input, chrome: { workingElapsedMs: period * fraction } });
				assert.deepEqual(frame.map(stripAnsi), idle.map(stripAnsi), `${palette.id}/${mode}/${width}/${rows}/${fraction}`);
				assert.equal(frame[0], idle[0], "top spacing stays outside the animation");
				for (const line of frame) assert.ok(visibleWidth(line) <= width);
				if (width < 2) assert.deepEqual(frame, idle);
				if (mode === "ansi256") assert.equal(frame.join("").includes("\x1b[38;2;"), false);
			}
		}
	}
});

test("status, scroll labels and styled input remain byte-identical in loop mode", () => {
	const config = configForLoop(); config.editor.topMarginRows = 0;
	const state = richInputSurfaceState(); state.context.percent = 95; state.git.status = "conflict";
	let status = "";
	const text = `\x1b[7m中文👩🏽‍💻\x1b[27m${CURSOR_MARKER} draft`;
	const input = { config, state, width: 180, styles, body: { kind: "editor" as const, lines: [text] },
		status: { render: (budget: number) => status = renderGlanceLine(state, config, budget, 2, { styles }) } };
	const chrome = { topScrollIndicator: "─── ↑ 10 more ", bottomScrollIndicator: "─── ↓ 8 more " };
	const idle = renderInputSurfaceFrame({ ...input, chrome });
	assert.ok(status);
	const period = perimeterSweepProfile(180, 3, 0).periodMs;
	for (let elapsed = 0; elapsed < period; elapsed += 80) {
		const frame = renderInputSurfaceFrame({ ...input, chrome: { ...chrome, workingElapsedMs: elapsed } });
		assert.ok(frame[0]!.includes(status));
		assert.ok(frame[0]!.includes(styles.border(chrome.topScrollIndicator)));
		assert.ok(frame.at(-1)!.includes(styles.border(chrome.bottomScrollIndicator)));
		assert.ok(frame[1]!.includes(text));
		assert.deepEqual(frame.map(stripAnsi), idle.map(stripAnsi));
	}
});

test("off, disabled and unfocused frames never animate even with an elapsed time", () => {
	for (const mode of ["top", "perimeter", "off"] as const) for (const disabled of [false, true]) for (const unfocused of [false, true]) {
		if (mode !== "off" && !disabled && !unfocused) continue;
		const config = defaultConfig(); config.enabled = !disabled; config.editor.workingSweep = mode;
		const input = { config, state: richInputSurfaceState(), width: 120, styles, body: { kind: "editor" as const, lines: [""] }, chrome: { focus: unfocused ? "unfocused" as const : "focused" as const } };
		assert.deepEqual(renderInputSurfaceFrame({ ...input, chrome: { ...input.chrome, workingElapsedMs: 900 } }), renderInputSurfaceFrame(input));
	}
});

test("animation work stays bounded to the beam on very wide top and bottom edges", () => {
	let calls = 0;
	const observed: ResolvedGlanceStyles = { ...styles, highlight: (style, amount) => { calls++; return styles.highlight!(style, amount); } };
	for (const fraction of [0, 0.25, 0.5, 0.75, 0.99]) {
		calls = 0;
		const period = perimeterSweepProfile(4000, 3, 0).periodMs;
		const sweep = createPerimeterSweep(4000, 3, period * fraction, observed);
		for (const row of [0, 4]) {
			const line = "─".repeat(4000);
			assert.equal(stripAnsi(sweep(line, styles.border, 0, row)), line);
		}
		assert.ok(calls <= 64, `only the beam is shaded, not 8000 cells: ${calls}`);
	}
});

test("live loop preserves cached status, Bash cues, cursor and scrolling after resize", () => {
	const config = configForLoop(); config.editor.topMarginRows = 0;
	const sample = richInputSurfaceState();
	let reads = 0, elapsed: number | undefined;
	const state = { ...sample, get usage() { reads++; return sample.usage; } };
	const editor = new GlanceEditor({ terminal: { rows: 16 }, requestRender() {} } as unknown as TUI, theme, keys, () => state, () => config, undefined, { getWorkingElapsedMs: () => elapsed });
	editor.focused = true;
	for (const text of ["中文 draft", "!pwd", Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n")]) {
		editor.setText(text);
		const bash = (text: string) => `\x1b[38;5;208m${text}\x1b[39m`;
		editor.borderColor = bash;
		const cursor = editor.getCursor();
		for (const width of [180, 80, 4, 1, 120]) {
			elapsed = undefined;
			const idle = editor.render(width), before = reads;
			for (const time of [0, 800, 2500, 4000, 7000]) {
				elapsed = time;
				const frame = editor.render(width);
				assert.deepEqual(frame.map(stripAnsi), idle.map(stripAnsi));
				assert.equal(frame.join("").split(CURSOR_MARKER).length, idle.join("").split(CURSOR_MARKER).length);
				if (text.startsWith("!")) {
					assert.ok(frame[0]!.startsWith(bash("╭")));
					assert.deepEqual(frame.slice(1), idle.slice(1));
				}
				assert.equal(reads, before, "animation must reuse the live status string");
				for (const line of frame) assert.ok(visibleWidth(line) <= width);
			}
		}
		assert.deepEqual(editor.getCursor(), cursor);
		assert.equal(editor.getText(), text);
	}
});
