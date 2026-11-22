// OC-R001: form validation and achieved work are both required. No writes here.
export function capturedReading(data = {}) {
  return String(data?.meterReading?.reading ?? "").trim();
}
export function operationObjectiveAchieved({trnType, data, validation}) {
  if (!validation?.ok) return false;
  const flags = {METER_DISCONNECTION:"disconnectionPassed",METER_RECONNECTION:"reconnectionPassed",
    METER_REMOVAL:"removalPassed",METER_INSPECTION:"inspectionPassed",METER_READING:"readingPassed",
    METER_COMMISSIONING:"commissioningPassed"};
  const flag = flags[trnType];
  if (!flag || validation[flag] !== true) return false;
  if (trnType === "METER_READING") return capturedReading(data) !== "" && String(data?.accessData?.access?.hasAccess).toLowerCase() === "yes";
  return String(data?.accessData?.access?.hasAccess || "").toLowerCase() === "yes";
}
