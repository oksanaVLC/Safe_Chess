// Runs after `next build`: writes out/sw.js with the list of every file in
// the static build, so the service worker can keep the whole app offline.
// The version is a hash of all files, so each new build replaces the old copy.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "out");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const hash = createHash("sha256");
const files = walk(out)
  .map((path) => ({ path, url: "/" + relative(out, path).split(sep).join("/") }))
  .filter(({ url }) => url !== "/sw.js")
  .sort((a, b) => a.url.localeCompare(b.url));

for (const { path, url } of files) {
  hash.update(url);
  hash.update(readFileSync(path));
}

const version = hash.digest("hex").slice(0, 12);
const template = readFileSync(join(root, "scripts", "sw.template.js"), "utf8");
const sw = template
  .replace("__VERSION__", version)
  .replace("__FILES__", JSON.stringify(files.map((f) => f.url), null, 2));

writeFileSync(join(out, "sw.js"), sw);
console.log(`Service worker: ${files.length} files, version ${version}`);
