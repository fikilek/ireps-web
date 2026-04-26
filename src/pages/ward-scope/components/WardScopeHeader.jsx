import { useGeo } from "../../../context/GeoContext";
import { useWarehouse } from "../../../context/WarehouseContext";

const getWardPcode = (ward) => ward?.id || ward?.pcode || ward?.wardPcode || "";

const getWardLabel = (ward) => {
  if (!ward) return "NAv";

  return ward?.name || `Ward ${ward?.code || ward?.wardNumber || "NAv"}`;
};

export default function WardScopeHeader({ stats = [] }) {
  const { geoState, updateGeo } = useGeo();
  const { available, scope, selected } = useWarehouse();

  const wards = available?.wards || [];
  const selectedWardPcode = getWardPcode(geoState?.selectedWard);
  const selectedWard = selected?.ward || null;

  const selectedWardLabel = selectedWard
    ? `${getWardLabel(selectedWard)} · ${getWardPcode(selectedWard)}`
    : "No ward selected";

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
      lastSelectionType: "WARD",
    });
  }

  return (
    <section className="filter-panel ward-scope-header">
      <label>
        Ward
        <select value={selectedWardPcode} onChange={handleWardChange}>
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

      {stats.map((stat) => (
        <div className="stat-card ward-scope-stat-card" key={stat.label}>
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
        </div>
      ))}

      <div className="filter-summary ward-scope-summary">
        <strong>{selectedWardLabel}</strong>
        <span>
          LM: {scope?.lmPcode || "NAv"} · Ward:{" "}
          {scope?.wardPcode || "Not selected"}
        </span>
      </div>
    </section>
  );
}
