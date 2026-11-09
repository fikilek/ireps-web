import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("MD BGO planning map is twice its former responsive height", async () => {
  const page = await readFile(new URL("../MdBgoPlanningPage.jsx", import.meta.url), "utf8");

  assert.match(page, /mapContainer:\s*\{[^}]*height:\s*"calc\(200vh - 560px\)"/s);
  assert.match(page, /mapContainer:\s*\{[^}]*minHeight:\s*1040/s);
});
