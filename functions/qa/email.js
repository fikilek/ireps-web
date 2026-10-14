import { randomUUID } from "node:crypto";
import { reviewAccess } from "./review.js";
import { fieldSubmitter } from "./model.js";

const MAX_ATTEMPTS = 5;
const systemStamp = at => ({ "metadata.updatedAt": at, "metadata.updatedByUid": "SYSTEM:QA_EMAIL", "metadata.updatedByUser": "iREPS QA email delivery" });
// A timeout after DATA might mean the mail server accepted the message. It
// must never cause a blind resend, even though its outcome is uncertain.
export function deliveryFailure(error, attempts) {
  const smtp = Number(error?.responseCode);
  const beforeData = ["CONN", "EHLO", "HELO", "STARTTLS", "AUTH", "MAIL FROM", "RCPT TO"].some(command => String(error?.command || "").startsWith(command));
  const rejected = Number.isInteger(smtp) && smtp >= 400 && smtp <= 599;
  const preconnect = ["EDNS", "ECONNECTION", "EAUTH"].includes(error?.code);
  if (!rejected && !beforeData && !preconnect) return "UNCERTAIN";
  if (attempts >= MAX_ATTEMPTS || (rejected && smtp >= 500)) return "FAILED";
  return "RETRY";
}

export async function deliverQaEmail(db, id, { auth, sendMail, clock = () => new Date() }) {
  const ref = db.doc(`qaEmailOutbox/${id}`), noticeRef = db.doc(`qaNotifications/${id}`);
  const token = randomUUID(), now = clock().toISOString();
  const job = await db.runTransaction(async tx => {
    const found = await tx.get(ref);
    if (!found.exists) return null;
    const job = found.data();
    if (job.status === "SENDING" && job.leaseUntil <= now) {
      tx.update(ref, { status: "UNCERTAIN", ...systemStamp(now) });
      tx.update(noticeRef, { emailStatus: "UNCERTAIN", ...systemStamp(now) }); return null;
    }
    if (!["PENDING", "RETRY"].includes(job.status) || job.nextAttemptAt > now) return null;
    const attempts = (job.attempts || 0) + 1;
    tx.update(ref, { status: "SENDING", attempts, attemptId: token, leaseUntil: new Date(Date.parse(now) + 180000).toISOString(), ...systemStamp(now) });
    tx.update(noticeRef, { emailStatus: "SENDING", ...systemStamp(now) });
    return { ...job, attempts };
  });
  if (!job) return { processed: false };
  let status = "SENT", errorCode = null, sendStarted = false;
  try {
    const [account, user, trn, providerDocs] = await Promise.all([auth.getUser(job.recipientUid), db.doc(`users/${job.recipientUid}`).get(), db.doc(`trns/${job.trnId}`).get(), db.collection("serviceProviders").get()]);
    const providers = providerDocs.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    const authorised = user.exists && user.data().accountStatus === "ACTIVE" && trn.exists && !account.disabled
      && (job.kind === "RETURNED" ? fieldSubmitter(trn.data()).uid === job.recipientUid : reviewAccess({ actorUid: job.recipientUid, actor: user.data(), providers, trn: trn.data() }).allowed);
    if (!authorised) status = "SKIPPED_ACCESS";
    else if (!account.email || !account.emailVerified || /[\r\n]/.test(account.email)) status = "SKIPPED_EMAIL";
    else {
      sendStarted = true;
      const result = await sendMail({ to: account.email, messageId: `<qa-${id}@ireps.co.za>`,
        subject: job.kind === "RETURNED" ? "iREPS: work returned for correction" : "iREPS: corrected work ready for QA",
        text: job.kind === "RETURNED" ? "A transaction has been returned for correction. Sign in to iREPS and open QA returned work to read the review and correct the saved form."
          : "A corrected transaction is ready for quality assurance. Sign in to iREPS and open your QA notifications to review it." });
      if (result?.rejected?.length || !result?.accepted?.length) { const error = new Error("Recipient not accepted"); error.responseCode = 550; throw error; }
    }
  } catch (error) {
    errorCode = String(error.code || "EMAIL_ERROR").slice(0, 80);
    // Auth/read failures happen before delivery. They are safe to retry.
    status = error.code === "auth/user-not-found" ? "SKIPPED_ACCESS" : !sendStarted
      ? (job.attempts < MAX_ATTEMPTS ? "RETRY" : "FAILED") : deliveryFailure(error, job.attempts);
  }
  const finishedAt = clock().toISOString();
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.data()?.attemptId !== token || current.data()?.status !== "SENDING") return;
    tx.update(ref, { status, errorCode, completedAt: finishedAt,
      nextAttemptAt: status === "RETRY" ? new Date(Date.parse(finishedAt) + Math.min(3600000, 60000 * 2 ** job.attempts)).toISOString() : null, ...systemStamp(finishedAt) });
    tx.update(noticeRef, { emailStatus: status, ...systemStamp(finishedAt) });
  });
  return { processed: true, status };
}
