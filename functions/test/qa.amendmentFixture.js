export function discoveryFixture(bucket = "demo-ireps-qa.appspot.com") {
  const id = "TRN_MDIS_1_ELC_ZA5241002_100";
  return { id, accessData: { trnType: "METER_DISCOVERY", erfId: "erf", erfNo: "100",
    parents: { countryPcode: "ZA", provincePcode: "ZA5", dmPcode: "ZA52", lmPcode: "ZA5241", wardPcode: "ZA5241002" },
    premise: { id: "premise", address: "1 Test Street", propertyType: "Residential" }, access: { hasAccess: "yes", reason: "NAv" } },
    ast: { astData: { astId: id, astNo: "04085348920", astManufacturer: "Conlog", astName: "Model X", meter: {
      phase: "single", type: "prepaid", category: "Normal", seal: { sealNo: "S-1", comment: "" },
      keypad: { serialNo: "K-1", comment: "" }, cb: { size: "60A", comment: "" } } },
    anomalies: { anomaly: "Meter Ok", anomalyDetail: "Operationally Ok", otherAnomalies: [] },
    ogs: { hasOffGridSupply: "no" }, normalisation: { actionTaken: ["None"] },
    location: { placement: "Boundary Wall", gps: { lat: -28.16, lng: 30.23 } } },
    meterType: "electricity", status: { state: "CONNECTED" }, serviceProvider: { id: "sub", name: "Subcontractor" },
    fieldComment: { text: "Original comment" },
    media: ["astNoPhoto", "sealPhoto", "keypadPhoto", "astCbPhoto"].map(tag => ({ tag,
      url: `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(`meters/qa-fixture/${tag}.jpg`)}?alt=media` })),
    metadata: { createdAt: "2026-09-01T08:00:00.000Z", createdByUid: "worker", createdByUser: "Original Worker",
      updatedAt: "2026-09-01T08:00:00.000Z", updatedByUid: "worker", updatedByUser: "Original Worker",
      createdOnDevice: "2026-09-01T07:59:00.000Z", createdOnDeviceByUid: "worker", createdOnDeviceByUser: "Original Worker" } };
}
