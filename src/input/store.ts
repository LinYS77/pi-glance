import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** One private, atomically replaced draft per session, including pre-first-turn drafts. */
export function createDraftStore(directory: string) {
	function path(sessionId: string): string {
		if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error("Invalid session ID");
		return join(directory, `${sessionId}.json`);
	}
	return {
		loadDraft(sessionId: string): string | null {
			let text: string;
			try { text = readFileSync(path(sessionId), "utf8"); }
			catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
			const data = JSON.parse(text) as { version?: unknown; text?: unknown };
			if (data?.version !== 1 || typeof data.text !== "string") throw new Error("Invalid saved draft");
			return data.text.length ? data.text : null;
		},
		saveDraft(sessionId: string, text: string | null): void {
			const target = path(sessionId);
			if (text === null) {
				rmSync(target, { force: true });
				return;
			}
			mkdirSync(directory, { recursive: true, mode: 0o700 });
			const temporary = `${target}.${randomUUID()}.tmp`;
			try {
				writeFileSync(temporary, JSON.stringify({ version: 1, text }) + "\n", { flag: "wx", mode: 0o600 });
				renameSync(temporary, target);
			} finally {
				rmSync(temporary, { force: true });
			}
		},
	};
}
