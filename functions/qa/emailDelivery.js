import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import nodemailer from "nodemailer";
import { REPORT_EMAIL_FROM_ADDRESS, REPORT_SMTP_HOST, REPORT_SMTP_PORT } from "../reportPlatform/emailDelivery.js";
import { deliverQaEmail } from "./email.js";

const password = defineSecret("IREPS_REPORT_SMTP_PASSWORD");
const options = { secrets: [password], timeoutSeconds: 120 };
function transport() {
  return nodemailer.createTransport({ host: REPORT_SMTP_HOST, port: REPORT_SMTP_PORT, secure: true,
    auth: { user: REPORT_EMAIL_FROM_ADDRESS, pass: password.value() }, tls: { servername: REPORT_SMTP_HOST },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    disableFileAccess: true, disableUrlAccess: true });
}
async function deliver(id, smtp) {
  return deliverQaEmail(getFirestore(), id, { auth: getAuth(), sendMail: mail => smtp.sendMail({ ...mail,
    from: { name: "iREPS QA", address: REPORT_EMAIL_FROM_ADDRESS } }) });
}
export const onQaEmailQueued = onDocumentCreated({ ...options, document: "qaEmailOutbox/{id}", retry: true }, async event => {
  const smtp = transport();
  try { await deliver(event.params.id, smtp); } finally { smtp.close(); }
});
export const retryQaEmails = onSchedule({ ...options, schedule: "every 5 minutes" }, async () => {
  const db = getFirestore(), smtp = transport(), now = new Date().toISOString();
  try {
    for (const [statuses, timeKey] of [[["PENDING", "RETRY"], "nextAttemptAt"], [["SENDING"], "leaseUntil"]]) {
      const jobs = await db.collection("qaEmailOutbox").where("status", "in", statuses).where(timeKey, "<=", now).orderBy(timeKey).limit(5).get();
      await Promise.all(jobs.docs.map(job => deliver(job.id, smtp)));
    }
  } finally { smtp.close(); }
});
