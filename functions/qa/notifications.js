import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { fieldSubmitter, qaText } from "./model.js";
import { reviewAccess } from "./review.js";
import { getUserDisplayName } from "../teams/helpers.js";

export const notificationId = (trnId, eventId, uid) => createHash("sha256").update(JSON.stringify([trnId, eventId, uid])).digest("hex");
export const metadata = (uid, name, at) => ({ createdAt: at, createdByUid: uid, createdByUser: name,
  updatedAt: at, updatedByUid: uid, updatedByUser: name });

// Perform every read before writing the event. Stable IDs and the enclosing
// transaction make retries produce one notice and one email job per recipient.
export async function planQaNotices(tx, db, { context, trn, trnId, eventId, kind, at }) {
  let recipients = [];
  if (kind === "RETURNED") {
    const uid = fieldSubmitter(trn).uid;
    if (uid) recipients = [uid];
  } else if (kind === "UPDATED") {
    const users = await tx.get(db.collection("users").where("accountStatus", "==", "ACTIVE"));
    recipients = users.docs.filter(doc => reviewAccess({ actorUid: doc.id, actor: doc.data(), providers: context.providers, trn }).allowed).map(doc => doc.id);
    const previous = trn.qa?.reviewedByUid;
    if (recipients.includes(previous)) recipients = [previous];
  }
  const stamp = metadata(context.actorUid, getUserDisplayName(context.actor), at);
  return recipients.map(uid => ({ id: notificationId(trnId, eventId, uid), recipientUid: uid, trnId, eventId, kind,
    lmPcode: qaText(trn.accessData?.parents?.lmPcode) || null, wardPcode: qaText(trn.accessData?.parents?.wardPcode) || null,
    title: kind === "RETURNED" ? "QA returned work for correction" : "Corrected work is ready for QA",
    createdAt: at, readAt: null, emailStatus: "PENDING", metadata: stamp }));
}

export function writeQaNotices(tx, db, notices) {
  for (const notice of notices) {
    tx.create(db.doc(`qaNotifications/${notice.id}`), notice);
    tx.create(db.doc(`qaEmailOutbox/${notice.id}`), { id: notice.id, recipientUid: notice.recipientUid,
      notificationId: notice.id, trnId: notice.trnId, kind: notice.kind, status: "PENDING", attempts: 0,
      lmPcode: notice.lmPcode, wardPcode: notice.wardPcode,
      nextAttemptAt: notice.createdAt, metadata: notice.metadata });
  }
}

export async function markQaNoticeRead(db, uid, input) {
  const id = qaText(input.id);
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to read QA notifications.");
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpsError("invalid-argument", "Invalid notification.");
  return db.runTransaction(async tx => {
    const ref = db.doc(`qaNotifications/${id}`);
    const [notice, user] = await Promise.all([tx.get(ref), tx.get(db.doc(`users/${uid}`))]);
    if (!user.exists || user.data().accountStatus !== "ACTIVE" || !notice.exists || notice.data().recipientUid !== uid) throw new HttpsError("permission-denied", "This notification is unavailable.");
    if (!notice.data().readAt) { const at = new Date().toISOString(); tx.update(ref, { readAt: at,
      "metadata.updatedAt": at, "metadata.updatedByUid": uid, "metadata.updatedByUser": getUserDisplayName(user.data()) }); }
    return { success: true };
  });
}
