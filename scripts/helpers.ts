import { emptyGitSnapshot } from "../git.js";
import type { GlanceState } from "../types.js";

export function testState(overrides: Partial<GlanceState> = {}): GlanceState {
	const overrideRecord = overrides as Partial<GlanceState> & Record<string, unknown>;
	const base = {
		workspace: { name: "repo", path: "/repo" },
		git: emptyGitSnapshot(),
		providers: { availableCount: 1 },
		model: { id: "gpt-5.5", provider: "openai", displayName: "GPT 5.5", thinking: "off" },
		context: { tokens: 46_800, window: 200_000, percent: 23.4 },
		usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0 },
		throughput: { lastTurn: null, currentRun: null },
		version: 0,
	} as GlanceState & Record<string, unknown>;
	return {
		...base,
		...overrides,
		workspace: { ...base.workspace, ...overrides.workspace },
		git: { ...base.git, ...overrides.git },
		providers: { ...base.providers, ...overrides.providers },
		model: { ...base.model, ...overrides.model },
		context: { ...base.context, ...overrides.context },
		usage: { ...base.usage, ...overrides.usage },
		throughput: { ...(base.throughput as object), ...((overrideRecord.throughput as object | undefined) ?? {}) },
	} as GlanceState;
}
