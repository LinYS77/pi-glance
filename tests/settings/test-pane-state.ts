import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { createPaneModel, createPaneViewModel, updatePaneModel, type PaneModelState } from "../../src/settings/model.js";

function checkStateTypes(): void {
	// @ts-expect-error a palette picker needs its slot, parent row and restore config
	const missing: PaneModelState["page"] = { kind: "theme", index: 0 };
	// @ts-expect-error a list cannot retain numeric editor state
	const stale: PaneModelState["page"] = { kind: "list", index: 0, text: "47" };
	void missing; void stale;
}
void checkStateTypes;

test("cancelling a palette picker preserves an earlier unsaved change and parent selection", () => {
	let model = createPaneModel(defaultConfig());
	model = updatePaneModel(model, { type: "toggle" }).model;
	model = updatePaneModel(model, { type: "move", direction: "down", amount: 2 }).model;
	model = updatePaneModel(model, { type: "activate" }).model;
	model = updatePaneModel(model, { type: "move", direction: "down" }).model;
	assert.equal(createPaneViewModel(model).preview.ambientTone, "dark");
	assert.notEqual(model.draft.theme.dark, "dark");
	model = updatePaneModel(model, { type: "back" }).model;
	assert.equal(model.draft.enabled, false);
	assert.equal(model.draft.theme.dark, "dark");
	assert.equal(createPaneViewModel(model).rows.find(row => row.selected)?.label, "Dark palette");
	assert.equal(createPaneViewModel(model).dirty, true);
});
