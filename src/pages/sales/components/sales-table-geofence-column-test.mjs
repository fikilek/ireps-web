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
