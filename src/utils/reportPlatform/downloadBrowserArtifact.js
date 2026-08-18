const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function getContentType(format) {
  if (format === "XLSX") return XLSX_CONTENT_TYPE;
  return "application/octet-stream";
}

export function downloadBrowserArtifact(artifact) {
  if (!artifact?.fileName) {
    throw new Error("Browser artifact download requires a fileName.");
  }

  if (!artifact?.bytes) {
    throw new Error("Browser artifact download requires bytes.");
  }

  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Browser artifact download requires a browser environment.");
  }

  const blob = new Blob([artifact.bytes], {
    type: getContentType(artifact.format),
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = artifact.fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
