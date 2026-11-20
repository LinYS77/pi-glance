import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const { version } = JSON.parse(read("package.json"));
const entries = read("CHANGELOG.md").split(/^## /m).slice(1);
const heading = `[${version}]`;
const bodies = entries.flatMap(entry => {
	const newline = entry.indexOf("\n");
	if (newline < 0) return [];
	const title = entry.slice(0, newline).trim();
	return title === heading || title.startsWith(`${heading} - `) ? [entry.slice(newline).trim()] : [];
});
if (bodies.length !== 1 || !bodies[0]) throw new Error(`Expected one nonempty ${heading} section in CHANGELOG.md`);
process.stdout.write(`# pi-glance ${version}\n\n${bodies[0]}\n`);
