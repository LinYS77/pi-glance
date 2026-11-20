import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDraftStore } from "./src/input/store.js";
import { createConfigStore } from "./src/config/store.js";
import { showGlancePane } from "./src/settings/pane.js";
import { createGlanceRuntime } from "./src/runtime/runtime.js";

// The command still reports that it needs a TUI. Only TUI sessions collect facts or load local state.
function tuiEvent<E>(handler: (event: E, ctx: ExtensionContext) => void | Promise<void>) {
	return (event: E, ctx: ExtensionContext) => {
		if (ctx.mode === "tui") return handler(event, ctx);
	};
}

export default function piGlance(pi: ExtensionAPI): void {
	const directory = join(getAgentDir(), "pi-glance");
	const store = createConfigStore(join(directory, "config.json"));
	const runtime = createGlanceRuntime({
		getThinkingLevel: () => pi.getThinkingLevel(),
		...createDraftStore(join(directory, "drafts")),
		...store,
		showPane: showGlancePane,
	});

	pi.registerCommand("glance", {
		description: "Open pi-glance configuration pane",
		handler: runtime.commands.openPane,
	});

	pi.on("session_start", tuiEvent(runtime.events.sessionStart));
	pi.on("session_shutdown", tuiEvent(runtime.events.sessionShutdown));
	pi.on("model_select", tuiEvent(runtime.events.modelSelect));
	pi.on("thinking_level_select", tuiEvent(runtime.events.thinkingLevelSelect));
	pi.on("turn_start", tuiEvent(runtime.events.turnStart));
	pi.on("tool_execution_end", tuiEvent(runtime.events.toolExecutionEnd));
	pi.on("session_tree", tuiEvent(runtime.events.sessionTree));
	pi.on("session_compact", tuiEvent(runtime.events.sessionCompact));
	pi.on("before_provider_request", tuiEvent(runtime.events.providerRequest));
	pi.on("ui_prompt_start", tuiEvent(runtime.events.uiPromptStart));
	pi.on("ui_prompt_end", tuiEvent(runtime.events.uiPromptEnd));
	pi.on("message_end", tuiEvent(runtime.events.messageEnd));
	pi.on("turn_end", tuiEvent(runtime.events.turnEnd));
	pi.on("agent_start", tuiEvent(runtime.events.agentStart));
	pi.on("agent_end", tuiEvent(runtime.events.agentEnd));
	pi.on("agent_settled", tuiEvent(runtime.events.agentSettled));
}
