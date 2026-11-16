import test from "node:test";
import assert from "node:assert/strict";
import { buildTrnBgoDisplayRows } from "./trnBgoRowsView.js";

test("buildTrnBgoDisplayRows joins live child TRN truth with tc_rows snapshot", () => {
  const rawRows = [
    {
      id: "BATCH_1_R000001",
      rowNo: 1,
      trnId: "TRN_MINSP_1",
      input: {
        meterNo: "04297706121",
        meterType: "electricity",
        meterPhase: "Single Phase",
        linkedAccountNo: "0002010425",
      },
      backend: { eligible: true, matched: true },
      bgo: { ready: true, readinessReason: "NAv" },
      ast: { meterType: "electricity", statusState: "DISCONNECTED", geofenceRefs: [{ name: "Gf W6 Acacia" }] },
      premise: {
        erfNo: "4241",
        address: { strNo: "4241", strName: "Acacia", strType: "Street", suburbName: "Dundee" },
      },
      wardPcode: "ZA5241006",
    },
  ];

  const childTrns = [
    {
      id: "TRN_MINSP_1",
      workflow: { state: "IN_PROGRESS" },
      noAccessCount: 2,
      status: { state: "CONNECTED" },
      metadata: { updatedAt: "2026-11-16T02:10:00.000Z" },
      ast: { astData: { astNo: "04297706121", meter: { type: "electricity", phase: "Three Phase" } } },
    },
  ];

  const [row] = buildTrnBgoDisplayRows({ rawRows, childTrns, activeBatch: { wardPcode: "ZA5241006" } });
  assert.equal(row.meterType, "electricity");
  assert.equal(row.meterPhase, "Three Phase");
  assert.equal(row.meterStatus, "CONNECTED");
  assert.equal(row.activeTrnId, "TRN_MINSP_1");
  assert.equal(row.activeTrnState, "IN_PROGRESS");
  assert.equal(row.naCount, 2);
  assert.equal(row.updatedAt, "2026-11-16T02:10:00.000Z");
  assert.equal(row.blockingMessage, "In progress (2 NA)");
  assert.equal(row.address, "4241 Acacia Street Dundee");
  assert.equal(row.geofenceName, "Gf W6 Acacia");
});
