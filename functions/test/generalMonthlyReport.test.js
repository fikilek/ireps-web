import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanonicalGmrMeterRow,
  buildZamoReportPhotoConfig,
  GMR_MONTH_KEYS,
  selectGmrPopulationMeters,
} from "../reports/generalMonthlyReport.js";

function registryMeter(index, visibility) {
  return {
    id: `TRN_MD_${String(index).padStart(4, "0")}`,
    meterNo: String(4_000_000_000 + index),
    visibility,
    premiseId: `PREM_${index}`,
    erfNo: String(1000 + index),
    parents: {
      lmPcode: "ZA5241",
      wardPcode: `ZA5241${String((index % 3) + 1).padStart(3, "0")}`,
    },
  };
}

test("GMR full population includes every Endumeni registry meter in deterministic order", () => {
  const meters = [
    registryMeter(5, "VISIBLE"),
    registryMeter(2, "INVISIBLE"),
    registryMeter(9, "UNKNOWN"),
    registryMeter(1, "VISIBLE"),
  ];

  const result = selectGmrPopulationMeters(meters);

  assert.equal(result.selected.length, 4);
  assert.equal(result.summary.selectedTotal, 4);
  assert.equal(result.summary.visibleSelected, 2);
  assert.equal(result.summary.invisibleSelected, 1);
  assert.equal(result.summary.unclassifiedSelected, 1);
  assert.deepEqual(
    new Set(result.selected.map((meter) => meter.id)),
    new Set(meters.map((meter) => meter.id)),
  );
  assert.deepEqual(
    result.selected,
    [...result.selected].sort((left, right) => {
      const ward = String(left.parents.wardPcode).localeCompare(
        String(right.parents.wardPcode),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
      if (ward !== 0) return ward;
      return String(left.meterNo).localeCompare(String(right.meterNo), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }),
  );
});

test("Invisible field-found meter can retain project Sales history through targetedBatchContext", () => {
  const registry = registryMeter(1, "INVISIBLE");
  registry.meterNo = "FIELD999";
  registry.meterKind = "prepaid";
  registry.meterType = "electricity";
  registry.meterPhase = "single";
  registry.statusState = "CONNECTED";
  registry.premiseAddress = "1 Example Street";

  const discoveryEntry = {
    id: registry.id,
    data: {
      accessData: {
        trnType: "METER_DISCOVERY",
        access: { hasAccess: "yes" },
        premise: { id: registry.premiseId },
        parents: registry.parents,
        erfNo: registry.erfNo,
      },
      ast: {
        astData: {
          astNo: "FIELD999",
          meter: { type: "prepaid", phase: "single" },
        },
        anomalies: {
          anomaly: "Illegally Connected",
          anomalyDetail: "Straight Connection (Meter Bypass)",
        },
        location: { gps: { lat: -28.123456, lng: 30.654321 } },
        normalisation: {
          actionTaken: ["Meter number corrected", "Address corrected"],
        },
      },
      meterType: "electricity",
      targetedBatchContext: {
        tbId: "TB_1",
        rowId: "ROW_1",
        salesDocId: "ORIG123",
        meterNo: "ORIG123",
        accountNumber: "ACC001",
        customerName: "Example Customer",
      },
      metadata: {
        createdAt: "2026-06-15T10:00:00.000Z",
        createdByUser: "Field Worker One",
      },
      media: [
        { url: "https://example.test/photo-1.jpg" },
        { url: "https://example.test/photo-2.jpg" },
      ],
      serviceProvider: { name: "Example SP" },
    },
  };

  const premiseEntry = {
    id: registry.premiseId,
    data: {
      erfNo: registry.erfNo,
      address: { strNo: "1", strName: "Example", strType: "Street" },
      propertyType: { name: "Residential", type: "RESIDENTIAL" },
      occupancy: { status: "Accessed" },
      parents: registry.parents,
    },
  };

  const sourceSalesEntry = {
    id: "ORIG123",
    data: {
      meterNoNormalized: "ORIG123",
      accountNumber: "ACC001",
      customerName: "Example Customer",
      leakageCategory: "CAT5 - Stopped Purchasing",
      monthlySalesC: {
        "2026-04": 0,
        "2026-05": 25000,
        "2026-06": 10000,
      },
    },
  };

  const row = buildCanonicalGmrMeterRow({
    registry,
    discoveryEntry,
    premiseEntry,
    fieldSalesEntry: null,
    sourceSalesEntry,
    lifecycleTrns: [],
  });

  assert.equal(row.registryVisibility, "Invisible");
  assert.equal(row.fieldFoundMeterInSales, "No");
  assert.equal(row.originalProjectMeterNo, "ORIG123");
  assert.equal(row.fieldFoundMeterNo, "FIELD999");
  assert.equal(row.salesHistorySourceMeterNo, "ORIG123");
  assert.equal(row.salesHistoryAvailable, "Yes");
  assert.equal(row.salesCategory, "CAT5 - Stopped Purchasing");
  assert.equal(row.targetCategory, "Yes");
  assert.equal(row.monthlyPurchases["2026-04"], 0);
  assert.equal(row.monthlyPurchases["2026-05"], 250);
  assert.equal(row.monthlyPurchases["2026-03"], null);
  assert.equal(row.meterNumberVerified, "Incorrect");
  assert.equal(row.primaryFinding, "Illegally Connected");
  assert.equal(row.findingDetail, "Straight Connection (Meter Bypass)");
  assert.equal(row.fieldWorkerName, "Field Worker One");
  assert.equal(row.captureDate, "2026-06-15T10:00:00.000Z");
  assert.equal(row.gpsCoordinates, "-28.123456, 30.654321");
  assert.deepEqual(row.photoUrls, [
    "https://example.test/photo-1.jpg",
    "https://example.test/photo-2.jpg",
  ]);
  assert.equal(row.normalisation, "Meter number corrected • Address corrected");
  assert.equal(row.propertyType, "Residential");
  assert.equal(row.meterMode, "Prepaid");
  assert.equal(row.meterPhase, "Single Phase");
});

test("Zamo Report photo columns follow current observed data up to the fixed six-photo ceiling", () => {
  const rows = [
    { photoUrls: ["p1", "p2", "p3"] },
    { photoUrls: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"] },
    { photoUrls: [] },
  ];

  const config = buildZamoReportPhotoConfig(rows);

  assert.deepEqual(config, {
    observedMaxPhotoCount: 7,
    photoColumnCount: 6,
    hardCeiling: 6,
    truncatedPhotoCount: 1,
  });
});

test("GMR row keeps confirmed financial zero separate from missing financial data", () => {
  const registry = registryMeter(2, "VISIBLE");
  registry.meterNo = "METER2";
  const discoveryEntry = {
    id: registry.id,
    data: {
      accessData: {
        trnType: "METER_DISCOVERY",
        access: { hasAccess: "yes" },
        premise: { id: registry.premiseId },
        parents: registry.parents,
      },
      ast: {
        astData: { astNo: "METER2", meter: { type: "prepaid" } },
        anomalies: { anomaly: "Meter Ok", anomalyDetail: "Meter Ok" },
      },
      meterType: "electricity",
      metadata: { createdAt: "2026-05-10T10:00:00.000Z" },
    },
  };
  const salesEntry = {
    id: "METER2",
    data: {
      meterNoNormalized: "METER2",
      leakageCategory: "Normal - No Leakage Flag",
      monthlySalesC: {
        "2026-05": 0,
        "2026-06": 12345,
      },
    },
  };

  const row = buildCanonicalGmrMeterRow({
    registry,
    discoveryEntry,
    premiseEntry: null,
    fieldSalesEntry: salesEntry,
    sourceSalesEntry: salesEntry,
    lifecycleTrns: [],
  });

  assert.equal(row.monthlyPurchases["2026-05"], 0);
  assert.equal(row.monthlyPurchases["2026-06"], 123.45);
  assert.equal(row.monthlyPurchases["2026-04"], null);
  assert.equal(row.salesCategory, "Normal - No Leakage Flag");
  assert.equal(row.targetCategory, "No");
  assert.equal(row.latestPurchasingStatus, "Purchasing");
  assert.equal(row.consecutiveZeroPurchaseMonths, 0);
  assert.equal(GMR_MONTH_KEYS[0], "2023-12");
  assert.equal(GMR_MONTH_KEYS.at(-1), "2026-08");
});

test("GMR intervention summary links completed DCN/RCN lifecycle TRNs without inventing fine revenue", () => {
  const registry = registryMeter(3, "VISIBLE");
  registry.meterNo = "METER3";
  const discoveryEntry = {
    id: registry.id,
    data: {
      accessData: {
        trnType: "METER_DISCOVERY",
        access: { hasAccess: "yes" },
        premise: { id: registry.premiseId },
        parents: registry.parents,
      },
      ast: {
        astData: { astNo: "METER3", meter: { type: "prepaid" } },
        anomalies: { anomaly: "Illegally Connected", anomalyDetail: "Bridge Wire On The Meter" },
      },
      meterType: "electricity",
      metadata: { createdAt: "2026-08-01T08:00:00.000Z" },
    },
  };
  const salesEntry = {
    id: "METER3",
    data: { meterNoNormalized: "METER3", monthlySalesC: { "2026-06": 0 } },
  };
  const lifecycleTrns = [
    {
      id: "TRN_DCN_1",
      data: {
        accessData: { trnType: "METER_DISCONNECTION" },
        ast: { astData: { astId: registry.id } },
        workflow: {
          state: "COMPLETED",
          completedAt: "2026-08-10T08:00:00.000Z",
          completedByUser: "Field User",
        },
        disconnection: {
          level: { label: "Meter" },
          supplyDisconnected: { answer: "yes" },
        },
        executionOutcome: { success: true },
      },
    },
    {
      id: "TRN_RCN_1",
      data: {
        accessData: { trnType: "METER_RECONNECTION" },
        ast: { astData: { astId: registry.id } },
        workflow: {
          state: "COMPLETED",
          completedAt: "2026-08-12T08:00:00.000Z",
          completedByUser: "Field User 2",
        },
        reconnection: { supplyReconnected: { answer: "yes" } },
        executionOutcome: { success: true },
      },
    },
  ];

  const row = buildCanonicalGmrMeterRow({
    registry,
    discoveryEntry,
    premiseEntry: null,
    fieldSalesEntry: salesEntry,
    sourceSalesEntry: salesEntry,
    lifecycleTrns,
  });

  assert.equal(row.interventionCount, 2);
  assert.equal(row.interventionStatus, "Completed");
  assert.equal(row.disconnected, "Yes");
  assert.equal(row.reconnected, "Yes");
  assert.equal(row.latestInterventionType, "METER_RECONNECTION");
  assert.equal(row.fineIssued, null);
  assert.equal(row.totalFinesPaidR, null);
  assert.equal(row.directRecoveryAmountR, null);
  assert.equal(row.lifecycleEvents.length, 2);
});

test("GMR consecutive zero-purchase count starts from the latest available month, not future missing months", () => {
  const registry = registryMeter(4, "VISIBLE");
  registry.meterNo = "METER4";
  const discoveryEntry = {
    id: registry.id,
    data: {
      accessData: {
        trnType: "METER_DISCOVERY",
        access: { hasAccess: "yes" },
        premise: { id: registry.premiseId },
        parents: registry.parents,
      },
      ast: {
        astData: { astNo: "METER4", meter: { type: "prepaid" } },
        anomalies: { anomaly: "Meter Ok", anomalyDetail: "Meter Ok" },
      },
      meterType: "electricity",
      metadata: { createdAt: "2026-05-10T10:00:00.000Z" },
    },
  };
  const salesEntry = {
    id: "METER4",
    data: {
      meterNoNormalized: "METER4",
      monthlySalesC: {
        "2026-04": 10000,
        "2026-05": 0,
        "2026-06": 0,
      },
    },
  };

  const row = buildCanonicalGmrMeterRow({
    registry,
    discoveryEntry,
    premiseEntry: null,
    fieldSalesEntry: salesEntry,
    sourceSalesEntry: salesEntry,
    lifecycleTrns: [],
  });

  assert.equal(row.latestAvailablePurchaseValue, 0);
  assert.equal(row.latestPurchasingStatus, "Zero Purchase");
  assert.equal(row.consecutiveZeroPurchaseMonths, 2);
});

test("completed no-access DCN attempt does not report the intervention itself as completed", () => {
  const registry = registryMeter(5, "VISIBLE");
  registry.meterNo = "METER5";
  const discoveryEntry = {
    id: registry.id,
    data: {
      accessData: {
        trnType: "METER_DISCOVERY",
        access: { hasAccess: "yes" },
        premise: { id: registry.premiseId },
        parents: registry.parents,
      },
      ast: {
        astData: { astNo: "METER5", meter: { type: "prepaid" } },
        anomalies: { anomaly: "Illegally Connected", anomalyDetail: "Straight Connection (Meter Bypass)" },
      },
      meterType: "electricity",
      metadata: { createdAt: "2026-08-01T08:00:00.000Z" },
    },
  };
  const salesEntry = {
    id: "METER5",
    data: { meterNoNormalized: "METER5", monthlySalesC: { "2026-06": 0 } },
  };
  const lifecycleTrns = [{
    id: "TRN_DCN_NO_ACCESS",
    data: {
      accessData: { trnType: "METER_DISCONNECTION" },
      ast: { astData: { astId: registry.id } },
      workflow: {
        state: "COMPLETED",
        completedAt: "2026-08-10T08:00:00.000Z",
        completedByUser: "Field User",
      },
      executionOutcome: { outcome: "NO_ACCESS", success: false },
    },
  }];

  const row = buildCanonicalGmrMeterRow({
    registry,
    discoveryEntry,
    premiseEntry: null,
    fieldSalesEntry: salesEntry,
    sourceSalesEntry: salesEntry,
    lifecycleTrns,
  });

  assert.equal(row.interventionCount, 1);
  assert.equal(row.interventionStatus, "Pending");
  assert.equal(row.disconnected, "No");
  assert.equal(row.reconnected, "No");
});

