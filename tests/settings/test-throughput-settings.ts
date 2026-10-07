import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { getSettingsRows } from "../../src/settings/catalog.js";

test("Output throughput separates its visibility from its one detail setting", () => {
	const config = defaultConfig();
	const summary = getSettingsRows(config, "status");
	assert.equal(summary[2]!.label, "Output throughput");
	const details = getSettingsRows(config, "status", "throughput");
	assert.equal(details.length, 1);
	const precision = details[0]!;
	assert.equal(precision.label, "Decimal places");
	assert.match(precision.hint, /including reasoning/);
	assert.match(precision.hint, /full request second/);
	assert.match(precision.hint, /not raw decode speed/);
	assert.equal(precision.kind, "choice");
	if (precision.kind !== "choice") throw new Error("missing choices");
	assert.deepEqual(precision.options.map(o => o.label), ["Automatic", "1 decimal", "Whole numbers"]);
	for (const [index, value] of ["auto", 1, 0].entries()) {
		const next = precision.select(config, index);
		assert.equal(next.throughput.precision, value);
		assert.deepEqual(next.segments, config.segments);
	}
	assert.equal(config.throughput.precision, "auto");
});
