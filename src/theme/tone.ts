import type { GlanceAmbientTone } from "./selection.js";

export interface PiThemeToneHost {
	readonly theme?: { readonly name?: string; readonly appearance?: unknown } | undefined;
}

export function readPiAmbientTone(host: PiThemeToneHost | undefined): GlanceAmbientTone {
	// Pi 0.99+ exposes appearance for system/custom themes; older hosts use names.
	const appearance = host?.theme?.appearance;
	if (appearance === "light" || appearance === "dark") return appearance;
	const name = host?.theme?.name;
	if (name === "light" || name === "dark") return name;
	return "unknown";
}
