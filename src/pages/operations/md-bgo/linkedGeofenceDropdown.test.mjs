import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("MD BGO planning dropdown emphasizes linked geofences without changing their labels", async () => {
  const page = await readFile(new URL("../MdBgoPlanningPage.jsx", import.meta.url), "utf8");
  const options = page.match(/\{displayGeofences\.map\(\(gf\) => \{([\s\S]*?)\n\s*\}\)\}/)?.[1];

  assert.ok(options, "geofence options should be rendered from the current ward geofence list");
  assert.match(options, /gf\?\.bgo\?\.linkState === "LINKED" && gf\?\.bgo\?\.batchId/);
  assert.match(options, /color: "#b91c1c", fontWeight: 700/);
  assert.match(options, /\{gf\.name\}/);
});
