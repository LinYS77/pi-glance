import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createConfigStore } from "./src/config/store.js";
import { showGlancePane } from "./src/settings/pane.js";
import { createGlanceRuntime } from "./src/runtime/runtime.js";

export default function piGlance(pi: ExtensionAPI): void {
	const store = createConfigStore(join(getAgentDir(), "pi-glance", "config.json"));
	const runtime = createGlanceRuntime({
		getThinkingLevel: () => pi.getThinkingLevel(),
		...store,
		showPane: showGlancePane,
	});

	pi.registerCommand("glance", {
		description: "Open pi-glance configuration pane",
		handler: runtime.commands.openPane,
	});

	pi.on("session_start", runtime.events.sessionStart);
	pi.on("session_shutdown", runtime.events.sessionShutdown);
	pi.on("model_select", runtime.events.modelSelect);
	pi.on("thinking_level_select", runtime.events.thinkingLevelSelect);
	pi.on("turn_start", runtime.events.turnStart);
	pi.on("tool_execution_end", runtime.events.toolExecutionEnd);
	pi.on("session_tree", runtime.events.sessionTree);
	pi.on("session_compact", runtime.events.sessionCompact);
	pi.on("message_update", runtime.events.messageUpdate);
	pi.on("ui_prompt_start", runtime.events.uiPromptStart);
	pi.on("ui_prompt_end", runtime.events.uiPromptEnd);
	pi.on("message_end", runtime.events.messageEnd);
	pi.on("turn_end", runtime.events.turnEnd);
	pi.on("agent_start", runtime.events.agentStart);
	pi.on("agent_end", runtime.events.agentEnd);
	pi.on("agent_settled", runtime.events.agentSettled);
}
