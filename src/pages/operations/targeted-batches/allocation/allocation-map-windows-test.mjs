import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// Targeted Batch rules TB-R047 (1.3.37): TEAMs and SPs side by side; confirm, progress and result windows.
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const pageSource = () => read("../../TargetedBatchAllocationMapPage.jsx");

test("TEAMs and Service providers are two columns side by side, each scrolling on its own with a count", async () => {
  const page = await pageSource();
  assert.match(page, /<section style=\{styles\.targetColumn\} aria-label="TEAMs">\s*<strong style=\{styles\.groupTitle\}>TEAMs \(\{teams\.length\}\)<\/strong>/);
  assert.match(page, /<section style=\{styles\.targetColumn\} aria-label="Service providers">\s*<strong style=\{styles\.groupTitle\}>Service providers \(\{serviceProviders\.length\}\)<\/strong>/);
  assert.match(page, /targetColumns: \{ display: "grid", gridTemplateColumns: "repeat\(2, minmax\(0, 1fr\)\)"/);
  assert.match(page, /targetList: \{[^}]*maxHeight: 280, overflowY: "auto"/, "each column scrolls, so the Allocate button stays in view");
  assert.doesNotMatch(page, /styles\.chips\b/, "the stacked chip rows are gone");
});

test("Allocate opens a confirmation window, never the browser's OK/Cancel box", async () => {
  const page = await pageSource();
  assert.doesNotMatch(page, /window\.confirm\(/);
  assert.match(page, /setAllocationWindow\(\{ kind: "confirm", selection, target \}\)/);
  assert.match(page, /title=\{allocateButtonLabel\(selection, target\)\}/);
  assert.match(page, /all together or not at all/);
  assert.match(page, /\{ label: "Allocate", primary: true, onClick: onConfirm \}, \{ label: "Cancel", onClick: onClose \}/);
  assert.match(page, /<small style=\{styles\.muted\}>\{item\.wardLabel\} · \{item\.meters\} meter\(s\) · \{item\.tbId\}<\/small>/, "each batch shows Ward, meters and batch ID");
});

test("allocating shows progress without buttons; the result says what was allocated or that nothing was", async () => {
  const page = await pageSource();
  const confirm = page.slice(page.indexOf("const confirmAllocate"), page.indexOf("const closeAllocationWindow"));
  assert.ok(confirm.indexOf('kind: "allocating"') < confirm.indexOf("await allocateTogether("), "progress shows before the server call");
  assert.match(confirm, /if \(!sameSelection\(selection, live\)\)/, "a selection that changed while confirming is not allocated");
  assert.match(page, /title=\{`Allocating \$\{selection\.batches\} batch\(es\) to \$\{target\.name\}…`\} working/);
  assert.match(page, /title=\{`\$\{view\.allocatedIds\.length\} batch\(es\) allocated to \$\{view\.targetName\}`\}/);
  assert.match(page, /They now wait for \$\{view\.targetName\} to accept them\./);
  assert.match(page, /title="Nothing was allocated" tone="error"/);
  assert.match(page, /The selection is still in the allocation window\. Remove or fix the batch named above, then press Allocate again\./);
  assert.match(page, /const closeAllocationWindow = \(\) => \{ if \(allocationWindow\?\.kind !== "allocating"\) setAllocationWindow\(null\); \}/, "the progress window cannot be closed while it works");
});
