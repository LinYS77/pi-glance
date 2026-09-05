import { readFile, readdir } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";

export const IO_NETWORK_PROCESS_IMPORTS = new Set(
	["fs", "fs/promises", "child_process", "process", "http", "https", "http2", "net", "tls", "dgram", "dns", "dns/promises", "worker_threads"]
		.flatMap((name) => [name, `node:${name}`]).concat(["undici", "ws"]),
);

export interface ImportRecord {
	specifier: string;
	typeOnly: boolean;
}

export interface SourceFile {
	path: string;
	text: string;
	ast: ts.SourceFile;
}

export function parseSource(path: string, text: string): SourceFile {
	return { path, text, ast: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) };
}

export async function readProductionSources(root = process.cwd()): Promise<SourceFile[]> {
	async function readDirectory(directory: string): Promise<SourceFile[]> {
		const entries = await readdir(join(root, directory), { withFileTypes: true });
		const files = await Promise.all(entries.map(async (entry): Promise<SourceFile[]> => {
			const path = join(directory, entry.name);
			if (entry.isDirectory() && (directory !== "" || entry.name === "src")) return readDirectory(path);
			if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
			return [parseSource(path, await readFile(join(root, path), "utf8"))];
		}));
		return files.flat();
	}
	return (await readDirectory("")).sort((a, b) => a.path.localeCompare(b.path));
}

export function importsFrom(file: SourceFile): ImportRecord[] {
	const records: ImportRecord[] = [];
	function visit(node: ts.Node): void {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			const clause = node.importClause;
			const bindings = clause?.namedBindings;
			const inlineTypes = !clause?.name && bindings && ts.isNamedImports(bindings)
				&& bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
			records.push({ specifier: node.moduleSpecifier.text, typeOnly: clause?.isTypeOnly === true || inlineTypes === true });
		} else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
			const clause = node.exportClause;
			const inlineTypes = clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
			records.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly || inlineTypes === true });
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
			records.push({ specifier: node.arguments[0].text, typeOnly: false });
		}
		ts.forEachChild(node, visit);
	}
	visit(file.ast);
	return records;
}

function localTarget(file: string, specifier: string): string {
	return normalize(join(dirname(file), specifier.replace(/\.js$/, ".ts")));
}

/** A diagnostic includes the whole local import chain, not just its last edge. */
export function dependencyPath(files: readonly SourceFile[], root: string, forbidden: (specifier: string) => boolean): string[] | undefined {
	const byPath = new Map(files.map((file) => [file.path, file]));
	const visited = new Set<string>();
	function visit(path: string, chain: string[]): string[] | undefined {
		if (visited.has(path)) return;
		visited.add(path);
		const file = byPath.get(path);
		if (!file) throw new Error(`Unresolved local source: ${chain.join(" -> ")}`);
		for (const record of importsFrom(file).filter((record) => !record.typeOnly)) {
			if (forbidden(record.specifier)) return [...chain, record.specifier];
			if (record.specifier.startsWith(".")) {
				const target = localTarget(path, record.specifier);
				const found = visit(target, [...chain, target]);
				if (found) return found;
			}
		}
	}
	return visit(root, [root]);
}

export function runtimeCycles(files: readonly SourceFile[]): string[][] {
	const byPath = new Map(files.map((file) => [file.path, file]));
	const completed = new Set<string>();
	const cycles: string[][] = [];
	function visit(path: string, stack: string[]): void {
		if (stack.includes(path)) {
			cycles.push([...stack.slice(stack.indexOf(path)), path]);
			return;
		}
		if (completed.has(path)) return;
		const file = byPath.get(path);
		if (!file) throw new Error(`Unresolved local source: ${path}`);
		for (const record of importsFrom(file)) {
			if (!record.typeOnly && record.specifier.startsWith(".")) visit(localTarget(path, record.specifier), [...stack, path]);
		}
		completed.add(path);
	}
	for (const file of files) visit(file.path, []);
	return cycles;
}
