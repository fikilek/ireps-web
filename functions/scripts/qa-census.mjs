// Read-only readiness check. Never writes remote data or prints credentials.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { qaEligibility, fieldSubmitter } from "../qa/model.js";
import { reviewAccess } from "../qa/review.js";
const app = initializeApp({ credential: applicationDefault(), projectId: "ireps2" });
const db = getFirestore(app);
const [usersSnap, providersSnap, trnsSnap, collections] = await Promise.all([
  db.collection("users").get(), db.collection("serviceProviders").get(), db.collection("trns").get(), db.listCollections(),
]);
const users = usersSnap.docs.map(doc => ({ ...doc.data(), uid: doc.id }));
const providers = providersSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
const trns = trnsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
const countBy = (items, select) => items.reduce((out, item) => { const key = select(item) || "MISSING"; out[key] = (out[key] || 0) + 1; return out; }, {});
const eligible = trns.filter(t => qaEligibility(t).eligible);
console.log(JSON.stringify({ project: "ireps2", collections: collections.map(c => c.id), total: trns.length,
  eligibility: countBy(trns, t => qaEligibility(t).label), provider: countBy(eligible, t => t.serviceProvider?.id),
  submitterMissing: eligible.filter(t => !fieldSubmitter(t).uid).length,
  captureMissing: eligible.filter(t => !t.metadata?.createdOnDevice).length,
  mediaPaths: countBy(trns.flatMap(t => Array.isArray(t.media) ? t.media : []), m => { try { const u = new URL(m.url); return u.hostname + ' ' + decodeURIComponent(u.pathname).split('/').slice(0, 7).join('/'); } catch { return 'NO_URL'; } }),
  mediaExample: eligible.find(t => t.media?.length)?.media?.slice(0, 1).map(m => ({ keys: Object.keys(m), uriFields: Object.keys(m).filter(k => typeof m[k] === "string" && m[k].startsWith("http")) })),
  reviewers: users.filter(u => ["MNG", "SPV"].includes(u.employment?.role)).map(actor => ({ uid: actor.uid, name: actor.profile?.displayName, role: actor.employment?.role, status: actor.accountStatus, providerId: actor.employment?.serviceProvider?.id,
    allowed: eligible.filter(trn => reviewAccess({ actorUid: actor.uid, actor, providers, trn }).allowed).length,
    refusalReasons: countBy(eligible, trn => reviewAccess({ actorUid: actor.uid, actor, providers, trn }).reason || "Allowed"),
    workbaseExample: actor.access?.workbases?.[0],
  })),
}, null, 2));
await db.terminate();
