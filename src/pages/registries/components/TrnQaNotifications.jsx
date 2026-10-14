import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../firebase";
import { qaDate } from "../../../utils/qaDisplay.js";

export default function TrnQaNotifications({ uid, onOpen }) {
  const [items, setItems] = useState([]), [error, setError] = useState("");
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(query(collection(db, "qaNotifications"), where("recipientUid", "==", uid)), snapshot => {
      setItems(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }, failure => setError(failure.message));
  }, [uid]);
  const unread = items.filter(item => !item.readAt).length;
  return <details className="qa-notifications"><summary>QA notifications{unread ? ` (${unread} unread)` : ""}</summary>
    {error && <p role="alert">{error}</p>}
    {!items.length && <p>No QA notifications yet.</p>}
    {items.map(item => <article key={item.id} style={{ padding: "12px 0", borderBottom: "1px solid #d6e0ed" }}>
      <p><strong>{item.title}</strong> · {qaDate(item.createdAt)}</p><p>{item.trnId}</p>
      {["FAILED", "UNCERTAIN", "SKIPPED_EMAIL", "RETRY"].includes(item.emailStatus) && <p>{item.emailStatus === "UNCERTAIN" ? "Email delivery is unconfirmed; no automatic resend." : item.emailStatus === "RETRY" ? "Email retry pending." : item.emailStatus === "SKIPPED_EMAIL" ? "Email could not be sent to a verified address." : "Email delivery failed."} This in-app notice remains available.</p>}
      {item.kind === "RETURNED" && <p>Open QA returned work in the iREPS mobile app to correct this submission.</p>}
      <button type="button" onClick={() => onOpen(item.trnId)}>Review / history</button>{" "}
      {!item.readAt && <button type="button" onClick={async () => {
        try { await httpsCallable(functions, "markTrnQaNoticeRead")({ id: item.id }); }
        catch (failure) { setError(failure.message); }
      }}>Mark read</button>}
    </article>)}
  </details>;
}
