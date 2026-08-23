import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

const readme = await readFile("README.md", "utf8");

assert.ok(readme.includes("Model speed"), "README should document the user-facing Model speed segment");
assert.ok(readme.includes("enabled by default"), "README should state Model speed is enabled by default");
assert.ok(/\?/.test(readme), "README should document the Model speed unknown ? placeholder");
assert.ok(/~/.test(readme), "README should document the Model speed provisional ~ marker");
assert.ok(/Precision/i.test(readme), "README should document the Model speed Precision setting");
assert.ok(/no notifications/i.test(readme), "README should state Model speed sends no notifications");
assert.ok(/no timers?/i.test(readme), "README should state Model speed uses no timers");
assert.ok(/no token estimation/i.test(readme) || /never tokenizes/i.test(readme), "README should state Model speed does not estimate tokens from content");
assert.ok(/provider-reported output minus the reported reasoning subset/i.test(readme), "README should define the Model speed numerator from final provider usage");
assert.ok(/active assistant output-stream time/i.test(readme), "README should define the Model speed denominator from assistant output-stream timing");
assert.ok(/text and tool-call deltas/i.test(readme), "README should define mixed text/tool-call output semantics");
assert.ok(/pre-output waiting/i.test(readme) && /reasoning spans/i.test(readme) && /tool execution/i.test(readme) && /gaps between model calls/i.test(readme), "README should list excluded non-generation intervals");
assert.ok(/reasoning tokens are subtracted when available/i.test(readme), "README should define provider reasoning-usage subtraction");
assert.ok(/agent_settled/.test(readme), "README should identify Pi agent_settled as the final lifecycle boundary");
assert.ok(/retries, compactions, and queued continuations/i.test(readme), "README should explain why agent_end is not the final model-speed boundary");
assert.ok(/usage-bearing tool results, compactions, and branch summaries/i.test(readme), "README should distinguish the complete billed-session ledger from measurable assistant model speed");
assert.ok(/not a benchmark/i.test(readme), "README should keep the observed-rate benchmark caveat");

console.log("✓ throughput README copy checks passed");
