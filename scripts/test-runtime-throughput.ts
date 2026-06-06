import { strict as assert } from "node:assert";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../config.js";
import { createGlanceRuntime } from "../runtime.js";
import type { GlanceConfig } from "../types.js";

interface Notification {
	message: string;
	type: "info" | "warning" | "error" | undefined;
}

interface TestContext {
	ctx: ExtensionCommandContext;
	notifications: Notification[];
	getRenderRequests(): number;
}

interface RuntimeRecord {
	events: Record<string, (event: unknown, ctx: ExtensionCommandContext) => unknown>;
	commands: {
		openPane(args: string, ctx: ExtensionCommandContext): Promise<void>;
	};
}

interface TurnThroughputExpectation {
	startedAtMs: number;
	endedAtMs: number;
	elapsedMs: number;
	tokensPerSecond: number;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
		assistantMessages: number;
	};
}

function cloneConfig(config: GlanceConfig): GlanceConfig {
	return JSON.parse(JSON.stringify(config)) as GlanceConfig;
}

function assistant(output: number, extras: Record<string, unknown> = {}, stopReason = "stop"): unknown {
	return {
		role: "assistant",
		stopReason,
		usage: { output, totalTokens: output, ...extras },
	};
}

function user(output: number): unknown {
	return { role: "user", usage: { output, totalTokens: output } };
}

function turnEnd(turnIndex: number, message: unknown): unknown {
	return { type: "turn_end", turnIndex, message, toolResults: [] };
}

function createContext(): TestContext {
	const notifications: Notification[] = [];
	let renderRequests = 0;
	const fakeTui = { requestRender: () => renderRequests++ };
	const fakeTheme = {};
	const fakeFooterData = { getAvailableProviderCount: () => 1 };

	const ctx = {
		hasUI: true,
		cwd: "/repo",
		model: { id: "test-model", provider: "test-provider", contextWindow: 200_000 },
		sessionManager: {
			getCwd: () => "/repo",
			getEntries: () => [],
			getBranch: () => [],
		},
		ui: {
			notify: (message: string, type?: "info" | "warning" | "error") => notifications.push({ message, type }),
			setFooter: (factory: unknown) => {
				if (factory) (factory as (tui: unknown, theme: unknown, footerData: unknown) => unknown)(fakeTui, fakeTheme, fakeFooterData);
			},
			setEditorComponent: (_factory: unknown) => {},
		},
		getContextUsage: () => ({ tokens: 42, contextWindow: 200_000, percent: 0.021 }),
	} as unknown as ExtensionCommandContext;

	return { ctx, notifications, getRenderRequests: () => renderRequests };
}

function createRuntime(nowValues: number[]): { runtime: RuntimeRecord; capturedStates: unknown[] } {
	const capturedStates: unknown[] = [];
	const config = defaultConfig();
	const adapters = {
		getThinkingLevel: () => "off",
		loadConfigSync: () => cloneConfig(config),
		loadConfig: async () => cloneConfig(config),
		saveConfig: async (_config: GlanceConfig) => {},
		showPane: async (_initial: GlanceConfig, _ctx: ExtensionCommandContext, previewState?: unknown) => {
			capturedStates.push(JSON.parse(JSON.stringify(previewState)) as unknown);
			return { action: "cancel" as const };
		},
		createGitRefresher: () => ({ schedule: (_immediate?: boolean) => {}, dispose: () => {} }),
		nowMs: () => {
			assert.ok(nowValues.length > 0, "runtime should only read injected nowMs for agent_start/turn_end/agent_end timing");
			return nowValues.shift()!;
		},
	};
	return { runtime: createGlanceRuntime(adapters) as unknown as RuntimeRecord, capturedStates };
}

async function captureState(runtime: RuntimeRecord, test: TestContext, capturedStates: unknown[]): Promise<unknown> {
	await runtime.commands.openPane("", test.ctx);
	return capturedStates.at(-1);
}

function throughputSlots(state: unknown): { lastTurn?: unknown; currentRun?: unknown } {
	return ((state as { throughput?: { lastTurn?: unknown; currentRun?: unknown } } | undefined)?.throughput ?? {}) as { lastTurn?: unknown; currentRun?: unknown };
}

function assertSlots(state: unknown, expected: { lastTurn: unknown; currentRun: unknown }, message: string): void {
	assert.deepEqual(throughputSlots(state), expected, message);
}

const firstFinal: TurnThroughputExpectation = {
	startedAtMs: 1_000,
	endedAtMs: 3_500,
	elapsedMs: 2_500,
	tokensPerSecond: 20,
	usage: {
		input: 0,
		output: 50,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 50,
		assistantMessages: 1,
	},
};

{
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000]);
	runtime.events.sessionStart({}, test.ctx);
	const before = await captureState(runtime, test, capturedStates);
	const renderBaseline = test.getRenderRequests();
	const notificationBaseline = test.notifications.length;

	assert.equal(typeof runtime.events.agentStart, "function", "runtime.events should expose agentStart for pi.on('agent_start') wiring");
	runtime.events.agentStart({}, test.ctx);
	const after = await captureState(runtime, test, capturedStates);

	assert.deepEqual(throughputSlots(after), throughputSlots(before), "agentStart should not change visible throughput state before a checkpoint");
	assert.equal(test.getRenderRequests(), renderBaseline, "agentStart should only record local start time and must not request render");
	assert.deepEqual(test.notifications.slice(notificationBaseline), [{ message: "pi-glance configuration cancelled", type: "info" }], "agentStart lifecycle should not call ctx.ui.notify");
}

{
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 3_500, 5_000]);
	runtime.events.sessionStart({}, test.ctx);

	runtime.events.agentStart({}, test.ctx);
	await runtime.events.agentEnd({ messages: [assistant(50)] }, test.ctx);
	const afterFinal = await captureState(runtime, test, capturedStates);
	assertSlots(afterFinal, { lastTurn: firstFinal, currentRun: null }, "valid agentEnd should store final lastTurn and keep currentRun clear");

	runtime.events.agentStart({}, test.ctx);
	const afterNextStart = await captureState(runtime, test, capturedStates);
	assertSlots(afterNextStart, { lastTurn: firstFinal, currentRun: null }, "previous final should remain visible after a new agentStart until a valid turn_end checkpoint exists");
}

{
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([10_000, 11_250]);
	runtime.events.sessionStart({}, test.ctx);

	runtime.events.agentStart({}, test.ctx);
	await runtime.events.turnEnd(turnEnd(0, assistant(40)), test.ctx);
	const afterTurn = await captureState(runtime, test, capturedStates);
	assertSlots(
		afterTurn,
		{
			lastTurn: null,
			currentRun: {
				startedAtMs: 10_000,
				endedAtMs: 11_250,
				elapsedMs: 1_250,
				tokensPerSecond: 32,
				usage: {
					input: 0,
					output: 40,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 40,
					assistantMessages: 1,
				},
			},
		},
		"valid assistant turn_end should create a provisional currentRun measurement using agent_start -> turn_end wall time",
	);
}

{
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 2_000, 4_000]);
	runtime.events.sessionStart({}, test.ctx);

	runtime.events.agentStart({}, test.ctx);
	await runtime.events.turnEnd(turnEnd(0, assistant(20, { input: 3, cacheRead: 2 })), test.ctx);
	await runtime.events.turnEnd(turnEnd(1, assistant(60, { input: 7, cacheWrite: 5 })), test.ctx);
	const afterSecondTurn = await captureState(runtime, test, capturedStates);
	assertSlots(
		afterSecondTurn,
		{
			lastTurn: null,
			currentRun: {
				startedAtMs: 1_000,
				endedAtMs: 4_000,
				elapsedMs: 3_000,
				tokensPerSecond: 80 / 3,
				usage: {
					input: 10,
					output: 80,
					cacheRead: 2,
					cacheWrite: 5,
					totalTokens: 80,
					assistantMessages: 2,
				},
			},
		},
		"multi-turn provisional Reply speed should sum assistant outputs/messages and use agent_start -> latest turn_end denominator",
	);
}

{
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 2_000]);
	runtime.events.sessionStart({}, test.ctx);

	runtime.events.agentStart({}, test.ctx);
	await runtime.events.turnEnd(turnEnd(7, assistant(20)), test.ctx);
	await runtime.events.turnEnd(turnEnd(7, assistant(20)), test.ctx);
	const afterDuplicate = await captureState(runtime, test, capturedStates);
	assertSlots(
		afterDuplicate,
		{
			lastTurn: null,
			currentRun: {
				startedAtMs: 1_000,
				endedAtMs: 2_000,
				elapsedMs: 1_000,
				tokensPerSecond: 20,
				usage: {
					input: 0,
					output: 20,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 20,
					assistantMessages: 1,
				},
			},
		},
		"duplicate turnIndex should not double-count assistant usage in currentRun",
	);
}

{
	const noStart = createContext();
	const noStartRuntime = createRuntime([1_000]);
	noStartRuntime.runtime.events.sessionStart({}, noStart.ctx);
	await noStartRuntime.runtime.events.turnEnd(turnEnd(0, assistant(40)), noStart.ctx);
	assertSlots(await captureState(noStartRuntime.runtime, noStart, noStartRuntime.capturedStates), { lastTurn: null, currentRun: null }, "turn_end without matching agent_start should not create throughput state");

	const nonAssistant = createContext();
	const nonAssistantRuntime = createRuntime([1_000]);
	nonAssistantRuntime.runtime.events.sessionStart({}, nonAssistant.ctx);
	nonAssistantRuntime.runtime.events.agentStart({}, nonAssistant.ctx);
	await nonAssistantRuntime.runtime.events.turnEnd(turnEnd(0, user(99)), nonAssistant.ctx);
	assertSlots(await captureState(nonAssistantRuntime.runtime, nonAssistant, nonAssistantRuntime.capturedStates), { lastTurn: null, currentRun: null }, "non-assistant turn_end should not create throughput state");
}

{
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 2_000, 3_000]);
	runtime.events.sessionStart({}, test.ctx);

	runtime.events.agentStart({}, test.ctx);
	await runtime.events.turnEnd(turnEnd(0, assistant(20)), test.ctx);
	await runtime.events.agentEnd({ messages: [assistant(90)] }, test.ctx);
	const afterFinal = await captureState(runtime, test, capturedStates);
	assertSlots(
		afterFinal,
		{
			lastTurn: {
				startedAtMs: 1_000,
				endedAtMs: 3_000,
				elapsedMs: 2_000,
				tokensPerSecond: 45,
				usage: {
					input: 0,
					output: 90,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 90,
					assistantMessages: 1,
				},
			},
			currentRun: null,
		},
		"valid agentEnd should compute final from event.messages, replace provisional display, and clear currentRun",
	);
}

{
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 3_500]);
	runtime.events.sessionStart({}, test.ctx);

	runtime.events.agentStart({}, test.ctx);
	await runtime.events.agentEnd({ messages: [assistant(50)] }, test.ctx);
	assert.deepEqual(throughputSlots(await captureState(runtime, test, capturedStates)).lastTurn, firstFinal, "no-start final setup should create an initial trusted final");

	await runtime.events.agentEnd({ messages: [assistant(1)] }, test.ctx);
	assertSlots(await captureState(runtime, test, capturedStates), { lastTurn: firstFinal, currentRun: null }, "agent_end without matching agent_start should preserve previous trusted lastTurn and keep currentRun clear");
}

for (const [name, event] of [
	["zero-output final", { messages: [assistant(0)] }],
	["error final", { messages: [assistant(20, {}, "error")] }],
	["aborted final", { messages: [assistant(20, {}, "aborted")] }],
] as const) {
	const test = createContext();
	const { runtime, capturedStates } = createRuntime([1_000, 3_500, 5_000, 6_000, 7_000]);
	runtime.events.sessionStart({}, test.ctx);

	runtime.events.agentStart({}, test.ctx);
	await runtime.events.agentEnd({ messages: [assistant(50)] }, test.ctx);
	const finalBeforeInvalid = throughputSlots(await captureState(runtime, test, capturedStates)).lastTurn;
	assert.deepEqual(finalBeforeInvalid, firstFinal, `${name}: setup should create an initial trusted final`);

	runtime.events.agentStart({}, test.ctx);
	await runtime.events.turnEnd(turnEnd(99, assistant(25)), test.ctx);
	await runtime.events.agentEnd(event, test.ctx);
	const afterInvalid = await captureState(runtime, test, capturedStates);
	assertSlots(afterInvalid, { lastTurn: firstFinal, currentRun: null }, `${name} should clear currentRun but preserve previous trusted lastTurn`);
}

assert.equal(
	createContext().notifications.filter((notification) => !notification.message.includes("configuration cancelled")).length,
	0,
	"test harness sanity: no Reply speed lifecycle path should require ctx.ui.notify",
);

console.log("✓ throughput runtime checks passed");
