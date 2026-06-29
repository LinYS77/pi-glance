import { strict as assert } from "node:assert";

type RuntimeEventKind =
	| "model_select"
	| "thinking_level_select"
	| "turn_start"
	| "tool_execution_end"
	| "session_tree"
	| "session_compact"
	| "message_end"
	| "turn_end"
	| "agent_end"
	| "config_save_success"
	| "editor_thinking_cycle";

type RuntimeSnapshotMode = "none" | "reliable" | "lifecycle" | "message" | "thinking" | "compact";
type RuntimeGitRefreshMode = "never" | "onWorkspaceChange" | "immediate";
type RuntimeContextPlan = "none" | "refresh" | "clear";

interface RuntimeRefreshPlan {
	ensureConfig: boolean;
	ensureState: boolean;
	snapshot: RuntimeSnapshotMode;
	refreshWorkspace: boolean;
	refreshModel: boolean;
	refreshUsageTotals: boolean;
	context: RuntimeContextPlan;
	git: RuntimeGitRefreshMode;
	render: boolean;
}

interface RuntimeEventFacts {
	messageRole?: string;
}

interface RuntimePolicyModule {
	runtimePlanFor(kind: RuntimeEventKind, facts?: RuntimeEventFacts): RuntimeRefreshPlan;
}

const reliableWithModelImmediate: RuntimeRefreshPlan = {
	ensureConfig: true,
	ensureState: true,
	snapshot: "reliable",
	refreshWorkspace: true,
	refreshModel: true,
	refreshUsageTotals: true,
	context: "refresh",
	git: "immediate",
	render: true,
};

const lifecycleWithModelImmediate: RuntimeRefreshPlan = {
	ensureConfig: true,
	ensureState: true,
	snapshot: "lifecycle",
	refreshWorkspace: true,
	refreshModel: true,
	refreshUsageTotals: false,
	context: "refresh",
	git: "immediate",
	render: true,
};

const lifecycleWithModelOnWorkspaceChange: RuntimeRefreshPlan = {
	ensureConfig: true,
	ensureState: true,
	snapshot: "lifecycle",
	refreshWorkspace: true,
	refreshModel: true,
	refreshUsageTotals: false,
	context: "refresh",
	git: "onWorkspaceChange",
	render: true,
};

const reliableNoModelOnWorkspaceChange: RuntimeRefreshPlan = {
	ensureConfig: true,
	ensureState: true,
	snapshot: "reliable",
	refreshWorkspace: true,
	refreshModel: false,
	refreshUsageTotals: true,
	context: "refresh",
	git: "onWorkspaceChange",
	render: true,
};

const runtimePolicyPath: string = "../runtime-policy.js";
const { runtimePlanFor } = (await import(runtimePolicyPath)) as RuntimePolicyModule;

assert.equal(typeof runtimePlanFor, "function", "runtime-policy.ts should export runtimePlanFor(kind, facts?)");

function assertPlan(kind: RuntimeEventKind, expected: RuntimeRefreshPlan, facts?: RuntimeEventFacts): void {
	assert.deepEqual(runtimePlanFor(kind, facts), expected, `${kind} should return the expected runtime refresh plan`);
}

assertPlan("model_select", lifecycleWithModelImmediate);
assertPlan("session_tree", reliableWithModelImmediate);

assertPlan("turn_start", lifecycleWithModelOnWorkspaceChange);

assertPlan("tool_execution_end", {
	ensureConfig: true,
	ensureState: true,
	snapshot: "lifecycle",
	refreshWorkspace: true,
	refreshModel: false,
	refreshUsageTotals: false,
	context: "refresh",
	git: "immediate",
	render: true,
});

assertPlan("session_compact", {
	ensureConfig: true,
	ensureState: true,
	snapshot: "compact",
	refreshWorkspace: true,
	refreshModel: true,
	refreshUsageTotals: true,
	context: "clear",
	git: "immediate",
	render: true,
});
assert.equal(runtimePlanFor("session_compact").context, "clear", "session_compact should clear context rather than refresh it");

assertPlan("message_end", {
	ensureConfig: true,
	ensureState: true,
	snapshot: "message",
	refreshWorkspace: true,
	refreshModel: false,
	refreshUsageTotals: false,
	context: "refresh",
	git: "onWorkspaceChange",
	render: true,
}, { messageRole: "assistant" });
for (const role of ["user", "system", undefined]) {
	assertPlan(
		"message_end",
		{
			ensureConfig: true,
			ensureState: true,
			snapshot: "none",
			refreshWorkspace: false,
			refreshModel: false,
			refreshUsageTotals: false,
			context: "none",
			git: "never",
			render: false,
		},
		role === undefined ? undefined : { messageRole: role },
	);
}

assertPlan("turn_end", reliableNoModelOnWorkspaceChange);
assertPlan("agent_end", reliableNoModelOnWorkspaceChange);

assertPlan("thinking_level_select", {
	ensureConfig: true,
	ensureState: true,
	snapshot: "thinking",
	refreshWorkspace: false,
	refreshModel: true,
	refreshUsageTotals: false,
	context: "none",
	git: "never",
	render: true,
});

assertPlan("editor_thinking_cycle", {
	ensureConfig: false,
	ensureState: false,
	snapshot: "thinking",
	refreshWorkspace: false,
	refreshModel: true,
	refreshUsageTotals: false,
	context: "none",
	git: "never",
	render: true,
});

assertPlan("config_save_success", {
	ensureConfig: false,
	ensureState: false,
	snapshot: "reliable",
	refreshWorkspace: true,
	refreshModel: true,
	refreshUsageTotals: true,
	context: "refresh",
	git: "immediate",
	render: true,
});

for (const kind of ["model_select", "turn_start", "tool_execution_end"] as const) {
	assert.equal(runtimePlanFor(kind).snapshot, "lifecycle", `${kind} should use the narrow lifecycle snapshot reader`);
	assert.equal(runtimePlanFor(kind).refreshUsageTotals, false, `${kind} should not request a usage totals refresh`);
}
assert.equal(runtimePlanFor("message_end", { messageRole: "assistant" }).snapshot, "message", "assistant message_end should use the message-level snapshot reader");
assert.equal(runtimePlanFor("message_end", { messageRole: "assistant" }).refreshUsageTotals, false, "assistant message_end should not request a usage totals scan");

for (const kind of ["thinking_level_select", "editor_thinking_cycle"] as const) {
	assert.equal(runtimePlanFor(kind).git, "never", `${kind} should not schedule a git refresh`);
}

for (const kind of ["turn_start", "turn_end", "agent_end"] as const) {
	assert.notEqual(runtimePlanFor(kind).git, "immediate", `${kind} should not force immediate git refresh`);
	assert.equal(runtimePlanFor(kind).git, "onWorkspaceChange", `${kind} should only refresh git when workspace changes`);
}

assert.equal(runtimePlanFor("message_end", { messageRole: "assistant" }).git, "onWorkspaceChange", "assistant message_end should only refresh git when workspace changes");
assert.equal(runtimePlanFor("message_end", { messageRole: "user" }).render, false, "non-assistant message_end should not render");

console.log("✓ runtime policy checks passed");
