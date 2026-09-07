import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CURSOR_MARKER, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { showGlancePane } from "../../src/settings/pane.js";
import { getThemeCatalogForSlot } from "../../src/settings/catalog.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { paneHarness, keys as k } from "../support/pane-harness.js";
import { stripAnsi } from "../support/surface-test-harness.js";

test("new users see three sections, readable values and save/close without focus columns", () => {
	const h = paneHarness();
	const text = h.text();
	for (const label of ["Appearance", "Status line", "Working", "Light palette", "Dark palette", "Nerd Font", "Smart path", "Save & close", "No changes"]) assert.ok(text.includes(label), label);
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
	h.press("t", "t", "d", "!"); // numeric input
	assert.ok(h.pane.render(100).join("").includes(CURSOR_MARKER));
	h.press("s", "r", "q");
	assert.equal(h.completion(), undefined);
	assert.doesNotMatch(h.text(), /whole number/);
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
	h.press(k.backTab, k.down, k.enter);
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
	h.press(k.backTab, k.down, k.enter, "74", k.enter, "s");
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

test("custom UI rejection and external completion dispose the preview clock", async () => {
	for (const fail of [false, true]) {
		let active = 0;
		const promise = showGlancePane(defaultConfig(), { ui: { custom: async <T>(factory: (tui: TUI, theme: Theme, keys: KeybindingsManager, done: (result: T) => void) => Component) => {
			const pane = factory({ terminal: { rows: 32 }, requestRender() {} } as unknown as TUI, { fg: (_tone: string, text: string) => text } as unknown as Theme, undefined as unknown as KeybindingsManager, () => {});
			pane.handleInput?.(k.backTab);
			assert.equal(active, 1);
			if (fail) throw new Error("UI closed");
			return { action: "cancel" } as T;
		} } }, undefined, { schedulePreviewFrame: () => { active++; return () => { active--; }; } });
		if (fail) await assert.rejects(promise, /UI closed/); else await promise;
		assert.equal(active, 0);
	}
});
