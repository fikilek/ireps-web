export const NO_TEAM = "None";
export const USERS_DEFAULT_SORT = { key: "surname", direction: "asc" };

export function userRealValue(value) {
  const text = String(value ?? "").trim();
  return text.toUpperCase() === "NAV" ? "" : text;
}

export function userStatusLabel(status) {
  const value = String(status ?? "").trim().toUpperCase();
  if (value === "ACTIVE" || value === "ENABLED") return "Enabled";
  if (value === "DISABLED" || value === "INACTIVE") return "Disabled";
  return value || "NAv";
}

export function usersTableSearchValue(user) {
  return `${userRealValue(user.displayName)} ${userRealValue(user.email)}`;
}

// Domain values stay separate from the cell controls and exported labels.
export function usersTableColumns({ options = {}, teamsUnavailable = false } = {}) {
  return [
    { key: "surname", label: "Surname", filter: "text" },
    { key: "name", label: "Name", filter: "text" },
    { key: "email", label: "Email", filter: "text" },
    { key: "role", label: "Role", filter: "select" },
    { key: "serviceProviderName", label: "Service Provider", filter: "select" },
    {
      key: "teams", label: "Team", filter: "select",
      value: user => teamsUnavailable ? "" : (user.teams || []).join(", "),
      filterValues: user => user.teams?.length ? user.teams : [NO_TEAM],
      filterDisabled: teamsUnavailable,
      exportValue: user => teamsUnavailable ? "NAv" : user.teams?.length ? user.teams.join(", ") : NO_TEAM,
    },
    {
      key: "accountStatus", label: "Account Status", filter: "select",
      sortValue: user => userRealValue(userStatusLabel(user.accountStatus)),
      exportValue: user => userStatusLabel(user.accountStatus),
    },
    { key: "onboardingStatus", label: "Onboarding Status", filter: "select" },
  ].map(column => ({
    value: user => {
      const value = userRealValue(user[column.key]);
      return ["role", "accountStatus", "onboardingStatus"].includes(column.key) ? value.toUpperCase() : value;
    },
    sortEmptyLast: true,
    filterOptions: options[column.key],
    ...column,
  }));
}
