import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// GPS Sales Table Geofences column (Targeted Batch rules 18.3, 1.3.44).
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("the Geofences column fits its names from 220 px up to 360 px", async () => {
  const table = await read("./SalesMetersTable.jsx");
  assert.match(table, /const GEOFENCE_COLUMN_MAX_WIDTH = 360;/);
  assert.match(table, /STICKY_COLUMN_WIDTHS = \{[^}]*\bgeofence: 220,/, "220 px stays the minimum");
  assert.match(table, /\.\.\.\(columnKey === "geofence" && !isHeader \? \{\} : \{ maxWidth: `\$\{config\.width\}px` \}\)/, "only Geofences body cells have no fixed maximum");
  assert.match(table, /<th\s+style=\{\{\s*\.\.\.styles\.headerCell,\s*\.\.\.getStickyStyle\("geofence", stickyLayout, true\),/, "the header passes isHeader, so a long filter choice cannot widen the column");
});

test("a longer list ends in … and the hover shows the whole list", async () => {
  const table = await read("./SalesMetersTable.jsx");
  assert.match(table, /geofenceNames: \{\s*(?:\/\/[^\n]*\n\s*)*maxWidth: `calc\(\$\{GEOFENCE_COLUMN_MAX_WIDTH\}px - 1\.3rem - 1px\)`,\s*overflow: "hidden",\s*textOverflow: "ellipsis",\s*whiteSpace: "nowrap",\s*\}/);
  assert.match(table, /bodyCell: \{\s*padding: "0\.72rem 0\.65rem",\s*borderRight: "1px solid /, "the 1.3rem + 1px in the cap is bodyCell's side padding and right border");
  assert.match(table, /title=\{getRowGeofenceLabel\(row\) \|\| "No geofence"\}\s*>\s*<div style=\{styles\.geofenceNames\}>\s*\{getRowGeofenceLabel\(row\) \|\| "No geofence"\}\s*<\/div>/);
});

test("the download keeps the full geofence list", async () => {
  const table = await read("./SalesMetersTable.jsx");
  assert.match(table, /value: \(row\) => getRowGeofenceLabel\(row\) \|\| "No geofence"/);
});

// Rules 18.3 (1.3.46): with Wards chosen, the Geofences filter lists only the geofences
// of meters in those Wards; the table rows and the list use the same Ward test.
async function wardFilter() {
  const table = await read("./SalesMetersTable.jsx");
  const source = ["normalizeWardNumber", "rowHasNoWardValue", "rowMatchesWardFilter"]
    .map(name => table.match(new RegExp(`function ${name}\\([^]*?\\r?\\n}\\r?\\n`))[0]).join("\n");
  return new Function(`const WARD_FILTER_NAV = "__NAV__";\n${source}\nreturn rowMatchesWardFilter;`)();
}

test("the Ward test: none chosen, a chosen Ward, or NAv for a meter without a Ward", async () => {
  const matches = await wardFilter();
  const ward6 = { wardNumbers: ["006"], wardNumberLabel: "006" };
  const ward4 = { wardNumbers: ["004"], wardNumberLabel: "004" };
  const noWard = { wardNumbers: [], wardNumberLabel: "NAv" };
  assert.equal(matches(ward4, new Set()), true, "no Ward chosen: every meter");
  assert.equal(matches(ward6, new Set(["006"])), true);
  assert.equal(matches(ward4, new Set(["006"])), false);
  assert.equal(matches(ward4, new Set(["006", "004"])), true);
  assert.equal(matches(noWard, new Set(["__NAV__"])), true);
  assert.equal(matches(ward6, new Set(["__NAV__"])), false);
});

test("the Geofences filter lists only the geofences of meters in the chosen Wards", async () => {
  const table = await read("./SalesMetersTable.jsx");
  assert.match(table, /const salesGeofenceOptions = useMemo\(\(\) => \{\s*const selectedWardNos = new Set\(filters\.wardNos\);\s*const byId = new Map\(\);\s*classifiedRows\.forEach\(\(row\) => \{\s*if \(!rowMatchesWardFilter\(row, selectedWardNos\)\) return;/);
  assert.match(table, /\}, \[classifiedRows, filters\.wardNos\]\);\s*const geofenceOptions = useMemo/, "the list follows the Ward filter");
  assert.match(table, /const matchesWard = rowMatchesWardFilter\(row, selectedWardNos\);/, "the table rows use the same Ward test");
});
