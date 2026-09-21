import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CURSOR_MARKER, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { showGlancePane } from "../../src/settings/pane.js";
import { getThemeCatalogForSlot } from "../../src/settings/catalog.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { renderInputSurface } from "../../src/surface/renderer.js";
import { paneHarness, keys as k } from "../support/pane-harness.js";
import { richInputSurfaceState, stripAnsi } from "../support/surface-test-harness.js";

test("settings preview keeps the real input width and status fitting when the terminal resizes", () => {
	const h = paneHarness();
	try {
		for (const width of [80, 100, 180, 240, 56, 220]) {
			const lines = h.pane.render(width);
			const top = lines.find(line => stripAnsi(line).trimStart().startsWith("╭"));
			const liveFrame = renderInputSurface(richInputSurfaceState(), h.config, width);
			assert.equal(top, liveFrame[h.config.editor.topMarginRows], `preview must fit the same facts as the live frame at ${width} columns`);
			assert.equal(visibleWidth(top!), width);
			const heading = lines.find(line => line.includes("◌ Glance"))!;
			assert.ok(visibleWidth(heading.trimStart()) <= 100, "only the settings controls remain width-bounded");
		}
	} finally { h.pane.dispose(); }
});

test("preview position stays stable across sections and field editors without filling the terminal", () => {
	const h = paneHarness();
	try {
		h.height(48);
		const initial = h.pane.render(180).map(stripAnsi);
		const previewRow = initial.findIndex(line => line.startsWith("╭"));
		for (const path of [[], [k.down, k.enter], [k.esc, k.tab, k.enter], [k.esc, k.tab, k.enter], [k.esc, k.down, k.enter], [k.esc, k.tab]]) {
			h.press(...path);
			const lines = h.pane.render(180).map(stripAnsi);
			const top = lines.findIndex(line => line.startsWith("╭"));
			assert.equal(top, previewRow, "opening a taller picker or shorter detail page must not shift the preview");
			assert.ok(lines.length < 46, "reserve a bounded settings area, not a fullscreen page");
			assert.ok(lines.at(-1)!.startsWith("╰"), "no setting, help or action row may move the preview away from Pi's input-area bottom");
			assert.equal(lines.length - top, h.config.editor.minContentRows + 2);
			assert.ok(lines.findIndex(line => line.includes("[Esc]")) < top, "navigation remains above the preview");
		}
	} finally { h.pane.dispose(); }
});

test("Glance off and discard confirmation keep the same preview area", () => {
	const h = paneHarness();
	try {
		const initial = h.pane.render(100);
		h.press(k.space);
		assert.match(h.text(), /Preview · Glance is off/);
		assert.equal(h.pane.render(100).length, initial.length, "turning the frame off must not collapse its preview space");
		h.press(k.esc);
		assert.match(h.text(), /Discard unsaved changes/);
		assert.equal(h.pane.render(100).length, initial.length);
		h.press(k.esc, k.space);
		assert.deepEqual(h.pane.render(100), initial);
	} finally { h.pane.dispose(); }
});

test("new users see four sections, readable values and save/close without focus columns", () => {
	const h = paneHarness();
	const text = h.text();
	for (const label of ["Appearance", "Status line", "Activity", "Light palette", "Dark palette", "Nerd Font", "Smart path", "Save & close", "No changes"]) assert.ok(text.includes(label), label);
	assert.ok(!text.includes("General") && !text.includes("Enabled"));
	h.press(k.space);
	assert.match(h.text(), /Glance \*\s+Off/);
	assert.match(h.text(), /Unsaved changes/);
	h.press(k.enter);
	assert.match(h.text(), /No changes/);
	h.press(k.esc);
	assert.equal(h.completion()?.action, "cancel");
	h.pane.dispose();
});

test("keyboard paths toggle status directly, open details once, and return to the right item", () => {
	const h = paneHarness();
	h.press(k.tab, k.space, "j");
	assert.match(h.text(), /› Git \*\s+Off/);
	h.press(k.enter);
	assert.match(h.text(), /Status line \/ Git/);
	assert.ok(!h.text().includes("Enabled"));
	h.press(k.esc);
	assert.match(h.text(), /› Git \*\s+Off/);
	h.press(k.tab);
	assert.match(h.text(), /Sweep speed\s+‹ 47 cols\/s ›/);
	h.press(k.backTab);
	assert.match(h.text(), /› Git \*\s+Off/);
	h.press("s");
	const done = h.completion();
	assert.equal(done?.action, "save");
	if (done?.action === "save") { assert.equal(done.config.segments[1]!.id, "git"); assert.equal(done.config.segments[1]!.enabled, false); }
	h.pane.dispose();
});

test("ordinary and palette lists stay navigable after narrow/short-terminal resizing", () => {
	const h = paneHarness();
	for (const rows of [6, 10, 16, 24, 40]) for (const width of [0, 1, 4, 16, 32, 40, 56, 80, 100, 180]) {
		h.height(rows);
		h.press(...Array(7).fill(k.up));
		for (let i = 0; i < 7; i++) {
			const rendered = h.pane.render(width);
			assert.ok(rendered.length <= rows - 2, `${width}x${rows}`);
			for (const line of rendered) assert.ok(visibleWidth(line) <= width, `${width}: ${stripAnsi(line)}`);
			if (width >= 56) assert.ok(rendered.some(line => stripAnsi(line).includes("› ")), "selected row stays visible");
			h.press(k.down);
		}
	}
	h.press(...Array(7).fill(k.up));
	h.press(k.down, k.enter); // Light palette
	for (const rows of [16, 24, 40]) {
		h.height(rows);
		h.press(...Array(22).fill(k.up));
		for (let i = 0; i < 22; i++) {
			const rendered = h.pane.render(80);
			assert.ok(rendered.length <= rows - 2);
			assert.ok(h.text(80).includes(getThemeCatalogForSlot("light")[i]!.label));
			h.press(k.down);
		}
	}
	h.pane.dispose();
});

test("Pi selection bindings take precedence; Ctrl-C always cancels and input owns letter shortcuts", () => {
	const bindings = { matches: (data: string, action: string) => ({ "tui.select.up": "u", "tui.select.down": "d", "tui.select.pageDown": "n", "tui.select.pageUp": "p", "tui.select.confirm": "!", "tui.select.cancel": "x", "tui.input.tab": "t" } as Record<string, string>)[action] === data } as unknown as KeybindingsManager;
	const h = paneHarness(defaultConfig(), {}, bindings);
	h.press(k.tab); assert.ok(!h.text().includes("[ Status line ]"));
	h.press("t", "t", "d", "d", "!"); // numeric input
	assert.ok(h.pane.render(100).join("").includes(CURSOR_MARKER));
	h.press("s", "r", "q");
	assert.equal(h.completion(), undefined);
	assert.doesNotMatch(h.text(), /Invalid value/);
	h.press("!");
	assert.match(h.text(), /whole number/);
	h.press("x"); // restore
	assert.match(h.text(), /47 cols\/s/);
	h.press("\x03");
	assert.equal(h.completion()?.action, "cancel");
	const count = h.renders();
	h.press("t"); assert.equal(h.renders(), count);
	h.pane.dispose();
});

test("number input supports correction, validation, cursor focus and local restore", () => {
	const h = paneHarness();
	h.press(k.backTab, k.backTab, k.down, k.down, k.enter);
	assert.ok(h.pane.render(100).join("").includes(CURSOR_MARKER));
	h.pane.focused = false;
	assert.ok(!h.pane.render(100).join("").includes(CURSOR_MARKER));
	h.pane.focused = true;
	h.press("\x15", "9", k.enter);
	assert.match(h.text(), /whole number/);
	assert.equal(h.completion(), undefined);
	h.press("\x15", "62", k.enter);
	assert.match(h.text(), /Sweep speed \*\s+‹ 62 cols\/s ›/);
	h.press(k.enter, "\x15", "99", k.esc);
	assert.match(h.text(), /62 cols\/s/);
	h.press("s");
	const saved = h.completion();
	if (saved?.action !== "save") throw new Error("not saved");
	assert.equal(saved.config.editor.workingSweepSpeed, 62);
	assert.equal(h.config.editor.workingSweepSpeed, 47);
	h.pane.dispose();
});

test("typing a speed replaces the initial number without requiring a delete shortcut", () => {
	const h = paneHarness();
	h.press(k.backTab, k.backTab, k.down, k.down, k.enter, "74", k.enter, "s");
	const saved = h.completion();
	assert.equal(saved?.action, "save");
	if (saved?.action === "save") assert.equal(saved.config.editor.workingSweepSpeed, 74);
	h.pane.dispose();
});

test("dirty exit and reset show safe choices; Enter alone never discards edits", () => {
	const h = paneHarness();
	h.press(k.space, k.esc);
	assert.match(h.text(), /Discard unsaved changes\?/);
	h.press(k.enter);
	assert.equal(h.completion(), undefined);
	assert.match(h.text(), /Glance \*\s+Off/);
	h.press("r");
	assert.match(h.text(), /Reset all settings\?/);
	h.press(k.esc);
	assert.match(h.text(), /Glance \*\s+Off/);
	h.press(k.esc, k.down, k.enter);
	assert.deepEqual(h.completion(), { action: "cancel" });
	h.pane.dispose();
});

test("palette preview uses the edited slot, injected styles and the reported color depth", () => {
	for (const trueColor of [false, true]) {
		const h = paneHarness(defaultConfig(), { renderStyleContext: { trueColor } });
		h.press(k.down, k.enter, k.down);
		const raw = h.pane.render(100).join("\n");
		const styles = resolveBuiltInGlanceStyles("catppuccin-latte", trueColor ? "truecolor" : "ansi256");
		assert.ok(raw.includes(styles.border("╭")));
		assert.equal(raw.includes("\x1b[38;2;"), trueColor);
		h.press(k.esc);
		assert.match(h.text(), /Light palette\s+Light/);
		h.pane.dispose();
	}
	const dark = resolveBuiltInGlanceStyles("dark");
	const h = paneHarness(defaultConfig(), { renderStyleContext: { styles: dark } });
	assert.ok(h.pane.render(100).join("").includes(dark.border("╭")));
	h.pane.dispose();
});

test("the full-width bottom overlay keeps the editor mounted and disposes its preview on every exit", async () => {
	for (const mode of ["regular", "fullscreen"] as const) for (const fail of [false, true]) {
		let active = 0;
		const promise = showGlancePane(defaultConfig(), { ui: { custom: async <T>(factory: (tui: TUI, theme: Theme, keys: KeybindingsManager, done: (result: T) => void) => Component, options?: Parameters<ExtensionUIContext["custom"]>[1]) => {
			const pane = factory({ mode, terminal: { rows: 32 }, requestRender() {} } as unknown as TUI, { fg: (_tone: string, text: string) => text } as unknown as Theme, undefined as unknown as KeybindingsManager, () => {});
			assert.equal(options?.overlay, true, "settings must not replace Pi's editor with a taller component");
			const layout = typeof options?.overlayOptions === "function" ? options.overlayOptions() : options?.overlayOptions;
			assert.equal(layout?.width, "100%");
			assert.equal(layout?.anchor, "bottom-left");
			assert.deepEqual(layout?.margin, { bottom: 0 }, "Pi 0.86 has no empty-footer reservation in either mode");
			pane.handleInput?.(k.backTab);
			pane.handleInput?.(k.backTab);
			pane.handleInput?.(k.right);
			assert.equal(active, 1);
			if (fail) throw new Error("UI closed");
			return { action: "cancel" } as T;
		} } }, undefined, { schedulePreviewFrame: () => { active++; return () => { active--; }; } });
		if (fail) await assert.rejects(promise, /UI closed/); else await promise;
		assert.equal(active, 0);
	}
});
