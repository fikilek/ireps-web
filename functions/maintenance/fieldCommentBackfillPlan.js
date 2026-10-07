// Only restore absent fields; an existing empty value is still an existing value.
export function planFieldCommentBackfill(data = {}) {
  if (data.accessData?.trnType !== "METER_DISCOVERY" || data.accessData?.access?.hasAccess !== "yes") {
    return { status: "OUT_OF_SCOPE", patch: {} };
  }
  if (!Object.hasOwn(data, "fieldComment")) {
    return { status: "UPDATE", patch: { fieldComment: { text: "NAv" } } };
  }
  const value = data.fieldComment;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { status: "HOLD", reason: "Existing fieldComment is not a map", patch: {} };
  }
  if (!Object.hasOwn(value, "text")) {
    return { status: "UPDATE", patch: { "fieldComment.text": "NAv" } };
  }
  return { status: "UNCHANGED", patch: {} };
}

export function assertFieldCommentBackfillProject(project, credentialProject) {
  // Extend only when the owner authorizes the next environment's promotion.
  if (project !== "ireps2" || credentialProject !== project) throw new Error("Only matching DEV (ireps2) credentials are allowed");
  return project;
}
