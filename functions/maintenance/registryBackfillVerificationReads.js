// Read every requested document, in bounded batches, without any writes.
export async function readRegistryVerificationSnapshots(db, paths) {
  const uniquePaths = [...new Set(paths)];
  const snapshots = new Map();
  for (let start = 0; start < uniquePaths.length; start += 100) {
    const batch = uniquePaths.slice(start, start + 100);
    const results = await db.getAll(...batch.map(path => db.doc(path)));
    for (const snapshot of results) snapshots.set(snapshot.ref.path, snapshot);
    for (const path of batch) {
      if (!snapshots.has(path)) throw new Error(`Verification read missing: ${path}`);
    }
  }
  return snapshots;
}
