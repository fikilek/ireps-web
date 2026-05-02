// /functions/geofences/triggers.js

/* eslint-disable no-undef */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";

import {
  collectGeoFenceErfUpdates,
  collectGeoFencePremiseUpdates,
  collectGeoFenceAstUpdates,
  commitGeoFenceMembershipUpdates,
  recomputeGeoFenceCounts,
} from "./membership.js";

/* =====================================================
   ON GEOFENCE CREATED
   ===================================================== */

export const onGeoFenceCreated = onDocumentCreated(
  "geo_fences/{geoFenceId}",
  async (event) => {
    const db = getFirestore();

    try {
      console.log("onGeoFenceCreated ---- START");

      const geoFenceSnap = event.data;

      if (!geoFenceSnap || !geoFenceSnap.exists) {
        console.log("onGeoFenceCreated ---- no doc, exit");
        return;
      }

      const geoFence = geoFenceSnap.data();
      const geoFenceId = geoFence?.id;
      const geoFenceName =
        geoFence?.name || geoFence?.description || geoFenceId;

      if (!geoFenceId) {
        console.log("onGeoFenceCreated ---- missing id, exit");
        return;
      }

      if (geoFence?.status !== "ACTIVE") {
        console.log("onGeoFenceCreated ---- not active, exit");
        return;
      }

      const lmPcode = geoFence?.parents?.lmPcode;
      const wardPcode = geoFence?.parents?.wardPcode;

      const polygonPoints = geoFence?.geometry?.points || [];
      const bbox = geoFence?.geometry?.bbox || null;

      if (!lmPcode || !wardPcode || !bbox || polygonPoints.length < 3) {
        console.log("onGeoFenceCreated ---- invalid geometry/scope, exit");
        return;
      }

      console.log("onGeoFenceCreated ---- geofence loaded", {
        geoFenceId,
        lmPcode,
        wardPcode,
        points: polygonPoints.length,
      });

      /* =====================================================
         ERF PHASE
         ===================================================== */

      const erfSnapshot = await db
        .collection("ireps_erfs")
        .where("admin.localMunicipality.pcode", "==", lmPcode)
        .where("admin.ward.pcode", "==", wardPcode)
        .get();

      console.log("onGeoFenceCreated ---- erf candidates", {
        count: erfSnapshot.size,
      });

      const erfUpdates = collectGeoFenceErfUpdates({
        erfDocs: erfSnapshot.docs,
        geoFenceId,
        geoFenceName,
        bbox,
        polygonPoints,
      });

      // const erfUpdates = collectGeoFenceErfUpdates({
      //   erfDocs: erfSnapshot.docs,
      //   geoFenceId,
      //   bbox,
      //   polygonPoints,
      // });

      const erfCommit = await commitGeoFenceMembershipUpdates({
        db,
        updates: erfUpdates,
      });

      console.log("onGeoFenceCreated ---- erf updates", erfCommit);

      /* =====================================================
         PREMISE PHASE
         ===================================================== */

      const premiseSnapshot = await db
        .collection("premises")
        .where("parents.lmPcode", "==", lmPcode)
        .where("parents.wardPcode", "==", wardPcode)
        .get();

      console.log("onGeoFenceCreated ---- premise candidates", {
        count: premiseSnapshot.size,
      });

      const premiseUpdates = collectGeoFencePremiseUpdates({
        premiseDocs: premiseSnapshot.docs,
        geoFenceId,
        geoFenceName,
        bbox,
        polygonPoints,
      });

      // const premiseUpdates = collectGeoFencePremiseUpdates({
      //   premiseDocs: premiseSnapshot.docs,
      //   geoFenceId,
      //   bbox,
      //   polygonPoints,
      // });

      const premiseCommit = await commitGeoFenceMembershipUpdates({
        db,
        updates: premiseUpdates,
      });

      console.log("onGeoFenceCreated ---- premise updates", premiseCommit);

      /* =====================================================
         AST PHASE
         ===================================================== */

      const astSnapshot = await db
        .collection("asts")
        .where("accessData.parents.lmPcode", "==", lmPcode)
        .where("accessData.parents.wardPcode", "==", wardPcode)
        .get();

      console.log("onGeoFenceCreated ---- ast candidates", {
        count: astSnapshot.size,
      });

      const astUpdates = collectGeoFenceAstUpdates({
        astDocs: astSnapshot.docs,
        geoFenceId,
        geoFenceName,
        bbox,
        polygonPoints,
      });

      // const astUpdates = collectGeoFenceAstUpdates({
      //   astDocs: astSnapshot.docs,
      //   geoFenceId,
      //   bbox,
      //   polygonPoints,
      // });

      const astCommit = await commitGeoFenceMembershipUpdates({
        db,
        updates: astUpdates,
      });

      console.log("onGeoFenceCreated ---- ast updates", astCommit);

      /* =====================================================
         COUNTS PHASE
         ===================================================== */

      const counts = await recomputeGeoFenceCounts({
        db,
        geoFenceId,
        lmPcode,
        wardPcode,
      });

      await geoFenceSnap.ref.update({
        counts,
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": "SYSTEM",
        "metadata.updatedByUser": "onGeoFenceCreated",
      });

      console.log("onGeoFenceCreated ---- counts recomputed", {
        geoFenceId,
        counts,
      });

      console.log("onGeoFenceCreated ---- SUCCESS", { geoFenceId });
    } catch (error) {
      console.error("onGeoFenceCreated ---- ERROR", error);
    }
  },
);
