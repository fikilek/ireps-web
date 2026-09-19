import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Targeted Batch rules TB-R045 (1.3.51, 1.3.53): the Allocation Matrix on TB Register.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("the Show Allocation Matrix button sits between Allocation Map and Clear ticks", async () => {
  const register = await read("../../TargetedBatchesPage.jsx");
  const map = register.indexOf("Allocation Map ({ticked.selectedIds.length})");
  const button = register.indexOf('{isAllocationMatrixOpen ? "Hide Allocation Matrix" : "Show Allocation Matrix"}');
  const clear = register.indexOf("Clear ticks\n") >= 0 ? register.indexOf("Clear ticks\n") : register.indexOf("Clear ticks\r\n");
  assert.ok(map > 0 && button > map && clear > button, "Allocation Map, then the button, then Clear ticks");
  assert.match(register, /aria-expanded=\{isAllocationMatrixOpen\}/);
  assert.match(register, /disabled=\{!activeLmPcode \|\| isRegisterLoading\}/, "not while the register (and so the place the matrix opens) is still loading");
  assert.match(register, /onClick=\{\(\) => setIsAllocationMatrixOpen\(\(current\) => !current\)\}/);
  assert.match(register, /\.\.\.\(isAllocationMatrixOpen \? styles\.secondaryLinkButton : styles\.primaryButton\),/, "blue while closed");
});

test("the matrix opens under the summary cards, above the batch table", async () => {
  const register = await read("../../TargetedBatchesPage.jsx");
  assert.match(register, /import TbRegisterAllocationMatrix from "\.\/targeted-batches\/allocation\/tb-register-allocation-matrix\.jsx";/);
  const cards = register.indexOf('<SummaryCard label="Needs Attention"');
  const matrix = register.indexOf("<TbRegisterAllocationMatrix lmPcode={activeLmPcode} open={isAllocationMatrixOpen} />");
  const batches = register.indexOf("Permanent Targeted Batches</h3>");
  assert.ok(cards > 0 && matrix > cards && batches > matrix, "cards, then the matrix, then the batch table");
  assert.equal(register.split("<TbRegisterAllocationMatrix").length - 1, 1, "shown once");
});

test("the matrix is closed when TB Register opens and reads nothing until it is shown", async () => {
  const register = await read("../../TargetedBatchesPage.jsx");
  const section = await read("./tb-register-allocation-matrix.jsx");
  assert.match(register, /const \[isAllocationMatrixOpen, setIsAllocationMatrixOpen\] = useState\(false\);/, "closed whenever TB Register opens");
  assert.match(section, /if \(!open \|\| !lmPcode\) return null;/, "nothing shows under the cards while closed; hiding unmounts the table, which ends its reads");
  assert.match(section, /body: \{ display: "grid", gridTemplateColumns: "minmax\(0, 1fr\)",/, "the wide table scrolls inside the panel, never past it");
  // The reads start only inside the part that exists while the matrix is open.
  const opened = section.slice(section.indexOf("function OpenAllocationMatrix("), section.indexOf("export default function TbRegisterAllocationMatrix("));
  assert.match(opened, /const matrix = useAllocationMatrix\(lmPcode\);/);
  assert.equal((section.match(/useAllocationMatrix\(/g) || []).length, 1, "no other read");
  assert.doesNotMatch(register, /useAllocationMatrix|useGetTargetedBatchAllocationMatrixByLmQuery|useGetFieldWorkSummaryByLmQuery/, "TB Register itself reads nothing of the matrix");
});

test("it is the Allocation Matrix page's own table, without search, Users view or allocation preview", async () => {
  const section = await read("./tb-register-allocation-matrix.jsx");
  const page = await read("../../TargetedBatchAllocationMatrixPage.jsx");
  assert.match(section, /<AllocationMatrixTeamSpTable matrix=\{matrix\} \/>/, "no search text and no incoming meters");
  assert.doesNotMatch(section, /AllocationIntegrityNotice|Allocation integrity warning/, "batches left out are named under the shared table (1.3.54)");
  assert.match(page, /const matrix = useAllocationMatrix\(matrixLmPcode\);/);
  assert.match(page, /<AllocationMatrixTeamSpTable matrix=\{matrix\} searchText=\{searchText\} incomingMeters=\{incomingMeters\} \/>/);
  for (const [name, source] of [["page", page], ["TB Register section", section]]) {
    assert.doesNotMatch(source, /useGetTargetedBatchAllocationMatrixByLmQuery|useGetFieldWorkSummaryByLmQuery|buildOrganisationAllocationMatrixResult|addFieldWorkToMatrix/, `${name} works out no numbers of its own`);
    assert.doesNotMatch(source, /<table[^>]*>[\s\S]*Meters Assigned<\/Th>/, `${name} has no TEAM / SP table of its own`);
  }
});

test("the shared table keeps the TEAM / SP / All switch, the Refresh of work outside batches and the totals row", async () => {
  const table = await read("./allocation-matrix-table.jsx");
  assert.match(table, /\[ALL, "TEAM", "SP"\]\.map/);
  assert.match(table, /\{type === ALL \? "All TEAM \/ SP" : type\}/);
  assert.match(table, /\{fieldWorkFetching \? "Refreshing…" : "Refresh"\}/);
  assert.match(table, /<span>Total<\/span>/);
  assert.match(table, /const projectionActive = incomingMeters > 0;/, "the preview columns only with a batch being allocated");
});
