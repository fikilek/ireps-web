import WardScopeHeader from "./components/WardScopeHeader";
import { useWarehouse } from "../../context/WarehouseContext";

const WAITING_STATUSES = new Set(["pending", "syncing"]);

const isWaitingForRows = ({ status, loading, selectedWardPcode, rowCount }) => {
  if (!selectedWardPcode) return false;
  if (rowCount > 0) return false;

  return loading || WAITING_STATUSES.has(status);
};

const InlineSpinner = ({ label = "Loading..." }) => (
  <span className="ward-scope-inline-spinner">
    <span className="ward-scope-spinner-dot" aria-hidden="true" />
    <span>{label}</span>
    <style>
      {`@keyframes wardScopeSpin {
        to {
          transform: rotate(360deg);
        }
      }

      .ward-scope-inline-spinner {
        align-items: center;
        display: inline-flex;
        gap: 0.45rem;
        justify-content: center;
        white-space: nowrap;
      }

      .ward-scope-spinner-dot {
        animation: wardScopeSpin 0.8s linear infinite;
        border: 2px solid currentColor;
        border-radius: 999px;
        border-right-color: transparent;
        display: inline-block;
        height: 0.85rem;
        width: 0.85rem;
      }`}
    </style>
  </span>
);

const LoadingState = ({ title, message }) => (
  <div className="empty-state">
    <h2>
      <InlineSpinner label={title} />
    </h2>
    <p className="muted">{message}</p>
  </div>
);


const getPremiseKey = (premise) =>
  premise?.premiseId || premise?.id || premise?.address || "NAv";

const getPremiseId = (premise) => premise?.premiseId || premise?.id || "NAv";

const getPremiseAddress = (premise) => {
  if (typeof premise?.address === "string") return premise.address;

  const address = premise?.address || {};

  const parts = [address?.strNo, address?.strName, address?.strType].filter(
    Boolean,
  );

  if (parts.length) return parts.join(" ");

  return premise?.fullAddress || premise?.premiseAddress || "NAv";
};

const getSuburb = (premise) => {
  if (typeof premise?.address === "string") return premise.address;

  const suburb = premise?.address?.suburbName || "";

  return suburb;
};

const getPropertyType = (premise) => {
  if (typeof premise?.propertyType === "string") return premise.propertyType;

  return premise?.propertyType?.type || premise?.type || "NAv";
};

const getPropertyName = (premise) => {
  if (typeof premise?.propertyName === "string") return premise.propertyName;

  return premise?.propertyType?.name || "NAv";
};

const getUnitNo = (premise) => {
  return (
    premise?.propertyType?.unitNo ||
    premise?.propertyType?.UnitNo ||
    premise?.unitNo ||
    premise?.unitNumber ||
    ""
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
  const { all, filtered, sync, selected, loading } = useWarehouse();

  const allPremises = all?.prems || [];
  const premises = filtered?.prems || [];
  const premiseSyncStatus =
    sync?.premises?.status ||
    (loading && allPremises.length === 0 ? "syncing" : "ready");
  const selectedWardPcode =
    sync?.scope?.wardPcode || sync?.premises?.wardPcode || "";
  const isWaitingForPremises = isWaitingForRows({
    status: premiseSyncStatus,
    loading,
    selectedWardPcode,
    rowCount: allPremises.length,
  });
  const selectedGeofence = selected?.geofence || null;
  const activeGeofenceLabel =
    selectedGeofence?.name || selectedGeofence?.id || "None";

  return (
    <>
      <WardScopeHeader
        showGeofenceLens
        geofenceClearLabel="All ward premises"
        stats={[
          {
            label: "Ward Premises",
            value: isWaitingForPremises ? (
              <InlineSpinner label="Loading..." />
            ) : premiseSyncStatus === "ready" ? (
              allPremises.length
            ) : (
              premiseSyncStatus
            ),
          },
          {
            label: "Visible Premises",
            value: premises.length,
          },
          {
            label: "Active Geofence",
            value: activeGeofenceLabel,
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
            <strong>
              {isWaitingForPremises ? (
                <InlineSpinner label={premiseSyncStatus} />
              ) : (
                premiseSyncStatus
              )}
            </strong>
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
        ) : isWaitingForPremises ? (
          <LoadingState
            title="Loading premises..."
            message="Please wait while the Ward Warehouse loads operational premises for the selected ward."
          />
        ) : premises.length === 0 ? (
          <div className="empty-state">
            <h2>No premises loaded</h2>
            <p className="muted">
              Premise sync status: {premiseSyncStatus}. If this remains empty,
              we will check the Firestore query/index for premises.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>SUBURB NAME</th>
                  <th>ERF No</th>
                  <th>Property Type</th>
                  <th>Property Name</th>
                  <th>Unit No</th>
                  {/* <th>Occupancy</th> */}
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
                    <td>{getSuburb(premise)}</td>
                    <td title={getErfId(premise)}>{getErfNo(premise)}</td>
                    <td>{getPropertyType(premise)}</td>
                    <td>{getPropertyName(premise)}</td>
                    <td>{getUnitNo(premise)}</td>
                    {/* <td>{getOccupancyStatus(premise)}</td> */}
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
