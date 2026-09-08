/** The editor and a single saved draft exchange content; neither is overwritten. */
export class PromptStash {
	constructor(private text: string | null, private readonly persist: (text: string | null) => void) {}

	get hasDraft(): boolean { return this.text !== null; }

	exchange(current: string): string {
		if (current.length === 0 && this.text === null) return current;
		const next = current.length ? current : null;
		const restored = this.text ?? "";
		// A failed save must leave both buffers untouched.
		this.persist(next);
		this.text = next;
		return restored;
	}
}
