import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrnBgoLink } from "./trnBgoLink.js";
import { extractTrnBgoFields } from "../../redux/trnBgoFields.js";
import { enrichMdBgoRowQa, mdBgoRowTrnId } from "../operations/md-bgo/mdBgoRowQaModel.js";
import { MD_BGO_ROW_DEFAULT_VISIBILITY } from "../operations/md-bgo/mdBgoRowsPresentation.js";
import { buildTrnBgoDisplayRows } from "../operations/trnBgoRowsView.js";

test("1. Current TRN_BGO Firestore document extracts origin.trnBgo and routes to /operations/trn-bgo-rows", () => {
  const rawDoc = {
    origin: {
      channel: "OFFICE",
      source: "TRN_BGO",
      trnBgo: {
        batchId: "TRN_BGO_20261119_040410_ZA5241006_MDCN",
        rowId: "TRN_BGO_20261119_040410_ZA5241006_MDCN_R000002",
      },
    },
    bgo: null,
    refs: null,
  };
  const extracted = extractTrnBgoFields(rawDoc);
  assert.equal(extracted.bgoBatchId, "TRN_BGO_20261119_040410_ZA5241006_MDCN");
  assert.equal(extracted.bgoRowId, "TRN_BGO_20261119_040410_ZA5241006_MDCN_R000002");
  assert.equal(extracted.bgoKind, "TRN_BGO");

  const link = resolveTrnBgoLink({ originChannel: "OFFICE", ...extracted });
  assert.deepEqual(link, {
    kind: "TRN_BGO",
    kindLabel: "TRN BGO",
    batchId: "TRN_BGO_20261119_040410_ZA5241006_MDCN",
    rowId: "TRN_BGO_20261119_040410_ZA5241006_MDCN_R000002",
    href: "/operations/trn-bgo-rows?batchId=TRN_BGO_20261119_040410_ZA5241006_MDCN&bgoRowId=TRN_BGO_20261119_040410_ZA5241006_MDCN_R000002",
  });
});

test("2. Current MD_BGO Firestore document extracts origin.mdBgo and routes to /operations/md-bgo-rows", () => {
  const rawDoc = {
    origin: {
      channel: "FIELD",
      mdBgo: {
        batchId: "MD_BGO_20261109_194642_ZA5241006_MDIS",
        rowId: "MD_BGO_20261109_194642_ZA5241006_MDIS_ROW_44",
        batchMode: "BMD",
      },
    },
    bgo: null,
    refs: null,
  };
  const extracted = extractTrnBgoFields(rawDoc);
  assert.equal(extracted.bgoBatchId, "MD_BGO_20261109_194642_ZA5241006_MDIS");
  assert.equal(extracted.bgoRowId, "MD_BGO_20261109_194642_ZA5241006_MDIS_ROW_44");
  assert.equal(extracted.bgoKind, "MD_BGO");

  const link = resolveTrnBgoLink({ originChannel: "FIELD", ...extracted });
  assert.deepEqual(link, {
    kind: "MD_BGO",
    kindLabel: "MD BGO",
    batchId: "MD_BGO_20261109_194642_ZA5241006_MDIS",
    rowId: "MD_BGO_20261109_194642_ZA5241006_MDIS_ROW_44",
    href: "/operations/md-bgo-rows?batchId=MD_BGO_20261109_194642_ZA5241006_MDIS&bgoRowId=MD_BGO_20261109_194642_ZA5241006_MDIS_ROW_44",
  });
});

test("3. Legacy BGO_TRN and BMD_ batch IDs route to their respective row pages", () => {
  const legacyTrnBgo = extractTrnBgoFields({
    origin: {
      channel: "OFFICE",
      source: "BGO",
      bgoBatchId: "TC_20260602_164211_ZA7423_MDCN_BGO_OBx1U9VMnVPOeniQjbOP",
      tcId: "TC_20260602_164211_ZA7423_MDCN",
      tcRowId: "TC_20260602_164211_ZA7423_MDCN_R000001",
    },
    bgo: { kind: "BGO_TRN" },
  });
  const trnLink = resolveTrnBgoLink({ originChannel: "OFFICE", ...legacyTrnBgo });
  assert.equal(trnLink.kind, "TRN_BGO");
  assert.equal(
    trnLink.href,
    "/operations/trn-bgo-rows?batchId=TC_20260602_164211_ZA7423_MDCN_BGO_OBx1U9VMnVPOeniQjbOP&bgoRowId=TC_20260602_164211_ZA7423_MDCN_R000001",
  );

  const legacyBmd = resolveTrnBgoLink({
    bgoBatchId: "BMD_ZA7423_ZA7423006_BGO_3vildZSRc07gw5415pxz_SP_E9142A0A",
    bgoRowId: "ROW_1",
    originChannel: "FIELD",
  });
  assert.equal(legacyBmd.kind, "MD_BGO");
  assert.equal(
    legacyBmd.href,
    "/operations/md-bgo-rows?batchId=BMD_ZA7423_ZA7423006_BGO_3vildZSRc07gw5415pxz_SP_E9142A0A&bgoRowId=ROW_1",
  );
});

test("4. Non-BGO ad-hoc TRNs produce null (NAv) and never fabricate links", () => {
  const nonBgo = extractTrnBgoFields({ origin: {}, bgo: null, refs: null });
  assert.equal(nonBgo.bgoBatchId, "NAv");
  assert.equal(resolveTrnBgoLink({ originChannel: "FIELD", ...nonBgo }), null);
  assert.equal(resolveTrnBgoLink({}), null);
});

test("5. Reverse navigation: TRN BGO Rows resolves activeTrnId for TRN Registry link", () => {
  const rows = buildTrnBgoDisplayRows({
    rawRows: [
      {
        id: "TRN_BGO_20261119_040410_ZA5241006_MDCN_R000002",
        trnId: "TRN_MDCN_1795053850592_ELC_ZA5241006_689",
        input: { meterNo: "04297698179" },
      },
      {
        id: "TRN_BGO_20261119_040410_ZA5241006_MDCN_R000007",
        input: { meterNo: "04297706063" },
      },
    ],
    childTrns: [{ id: "TRN_MDCN_1795053850592_ELC_ZA5241006_689", workflow: { state: "ISSUED" } }],
  });
  assert.equal(rows[0].activeTrnId, "TRN_MDCN_1795053850592_ELC_ZA5241006_689");
  assert.equal(rows[1].activeTrnId, "None");
});

test("6. Reverse navigation & AST identity: MD BGO preserves originating-TRN semantics and hidden-by-default TRN ID column", () => {
  assert.equal(MD_BGO_ROW_DEFAULT_VISIBILITY.trnId, false);
  assert.equal(MD_BGO_ROW_DEFAULT_VISIBILITY.sourceRowId, false);

  const rowWithRefs = {
    sourceRowId: "MD_BGO_20261109_194642_ZA5241006_MDIS_ROW_44",
    premiseId: "PRM_1",
    meterId: "TRN_MDIS_1794423090078_ELC_ZA5241006_3703",
    refs: { trnId: "TRN_MDIS_1794423090078_ELC_ZA5241006_3703" },
  };
  assert.equal(mdBgoRowTrnId(rowWithRefs), "TRN_MDIS_1794423090078_ELC_ZA5241006_3703");

  // Even before qaSource finishes loading, explicit refs.trnId remains available;
  // a row with only meterId and no qaSource does not manufacture an unverified TRN link.
  const rowMeterIdOnly = {
    sourceRowId: "MD_BGO_20261109_194642_ZA5241006_MDIS_ROW_99",
    premiseId: "PRM_2",
    meterId: "TRN_MDIS_ORIGINATING",
  };
  const notReady = enrichMdBgoRowQa([rowWithRefs, rowMeterIdOnly], { ready: false });
  assert.equal(notReady[0].trnId, "TRN_MDIS_1794423090078_ELC_ZA5241006_3703");
  assert.equal(notReady[1].trnId, "");

  const ready = enrichMdBgoRowQa([rowWithRefs, rowMeterIdOnly], {
    ready: true,
    premises: {},
    trns: {
      TRN_MDIS_1794423090078_ELC_ZA5241006_3703: { workflow: { state: "QA PASS" } },
      TRN_MDIS_ORIGINATING: { workflow: { state: "COMPLETED" } },
    },
  });
  assert.equal(ready[0].trnId, "TRN_MDIS_1794423090078_ELC_ZA5241006_3703");
  assert.equal(ready[1].trnId, "TRN_MDIS_ORIGINATING");
});
