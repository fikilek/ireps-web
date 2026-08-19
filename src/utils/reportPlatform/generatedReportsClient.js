function requireIdentity(report) {
  const reportId = report?.lifecycle?.reportId;
  const reportType = report?.report?.reportType;
  const fileName = report?.report?.fileName;

  if (
    typeof reportId !== "string" ||
    !reportId ||
    typeof reportType !== "string" ||
    !reportType ||
    typeof fileName !== "string" ||
    !fileName
  ) {
    throw new TypeError("Generated report identity is incomplete.");
  }

  return {
    reportId,
    reportType,
    fileName,
  };
}

function assertListResult(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.reports)) {
    throw new Error("Generated Reports listing returned an invalid response.");
  }

  if (
    result.nextPageToken !== null &&
    result.nextPageToken !== undefined &&
    typeof result.nextPageToken !== "string"
  ) {
    throw new Error("Generated Reports listing returned an invalid page token.");
  }

  return {
    reports: result.reports,
    nextPageToken: result.nextPageToken || null,
  };
}

function assertDownloadResult(result) {
  if (
    !result ||
    typeof result !== "object" ||
    typeof result.downloadUrl !== "string" ||
    !result.downloadUrl
  ) {
    throw new Error("Generated report download authorization returned an invalid response.");
  }

  return result;
}

export function createGeneratedReportsClient({
  list,
  authorizeDownload,
  deleteReport,
} = {}) {
  if (
    typeof list !== "function" ||
    typeof authorizeDownload !== "function" ||
    typeof deleteReport !== "function"
  ) {
    throw new TypeError("Generated Reports client dependencies are incomplete.");
  }

  return {
    async listPage({ pageSize = 50, pageToken = null } = {}) {
      const payload = { pageSize };
      if (pageToken) payload.pageToken = pageToken;
      return assertListResult(await list(payload));
    },

    async getDownload(report) {
      const identity = requireIdentity(report);
      return assertDownloadResult(await authorizeDownload(identity));
    },

    async delete(report) {
      const identity = requireIdentity(report);
      const result = await deleteReport(identity);

      if (!result || result.deleted !== true || result.reportId !== identity.reportId) {
        throw new Error("Generated report deletion returned an invalid response.");
      }

      return result;
    },
  };
}

let firebaseClientPromise = null;

async function createFirebaseGeneratedReportsClient() {
  const [functionsModule, firebaseModule] = await Promise.all([
    import("firebase/functions"),
    import("../../firebase/index.js"),
  ]);

  const listCallable = functionsModule.httpsCallable(
    firebaseModule.functions,
    "listGeneratedReportsCallable",
  );
  const downloadCallable = functionsModule.httpsCallable(
    firebaseModule.functions,
    "getGeneratedReportDownloadCallable",
  );
  const deleteCallable = functionsModule.httpsCallable(
    firebaseModule.functions,
    "deleteGeneratedReportCallable",
  );

  return createGeneratedReportsClient({
    async list(payload) {
      const result = await listCallable(payload);
      return result.data;
    },

    async authorizeDownload(payload) {
      const result = await downloadCallable(payload);
      return result.data;
    },

    async deleteReport(payload) {
      const result = await deleteCallable(payload);
      return result.data;
    },
  });
}

async function getFirebaseGeneratedReportsClient() {
  if (!firebaseClientPromise) {
    firebaseClientPromise = createFirebaseGeneratedReportsClient();
  }

  return firebaseClientPromise;
}

export async function listGeneratedReportsPage(options = {}) {
  const client = await getFirebaseGeneratedReportsClient();
  return client.listPage(options);
}

export async function authorizeGeneratedReportDownload(report) {
  const client = await getFirebaseGeneratedReportsClient();
  return client.getDownload(report);
}

export async function deleteGeneratedReport(report) {
  const client = await getFirebaseGeneratedReportsClient();
  return client.delete(report);
}
