import { defineConfig, mergeConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "../vite.config.js";

// Opt-in review fixtures. Normal dev and release builds always use real APIs.
const fixture = fileURLToPath(new URL("./registries-preview-data.jsx", import.meta.url));
export default mergeConfig(base, defineConfig({
  cacheDir: ".vite-registries-preview.local",
  plugins: [{
    name: "registries-preview-fixtures",
    enforce: "pre",
    resolveId(source, importer) {
      const path = importer?.replaceAll("\\", "/") || "";
      const registry = /\/src\/pages\/registries\//.test(path);
      const meterHistory = path.endsWith("/src/components/mread/MeterHistoryModal.jsx");
      if (!registry && !meterHistory) return null;
      return source.includes("/redux/") || source.endsWith("/auth/useAuth") || source.endsWith("/context/GeoContext") || source === "firebase/firestore" || source === "firebase/functions" || source.endsWith("/firebase") || /\/(persistGeneratedReport|generatedReportsClient|generatedReportEmailClient)$/.test(source) ? fixture : null;
    },
  }],
}));
