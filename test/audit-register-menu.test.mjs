import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/layouts/ConsoleLayout.jsx", import.meta.url), "utf8");
const roles = source.slice(source.indexOf("const ALL_OPERATIONAL_ROLES"), source.indexOf("const APP_ENV_VALUE"));
const navigation = source.slice(source.indexOf("const navSections"), source.indexOf("const sidebarStyles"));
const sections = new Function(`${roles}\n${navigation}\nreturn navSections;`)();
function entries(value) {
  if (!value || typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(entries)];
}
for (const [path, label] of [["/operations/bgo", "Sweep Audit Register"], ["/operations/targeted-batches", "Targeted Audit Register"]]) {
  test(`${label} retains its existing destination and management visibility`, () => {
    const matches = entries(sections).filter(item => item.path === path);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].label, label);
    assert.deepEqual(matches[0].allowedRoles, ["SPU", "ADM", "MNG", "SPV"]);
  });
}
test("TRN BGO Register keeps its existing label", () => {
  assert.equal(entries(sections).find(item => item.path === "/operations/trn-bgo").label, "TRN BGO Register");
});
