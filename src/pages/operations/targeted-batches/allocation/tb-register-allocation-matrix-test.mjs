import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Targeted Batch rules TB-R045 (1.3.51): the Allocation Matrix on TB Register.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("TB Register shows the Allocation Matrix between its summary cards and the batch table", async () => {
  const register = await read("../../TargetedBatchesPage.jsx");
  assert.match(register, /import TbRegisterAllocationMatrix from "\.\/targeted-batches\/allocation\/tb-register-allocation-matrix\.jsx";/);
  const cards = register.indexOf('<SummaryCard label="Needs Attention"');
  const matrix = register.indexOf("<TbRegisterAllocationMatrix lmPcode={activeLmPcode} />");
  const batches = register.indexOf("Permanent Targeted Batches</h3>");
  assert.ok(cards > 0 && matrix > cards && batches > matrix, "cards, then the matrix, then the batch table");
  assert.equal(register.split("<TbRegisterAllocationMatrix").length - 1, 1, "shown once");
});

test("the section is closed when TB Register opens and reads nothing until it is shown", async () => {
  const section = await read("./tb-register-allocation-matrix.jsx");
  assert.match(section, /const \[open, setOpen\] = useState\(false\);/, "closed whenever TB Register opens");
  assert.match(section, /\{open \? "Hide Allocation Matrix" : "Show Allocation Matrix"\}/);
  assert.match(section, /aria-expanded=\{open\}/);
  assert.match(section, /\{open && lmPcode \? <OpenAllocationMatrix lmPcode=\{lmPcode\} \/> : null\}/, "hiding unmounts the table, which ends its reads");
  // The reads start only inside the part that exists while the section is open.
  const opened = section.slice(section.indexOf("function OpenAllocationMatrix("), section.indexOf("export default function TbRegisterAllocationMatrix("));
  const closed = section.slice(section.indexOf("export default function TbRegisterAllocationMatrix("));
  assert.match(opened, /const matrix = useAllocationMatrix\(lmPcode\);/);
  assert.equal((section.match(/useAllocationMatrix\(/g) || []).length, 1, "no other read");
  assert.doesNotMatch(closed, /useAllocationMatrix|use[A-Z]\w*Query/, "the closed section reads nothing");
});

test("it is the Allocation Matrix page's own table, without search, Users view or allocation preview", async () => {
  const section = await read("./tb-register-allocation-matrix.jsx");
  const page = await read("../../TargetedBatchAllocationMatrixPage.jsx");
  assert.match(section, /<AllocationMatrixTeamSpTable matrix=\{matrix\} \/>/, "no search text and no incoming meters");
  assert.match(section, /<AllocationIntegrityNotice issues=\{matrix\.integrityIssues\} \/>/, "the warning about batches left out");
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
