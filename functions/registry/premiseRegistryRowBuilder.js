export const buildPremiseRegistryRow = (premiseId, premise = {}) => {
  const sourceMeta = premise?.metadata || {};

  const now = new Date().toISOString();

  const createdAt = sourceMeta?.createdAt || now;
  const createdByUid = sourceMeta?.createdByUid || "SYSTEM";
  const createdByUser = sourceMeta?.createdByUser || "SYSTEM";

  return {
    premiseId,
    erfId: premise?.erfId || "NAv",
    erfNo: premise?.erfNo || "NAv",

    address: {
      strNo: premise?.address?.strNo || "NAv",
      strName: premise?.address?.strName || "NAv",
      strType: premise?.address?.strType || "NAv",
    },

    propertyType: {
      name: premise?.propertyType?.name || "NAv",
      type: premise?.propertyType?.type || "NAv",
      unitNo: premise?.propertyType?.unitNo || "NAv",
    },

    occupancy: {
      status: premise?.occupancy?.status || "NAv",
    },

    counts: {
      electricityMeters: 0,
      waterMeters: 0,
      totalMeters: 0,
    },

    parents: {
      countryPcode: premise?.parents?.countryPcode || "NAv",
      provincePcode: premise?.parents?.provincePcode || "NAv",
      dmPcode: premise?.parents?.dmPcode || "NAv",
      lmPcode: premise?.parents?.lmPcode || "NAv",
      wardPcode: premise?.parents?.wardPcode || "NAv",
    },

    metadata: {
      createdAt,
      createdByUid,
      createdByUser,
      updatedAt: new Date().toISOString(),
      updatedByUid: "SYSTEM",
      updatedByUser: "Premise Registry Sync",
    },
  };
};
