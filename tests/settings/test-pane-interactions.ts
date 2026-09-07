import { strict as assert } from "node:assert";
import { test } from "node:test";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { createPaneModel, createPaneViewModel, updatePaneModel, type PaneIntent, type PaneModelState } from "../../src/settings/model.js";
import { paneHarness, keys as k } from "../support/pane-harness.js";

const step = (model: PaneModelState, intent: PaneIntent) => updatePaneModel(model, intent).model;
const down = (model: PaneModelState, amount = 1) => step(model, { type: "move", direction: "down", amount });
const section = (model: PaneModelState) => step(model, { type: "section", direction: 1 });
const selected = (model: PaneModelState) => createPaneViewModel(model).rows.find(row => row.selected)!;

test("Left means off and Right means on for every boolean and status row", () => {
	const root = createPaneModel(defaultConfig());
	const status = section(root);
	const details = step(status, { type: "activate" });
	for (const start of [root, status, details]) {
		let model = start;
		for (let i = 0; i < 3; i++) {
			model = step(model, { type: "adjust", direction: -1 });
			assert.equal(selected(model).value, "Off");
		}
		for (let i = 0; i < 3; i++) {
			model = step(model, { type: "adjust", direction: 1 });
			assert.equal(selected(model).value, "On");
		}
		assert.equal(selected(step(model, { type: "toggle" })).value, "Off");
	}
});

test("palettes adjust inline like other choices; arrows stop at either end", () => {
	let palette = down(createPaneModel(defaultConfig()));
	palette = step(palette, { type: "adjust", direction: -1 });
	assert.equal(palette.page.kind, "list");
	assert.equal(palette.draft.theme.light, "light");
	palette = step(palette, { type: "adjust", direction: 1 });
	assert.equal(palette.page.kind, "list");
	assert.equal(palette.draft.theme.light, "catppuccin-latte");
	let mode = section(section(createPaneModel(defaultConfig())));
	mode = step(mode, { type: "adjust", direction: -1 });
	assert.equal(mode.draft.editor.workingSweep, "perimeter");
	for (let i = 0; i < 5; i++) mode = step(mode, { type: "adjust", direction: 1 });
	assert.equal(mode.draft.editor.workingSweep, "off");
});

test("every field editor confirms or cancels locally; only a list can save", () => {
	const root = createPaneModel(defaultConfig());
	const working = section(section(root));
	for (const row of [down(root), working, down(working)]) {
		let model = step(row, { type: "activate" });
		model = model.page.kind === "number" ? step(model, { type: "input", text: "74" }) : down(model);
		assert.equal(updatePaneModel(model, { type: "save" }).completion, undefined);
		assert.deepEqual(step(model, { type: "section", direction: 1 }), model, "finish the edit before switching sections");
		assert.deepEqual(step(model, { type: "back" }).draft, row.draft);
		const confirmed = step(model, { type: "activate" });
		assert.equal(confirmed.page.kind, "list");
		assert.equal(updatePaneModel(confirmed, { type: "save" }).completion?.action, "save");
	}
});

test("incomplete numbers do not show an error until confirmation", () => {
	let model = step(down(section(section(createPaneModel(defaultConfig())))), { type: "activate" });
	model = step(model, { type: "input", text: "7" });
	if (model.page.kind !== "number") throw new Error("not editing number");
	assert.equal(model.page.error, "");
	assert.equal(model.draft.editor.workingSweepSpeed, 47);
	model = step(model, { type: "activate" });
	if (model.page.kind !== "number") throw new Error("not editing number");
	assert.match(model.page.error, /10.*120/);
	const unchanged = step(model, { type: "input", text: "7" });
	if (unchanged.page.kind === "number") assert.equal(unchanged.page.error, model.page.error, "cursor movement cannot clear a validation error");
	model = step(model, { type: "input", text: "74" });
	if (model.page.kind !== "number") throw new Error("not editing number");
	assert.equal(model.page.error, "");
	assert.equal(model.draft.editor.workingSweepSpeed, 74);
});

test("opening an existing custom value neither substitutes a preset nor loses it during preview", () => {
	const config = defaultConfig(); config.git.pollIntervalMs = 7500;
	const row = down(step(section(createPaneModel(config)), { type: "activate" }), 3);
	const opened = step(row, { type: "activate" });
	const choices = createPaneViewModel(opened).choices;
	assert.match(choices.find(choice => choice.selected)!.label, /7\.5 seconds/);
	assert.equal(step(opened, { type: "activate" }).draft.git.pollIntervalMs, 7500);
	let preview = step(opened, { type: "move", direction: "up" });
	assert.equal(preview.draft.git.pollIntervalMs, 30000);
	preview = down(preview);
	assert.equal(preview.draft.git.pollIntervalMs, 7500);
	assert.equal(step(preview, { type: "activate" }).draft.git.pollIntervalMs, 7500);
});

test("sections remember the detail page; returning and re-entering restores its row", () => {
	let model = down(step(section(createPaneModel(defaultConfig())), { type: "activate" }), 2);
	assert.equal(selected(model).label, "Commit ID");
	model = section(model);
	model = step(model, { type: "section", direction: -1 });
	assert.equal(createPaneViewModel(model).title, "Status line / Git");
	assert.equal(selected(model).label, "Commit ID");
	model = step(model, { type: "back" });
	assert.equal(selected(model).label, "Git");
	model = step(model, { type: "activate" });
	assert.equal(selected(model).label, "Commit ID");
});

test("list navigation clamps, including paging and destructive confirmation choices", () => {
	const root = createPaneModel(defaultConfig());
	assert.equal(selected(step(root, { type: "move", direction: "up" })).label, "Glance");
	assert.equal(selected(down(root, 999)).label, "Space above editor");
	const confirmation = step(root, { type: "reset" });
	assert.equal(createPaneViewModel(step(confirmation, { type: "move", direction: "up" })).choices.find(c => c.selected)!.label, "Keep editing");
	const palette = step(down(root), { type: "activate" });
	assert.equal(createPaneViewModel(down(palette, 999)).choices.at(-1)!.selected, true);
});

test("reset affects settings, not navigation, including reordered status items", () => {
	let model = step(section(createPaneModel(defaultConfig())), { type: "reorder", direction: 1 });
	assert.equal(selected(model).label, "Git");
	model = step(down(step(model, { type: "reset" })), { type: "activate" });
	assert.equal(model.section, "status");
	assert.equal(selected(model).label, "Git");
	assert.deepEqual(model.draft, defaultConfig());
});

test("field editors do not advertise Save or section switching", () => {
	for (const enter of [[k.down, k.enter], [k.backTab, k.enter], [k.backTab, k.down, k.enter]]) {
		const pane = paneHarness();
		pane.press(...enter);
		assert.ok(!pane.text(40).includes("Save & close"));
		assert.ok(!pane.text(40).includes("[Tab]"));
		assert.match(pane.text(), /\[Enter\] Confirm/);
		assert.match(pane.text(), /\[Esc\] Cancel/);
		pane.pane.dispose();
	}
});

test("number replacement works for Kitty key events and fragmented paste stays text", () => {
	const kitty = paneHarness();
	kitty.press(k.backTab, k.down, k.enter, "\x1b[55u", "\x1b[52u", k.enter, "s");
	const saved = kitty.completion();
	if (saved?.action !== "save") throw new Error("not saved");
	assert.equal(saved.config.editor.workingSweepSpeed, 74);
	kitty.pane.dispose();

	const paste = paneHarness();
	paste.press(k.backTab, k.down, k.enter, "\x1b[200~", "80", "\r", "s", "r", "q", "\x1b[201~");
	assert.equal(paste.completion(), undefined);
	assert.match(paste.text(), /Sweep speed/);
	assert.doesNotMatch(paste.text(), /Reset all settings\?/);
	paste.press(k.esc);
	assert.match(paste.text(), /47 cols\/s/);
	paste.pane.dispose();
	const trailingEnter = paneHarness();
	trailingEnter.press(k.backTab, k.down, k.enter, "\x1b[200~74\x1b[201~\r", "s");
	const done = trailingEnter.completion();
	if (done?.action !== "save") throw new Error("confirmation following paste was lost");
	assert.equal(done.config.editor.workingSweepSpeed, 74);
	trailingEnter.pane.dispose();
});

test("help reflects injected Pi selection keys and disabled bindings", () => {
	const bindings = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.up": ["ctrl+k"], "tui.select.down": ["ctrl+j"], "tui.select.confirm": ["ctrl+g"], "tui.select.cancel": ["ctrl+x"], "tui.input.tab": ["ctrl+n"] });
	const h = paneHarness(defaultConfig(), {}, bindings);
	const text = h.text();
	for (const key of ["Ctrl+K", "Ctrl+J", "Ctrl+G", "Ctrl+X", "Ctrl+N"]) assert.ok(text.includes(key), key);
	h.press("\x0e", "\x0e", "\x0a", "\x07"); // Working -> speed -> edit
	assert.match(h.text(), /Sweep speed/);
	assert.match(h.text(), /\[Ctrl\+G\] Confirm/);
	assert.match(h.text(), /\[Ctrl\+X\] Cancel/);
	h.pane.dispose();
	const noCancel = paneHarness(defaultConfig(), {}, new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.cancel": [] }));
	assert.ok(!noCancel.text().includes("[Esc]"));
	assert.match(noCancel.text(), /Ctrl\+C/);
	noCancel.pane.dispose();
});
