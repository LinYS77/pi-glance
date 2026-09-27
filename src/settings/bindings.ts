import { isKeyRelease, matchesKey, type Keybinding, type KeyId } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { HelpShortcut, PaneIntent } from "./model.js";

export type PaneActionId = "Enter" | "Esc" | "↑↓" | "Page" | "Tab/Shift+Tab" | "←→" | "Space" | "J/K" | "S" | "R" | "P" | "D" | "?" | "Ctrl+C";
export type PaneKeybindings = Pick<KeybindingsManager, "matches" | "getKeys">;
interface Binding {
	action: PaneActionId;
	keys: KeyId[];
	native?: Keybinding;
	intent: PaneIntent;
}

function keyLabel(key: string): string {
	const names: Record<string, string> = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", super: "Super", enter: "Enter", escape: "Esc",
		tab: "Tab", space: "Space", up: "↑", down: "↓", left: "←", right: "→", pageUp: "PgUp", pageDown: "PgDn" };
	return key.split("+").map(part => names[part] ?? (part.length === 1 ? part.toUpperCase() : part)).join("+");
}
const letter = (action: PaneActionId, key: string, intent: PaneIntent): Binding => ({ action, keys: [key as KeyId, `shift+${key}` as KeyId], intent });

/** Resolve display and dispatch together, respecting Pi's selection bindings first. */
export function resolvePaneBindings(hints: readonly HelpShortcut[], manager?: PaneKeybindings, pageSize = 5, recording = false) {
	const allowed = new Set(hints.map(hint => hint.key));
	if (allowed.has("↑↓")) allowed.add("Page");
	const definitions: Binding[] = [
		{ action: "Esc", keys: ["escape"], native: recording ? undefined : "tui.select.cancel", intent: { type: "back" } },
		{ action: "Enter", keys: ["enter"], native: recording ? undefined : "tui.select.confirm", intent: { type: "activate" } },
		{ action: "↑↓", keys: ["up"], native: "tui.select.up", intent: { type: "move", direction: "up" } },
		{ action: "↑↓", keys: ["down"], native: "tui.select.down", intent: { type: "move", direction: "down" } },
		{ action: "Page", keys: ["pageUp"], native: "tui.select.pageUp", intent: { type: "move", direction: "up", amount: pageSize } },
		{ action: "Page", keys: ["pageDown"], native: "tui.select.pageDown", intent: { type: "move", direction: "down", amount: pageSize } },
		{ action: "Tab/Shift+Tab", keys: ["tab"], native: "tui.input.tab", intent: { type: "section", direction: 1 } },
		{ action: "Tab/Shift+Tab", keys: ["shift+tab"], intent: { type: "section", direction: -1 } },
		{ action: "←→", keys: ["left"], intent: { type: "adjust", direction: -1 } },
		{ action: "←→", keys: ["right"], intent: { type: "adjust", direction: 1 } },
		{ action: "Space", keys: ["space"], intent: { type: "toggle" } },
		{ ...letter("S", "s", { type: "save" }), keys: ["s", "shift+s", "ctrl+s"] },
		{ action: "?", keys: ["?"], intent: { type: "help" } },
		letter("R", "r", { type: "reset" }),
		letter("P", "p", { type: "previewActivity" }),
		letter("D", "d", { type: "density" }),
		letter("J/K", "j", { type: "reorder", direction: 1 }),
		letter("J/K", "k", { type: "reorder", direction: -1 }),
	];
	const claimed = new Set<string>(["ctrl+c"]);
	const resolved = definitions.filter(binding => allowed.has(binding.action)).map(binding => {
		const keys = binding.native ? manager?.getKeys?.(binding.native) ?? binding.keys : binding.keys;
		const effective = keys.filter(key => !claimed.has(key) && !(key.startsWith("shift+") && key.length === 7 && claimed.has(key.slice(6))));
		for (const key of effective) claimed.add(key);
		return { ...binding, keys: effective };
	});
	const label = (action: PaneActionId) => {
		if (action === "Ctrl+C") return "Ctrl+C";
		const labels = resolved.filter(binding => binding.action === action).flatMap(binding => binding.keys[0] ? [keyLabel(binding.keys[0])] : []);
		const joined = labels.join("/");
		return joined === "↑/↓" ? "↑↓" : joined === "←/→" ? "←→" : joined;
	};
	return {
		label,
		format(hint: HelpShortcut): string {
			const key = label(hint.key);
			if (!key && hint.key === "Esc") return "[Ctrl+C] Discard & close";
			return key ? `[${key}] ${hint.label}` : "";
		},
		input(data: string): PaneIntent | undefined {
			if (isKeyRelease(data)) return;
			if (matchesKey(data, "ctrl+c")) return { type: "cancel" };
			for (const binding of resolved) {
				const matched = binding.native && manager
					? binding.keys.length > 0 && manager.matches(data, binding.native)
					: binding.keys.some(key => matchesKey(data, key));
				if (matched) return binding.intent;
			}
			// Q remains an alias for Back, unless a higher-priority binding owns it.
			if (allowed.has("Esc") && allowed.has("↑↓") && !recording && !claimed.has("q") && (matchesKey(data, "q") || matchesKey(data, "shift+q"))) return { type: "back" };
		},
	};
}
