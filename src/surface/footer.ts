import type { Component } from "@earendil-works/pi-tui";

export class GlanceFooter implements Component {
	constructor(private readonly onDispose?: () => void) {}

	dispose(): void { this.onDispose?.(); }

	invalidate(): void {}

	render(_width: number): string[] {
		return [];
	}
}
