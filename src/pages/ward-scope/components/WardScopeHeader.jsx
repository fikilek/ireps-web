import { useGeo } from "../../../context/GeoContext";
import { useWarehouse } from "../../../context/WarehouseContext";

const getWardPcode = (ward) => ward?.id || ward?.pcode || ward?.wardPcode || "";

const getWardLabel = (ward) => {
  if (!ward) return "NAv";

  return ward?.name || `Ward ${ward?.code || ward?.wardNumber || "NAv"}`;
};

const getGeofenceLabel = (geofence) => {
  return geofence?.name || geofence?.id || "NAv";
};

export default function WardScopeHeader({
  stats = [],
  showGeofenceLens = false,
  geofenceClearLabel = "All ward data",
}) {
  const { geoState, updateGeo } = useGeo();
  const { available, all, scope, selected } = useWarehouse();

  const wards = available?.wards || [];
  const geofences = all?.geofences || [];

  const selectedWardPcode =
    scope?.wardPcode || getWardPcode(geoState?.selectedWard);

  const selectedGeofenceId = scope?.selectedGeofenceId || "";

  const selectedWard = selected?.ward || geoState?.selectedWard || null;
  const selectedGeofence =
    selected?.geofence || geoState?.selectedGeofence || null;

  function handleWardChange(event) {
    const wardPcode = event.target.value;

    if (!wardPcode) {
      updateGeo({
        selectedWard: null,
        lastSelectionType: null,
      });

      return;
    }

    const ward = wards.find((item) => getWardPcode(item) === wardPcode);

    updateGeo({
      selectedWard: ward || {
        id: wardPcode,
        pcode: wardPcode,
        wardPcode,
        name: `Ward ${wardPcode}`,
      },
      selectedGeofence: null,
      lastSelectionType: "WARD",
    });
  }

  function handleGeofenceChange(event) {
    const geofenceId = event.target.value;

    if (!geofenceId) {
      updateGeo({
        selectedGeofence: null,
        lastSelectionType: null,
      });

      return;
    }

    const geofence = geofences.find((item) => item?.id === geofenceId) || {
      id: geofenceId,
    };

    updateGeo({
      selectedGeofence: geofence,
      lastSelectionType: "GEOFENCE",
    });
  }

  return (
    <section className="ward-scope-header-compact">
      <div className="ward-scope-controls">
        <label className="compact-field">
          <span>Ward</span>

          <select value={selectedWardPcode || ""} onChange={handleWardChange}>
            <option value="">Select ward</option>

            {wards.map((ward) => {
              const wardPcode = getWardPcode(ward);

              return (
                <option key={wardPcode} value={wardPcode}>
                  {getWardLabel(ward)} · {wardPcode}
                </option>
              );
            })}
          </select>
        </label>

        {showGeofenceLens ? (
          <label className="compact-field">
            <span>Geofence</span>

            <select
              value={selectedGeofenceId}
              onChange={handleGeofenceChange}
              disabled={!selectedWardPcode}
            >
              <option value="">{geofenceClearLabel}</option>

              {geofences.map((geofence) => (
                <option key={geofence.id} value={geofence.id}>
                  {getGeofenceLabel(geofence)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="ward-scope-stats">
        {stats.map((stat) => (
          <div className="stat-card ward-scope-stat-card" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>

      <div className="ward-scope-mini-summary">
        <span>{selectedWard ? getWardLabel(selectedWard) : "No ward"}</span>
        {showGeofenceLens ? (
          <strong>
            {selectedGeofence
              ? getGeofenceLabel(selectedGeofence)
              : "No geofence"}
          </strong>
        ) : null}
      </div>
    </section>
  );
}
