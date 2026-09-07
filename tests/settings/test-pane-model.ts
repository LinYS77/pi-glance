import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig, configFromText, configToText } from "../../src/config/model.js";
import { createPaneModel, createPaneViewModel, paneIsDirty, updatePaneModel, type PaneModelState, type PaneIntent } from "../../src/settings/model.js";
import { getThemeCatalogForSlot } from "../../src/settings/catalog.js";

const step = (model: PaneModelState, intent: PaneIntent) => updatePaneModel(model, intent).model;
const down = (model: PaneModelState, amount = 1) => step(model, { type: "move", direction: "down", amount });
const section = (model: PaneModelState) => step(model, { type: "section", direction: 1 });
const selected = (model: PaneModelState) => createPaneViewModel(model).rows.find(row => row.selected)!;

test("first row edits immediately; source config and loaded-key order never create false dirty state", () => {
	const config = defaultConfig(), initial = createPaneModel(config);
	assert.equal(initial.section, "appearance");
	assert.equal(selected(initial).label, "Glance");
	assert.equal(paneIsDirty(initial), false);
	const changed = step(initial, { type: "activate" });
	assert.equal(changed.draft.enabled, false);
	assert.equal(initial.draft.enabled, true);
	assert.equal(config.enabled, true);
	assert.equal(paneIsDirty(changed), true);
	assert.equal(paneIsDirty(step(changed, { type: "toggle" })), false);
	const loaded = createPaneModel(configFromText(configToText(config)));
	const reset = step(down(step(loaded, { type: "reset" })), { type: "activate" });
	assert.equal(paneIsDirty(reset), false);
});

test("three sections keep their selected row and expose only task-relevant controls", () => {
	let model = down(createPaneModel(defaultConfig()), 3);
	assert.equal(selected(model).label, "Icons");
	model = section(model);
	assert.deepEqual(createPaneViewModel(model).rows.map(row => row.label), ["Git", "Cost", "Model speed", "Context", "Tokens", "Model"]);
	model = section(model);
	assert.deepEqual(createPaneViewModel(model).rows.map(row => row.label), ["Animation", "Sweep speed"]);
	assert.equal(createPaneViewModel(model).preview.working, true);
	model = section(model);
	assert.equal(selected(model).label, "Icons");
	assert.equal(createPaneViewModel(model).preview.working, false);
	assert.equal(selected(step(model, { type: "move", direction: "up", amount: 3 })).label, "Glance");
});

test("status visibility, order and detail navigation are separate actions", () => {
	let model = section(createPaneModel(defaultConfig()));
	model = step(model, { type: "toggle" });
	assert.equal(model.draft.segments[0]!.enabled, false);
	model = step(model, { type: "reorder", direction: 1 });
	assert.equal(selected(model).label, "Git");
	assert.deepEqual(model.draft.segments.slice(0, 2).map(s => s.id), ["cost", "git"]);
	model = step(model, { type: "activate" });
	assert.equal(createPaneViewModel(model).title, "Status line / Git (Off)");
	assert.equal(createPaneViewModel(model).rows.some(row => row.label === "Enabled"), false);
	const detailed = step(model, { type: "activate" });
	assert.equal(detailed.draft.git.showDirty, false);
	assert.equal(detailed.draft.segments.find(s => s.id === "git")!.enabled, false);
	model = step(detailed, { type: "back" });
	assert.equal(selected(model).label, "Git");
	model = step(model, { type: "reorder", direction: -1 });
	assert.deepEqual(model.draft.segments.map(s => s.id), defaultConfig().segments.map(s => s.id));
	assert.deepEqual(step(model, { type: "reorder", direction: -1 }).draft, model.draft);
});

test("choice list exposes every option, previews and restores only the edited value", () => {
	let model = section(section(createPaneModel(defaultConfig())));
	model = down(model);
	model = step(model, { type: "adjust", direction: 1 }); // pre-existing dirty speed
	model = step(model, { type: "move", direction: "up" });
	const before = model.draft;
	model = step(model, { type: "activate" });
	assert.deepEqual(createPaneViewModel(model).choices.map(c => c.label), ["Full border", "Top edge", "Off"]);
	model = down(model);
	assert.equal(model.draft.editor.workingSweep, "top");
	assert.deepEqual(step(model, { type: "back" }).draft, before);
	model = step(model, { type: "activate" });
	assert.equal(model.page.kind, "list");
	assert.equal(model.draft.editor.workingSweep, "top");
	assert.equal(model.draft.editor.workingSweepSpeed, 48);
});

for (const slot of ["light", "dark"] as const) test(`${slot} palette preview, accept and cancel preserve the other slot`, () => {
	let model = down(createPaneModel(defaultConfig()), slot === "light" ? 1 : 2);
	model = step(model, { type: "activate" });
	assert.equal(createPaneViewModel(model).choices.length, 22);
	for (let index = 1; index < 22; index++) {
		model = down(model);
		assert.equal(model.draft.theme[slot], getThemeCatalogForSlot(slot)[index]!.id);
		assert.equal(createPaneViewModel(model).preview.ambientTone, slot);
	}
	model = down(model);
	const preview = model.draft.theme[slot];
	const restored = step(model, { type: "back" });
	assert.equal(paneIsDirty(restored), false);
	assert.equal(selected(restored).label, slot === "light" ? "Light palette" : "Dark palette");
	assert.equal(step(model, { type: "activate" }).draft.theme[slot], preview);
	const saved = updatePaneModel(step(model, { type: "activate" }), { type: "save" });
	assert.equal(saved.completion?.action, "save");
	if (saved.completion?.action === "save") assert.equal(saved.completion.config.theme[slot], preview);
});

test("speed supports one-column steps, direct input, strict validation and restore", () => {
	let model = down(section(section(createPaneModel(defaultConfig()))));
	assert.equal(selected(model).value, "47 cols/s");
	model = step(model, { type: "adjust", direction: -1 });
	assert.equal(model.draft.editor.workingSweepSpeed, 46);
	model = step(model, { type: "activate" });
	for (const text of ["", "0", "9", "121", "47.5", "abc", "Infinity", "1e2"]) {
		const invalid = step(model, { type: "input", text });
		assert.equal(invalid.draft.editor.workingSweepSpeed, 46);
		const rejected = step(invalid, { type: "activate" });
		assert.equal(rejected.page.kind, "number");
		if (rejected.page.kind === "number") assert.match(rejected.page.error, /whole number/);
		assert.equal(updatePaneModel(invalid, { type: "save" }).completion, undefined);
	}
	const valid = step(model, { type: "input", text: "85" });
	assert.equal(valid.draft.editor.workingSweepSpeed, 85);
	assert.equal(step(valid, { type: "back" }).draft.editor.workingSweepSpeed, 46);
	assert.equal(step(valid, { type: "activate" }).draft.editor.workingSweepSpeed, 85);
	const high = step(step(model, { type: "input", text: "120" }), { type: "activate" });
	assert.equal(step(high, { type: "adjust", direction: 1 }).draft.editor.workingSweepSpeed, 120);
	const low = step(step(model, { type: "input", text: "10" }), { type: "activate" });
	assert.equal(step(low, { type: "adjust", direction: -1 }).draft.editor.workingSweepSpeed, 10);
});

test("reset and dirty exit require confirmation, default to keep editing, and never write config", () => {
	const initial = createPaneModel(defaultConfig());
	assert.equal(updatePaneModel(initial, { type: "back" }).completion?.action, "cancel");
	const dirty = step(initial, { type: "toggle" });
	for (const type of ["back", "reset"] as const) {
		let confirmation = step(dirty, { type });
		assert.equal(confirmation.page.kind, "confirm");
		assert.equal(createPaneViewModel(confirmation).choices.find(c => c.selected)!.label, "Keep editing");
		assert.deepEqual(step(confirmation, { type: "activate" }).draft, dirty.draft);
		assert.deepEqual(step(confirmation, { type: "back" }).draft, dirty.draft);
		confirmation = down(confirmation);
		const result = updatePaneModel(confirmation, { type: "activate" });
		if (type === "back") assert.equal(result.completion?.action, "cancel");
		else { assert.deepEqual(result.model.draft, defaultConfig()); assert.equal(result.completion, undefined); }
	}
	assert.equal(updatePaneModel(dirty, { type: "cancel" }).completion?.action, "cancel");
	const saved = updatePaneModel(dirty, { type: "save" });
	if (saved.completion?.action !== "save") throw new Error("not saved");
	saved.completion.config.enabled = true;
	assert.equal(dirty.draft.enabled, false);
});

test("preview layout is transient and controls never alter unrelated settings", () => {
	let model = section(createPaneModel(defaultConfig()));
	for (const density of ["full", "compact", "minimal", "auto"]) {
		model = step(model, { type: "density" });
		assert.equal(model.previewDensity, density);
		assert.equal(paneIsDirty(model), false);
	}
	model = section(model);
	model = step(step(model, { type: "adjust", direction: 1 }), { type: "adjust", direction: 1 }); // off
	assert.equal(model.draft.editor.workingSweep, "off");
	assert.equal(createPaneViewModel(model).preview.working, false);
	model = down(model);
	model = step(model, { type: "adjust", direction: 1 });
	assert.equal(model.draft.editor.workingSweepSpeed, 48);
	assert.equal(createPaneViewModel(model).preview.working, false);
});
