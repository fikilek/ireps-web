import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrnBgoLink } from "./trnBgoLink.js";

test("resolveTrnBgoLink returns null when no batch ID exists", () => {
  assert.equal(resolveTrnBgoLink({ bgoBatchId: "NAv", tcId: "NAv" }), null);
  assert.equal(resolveTrnBgoLink({}), null);
});

test("resolveTrnBgoLink builds TRN BGO Rows link with batchId and bgoRowId", () => {
  const link = resolveTrnBgoLink({
    bgoBatchId: "TRN_BGO_20261119_040410_ZA5241006_MDCN",
    bgoRowId: "row_7",
    originChannel: "TRN_BGO",
  });
  assert.deepEqual(link, {
    kind: "TRN_BGO",
    kindLabel: "TRN BGO",
    batchId: "TRN_BGO_20261119_040410_ZA5241006_MDCN",
    rowId: "row_7",
    href: "/operations/trn-bgo-rows?batchId=TRN_BGO_20261119_040410_ZA5241006_MDCN&bgoRowId=row_7",
  });
});

test("resolveTrnBgoLink builds MD BGO Rows link for MD_BGO originChannel", () => {
  const link = resolveTrnBgoLink({
    bgoBatchId: "MD_BGO_20261118_001",
    bgoRowId: "src_12",
    originChannel: "MD_BGO",
  });
  assert.deepEqual(link, {
    kind: "MD_BGO",
    kindLabel: "MD BGO",
    batchId: "MD_BGO_20261118_001",
    rowId: "src_12",
    href: "/operations/md-bgo-rows?batchId=MD_BGO_20261118_001&bgoRowId=src_12",
  });
});
