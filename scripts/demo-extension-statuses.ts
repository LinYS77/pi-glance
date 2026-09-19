/** Local test publisher: no credentials, HTTP requests, timers or subscription changes. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const KEYS = ["glance-demo-1-quota", "glance-demo-2-worker", "glance-demo-3-tools"] as const;
const MODES = ["normal", "low", "long", "clear"] as const;

export default function demoExtensionStatuses(pi: ExtensionAPI): void {
	function clear(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		for (const key of KEYS) ctx.ui.setStatus(key, undefined);
	}
	function publish(ctx: ExtensionContext, mode: string): void {
		if (ctx.mode !== "tui") return;
		if (mode === "clear") { clear(ctx); return; }
		const theme = ctx.ui.theme;
		const low = mode === "low";
		const text = low ? "5h:8% 7d:23%" : "5h:80% 7d:65%";
		ctx.ui.setStatus(KEYS[0], theme.fg("dim", "DEMO ") + theme.fg(low ? "error" : "success", text));
		ctx.ui.setStatus(KEYS[1], mode === "long" ? theme.fg("warning", "DEMO syncing 中文🙂 " + "long status ".repeat(12)) : undefined);
		ctx.ui.setStatus(KEYS[2], mode === "long" ? theme.fg("accent", "DEMO MCP 3/3") : undefined);
	}
	pi.on("session_start", (_event, ctx) => publish(ctx, "normal"));
	pi.on("session_shutdown", (_event, ctx) => clear(ctx));
	pi.registerCommand("glance-demo", {
		description: "Simulated quota statuses only: normal, low, long, clear",
		getArgumentCompletions: prefix => MODES.filter(mode => mode.startsWith(prefix)).map(mode => ({ value: mode, label: mode })),
		handler: async (args, ctx) => {
			const mode = args.trim() || "normal";
			if (!MODES.some(value => value === mode)) {
				ctx.ui.notify("Usage: /glance-demo normal|low|long|clear. DEMO values are not real quotas.", "info");
				return;
			}
			publish(ctx, mode);
		},
	});
}
