import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { isWeekend, validateEntry } from "../build/contract.js";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const templates = new URL("web/", root);
const template = await readFile(new URL("index.html", templates), "utf8");
await rm(dist, { recursive: true, force: true });
await mkdir(new URL("api/v1/", dist), { recursive: true });
try {
  await cp(new URL("public/api/v1/", root), new URL("api/v1/", dist), { recursive: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await cp(new URL("build/web/", root), new URL("web/", dist), { recursive: true });
await cp(new URL("build/contract.js", root), new URL("contract.js", dist));
await cp(new URL("style.css", templates), new URL("web/style.css", dist));
await cp(new URL("404.html", templates), new URL("404.html", dist));
await writeFile(new URL("_headers", dist), "/api/v1/*\n  Access-Control-Allow-Origin: *\n");

for (const [route, feed] of [["", "custom"], ["custom/", "custom"], ["classic/", "classic"]]) {
  const dir = new URL(route, dist);
  const html = template
    .replaceAll("__FEED__", feed)
    .replaceAll("__ACTIVE_CLASSIC__", feed === "classic" ? 'aria-current="page"' : "")
    .replaceAll("__ACTIVE_CUSTOM__", feed === "custom" ? 'aria-current="page"' : "");
  if (/__[A-Z_]+__/u.test(html)) throw new Error("Unexpanded web template field");
  await mkdir(dir, { recursive: true });
  await writeFile(new URL("index.html", dir), html);
}

const editions = new Map();
for (const feed of ["classic", "custom"]) {
  const dir = new URL(`api/v1/${feed}/`, dist);
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter(file => /^\d{4}-\d{2}-\d{2}\.json$/u.test(file));
  const dates = files.sort().map(file => file.slice(0, -5));
  for (const date of dates) {
    const entry = validateEntry(JSON.parse(await readFile(new URL(`${date}.json`, dir), "utf8")), feed);
    if (entry.date !== date) throw new Error(`Date mismatch in ${feed}/${date}.json`);
    if (!isWeekend(date)) continue;
    if (feed === "classic") editions.set(date, entry);
    else if (editions.has(date)) {
      assert.deepEqual(entry, editions.get(date), `Weekend feeds disagree on ${date}`);
      editions.delete(date);
    } else throw new Error(`Classic weekend edition is missing for ${date}`);
  }
}
if (editions.size) throw new Error(`Custom weekend edition is missing for ${editions.keys().next().value}`);
