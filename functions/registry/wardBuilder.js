// registry/wardBuilder.js

import { randomUUID } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

import {
  buildWardRegistryId,
  buildWardRegistryMetadata,
  safeText,
} from "./wardHelpers.js";

import {
  loadWardCounts,
  computeWardOperationalStatus,
} from "./wardCounters.js";

const buildWardRegistryRow = async ({
  db,
  lmPcode,
  wardPcode,
  wardData = null,
  existingDoc = null,
  countLoader = loadWardCounts,
}) => {
  if (!db) {
    throw new Error("db is required");
  }

  if (!lmPcode) {
    throw new Error("lmPcode is required");
  }

  if (!wardPcode) {
    throw new Error("wardPcode is required");
  }

  let ward = wardData;

  if (!ward) {
    const wardSnap = await db.collection("wards").doc(wardPcode).get();

    if (!wardSnap.exists) {
      throw new Error(`Ward not found: ${wardPcode}`);
    }

    ward = {
      id: wardSnap.id,
      ...wardSnap.data(),
    };
  }

  const counts = await countLoader({
    db,
    lmPcode,
    wardPcode,
  });

  const fields = ['formalErfs','informalErfs','totalErfs','premises','electricityMeters','waterMeters','totalMeters','trns'];
  if (!fields.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0) || counts.totalErfs !== counts.formalErfs + counts.informalErfs || counts.totalMeters !== counts.electricityMeters + counts.waterMeters) throw new Error('Invalid ward counts');
  const isOperationallyActive = computeWardOperationalStatus({
    totalErfs: counts.totalErfs,
    premises: counts.premises,
    totalMeters: counts.totalMeters,
    trns: counts.trns,
  });

  const id = buildWardRegistryId(lmPcode, wardPcode);
  const metadata = buildWardRegistryMetadata(existingDoc);

  return {
    id,

    province: {
      pcode: ward?.parents?.provinceId || "NAv",
      name: "NAv",
    },

    district: {
      pcode: ward?.parents?.districtId || "NAv",
      name: "NAv",
    },

    localMunicipality: {
      pcode: ward?.parents?.localMunicipalityId || lmPcode || "NAv",
      name: "NAv",
    },

    ward: {
      pcode: ward?.id || wardPcode || "NAv",
      name: safeText(ward?.name),
      number: ward?.code || "NAv",
    },

    counts,

    status: {
      isOperationallyActive,
    },

    metadata,
  };
};

/** Rebuild one ward. A newer request owns publication, so slow older work cannot overwrite it. */
export const rebuildWardRegistryRow = async ({
  lmPcode, wardPcode, reason = 'WARD_REGISTRY_ROW_REBUILD',
  db = getFirestore(), countLoader = loadWardCounts,
} = {}) => {
  if (!lmPcode || !wardPcode) throw new Error('Municipality and ward are required');
  const ref = db.collection('registry_wards').doc(buildWardRegistryId(lmPcode, wardPcode));
  const wardRef = db.collection('wards').doc(wardPcode);
  const requestId = randomUUID();
  const reservation = await db.runTransaction(async tx => {
    const [wardSnap, existing] = await Promise.all([tx.get(wardRef), tx.get(ref)]);
    const ward = wardSnap.exists ? {...wardSnap.data(), id:wardSnap.id} : null;
    if (!ward || ward.parents?.localMunicipalityId !== lmPcode) {
      if (existing.exists) tx.delete(ref);
      return null;
    }
    const previous = existing.data() || {};
    tx.set(ref, {
      id: ref.id, localMunicipality:{pcode:lmPcode},
      ward:{pcode:wardPcode, number:ward.code ?? 'NAv', name:ward.name || 'NAv'},
      calculation:{state:'PENDING', requestId, requestedAt:FieldValue.serverTimestamp(), reason, error:null},
    }, {merge:true});
    return {ward, previous};
  });
  if (!reservation) return {skipped:true};
  try {
    const row = await buildWardRegistryRow({db,lmPcode,wardPcode,wardData:reservation.ward,existingDoc:reservation.previous,countLoader});
    const published = await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.data()?.calculation?.requestId !== requestId) return false;
      tx.set(ref, {...row, lastSuccessfulCounts:row.counts,
        calculation:{state:'READY',requestId,reason,error:null,completedAt:FieldValue.serverTimestamp(),lastSuccessfulAt:FieldValue.serverTimestamp()}}, {merge:true});
      return true;
    });
    return {...row,published};
  } catch (error) {
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.data()?.calculation?.requestId !== requestId) return;
      tx.set(ref,{calculation:{state:'UNAVAILABLE',error:'Count calculation failed',failedAt:FieldValue.serverTimestamp()}},{merge:true});
    });
    logger.error('Ward calculation failed',{lmPcode,wardPcode,reason,error:error.message});
    throw error;
  }
};

/** Independent writes allow healthy wards to finish even if another ward fails. */
export const rebuildWardRegistryForLm = async (lmPcode, {db=getFirestore(), rebuild=rebuildWardRegistryRow} = {}) => {
  if (!lmPcode) throw new Error('Municipality is required');
  const snapshot = await db.collection('wards').where('parents.localMunicipalityId','==',lmPcode).get();
  const result = {total:snapshot.size,completed:0,failed:[]};
  for (const ward of snapshot.docs) {
    try { await rebuild({lmPcode,wardPcode:ward.id,db}); result.completed++; }
    catch { result.failed.push(ward.id); }
  }
  if (result.failed.length) {
    const error = new Error('Ward rebuild failed: '+result.failed.join(', '));
    error.result = result;
    throw error;
  }
  return result;
};
