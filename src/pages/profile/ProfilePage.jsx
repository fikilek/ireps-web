import { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";

import { db } from "@/firebase";
import { useAuth } from "@/auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import {
  useGetAllLmsQuery,
  useGetLmBoundaryByIdQuery,
} from "@/redux/mapLmsApi";

function getWorkbaseId(workbase) {
  return workbase?.pcode || workbase?.id || "";
}

function getWorkbaseLabel(workbase) {
  const name = workbase?.name || "Unnamed LM";
  const id = getWorkbaseId(workbase);

  return id ? `${name} (${id})` : name;
}

export default function ProfilePage() {
  const {
    uid,
    profile,
    email,
    role,
    isSPU,
    serviceProvider,
    activeWorkbase,
    workbases,
  } = useAuth();

  const { data: allLms = [] } = useGetAllLmsQuery(undefined, {
    skip: !isSPU,
  });
  // console.log(`allLms`, allLms);

  const availableWorkbases = useMemo(() => {
    if (isSPU) return allLms;
    return workbases || [];
  }, [isSPU, allLms, workbases]);
  console.log(`availableWorkbases`, availableWorkbases);

  const { updateGeo } = useGeo();

  const [selectedWorkbaseId, setSelectedWorkbaseId] = useState(
    getWorkbaseId(activeWorkbase),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const activeWorkbaseId = getWorkbaseId(activeWorkbase);

  const selectedWorkbase = useMemo(() => {
    return availableWorkbases.find(
      (workbase) => getWorkbaseId(workbase) === selectedWorkbaseId,
    );
  }, [availableWorkbases, selectedWorkbaseId]);

  const hasChanged =
    selectedWorkbaseId && selectedWorkbaseId !== activeWorkbaseId;

  async function handleSwitchWorkbase() {
    if (!uid || !selectedWorkbase || !hasChanged) return;

    try {
      setSaving(true);
      setMessage("");

      const normalizedWorkbase = {
        ...selectedWorkbase,
        id: getWorkbaseId(selectedWorkbase),
      };

      await updateDoc(doc(db, "users", uid), {
        "access.activeWorkbase": normalizedWorkbase,
      });

      updateGeo({
        selectedLm: normalizedWorkbase,
        selectedWard: null,
        selectedGeofence: null,
        selectedErf: null,
        selectedPremise: null,
        selectedMeter: null,
        lastSelectionType: "LM",
      });

      setMessage("Active workbase updated.");
    } catch (error) {
      console.error("ProfilePage workbase switch error:", error);
      setMessage("Could not update active workbase.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>
              {profile?.displayName ||
                profile?.name ||
                profile?.fullName ||
                email ||
                "User Profile"}
            </h1>
            <p style={styles.subtitle}>
              Read-only profile. Workbase switching only.
            </p>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.row}>
            <span style={styles.label}>Email</span>
            <span style={styles.value}>{email || "NAv"}</span>
          </div>

          <div style={styles.row}>
            <span style={styles.label}>Role</span>
            <span style={styles.value}>{role || "NAv"}</span>
          </div>

          <div style={styles.row}>
            <span style={styles.label}>Service Provider</span>
            <span style={styles.value}>
              {serviceProvider?.name || serviceProvider?.id || "NAv"}
            </span>
          </div>
        </div>

        <div style={styles.section}>
          <label style={styles.label}>Active Workbase</label>

          <select
            value={selectedWorkbaseId}
            onChange={(event) => setSelectedWorkbaseId(event.target.value)}
            style={styles.select}
            disabled={saving}
          >
            <option value="">Select workbase</option>

            {availableWorkbases.map((workbase) => {
              const id = getWorkbaseId(workbase);

              return (
                <option key={id} value={id}>
                  {getWorkbaseLabel(workbase)}
                </option>
              );
            })}
          </select>

          <button
            type="button"
            onClick={handleSwitchWorkbase}
            disabled={!hasChanged || saving}
            style={{
              ...styles.button,
              opacity: !hasChanged || saving ? 0.55 : 1,
              cursor: !hasChanged || saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Switching..." : "Switch Workbase"}
          </button>

          {message ? <p style={styles.message}>{message}</p> : null}
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Available Workbases</h2>

          {availableWorkbases.length === 0 ? (
            <p style={styles.emptyText}>No workbases assigned.</p>
          ) : (
            <ul style={styles.list}>
              {availableWorkbases.map((workbase) => {
                const id = getWorkbaseId(workbase);
                const isActive = id === activeWorkbaseId;

                return (
                  <li key={id} style={styles.listItem}>
                    <span>{getWorkbaseLabel(workbase)}</span>
                    {isActive ? (
                      <strong style={styles.activeTag}>Active</strong>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    padding: 24,
  },
  card: {
    maxWidth: 760,
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 24,
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 24,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 800,
    color: "#0f172a",
  },
  subtitle: {
    margin: "6px 0 0",
    color: "#64748b",
  },
  section: {
    borderTop: "1px solid #e5e7eb",
    paddingTop: 18,
    marginTop: 18,
  },
  sectionTitle: {
    margin: "0 0 12px",
    fontSize: 16,
    color: "#0f172a",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    padding: "10px 0",
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    color: "#475569",
    marginBottom: 8,
  },
  value: {
    color: "#0f172a",
    fontWeight: 600,
  },
  select: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    fontSize: 15,
    marginBottom: 14,
  },
  button: {
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 800,
  },
  message: {
    marginTop: 12,
    color: "#334155",
    fontWeight: 600,
  },
  list: {
    padding: 0,
    margin: 0,
    listStyle: "none",
  },
  listItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 0",
    borderBottom: "1px solid #f1f5f9",
  },
  activeTag: {
    color: "#16a34a",
    fontSize: 13,
  },
  emptyText: {
    color: "#64748b",
  },
};
