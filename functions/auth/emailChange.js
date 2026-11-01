// AU-R001 11: changing a sign-in email. One email per person — the sign-in email is their email in
// iREPS, and the record follows it.

export function normaliseEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ""));
}

function roleOf(user) {
  return String(user?.employment?.role || "").trim().toUpperCase();
}

function serviceProviderIdOf(user) {
  return String(user?.employment?.serviceProvider?.id || "").trim();
}

// AU-R001 11.2: who may change whose sign-in email, straight away and without a link.
//
//   SPU      anybody's
//   Admin    anybody's but the SPU's
//   Manager  field workers and supervisors of the manager's own service providers
//   Others   nobody's
//
// Nobody changes their own this way — their own goes through Account Settings and its link.
export function mayChangeEmailOf({
  callerUid,
  caller,
  targetUid,
  target,
  managerServiceProviderIds = [],
}) {
  if (!callerUid || !targetUid) return { allowed: false, reason: "not-yours" };
  if (callerUid === targetUid) return { allowed: false, reason: "own" };

  const callerRole = roleOf(caller);
  const targetRole = roleOf(target);

  if (callerRole === "SPU") return { allowed: true, reason: null };

  if (callerRole === "ADM") {
    return targetRole === "SPU"
      ? { allowed: false, reason: "not-yours" }
      : { allowed: true, reason: null };
  }

  if (callerRole === "MNG") {
    const managed = ["FWR", "SPV"].includes(targetRole);
    const inTree = managerServiceProviderIds.includes(serviceProviderIdOf(target));

    return managed && inTree
      ? { allowed: true, reason: null }
      : { allowed: false, reason: "not-yours" };
  }

  return { allowed: false, reason: "not-yours" };
}
