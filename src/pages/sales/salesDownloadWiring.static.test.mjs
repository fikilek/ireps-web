import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const table = await readFile(
  new URL("./components/SalesMetersTable.jsx", import.meta.url),
  "utf8",
);

const prepaid = await readFile(
  new URL("./PrepaidSales.jsx", import.meta.url),
  "utf8",
);

function getDownloadButtonsBlock(source) {
  return source.match(/<DownloadButtons[\s\S]*?\/>/)?.[0] || "";
}

test("Sales Table uses the standard iREPS QD/FD component", () => {
  assert.match(
    table,
    /import DownloadButtons from "\.\.\/\.\.\/\.\.\/components\/DownloadButtons";/,
  );

  const block = getDownloadButtonsBlock(table);

  assert.ok(block, "DownloadButtons block must exist");
  assert.match(block, /registryName="Sales Table"/);
  assert.match(block, /rowsLabel="meters"/);
  assert.match(block, /fileBaseName="sales_table"/);
  assert.match(block, /scope=\{downloadScope\}/);
});

test("Sales Quick Download exports all filtered and sorted meters, not the current page", () => {
  const block = getDownloadButtonsBlock(table);

  assert.match(block, /visibleRows=\{sortedRows\}/);
  assert.doesNotMatch(block, /visibleRows=\{paginatedRows\}/);

  const filteredIndex = table.indexOf("const filteredRows = useMemo");
  const sortedIndex = table.indexOf("const sortedRows = useMemo");
  const paginatedIndex = table.indexOf("const paginatedRows = useMemo");
  const downloadIndex = table.indexOf("visibleRows={sortedRows}");

  assert.ok(filteredIndex >= 0, "filteredRows must exist");
  assert.ok(sortedIndex > filteredIndex, "sortedRows must follow filtering");
  assert.ok(
    paginatedIndex > sortedIndex,
    "pagination must happen after the complete sorted result is established",
  );
  assert.ok(
    downloadIndex > sortedIndex,
    "Quick Download must consume the complete sorted result",
  );
});

test("Sales Full Download stays visible but unimplemented", () => {
  const block = getDownloadButtonsBlock(table);

  assert.ok(block, "DownloadButtons block must exist");
  assert.equal(
    block.includes("onFullDownload"),
    false,
    "Sales must not enable a Full Download backend handler in this workstream",
  );
});

test("Sales Quick Download carries the established Sales table fields", () => {
  for (const header of [
    "Meter Number",
    "Ward No",
    "Geofences",
    "TB IDs",
    "Work Status",
    "Sales Category",
    "Address",
    "Town",
    "SG Code",
    "Erf No",
    "Total Sales (R)",
    "Latest 12 Months (R)",
    "Updated At",
  ]) {
    assert.ok(
      table.includes(`header: "${header}"`),
      `Missing Quick Download column: ${header}`,
    );
  }

  assert.match(
    table,
    /\.\.\.monthKeys\.map\(\(monthKey\) => \(\{/,
  );
});

test("Prepaid Sales provides LM-wide All wards download scope", () => {
  assert.match(prepaid, /const quickDownloadScope = useMemo/);
  assert.match(prepaid, /lmName: activeWorkbaseName/);
  assert.match(prepaid, /lmPcode: activeLmPcode \|\| "NAv"/);
  assert.match(prepaid, /wardLabel: "All wards"/);
  assert.match(prepaid, /downloadScope=\{quickDownloadScope\}/);
});