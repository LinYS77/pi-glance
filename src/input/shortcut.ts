const MODIFIERS = ["ctrl", "shift", "alt", "super"] as const;
const SPECIAL = new Set(["escape", "enter", "tab", "space", "backspace", "delete", "insert", "home", "end", "pageUp", "pageDown", "up", "down", "left", "right"]);

/** Accept a single terminal shortcut, never plain text or a key sequence. */
export function normalizeStashShortcut(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length > 60) return undefined;
	const parts = value.toLowerCase().split("+");
	let key = parts.pop()!;
	key = ({ esc: "escape", return: "enter", pageup: "pageUp", pagedown: "pageDown" } as Record<string, string>)[key] ?? key;
	if (!key || parts.some(part => !MODIFIERS.includes(part as typeof MODIFIERS[number])) || new Set(parts).size !== parts.length) return undefined;
	const functionKey = /^f(?:[1-9]|1[0-2])$/.test(key);
	if (!functionKey && !parts.some(part => part === "ctrl" || part === "alt" || part === "super")) return undefined;
	if (!functionKey && !/^[a-z0-9.,/;\[\]\\'`=\-]$/.test(key) && !SPECIAL.has(key)) return undefined;
	return [...MODIFIERS.filter(part => parts.includes(part)), key].join("+");
}

export function shortcutLabel(key: string): string {
	return key.toLowerCase();
}
