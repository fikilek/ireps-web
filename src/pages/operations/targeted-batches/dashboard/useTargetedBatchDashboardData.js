import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../../../firebase";
import {
  getBatchId,
  sortBatchesByUpdatedDesc,
} from "./targetedBatchDashboardModel";

function mapSnapshotDoc(snapshot) {
  return {
    ...(snapshot.data() || {}),
    id: snapshot.id,
  };
}

export default function useTargetedBatchDashboardData({
  lmPcode = null,
  tbId = null,
} = {}) {
  const [batches, setBatches] = useState([]);
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let batchReady = false;
    let rowsReady = false;

    setBatches([]);
    setRows([]);
    setLoadError("");
    setIsLoading(true);

    if (!tbId && !lmPcode) {
      setIsLoading(false);
      return undefined;
    }

    function markReady(type) {
      if (type === "BATCH") batchReady = true;
      if (type === "ROWS") rowsReady = true;
      if (batchReady && rowsReady) setIsLoading(false);
    }

    function handleError(error) {
      setLoadError(
        error?.message ||
          "The permanent Targeted Batch dashboard data could not be loaded.",
      );
      setIsLoading(false);
    }

    let unsubscribeBatches = null;
    let unsubscribeRows = null;

    if (tbId) {
      unsubscribeBatches = onSnapshot(
        doc(db, "tb_uploads", tbId),
        (snapshot) => {
          setBatches(snapshot.exists() ? [mapSnapshotDoc(snapshot)] : []);
          markReady("BATCH");
        },
        handleError,
      );

      unsubscribeRows = onSnapshot(
        query(collection(db, "tb_rows"), where("tbId", "==", tbId)),
        (snapshot) => {
          setRows(snapshot.docs.map(mapSnapshotDoc));
          markReady("ROWS");
        },
        handleError,
      );
    } else {
      unsubscribeBatches = onSnapshot(
        query(
          collection(db, "tb_uploads"),
          where("scope.lmPcode", "==", lmPcode),
        ),
        (snapshot) => {
          setBatches(
            snapshot.docs
              .map(mapSnapshotDoc)
              .sort(sortBatchesByUpdatedDesc),
          );
          markReady("BATCH");
        },
        handleError,
      );

      unsubscribeRows = onSnapshot(
        query(
          collection(db, "tb_rows"),
          where("scope.lmPcode", "==", lmPcode),
        ),
        (snapshot) => {
          setRows(snapshot.docs.map(mapSnapshotDoc));
          markReady("ROWS");
        },
        handleError,
      );
    }

    return () => {
      if (unsubscribeBatches) unsubscribeBatches();
      if (unsubscribeRows) unsubscribeRows();
    };
  }, [lmPcode, tbId]);

  return {
    batches,
    rows,
    batch: tbId
      ? batches.find((item) => getBatchId(item) === tbId) || null
      : null,
    isLoading,
    loadError,
  };
}
