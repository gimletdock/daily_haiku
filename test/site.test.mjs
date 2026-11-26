import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

const dist = new URL("../dist/", import.meta.url);

test("both edition routes link to each other and load the common client assets", async () => {
  for (const [path, edition] of [["", "custom"], ["custom/", "custom"], ["classic/", "classic"]]) {
    const html = await readFile(new URL(`${path}index.html`, dist), "utf8");
    assert.match(html, new RegExp(`data-feed="${edition}"`));
    assert.match(html, /href="\/custom\/"/u);
    assert.match(html, /href="\/classic\/"/u);
    assert.match(html, new RegExp(`href="/${edition}/"[^>]*aria-current="page"`));
    assert.match(html, /name="viewport"/u);
    assert.match(html, /type="module" src="\/web\/app\.js"/u);
    assert.match(html, /href="\/web\/style\.css"/u);
    assert.doesNotMatch(html, /__[A-Z_]+__/u);
  }
  for (const file of ["web/app.js", "web/style.css", "contract.js"]) {
    await access(new URL(file, dist));
  }
});
