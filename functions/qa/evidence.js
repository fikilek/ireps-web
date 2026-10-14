import { HttpsError } from "firebase-functions/v2/https";
import { createHash, randomUUID } from "node:crypto";
import { logger } from "firebase-functions";

// Storage rules use the final filename as a conservative, cross-folder lock.
// No downloads or requests to an arbitrary URL supplied in a field record.
export function evidenceObjects(trn, bucketName) {
  const objects = new Map();
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value.url === "string" && value.url.trim()) {
      let url;
      try { url = new URL(value.url); } catch { throw new HttpsError("failed-precondition", "This record contains an invalid evidence link. Its evidence needs checking before QA."); }
      const parts = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com" || !parts || decodeURIComponent(parts[1]) !== bucketName) {
        throw new HttpsError("failed-precondition", "This record has evidence outside this iREPS environment. Its evidence needs checking before QA.");
      }
      const path = decodeURIComponent(parts[2]);
      const segments = path.split("/");
      const supported = (segments.length === 3 && ["meters", "premises", "informal_erfs", "lifecycleInstructions"].includes(segments[0]))
        || (segments.length === 4 && segments[0] === "qa-amendments")
        || (segments.length === 4 && segments[0] === "meters" && segments[1] === "lifecycle")
        || ([3, 4].includes(segments.length) && segments[0] === "trns" && segments[1] === "lifecycle_instructions");
      if (!supported || segments.some(x => !x || x === "." || x === "..")) {
        throw new HttpsError("failed-precondition", "This evidence uses an unsupported storage location. Its evidence needs checking before QA.");
      }
      objects.set(path, { bucket: bucketName, path, filename: segments.at(-1) });
    }
    Object.values(value).forEach(visit);
  };
  visit(trn.media || []);
  visit(trn.fieldComment || {});
  return [...objects.values()];
}

export async function lockEvidence({ db, bucket, trnId, trn, actorUid }) {
  const objects = evidenceObjects(trn, bucket.name);
  const location = { lmPcode: trn.accessData?.parents?.lmPcode || null, wardPcode: trn.accessData?.parents?.wardPcode || null };
  // Preserve existing locks. Once a reviewer has seen a version, its evidence
  // remains protected even if the review is cancelled or subsequently fails.
  for (const object of objects) {
    const ref = db.doc(`qaEvidenceLocks/${object.filename}`);
    await db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (!existing.exists) tx.create(ref, { ...object, trnId, ...location, recordedByUid: actorUid, recordedAt: new Date().toISOString() });
    });
  }
  return Promise.all(objects.map(async object => {
    try {
      const [metadata] = await bucket.file(object.path).getMetadata();
      const generation = String(metadata.generation);
      const key = createHash("sha256").update(`${object.path}:${generation}`).digest("hex");
      const preservedPath = `qa-evidence/${trnId}/${key}/${object.filename}`;
      const preserved = bucket.file(preservedPath);
      try {
        // Copy the generation we inspected. An upload already in flight cannot
        // silently replace the bytes subsequently shown to the reviewer.
        await bucket.file(object.path, { generation }).copy(preserved, {
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { firebaseStorageDownloadTokens: randomUUID() },
        });
      } catch (error) {
        if (Number(error.code) !== 412) throw error; // Existing immutable copy.
      }
      const [saved] = await preserved.getMetadata();
      if (metadata.md5Hash && saved.md5Hash !== metadata.md5Hash) throw new Error("Evidence copy checksum mismatch");
      const token = saved.metadata?.firebaseStorageDownloadTokens;
      if (!token) throw new Error("Evidence copy download token missing");
      const preservedUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(preservedPath)}?alt=media&token=${encodeURIComponent(token)}`;
      return { ...object, available: true, generation, md5Hash: metadata.md5Hash || null, size: Number(metadata.size), preservedPath, preservedUrl, preservedGeneration: String(saved.generation) };
    } catch (error) {
      if (Number(error.code) === 404) return { ...object, available: false, generation: null, md5Hash: null, size: null };
      logger.error("QA evidence preservation failed", { trnId, code: error.code || "COPY_FAILED", message: error.message });
      throw new HttpsError("unavailable", "Evidence could not be checked. Please try opening the review again.");
    }
  }));
}
