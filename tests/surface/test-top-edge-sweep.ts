import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { GlanceEditor } from "../../src/surface/editor.js";
import { renderInputSurfaceFrame } from "../../src/surface/frame.js";
import { createTopEdgeSweep, sweepProfile } from "../../src/surface/top-edge-sweep.js";
import { renderGlanceLine } from "../../src/surface/status-line.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { GLANCE_THEMES } from "../../src/theme/themes.js";
import type { Rgb } from "../../src/types.js";
import { richInputSurfaceState, stripAnsi } from "../support/surface-test-harness.js";

const identity = (text: string) => text;
const theme: EditorTheme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
const tui = { terminal: { rows: 24 }, requestRender() {} } as unknown as TUI;
const keys = { matches: () => false } as unknown as KeybindingsManager;

function foreground(text: string): Rgb {
	const rgb = text.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
	if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
	const code = Number(text.match(/\x1b\[38;5;(\d+)m/)![1]);
	if (code >= 232) { const value = 8 + 10 * (code - 232); return { r: value, g: value, b: value }; }
	const levels = [0, 95, 135, 175, 215, 255];
	const index = code - 16;
	return { r: levels[Math.floor(index / 36)]!, g: levels[Math.floor(index % 36 / 6)]!, b: levels[index % 6]! };
}

function luminance(color: Rgb): number {
	return [color.r, color.g, color.b].map(channel => {
		const value = channel / 255;
		return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
	}).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i]!, 0);
}

function contrast(a: Rgb, b: Rgb): number {
	const first = luminance(a), second = luminance(b);
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function oklab(color: Rgb): [number, number, number] {
	const [r, g, b] = [color.r, color.g, color.b].map(value => {
		const c = value / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

test("each theme has one chromatic Working accent distinct from both title and connector", () => {
	for (const palette of GLANCE_THEMES) for (const mode of ["truecolor", "ansi256"] as const) {
		const styles = resolveBuiltInGlanceStyles(palette.id, mode);
		const titlePeak = foreground(styles.highlight!(styles.title, 1)("x"));
		const borderPeak = foreground(styles.highlight!(styles.border, 1)("x"));
		assert.deepEqual(titlePeak, borderPeak, `${palette.id}/${mode}: one continuous beam`);
		const peak = oklab(titlePeak);
		assert.ok(Math.hypot(peak[1], peak[2]) >= 0.07, `${palette.id}/${mode}: use a colored accent rather than gray`);
		for (const style of [styles.title, styles.border]) {
			const base = oklab(foreground(style("x")));
			const difference = Math.hypot(...peak.map((value, i) => value - base[i]!));
			assert.ok(difference >= 0.18, `${palette.id}/${mode}: perceptual difference ${difference}`);
		}
		const background = palette.tone === "dark" ? { r: 40, g: 40, b: 40 } : { r: 245, g: 245, b: 245 };
		assert.ok(contrast(titlePeak, background) >= 4.5, `${palette.id}/${mode}: readable on the reference background`);
	}
});

test("wide unlit text bypasses per-character highlighting", () => {
	const styles = resolveBuiltInGlanceStyles("light");
	let calls = 0;
	const sweep = createTopEdgeSweep(4000, 1800, { ...styles, highlight: (style, amount) => { calls++; return styles.highlight!(style, amount); } });
	const text = "─".repeat(4000);
	assert.equal(stripAnsi(sweep(text, styles.border, 0)), text);
	assert.ok(calls <= 62, `only the beam and its edges should be evaluated, got ${calls}`);
	calls = 0;
	assert.equal(sweep("unlit path", styles.title, 0), styles.title("unlit path"));
	assert.equal(calls, 0);
});

test("cached Unicode measurements remain correct after changing paths and evicting old entries", () => {
	const styles = resolveBuiltInGlanceStyles("dark");
	const originals = ["项目/👩🏽‍💻/e\u0301", "\u0301中文🙂", "a\u200db", "路径".repeat(600)];
	const paint = (text: string) => createTopEdgeSweep(80, 800, styles)(text, styles.title, 0);
	const before = originals.map(paint);
	for (let i = 0; i < 200; i++) {
		const text = `目录-${i}-中文🙂`;
		assert.equal(stripAnsi(paint(text)), text);
		assert.equal(visibleWidth(paint(text)), visibleWidth(text));
	}
	assert.deepEqual(originals.map(paint), before);
	assert.ok(before[0]!.includes("👩🏽‍💻") && before[0]!.includes("e\u0301"));
});

test("all themes retain readable bold cores and feathered transitions", () => {
	for (const palette of GLANCE_THEMES) for (const mode of ["truecolor", "ansi256"] as const) {
		const styles = resolveBuiltInGlanceStyles(palette.id, mode);
		const value = palette.tone === "dark" ? 0 : 255;
		const background = { r: value, g: value, b: value };
		for (const style of [styles.border, styles.title]) {
			const peak = styles.highlight!(style, 1)("x");
			const color = foreground(peak);
			assert.ok(contrast(color, background) >= 4.5, `${palette.id}/${mode}: core remains readable on the reference background`);
			assert.ok(peak.startsWith("\x1b[1m") && peak.endsWith("\x1b[22m"), "bold applies only to the core");
			assert.equal(styles.highlight!(style, 0), style);
			const shades = new Set(Array.from({ length: 33 }, (_, i) => JSON.stringify(foreground(styles.highlight!(style, i / 32)("x")))));
			assert.ok(shades.size >= 3, `${palette.id}/${mode}: feathered transitions need multiple actual colors`);
		}
	}
});

test("status, warnings and host-provided border colors are outside the highlight palette", () => {
	const styles = resolveBuiltInGlanceStyles("high-contrast-light");
	const host = (text: string) => `\x1b[38;5;208m${text}\x1b[39m`;
	for (const style of [styles.error, styles.warn, styles.separator, styles.text, host, ...Object.values(styles.segments).map(s => s.fg)]) {
		assert.equal(styles.highlight!(style, 1), style);
	}
});

test("a broad core crosses the left region every two to four seconds", () => {
	const styles = resolveBuiltInGlanceStyles("light");
	for (const width of [20, 80, 160, 400]) {
		const profile = sweepProfile(width, 0);
		assert.equal(profile.center, -profile.radius);
		assert.ok(profile.radius >= 9 && profile.radius <= 28);
		assert.ok(profile.periodMs >= 2000 && profile.periodMs <= 3600);
		const intensities: number[] = [];
		const sweep = createTopEdgeSweep(width, profile.periodMs / 2, { ...styles, highlight: (style, amount) => { intensities.push(amount); return style; } });
		sweep("─".repeat(width), styles.border, 0);
		assert.ok(intensities.filter(value => value === 1).length >= 8, "visible core spans at least eight characters");
		assert.ok(intensities.some(value => value > 0 && value < 1));
		if (width >= 80) assert.equal(intensities[0], 0, "no whole-region flashing");
	}
});

test("path and line share one beam without splitting Unicode graphemes", () => {
	const styles = resolveBuiltInGlanceStyles("dark");
	const whole: number[] = [], split: number[] = [];
	const a = "路径/👩🏽‍💻/e\u0301 ", b = "────────────────";
	const record = (out: number[]) => createTopEdgeSweep(80, 800, { ...styles, highlight: (style, amount) => { if (amount > 0) out.push(amount); return style; } });
	record(whole)(a + b, styles.title, 0);
	record(split)(a, styles.title, 0);
	record(split)(b, styles.border, visibleWidth(a));
	assert.deepEqual(split, whole);
	const painted = createTopEdgeSweep(80, 800, styles)(a + b, styles.title, 0);
	assert.ok(painted.includes("👩🏽‍💻") && painted.includes("e\u0301"));
	assert.equal(stripAnsi(painted), a + b);
	assert.equal(visibleWidth(painted), visibleWidth(a + b));
});

test("every theme preserves all text, dimensions, body and bottom at every phase", () => {
	const config = defaultConfig(); config.editor.topMarginRows = 0;
	const state = richInputSurfaceState();
	for (const palette of GLANCE_THEMES) for (const mode of ["truecolor", "ansi256"] as const) {
		const styles = resolveBuiltInGlanceStyles(palette.id, mode);
		for (const width of [0, 1, 2, 4, 16, 40, 80, 120, 220]) {
			const input = { config, state, width, styles, body: { kind: "editor" as const, lines: ["中文🙂"] } };
			const idle = renderInputSurfaceFrame(input);
			for (const elapsed of [0, 300, 800, 1200, 1800, 2500, 3400]) {
				const frame = renderInputSurfaceFrame({ ...input, chrome: { workingElapsedMs: elapsed } });
				assert.deepEqual(frame.map(stripAnsi), idle.map(stripAnsi), `${palette.id}/${mode}/${width}/${elapsed}`);
				assert.deepEqual(frame.slice(1), idle.slice(1));
				for (const line of frame) assert.ok(visibleWidth(line) <= width);
				if (mode === "ansi256") assert.equal(frame.join("").includes("\x1b[38;2;"), false);
			}
		}
	}
});

test("right-hand status and its trailing border remain byte-identical throughout the sweep", () => {
	const config = defaultConfig(); config.editor.topMarginRows = 0;
	const styles = resolveBuiltInGlanceStyles("light");
	for (const width of [80, 120, 220]) for (const warning of [false, true]) {
		const state = richInputSurfaceState();
		if (warning) { state.context.percent = 95; state.git.status = "conflict"; }
		let statusText = "";
		const input = { config, state, width, styles, body: { kind: "editor" as const, lines: [""] },
			status: { render: (budget: number) => statusText = renderGlanceLine(state, config, budget, 1, { styles }) } };
		const idle = renderInputSurfaceFrame(input)[0]!;
		assert.ok(statusText && idle.includes(statusText));
		const suffix = idle.slice(idle.indexOf(statusText));
		let changes = 0;
		for (let elapsed = 0; elapsed < 3600; elapsed += 80) {
			const line = renderInputSurfaceFrame({ ...input, chrome: { workingElapsedMs: elapsed } })[0]!;
			assert.ok(line.endsWith(suffix), "status colors, emphasis and trailing border cannot animate");
			assert.deepEqual(stripAnsi(line), stripAnsi(idle));
			if (line !== idle) changes++;
		}
		assert.ok(changes > 30, "the beam no longer spends most of the cycle outside the left region");
	}
});

test("short paths still animate their connector; unfocused frames remain static", () => {
	const config = defaultConfig(); config.editor.topMarginRows = 0;
	const state = richInputSurfaceState(); state.workspace = { name: "p", path: "/p" };
	const styles = resolveBuiltInGlanceStyles("high-contrast-light");
	const touched: string[] = [];
	const observed = { ...styles, highlight: (style: (text: string) => string, amount: number) => amount > 0
		? (text: string) => { touched.push(text); return style(text); }
		: style };
	const input = { config, state, styles: observed, width: 180, body: { kind: "editor" as const, lines: [""] } };
	for (let time = 0; time < 3600; time += 80) renderInputSurfaceFrame({ ...input, chrome: { workingElapsedMs: time } });
	assert.ok(touched.some(text => text.includes("p")));
	assert.ok(touched.some(text => text.includes("─")));
	assert.equal(touched.some(text => /main|GPT|tok|ctx/.test(text)), false);
	const unfocused = { ...input, chrome: { focus: "unfocused" as const } };
	assert.deepEqual(renderInputSurfaceFrame({ ...unfocused, chrome: { ...unfocused.chrome, workingElapsedMs: 1000 } }), renderInputSurfaceFrame(unfocused));
});

test("live sweep retains the original status cache, Bash border and scroll labels", () => {
	const config = defaultConfig(); config.editor.topMarginRows = 0;
	const sample = richInputSurfaceState();
	let reads = 0;
	const state = { ...sample, get usage() { reads++; return sample.usage; } };
	let elapsed: number | undefined;
	const editor = new GlanceEditor(tui, theme, keys, () => state, () => config, undefined, { getWorkingElapsedMs: () => elapsed });
	editor.focused = true; editor.setText("!pwd");
	const bash = (text: string) => `\x1b[38;5;208m${text}\x1b[39m`;
	editor.borderColor = bash;
	const idle = editor.render(180), before = reads;
	assert.ok(before > 0);
	for (const time of [300, 800, 1200, 2200]) {
		elapsed = time;
		const frame = editor.render(180);
		assert.deepEqual(frame.map(stripAnsi), idle.map(stripAnsi));
		assert.ok(frame[0]!.startsWith(bash("╭")));
		assert.equal(reads, before);
	}
	elapsed = undefined;
	assert.deepEqual(editor.render(180), idle);
	editor.setText(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
	const scrolled = editor.render(180);
	assert.ok(stripAnsi(scrolled[0]!).includes("more"));
	elapsed = 1000;
	assert.deepEqual(editor.render(180).map(stripAnsi), scrolled.map(stripAnsi));
});
