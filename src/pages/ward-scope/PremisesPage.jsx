import WardScopeHeader from "./components/WardScopeHeader";
import { useWarehouse } from "../../context/WarehouseContext";

const getPremiseKey = (premise) =>
  premise?.premiseId || premise?.id || premise?.address || "NAv";

const getPremiseId = (premise) => premise?.premiseId || premise?.id || "NAv";

const getPremiseAddress = (premise) => {
  if (typeof premise?.address === "string") return premise.address;

  const address = premise?.address || {};

  const parts = [
    address?.strNo,
    address?.strName,
    address?.strType,
    address?.suburbName,
  ].filter(Boolean);

  if (parts.length) return parts.join(" ");

  return premise?.fullAddress || premise?.premiseAddress || "NAv";
};

const getPropertyType = (premise) => {
  if (typeof premise?.propertyType === "string") return premise.propertyType;

  return (
    premise?.propertyType?.name ||
    premise?.property?.type ||
    premise?.type ||
    "NAv"
  );
};

const getUnitNo = (premise) => {
  return (
    premise?.propertyType?.unitNo ||
    premise?.propertyType?.UnitNo ||
    premise?.unitNo ||
    premise?.unitNumber ||
    "NAv"
  );
};

const getOccupancyStatus = (premise) => {
  return (
    premise?.occupancyStatus ||
    premise?.occupancy?.status ||
    premise?.status ||
    "NAv"
  );
};

const getErfNo = (premise) => {
  return premise?.erfNo || premise?.erf?.erfNo || "NAv";
};

const getErfId = (premise) => {
  return premise?.erfId || premise?.erf?.id || "NAv";
};

const getElectricityMeterCount = (premise) => {
  return (
    premise?.electricityMeterCount ||
    premise?.counts?.electricityMeters ||
    premise?.counts?.electricityMeterCount ||
    0
  );
};

const getWaterMeterCount = (premise) => {
  return (
    premise?.waterMeterCount ||
    premise?.counts?.waterMeters ||
    premise?.counts?.waterMeterCount ||
    0
  );
};

const getTotalMeterCount = (premise) => {
  return (
    premise?.totalMeterCount ||
    premise?.meterCount ||
    premise?.counts?.totalMeters ||
    getElectricityMeterCount(premise) + getWaterMeterCount(premise)
  );
};

export default function PremisesPage() {
  const { all, filtered, sync, scope, loading } = useWarehouse();

  const allPremises = all?.prems || [];
  const premises = filtered?.prems || [];
  const selectedWardPcode = scope?.wardPcode || "";

  return (
    <>
      <WardScopeHeader
        stats={[
          {
            label: "Ward Premises",
            value: loading
              ? "Loading..."
              : sync?.premises?.status === "ready"
                ? allPremises.length
                : sync?.premises?.status || "idle",
          },
          {
            label: "Filtered Premises",
            value: premises.length,
          },
          {
            label: "Meters Loaded",
            value: filtered?.meters?.length || 0,
          },
        ]}
      />

      <section className="table-panel">
        <div className="load-more-row">
          <div>
            <strong>Operational Premises</strong>
            <p className="muted">
              Premises are loaded through the Ward Warehouse for the selected
              ward.
            </p>
          </div>

          <div className="filter-summary">
            <strong>{sync?.premises?.status || "idle"}</strong>
            <span>{premises.length} visible rows</span>
          </div>
        </div>

        {!selectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              Choose a ward above to load operational premises from the
              warehouse.
            </p>
          </div>
        ) : premises.length === 0 ? (
          <div className="empty-state">
            <h2>No premises loaded</h2>
            <p className="muted">
              Premise sync status: {sync?.premises?.status || "idle"}. If this
              remains empty, we will check the Firestore query/index for
              premises.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Property Type</th>
                  <th>Unit</th>
                  <th>Occupancy</th>
                  <th>ERF No</th>
                  <th>Electricity</th>
                  <th>Water</th>
                  <th>Total Meters</th>
                  <th>Premise ID</th>
                </tr>
              </thead>

              <tbody>
                {premises.map((premise) => (
                  <tr key={getPremiseKey(premise)}>
                    <td>{getPremiseAddress(premise)}</td>
                    <td>{getPropertyType(premise)}</td>
                    <td>{getUnitNo(premise)}</td>
                    <td>{getOccupancyStatus(premise)}</td>
                    <td title={getErfId(premise)}>{getErfNo(premise)}</td>
                    <td>{getElectricityMeterCount(premise)}</td>
                    <td>{getWaterMeterCount(premise)}</td>
                    <td>{getTotalMeterCount(premise)}</td>
                    <td>{getPremiseId(premise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
