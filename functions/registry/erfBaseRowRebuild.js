import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

const buildErfNo = (sg = {}) => {
  const parcelNo = Number(sg?.parcelNo || 0);
  const portion = Number(sg?.portion || 0);

  if (parcelNo <= 0) return "NAv";
  if (portion > 0) return `${parcelNo}/${portion}`;
  return `${parcelNo}`;
};

const buildErfSearchableText = ({ erfNo, type, lmPcode, wardPcode }) => {
  return [erfNo, type, lmPcode, wardPcode]
    .filter((value) => value && value !== "NAv")
    .join(" ")
    .toLowerCase();
};

export const rebuildErfBaseRow = async (erfId) => {
  const db = getFirestore();

  if (!erfId || erfId === "NAv") return null;

  try {
    const erfRef = db.collection("ireps_erfs").doc(erfId);
    const erfSnap = await erfRef.get();

    if (!erfSnap.exists) {
      logger.warn("rebuildErfBaseRow ---- source ERF missing", { erfId });
      return null;
    }

    const erfDoc = erfSnap.data() || {};

    const sourceId = erfSnap.id;
    const resolvedErfId = erfDoc?.erfId || sourceId;

    const erfNo = buildErfNo(erfDoc?.sg);
    const type = erfDoc?.erf?.type || "NAv";
    const status = "NAv";

    const provincePcode = erfDoc?.admin?.province?.pcode || "NAv";
    const districtPcode = erfDoc?.admin?.district?.pcode || "NAv";
    const lmPcode = erfDoc?.admin?.localMunicipality?.pcode || "NAv";
    const wardPcode = erfDoc?.admin?.ward?.pcode || "NAv";

    const searchableText = buildErfSearchableText({
      erfNo,
      type,
      lmPcode,
      wardPcode,
    });

    const now = new Date().toISOString();

    await db
      .collection("registry_erfs")
      .doc(sourceId)
      .set(
        {
          id: sourceId,

          source: {
            collection: "ireps_erfs",
            sourceId,
          },

          erf: {
            id: resolvedErfId,
            erfNo,
            type,
            status,
          },

          geography: {
            provincePcode,
            districtPcode,
            lmPcode,
            wardPcode,
          },

          registry: {
            lmPcode,
            wardPcode,
            type,
            status,
            searchableText,
          },

          metadata: {
            createdAt: now,
            createdByUid: "SYSTEM",
            createdByUser: "ERF Registry Rebuild",
            updatedAt: now,
            updatedByUid: "SYSTEM",
            updatedByUser: "ERF Registry Rebuild",
          },
        },
        { merge: true },
      );

    logger.info("rebuildErfBaseRow ---- SUCCESS", {
      erfId: sourceId,
      erfNo,
      type,
      lmPcode,
      wardPcode,
    });

    return {
      id: sourceId,
      erfNo,
      type,
      lmPcode,
      wardPcode,
    };
  } catch (error) {
    logger.error("rebuildErfBaseRow ---- FAILED", {
      erfId,
      message: error?.message || "Unknown error",
      stack: error?.stack || "No stack",
    });
    throw error;
  }
};
