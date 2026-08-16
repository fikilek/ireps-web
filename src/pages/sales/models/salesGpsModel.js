export const SALES_GPS_FILTERS = Object.freeze({
  ALL: "ALL",
  WITH_GPS: "WITH_GPS",
  WITHOUT_GPS: "WITHOUT_GPS",
});

export function hasUsableSalesGps(row = {}) {
  return row?.hasUsableGps === true;
}

export function isSalesWithoutUsableGps(row = {}) {
  return !hasUsableSalesGps(row);
}

export function matchesSalesGpsFilter(
  row = {},
  gpsFilter = SALES_GPS_FILTERS.ALL,
) {
  if (gpsFilter === SALES_GPS_FILTERS.WITH_GPS) {
    return hasUsableSalesGps(row);
  }

  if (gpsFilter === SALES_GPS_FILTERS.WITHOUT_GPS) {
    return isSalesWithoutUsableGps(row);
  }

  return true;
}
