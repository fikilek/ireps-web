import { resolveDuplicates } from "../../functions/tcUploads/stage1Validation.js";
export const functions = {};
export const useAuth = () => ({ workbases: [{ id: "ZA5241", name: "Endumeni" }], activeWorkbase: { id: "ZA5241", name: "Endumeni" } });
export const useGeo = () => ({ geoState: {} });
export const useGetAvailableTeamsQuery = () => ({ data: [] });
export const useGetAvailableServiceProvidersQuery = () => ({ data: [] });
export const useCreateTrnBgoWardBatchesMutation = () => [() => { throw new Error("Stage 2 must not be invoked by Stage 1 tests"); }];
export const useAllocateTrnBgoWardBatchesMutation = useCreateTrnBgoWardBatchesMutation;
export const httpsCallable = () => async (payload) => {
  window.__stage1Payload = payload;
  const rows = resolveDuplicates(payload.rows, payload.keep);
  return { data: { meterAstEntries: rows.filter((row) => row.meterNo !== "009999").map((row) => [row.meterNo, { id: `ast-${row.meterNo}`, master: { id: row.meterNo }, accessData: { parents: { lmPcode: row.meterNo === "000456" ? "ZA9999" : "ZA5241", wardPcode: "ZA5241006" } } }]), meterRegEntries: [], meterSalesEntries: [], premiseEntries: [], mismatches: rows.filter((row) => row.meterNo === "000456").map((row) => ({ ...row, actualLmPcode: "ZA9999" })) } };
};
