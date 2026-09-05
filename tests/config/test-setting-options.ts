import { strict as assert } from "node:assert";
import { test } from "node:test";
import { nextOption } from "../../src/config/options.js";

test("curated option cycling preserves order, wraps and recovers unknown values", () => {
	assert.equal(nextOption("plain", ["plain", "nerd"]), "nerd");
	assert.equal(nextOption("nerd", ["plain", "nerd"]), "plain");
	assert.equal(nextOption("unknown", ["plain", "nerd"]), "plain");
	assert.equal(nextOption(5000, [2000, 5000, 10000, 30000]), 10000);
	assert.equal(nextOption(30000, [2000, 5000, 10000, 30000]), 2000);
	assert.equal(nextOption(7500, [2000, 5000, 10000, 30000]), 2000);
	assert.equal(nextOption("only", ["only"]), "only");
	assert.throws(() => nextOption("unknown", []), /empty option list/);
});
