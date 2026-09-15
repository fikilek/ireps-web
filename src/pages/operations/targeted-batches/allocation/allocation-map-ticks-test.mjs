import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseSelection, selectionKey, toggleListed, toggleTick } from "./allocationMapSelection.js";

// Targeted Batch rules TB-R047 (1.3.32): TB Register decides which batches the Allocation Map draws.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("a tick goes on and off, and the heading ticks every batch listed", () => {
  assert.deepEqual(toggleTick([], "TB1"), ["TB1"]);
  assert.deepEqual(toggleTick(["TB1", "TB2"], "TB1"), ["TB2"]);
  assert.deepEqual(toggleTick(["TB1"], "  "), ["TB1"], "an empty id changes nothing");
  assert.deepEqual(toggleListed(["TB1"], ["TB1", "TB2", "TB3"]), ["TB1", "TB2", "TB3"], "the listed batches, not only the page");
  assert.deepEqual(toggleListed(["TB1", "TB2", "TB9"], ["TB1", "TB2"]), ["TB9"], "all ticked already, so the heading unticks them");
  assert.deepEqual(toggleListed(["TB1"], []), ["TB1"], "nothing listed, nothing changes");
});

test("the ticks are kept per municipality and survive a refresh", () => {
  assert.equal(selectionKey("ZA5241"), "ireps.allocationMap.ZA5241");
  assert.notEqual(selectionKey("ZA5241"), selectionKey("ZA5242"), "one municipality never sees another's ticks");
  assert.deepEqual(parseSelection('["TB1","TB2"]'), ["TB1", "TB2"], "read back after a refresh");
  assert.deepEqual(parseSelection("not json"), [], "a damaged store simply means nothing is ticked");
  assert.deepEqual(parseSelection('{"TB1":true}'), []);
});

test("TB Register carries the tick column and the Allocation Map draws the ticked batches", async () => {
  const register = await read("../../TargetedBatchesPage.jsx");
  assert.match(register, /const ticked = useAllocationMapSelection\(activeLmPcode\)/);
  assert.match(register, /const listedIds = useMemo\(\(\) => sortedUploads\.map/, "the heading covers the filtered rows");
  assert.match(register, /<thead>\s*<tr>\s*\{\/\* TB-R047[^}]*\*\/\}\s*<Th>\s*<input\s+type="checkbox"/, "the tick box is the first column, before Map");
  assert.match(register, /checked=\{allListedTicked\}[\s\S]*onChange=\{\(\) => ticked\.toggleListed\(listedIds\)\}/);
  assert.match(register, /checked=\{ticked\.isTicked\(upload\.id\)\}/);
  assert.match(register, /onClick=\{ticked\.clear\}/, "a Clear link next to the button");
  assert.match(register, /<Td colSpan=\{12\}>/, "the empty row spans the new column too");

  const page = await read("../../TargetedBatchAllocationMapPage.jsx");
  assert.match(page, /showAll \? model\.items : model\.items\.filter\(item => tickedIds\.includes\(item\.tbId\)\)/);
  assert.match(page, /Tick the batches you want in <Link to="\/operations\/targeted-batches"/, "nothing ticked says where to tick");
  assert.match(page, /Show all batches/, "the switch shows every batch when it is wanted");
  assert.match(page, /className = "ireps-geofence-label ireps-allocation-label"/);
  assert.match(await read("../../../../index.css"), /\.ireps-allocation-label\s*\{[^}]*text-align:\s*center/);
});
