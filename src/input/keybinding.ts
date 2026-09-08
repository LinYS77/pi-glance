import { matchesKey, type KeyId } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";

/** Compare actual key reports as well as labels: legacy Ctrl+I is also Tab. */
export function shortcutConflict(data: string, key: string, manager: Pick<KeybindingsManager, "getEffectiveConfig">): string | undefined {
	const bindings = manager.getEffectiveConfig();
	for (const [action, value] of Object.entries(bindings)) {
		const keys = value === undefined ? [] : Array.isArray(value) ? value : [value];
		if (keys.some(bound => matchesKey(data, bound) || sameKey(bound, key))) return action;
	}
	return undefined;
}

function sameKey(a: string, b: string): boolean {
	return a.split("+").sort().join("+") === b.split("+").sort().join("+");
}

export function matchesStashShortcut(data: string, shortcut: string): boolean {
	return matchesKey(data, shortcut as KeyId);
}
