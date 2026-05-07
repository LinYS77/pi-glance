import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import { defaultConfig } from "../config.js";
import { formatWorkspaceLabel, stripControls } from "../format.js";
import { renderInputSurface } from "../renderer.js";
import { testState } from "./helpers.js";

function topLine(path: string, mode: "name" | "smart" | "path", width = 160): string {
	const config = defaultConfig();
	config.display.workspaceLabel = mode;
	return stripControls(renderInputSurface(testState({ workspace: { name: "07_pi-glance", path } }), config, width)[0] ?? "");
}

const homePath = `${homedir()}/winnie/00_project/07_pi-glance`;

assert.equal(defaultConfig().display.workspaceLabel, "name", "workspace label defaults to name");
assert.equal(formatWorkspaceLabel(homePath, "07_pi-glance", "name", 80), "07_pi-glance", "name mode renders basename");
assert.equal(formatWorkspaceLabel(homePath, "07_pi-glance", "name", 8), "07_pi-g…", "name mode fits title budget");
assert.equal(formatWorkspaceLabel(homePath, "07_pi-glance", "smart", 20, 72), "07_pi-glance", "smart narrow renders basename");
assert.equal(
	formatWorkspaceLabel(homePath, "07_pi-glance", "smart", 80, 100),
	"…/00_project/07_pi-glance",
	"smart half-width renders parent path",
);
assert.equal(
	formatWorkspaceLabel(homePath, "07_pi-glance", "smart", 80, 160),
	"~/winnie/00_project/07_pi-glance",
	"smart wide renders home-shortened path",
);
assert.equal(
	formatWorkspaceLabel(homePath, "07_pi-glance", "path", 80),
	"~/winnie/00_project/07_pi-glance",
	"path mode renders home-shortened path",
);
assert.equal(
	formatWorkspaceLabel(homePath, "07_pi-glance", "path", 22),
	"…/07_pi-glance",
	"narrow path keeps project name",
);
assert.equal(
	formatWorkspaceLabel(homePath, "07_pi-glance", "path", 28),
	"~/winnie/…/07_pi-glance",
	"medium path keeps home prefix and project name",
);
assert.ok(
	!formatWorkspaceLabel(homePath, "07_pi-glance", "path", 80).startsWith(homedir()),
	"path mode never renders full home path",
);

const nonHome = "/mnt/data/work/07_pi-glance";
assert.equal(formatWorkspaceLabel(nonHome, "07_pi-glance", "path", 80), "…/data/work/07_pi-glance", "non-home paths keep only a safe tail");
assert.ok(!formatWorkspaceLabel(nonHome, "07_pi-glance", "path", 80).startsWith("/"), "non-home paths are not absolute");
assert.ok(formatWorkspaceLabel(nonHome, "07_pi-glance", "path", 80).includes("07_pi-glance"), "non-home path keeps project name");

assert.ok(topLine(homePath, "name").includes(" 07_pi-glance "), "surface name mode uses basename title");
assert.ok(topLine(homePath, "smart", 100).includes(" …/00_project/07_pi-glance "), "surface smart half-width uses parent path title");
assert.ok(topLine(homePath, "path").includes(" ~/winnie/00_project/07_pi-glance "), "surface path mode uses safe path title");
assert.ok(!topLine(homePath, "path").includes(homedir()), "surface never renders full home path");

console.log("✓ workspace label checks passed");
