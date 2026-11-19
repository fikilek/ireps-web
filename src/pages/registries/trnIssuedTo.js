function cleanText(value) {
  const text = String(value ?? "").trim();
  return text && text.toUpperCase() !== "NAV" ? text : "";
}

export function normalizeTargetType(type) {
  const upper = cleanText(type).toUpperCase();
  return upper || "USER";
}

export function formatTargetLabel(target = {}) {
  const name = cleanText(target.name || target.displayName || target.label) || cleanText(target.id);
  if (!name) return "";
  const type = normalizeTargetType(target.type || target.targetType);
  if (type === "TEAM" || type === "SP") {
    return `${type}: ${name}`;
  }
  return name;
}

export function formatIssuedToText(targets = []) {
  if (!Array.isArray(targets) || targets.length === 0) return "NAv";
  const labels = targets.map(formatTargetLabel).filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : "NAv";
}

export function buildMemberLookups({ users = [], teams = [] } = {}) {
  const usersByUid = new Map();
  const usersBySpId = new Map();
  const teamsById = new Map();

  users.forEach((user) => {
    const uid = cleanText(user?.uid || user?.id);
    if (!uid) return;
    usersByUid.set(uid, user);

    const spId = cleanText(
      user?.serviceProviderId || user?.raw?.employment?.serviceProvider?.id,
    );
    if (spId) {
      if (!usersBySpId.has(spId)) usersBySpId.set(spId, []);
      usersBySpId.get(spId).push(user);
    }
  });

  teams.forEach((team) => {
    const id = cleanText(team?.id);
    if (id) teamsById.set(id, team);
  });

  return { usersByUid, usersBySpId, teamsById };
}

function formatMemberEntry(user, fallbackUid = "") {
  if (!user) {
    return { uid: fallbackUid, name: fallbackUid || "Unknown User", role: "" };
  }
  const uid = cleanText(user.uid || user.id) || fallbackUid;
  const name =
    cleanText(user.displayName || user.name || user.email) || uid || "Unknown User";
  const role = cleanText(user.role || user?.raw?.employment?.role);
  return { uid, name, role };
}

export function resolveTargetMembers({
  target = {},
  usersByUid = new Map(),
  usersBySpId = new Map(),
  teamsById = new Map(),
} = {}) {
  const type = normalizeTargetType(target.type || target.targetType);
  const id = cleanText(target.id || target.uid);
  if (!id || (type !== "TEAM" && type !== "SP")) return [];

  if (type === "TEAM") {
    const team = teamsById.get(id);
    const memberUids = Array.isArray(team?.memberUserIds) ? team.memberUserIds : [];
    return memberUids
      .map((uid) => cleanText(uid))
      .filter(Boolean)
      .map((uid) => formatMemberEntry(usersByUid.get(uid), uid))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const spUsers = usersBySpId.get(id) || [];
  return spUsers
    .map((user) => formatMemberEntry(user))
    .sort((a, b) => a.name.localeCompare(b.name));
}
