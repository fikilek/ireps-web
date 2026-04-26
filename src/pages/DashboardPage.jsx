import { useAuth } from "../auth/useAuth";

export default function DashboardPage() {
  const {
    email,
    profile,
    role,
    serviceProvider,
    activeWorkbase,
    workbases,
    onboardingStatus,
    isSPU,
    isADM,
    isMNG,
    isSPV,
    isFWR,
  } = useAuth();

  const displayName =
    profile?.displayName ||
    profile?.name ||
    profile?.personal?.displayName ||
    profile?.personal?.fullName ||
    email ||
    "iREPS User";

  const serviceProviderName =
    serviceProvider?.name || serviceProvider?.id || "NAv";

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Welcome</p>
          <h1>{displayName}</h1>
          <p className="muted">{email}</p>
        </div>

        <div className="role-pill">{role || "NAv"}</div>
      </header>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>Role</span>
          <strong>{role || "NAv"}</strong>
        </div>

        <div className="stat-card">
          <span>Service Provider</span>
          <strong>{serviceProviderName}</strong>
        </div>

        <div className="stat-card">
          <span>Active Workbase</span>
          <strong>{activeWorkbaseName}</strong>
        </div>

        <div className="stat-card">
          <span>Onboarding</span>
          <strong>{onboardingStatus || "NAv"}</strong>
        </div>
      </section>

      <section className="panel">
        <h2>Role flags</h2>

        <div className="flag-grid">
          <span className={isSPU ? "flag-on" : "flag-off"}>SPU</span>
          <span className={isADM ? "flag-on" : "flag-off"}>ADM</span>
          <span className={isMNG ? "flag-on" : "flag-off"}>MNG</span>
          <span className={isSPV ? "flag-on" : "flag-off"}>SPV</span>
          <span className={isFWR ? "flag-on" : "flag-off"}>FWR</span>
        </div>
      </section>

      <section className="panel">
        <h2>Foundation check</h2>

        <p>
          Firebase Auth is connected. The user profile is streaming from
          users/&#123;uid&#125;. Role and onboarding guards are active.
        </p>

        <p className="muted">
          Workbases available: {Array.isArray(workbases) ? workbases.length : 0}
        </p>
      </section>
    </>
  );
}
