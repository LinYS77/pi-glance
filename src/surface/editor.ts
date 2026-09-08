import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { isKeyRepeat, truncateToWidth, visibleWidth, type EditorOptions, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { matchesStashShortcut, shortcutConflict } from "../input/keybinding.js";
import type { PromptStash } from "../input/stash.js";
import { stripControls } from "./format.js";
import { measureInputSurfaceFrame, renderInputSurfaceFrame } from "./frame.js";
import { GlanceLineRenderer } from "./status-line.js";
import { formatSurfaceScrollIndicator } from "./layout.js";
import { resolveGlanceRenderStyles, type GlanceRenderStyleContext, type ResolvedGlanceStyles } from "../theme/adapter.js";
import type { GlanceConfig, GlanceState } from "../types.js";

export interface GlanceEditorOptions {
	readonly stash?: PromptStash;
	readonly onStashError?: (message: string) => void;
	readonly getWorkingElapsedMs?: () => number | undefined;
	readonly editorOptions?: EditorOptions;
	readonly renderStyleContext?: GlanceRenderStyleContext;
}

function stripBorderColor(line: string, borderColor: (text: string) => string): string {
	const sample = borderColor("─");
	if (!sample || sample === "─") return stripControls(line);
	const markerIndex = sample.indexOf("─");
	if (markerIndex < 0) return stripControls(line);
	const prefix = sample.slice(0, markerIndex);
	const suffix = sample.slice(markerIndex + 1);
	let out = line;
	if (prefix) out = out.split(prefix).join("");
	if (suffix) out = out.split(suffix).join("");
	return stripControls(out);
}

function isHorizontalBorder(line: string, borderColor: (text: string) => string): boolean {
	const plain = stripBorderColor(line, borderColor).trim();
	if (plain.length === 0) return false;
	const borderCharactersOnly = [...plain].every(
		(char) => char === "─" || char === "↑" || char === "↓" || char === " " || char === "." || /[0-9a-z]/i.test(char),
	);
	if (!borderCharactersOnly) return false;
	// Pi 0.84 truncates scroll borders with ASCII periods at very narrow widths,
	// including pure "." / "..." lines where no horizontal glyph survives.
	return plain.includes("─") || /^\.+$/.test(plain);
}

function normalizeRenderedLine(line: string, width: number): string {
	const lineWidth = visibleWidth(line);
	if (lineWidth === width) return line;
	if (lineWidth < width) return `${line}${" ".repeat(width - lineWidth)}`;
	return truncateToWidth(line, width, "");
}

function indentAutocompleteLine(line: string, width: number, indentWidth: number): string {
	const indent = " ".repeat(indentWidth);
	return normalizeRenderedLine(`${indent}${line}`, width);
}

export class GlanceEditor extends CustomEditor {
	private readonly statusLine = new GlanceLineRenderer();
	private pasting = false;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		private readonly appKeybindings: KeybindingsManager,
		private readonly getState: () => GlanceState,
		private readonly getConfig: () => GlanceConfig,
		private readonly onThinkingLevelMaybeChanged?: () => void,
		private readonly glanceOptions?: GlanceEditorOptions,
	) {
		super(tui, theme, appKeybindings, glanceOptions?.editorOptions);
	}

	handleInput(data: string): void {
		if (this.pasting || data.includes("\x1b[200~")) {
			// A fragmented bracketed paste is text, even when a chunk looks like a shortcut.
			if (data.includes("\x1b[200~")) this.pasting = true;
			const end = data.indexOf("\x1b[201~");
			const length = end < 0 ? data.length : end + 6;
			super.handleInput(data.slice(0, length));
			if (end >= 0) this.pasting = false;
			if (length < data.length) this.handleInput(data.slice(length));
			return;
		}
		const config = this.getConfig();
		if (this.focused && config.enabled && config.editor.stashEnabled && this.glanceOptions?.stash && matchesStashShortcut(data, config.editor.stashShortcut)) {
			if (isKeyRepeat(data)) return;
			const conflict = shortcutConflict(data, config.editor.stashShortcut, this.appKeybindings);
			if (conflict) {
				this.glanceOptions.onStashError?.(`Stash shortcut is used by ${conflict}. Change it in /glance → Input.`);
			} else {
				// Existing extension shortcuts retain precedence over this editor feature.
				if (this.onExtensionShortcut?.(data)) return;
				const current = this.getExpandedText();
				let restored: string;
				try {
					restored = this.glanceOptions.stash.exchange(current);
				} catch {
					this.glanceOptions.onStashError?.("Could not save the draft. Input was kept.");
					return;
				}
				if (current !== restored) this.setText(restored);
				this.tui.requestRender();
				return;
			}
		}
		const isThinkingCycle = this.appKeybindings.matches(data, "app.thinking.cycle");
		super.handleInput(data);
		if (isThinkingCycle) this.onThinkingLevelMaybeChanged?.();
	}

	private currentStyles(config: GlanceConfig = this.getConfig()): ResolvedGlanceStyles {
		const styles = resolveGlanceRenderStyles(config.theme, this.glanceOptions?.renderStyleContext);
		// Pi owns Bash detection/execution and updates this public callback on input
		// and theme changes. Preserve its cue only on the live Bash frame; title and
		// status remain Glance-owned, so their cache key must not change.
		return this.getText().trimStart().startsWith("!") ? { ...styles, border: this.borderColor } : styles;
	}

	private extractScrollIndicator(line: string, width: number): string | undefined {
		return formatSurfaceScrollIndicator(stripBorderColor(line, this.borderColor), width);
	}

	render(width: number): string[] {
		const config = this.getConfig();
		if (!config.enabled) {
			return super.render(width);
		}

		const styles = this.currentStyles(config);
		const metrics = measureInputSurfaceFrame(width);
		// Pi 0.84's word wrapper recurses on a wide grapheme in a one-column
		// layout. Give the inherited editor room for a two-column glyph (plus
		// its public padding/cursor reserve), then clip through our frame as usual.
		const editorWidth = Math.max(metrics.editorContentWidth, 3, 2 + this.getPaddingX() * 2);
		const lines = super.render(editorWidth);
		if (lines.length < 2) return lines;

		const isFocused = this.focused;

		const topOriginal = lines[0] ?? "";
		let bottomIndex = -1;
		for (let i = 1; i < lines.length; i++) {
			if (isHorizontalBorder(lines[i] ?? "", this.borderColor)) bottomIndex = i;
		}
		if (bottomIndex < 1) return lines;

		const bottomOriginal = lines[bottomIndex] ?? "";
		const body = lines.slice(1, bottomIndex);
		const autocomplete = lines.slice(bottomIndex + 1);
		const contentLines = body.length > 0 ? body : [""];
		const state = this.getState();
		const frame = renderInputSurfaceFrame({
			state,
			config,
			width,
			styles,
			body: { kind: "editor", lines: contentLines },
			chrome: {
				workingElapsedMs: this.glanceOptions?.getWorkingElapsedMs?.(),
				focus: isFocused ? "focused" : "unfocused",
				topScrollIndicator: this.extractScrollIndicator(topOriginal, metrics.safeWidth),
				bottomScrollIndicator: this.extractScrollIndicator(bottomOriginal, metrics.safeWidth),
				hasDraft: this.glanceOptions?.stash?.hasDraft,
			},
			status: {
				render: (budget, frameStyles) => this.statusLine.render(state, config, budget, state.providers.availableCount, { styles: frameStyles }),
			},
		});

		for (const line of autocomplete) {
			frame.push(indentAutocompleteLine(line, metrics.safeWidth, metrics.autocompleteIndent));
		}
		return frame;
	}
}
