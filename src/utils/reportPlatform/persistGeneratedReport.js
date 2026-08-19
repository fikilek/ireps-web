function assertArtifact(artifact, metadata) {
  if (!artifact || typeof artifact !== "object") {
    throw new TypeError("A canonical report artifact is required.");
  }

  if (!(artifact.bytes instanceof Uint8Array) || artifact.bytes.byteLength <= 0) {
    throw new TypeError("Canonical report artifact bytes must be a non-empty Uint8Array.");
  }

  if (!metadata || typeof metadata !== "object") {
    throw new TypeError("Report producer metadata is required.");
  }

  if (artifact.format !== metadata.format) {
    throw new TypeError("Artifact format does not match report metadata.");
  }

  if (artifact.fileName !== metadata.fileName) {
    throw new TypeError("Artifact fileName does not match report metadata.");
  }
}

function assertPreparedDescriptor(descriptor, artifact) {
  if (!descriptor || typeof descriptor !== "object") {
    throw new Error("Report preparation returned an invalid descriptor.");
  }

  const requiredTextFields = [
    "reportId",
    "storagePath",
    "reportType",
    "format",
    "fileName",
    "expectedContentType",
  ];

  for (const field of requiredTextFields) {
    if (typeof descriptor[field] !== "string" || !descriptor[field]) {
      throw new Error(`Report preparation did not return ${field}.`);
    }
  }

  if (descriptor.format !== artifact.format || descriptor.fileName !== artifact.fileName) {
    throw new Error("Prepared report descriptor does not match the canonical artifact.");
  }
}

export function createGeneratedReportPersister({
  prepare,
  upload,
  finalize,
}) {
  if (
    typeof prepare !== "function" ||
    typeof upload !== "function" ||
    typeof finalize !== "function"
  ) {
    throw new TypeError("Report persistence dependencies are incomplete.");
  }

  return async function persist({ artifact, metadata }) {
    assertArtifact(artifact, metadata);

    const descriptor = await prepare({ metadata });
    assertPreparedDescriptor(descriptor, artifact);

    await upload({
      storagePath: descriptor.storagePath,
      bytes: artifact.bytes,
      contentType: descriptor.expectedContentType,
    });

    return finalize({
      reportId: descriptor.reportId,
      metadata,
    });
  };
}

async function createFirebasePersister() {
  const [functionsModule, storageModule, firebaseModule] = await Promise.all([
    import("firebase/functions"),
    import("firebase/storage"),
    import("../../firebase/index.js"),
  ]);

  const prepareCallable = functionsModule.httpsCallable(
    firebaseModule.functions,
    "prepareGeneratedReportCallable",
  );
  const finalizeCallable = functionsModule.httpsCallable(
    firebaseModule.functions,
    "finalizeGeneratedReportCallable",
  );

  return createGeneratedReportPersister({
    async prepare(payload) {
      const result = await prepareCallable(payload);
      return result.data;
    },

    async upload({ storagePath, bytes, contentType }) {
      const objectRef = storageModule.ref(firebaseModule.storage, storagePath);
      await storageModule.uploadBytes(objectRef, bytes, { contentType });
    },

    async finalize(payload) {
      const result = await finalizeCallable(payload);
      return result.data;
    },
  });
}

export async function persistGeneratedReport({ artifact, metadata }) {
  const persist = await createFirebasePersister();
  return persist({ artifact, metadata });
}
