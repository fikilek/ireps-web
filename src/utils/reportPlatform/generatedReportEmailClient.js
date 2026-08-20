function requireReportIdentity(report) {
  const reportId = report?.lifecycle?.reportId || report?.reportId;
  const reportType = report?.report?.reportType || report?.reportType;
  const fileName = report?.report?.fileName || report?.fileName;

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

  return { reportId, reportType, fileName };
}

function assertEmailResult(result, reportId) {
  if (
    !result ||
    typeof result !== "object" ||
    result.sent !== true ||
    result.reportId !== reportId ||
    typeof result.sentAt !== "string" ||
    !result.sentAt
  ) {
    throw new Error("Report email delivery returned an invalid response.");
  }

  return result;
}

export function createGeneratedReportEmailClient({ send } = {}) {
  if (typeof send !== "function") {
    throw new TypeError("Generated report email client dependencies are incomplete.");
  }

  return {
    async send({ report, to, subject, message = "" }) {
      const identity = requireReportIdentity(report);
      const result = await send({
        ...identity,
        to,
        subject,
        message,
      });

      return assertEmailResult(result, identity.reportId);
    },
  };
}

let firebaseClientPromise = null;

async function createFirebaseGeneratedReportEmailClient() {
  const [functionsModule, firebaseModule] = await Promise.all([
    import("firebase/functions"),
    import("../../firebase/index.js"),
  ]);

  const sendCallable = functionsModule.httpsCallable(
    firebaseModule.functions,
    "sendGeneratedReportEmailCallable",
  );

  return createGeneratedReportEmailClient({
    async send(payload) {
      const result = await sendCallable(payload);
      return result.data;
    },
  });
}

async function getFirebaseGeneratedReportEmailClient() {
  if (!firebaseClientPromise) {
    firebaseClientPromise = createFirebaseGeneratedReportEmailClient();
  }

  return firebaseClientPromise;
}

export async function sendGeneratedReportEmail(options) {
  const client = await getFirebaseGeneratedReportEmailClient();
  return client.send(options);
}
