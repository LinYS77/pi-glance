import { emptyGitSnapshot } from "../git.js";
import type { GlanceState } from "../types.js";

export function testState(overrides: Partial<GlanceState> = {}): GlanceState {
	const base: GlanceState = {
		workspace: { name: "repo", path: "/repo" },
		git: emptyGitSnapshot(),
		providers: { availableCount: 1 },
		model: { id: "gpt-5.5", provider: "openai", displayName: "GPT 5.5", thinking: "off" },
		context: { tokens: 46_800, window: 200_000, percent: 23.4 },
		usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0 },
		version: 0,
	};
	return {
		...base,
		...overrides,
		workspace: { ...base.workspace, ...overrides.workspace },
		git: { ...base.git, ...overrides.git },
		providers: { ...base.providers, ...overrides.providers },
		model: { ...base.model, ...overrides.model },
		context: { ...base.context, ...overrides.context },
		usage: { ...base.usage, ...overrides.usage },
	};
}
