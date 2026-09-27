import { strict as assert } from "node:assert";
import { test } from "node:test";
import { paneHarness, keys as k } from "../support/pane-harness.js";
import { defaultConfig } from "../../src/config/model.js";
import { getSettingsRows } from "../../src/settings/catalog.js";
import { createPaneModel, createPaneViewModel, updatePaneModel, type PaneIntent, type PaneModelState } from "../../src/settings/model.js";

const step = (model: PaneModelState, intent: PaneIntent) => updatePaneModel(model, intent).model;

test("the change count tracks settings and order, not activity previews or derived values", () => {
	const h = paneHarness();
	try {
		h.press(k.tab, "j");
		assert.match(h.text(), /Unsaved changes · 1/);
		h.press(k.space);
		assert.match(h.text(), /Unsaved changes · 2/);
		h.press("d");
		assert.match(h.text(), /Unsaved changes · 2/);
		h.press(k.space, "k");
		assert.match(h.text(), /No changes/);
		h.press(k.tab, k.down, k.down, k.right);
		assert.match(h.text(), /Unsaved changes · 1/);
		h.press("p");
		assert.match(h.text(), /Unsaved changes · 1/);
	} finally { h.pane.dispose(); }
});

test("changing Working speed does not mark the unchanged summary multiplier as edited", () => {
	let model = createPaneModel(defaultConfig());
	model = step(step(model, { type: "section", direction: 1 }), { type: "section", direction: 1 });
	model = step(model, { type: "move", direction: "down", amount: 2 });
	model = step(model, { type: "adjust", direction: 1 });
	let view = createPaneViewModel(model);
	assert.deepEqual(view.rows.filter(row => row.changed).map(row => row.id), ["working.speed"]);
	assert.equal(model.draft.editor.summarySpeedMultiplier, 0.5);
	assert.match(getSettingsRows(model.draft, "working").find(row => row.id === "activity.summarySpeed")!.hint, /24 cols\/s/);
	model = step(model, { type: "adjust", direction: -1 });
	view = createPaneViewModel(model);
	assert.equal(view.dirty, false);
	assert.equal(view.rows.some(row => row.changed), false);
});
