import { useState } from "react";

const wardPcode = "ZA5241002";
const rowData = Array.from({ length: 12 }, (_, i) => ({
  id: `preview-${i}`, rowId: `preview-${i}`, trnId: `TRN-${i}`, lmPcode: "ZA5241", wardPcode,
  wardNumber: String(i + 1).padStart(3, "0"), wardNo: "002", erfNo: String(100 + i), erfType: i % 2 ? "FORMAL" : "INFORMAL",
  formalErfCount: i, informalErfCount: 2, totalErfCount: i + 2, premiseCount: i + 1,
  electricityMeterCount: i + 1, waterMeterCount: 1, meterCount: i + 2, trnCount: i + 3,
  trnsAccessCount: i, trnsNaCount: 1, trnsTotalCount: i + 1,
  addressText: `${i + 1} Preview Road`, premiseAddress: `${i + 1} Preview Road`, premiseId: `premise-${i}`,
  propertyTypeType: i % 2 ? "RESIDENTIAL" : "COMMERCIAL", propertyTypeName: "House", premiseType: "Residential", unitNo: `${i + 1}`, occupancyStatus: i % 2 ? "OCCUPIED" : "VACANT",
  meterNo: `000${i + 1}`, meterType: i % 2 ? "water" : "electricity", meterKind: "PREPAID", meterPhase: "SINGLE_PHASE", visibility: "VISIBLE", status: "FIELD",
  ownerLabel: `Owner ${i + 1}`, ownerType: i % 2 ? "NATURAL_PERSON" : "JURISTIC_PERSON", occupantLabel: `Occupant ${i + 1}`,
  accounts: Array.from({length: 7}, (_, j) => ({accountNo: `A${i}-${7-j}`})), accountCount: 7,
  meters: [{meterNo: `000${i+1}`,meterId: `meter-${i}`}], refs: {accountMasterIds: Array.from({length:7},(_,j)=>`master-${i}-${7-j}`)},
  historyStatus: "NO_HISTORY", historySortValue: 0, reconciliationExceptions: [],
  trnType: "METER_READING", hasAccess: i % 2 ? "YES" : "NO", accessReason: "Available", astState: "MATCHED", mediaCount: 0,
  anomaly: "NONE", anomalyDetail: "None", normalisation: "None", createdByUser: "Preview Reviewer",
  createdAt: `2026-09-${String(i+1).padStart(2,"0")}T10:00:00Z`, updatedAt: `2026-09-${String(i+1).padStart(2,"0")}T10:00:00Z`, completedAt: `2026-09-${String(i+1).padStart(2,"0")}T10:00:00Z`,
  outcome: i % 3 === 0 ? "NO_ACCESS" : i % 3 === 1 ? "SUCCESSFUL_READING" : "UNSUCCESSFUL_READING",
  currentReading: i * 100, previousReading: i * 90, prevReading: i * 90, consumption: i * 10,
  successfulReads: i, unsuccessful: 1, noAccess: 0, mediaEvidence: 0, geofence: "Preview boundary",
  billingReadiness: i % 2 ? "BILLING_READY_CANDIDATE" : "NOT_BILLING_READY", reviewStatus: "NAv",
}));
export const previewRows = rowData;
const empty = [];
const result = data => ({data, isLoading:false, isFetching:false, isError:false, refetch: async()=>({data})});
const scoped = arg => typeof arg === "symbol" ? empty : rowData;
const wards = rowData.map((row,i)=>({...row,wardPcode:i===0?wardPcode:`ZA5241${String(i+2).padStart(3,"0")}`}));
export const useAuth = () => ({activeWorkbase:{id:"ZA5241",lmPcode:"ZA5241",name:"Preview Municipality"},role:"MNG"});
export function useGeo() { const [geoState,setGeo] = useState({selectedWard:{pcode:wardPcode,wardPcode,wardNumber:"002"}}); return {geoState,updateGeo:patch=>setGeo(current=>({...current,...patch}))}; }
export const useGetRegistryWardsByLmQuery = () => result(wards);
export const useGetWardBoundariesByLmQuery = () => result(empty);
export const useGetRegistryPremisesByWardQuery = arg => result(scoped(arg));
export const useGetRegistryMetersByWardQuery = arg => result(scoped(arg));
export const useGetRegistryAccountsByWardQuery = arg => result(scoped(arg));
export const useGetRegistryTrnsByLmPcodeQuery = arg => result(scoped(arg));
export const useGetRegistryMreadByWardQuery = arg => result(scoped(arg));
const firstPage = {rows:rowData,hasMore:true,nextCursorId:"preview-cursor"};
export const useGetRegistryErfsPageByWardQuery = arg => result(typeof arg === "symbol" ? {rows:empty} : firstPage);
export const useLazyGetRegistryErfsPageByWardQuery = () => [() => ({unwrap:async()=>({rows:rowData.map(r=>({...r,id:`extra-${r.id}`,erfNo:`9${r.erfNo}`})),hasMore:false,nextCursorId:null})}),{isFetching:false}];
export const useLazySearchRegistryErfsByLmQuery = () => [() => ({unwrap:async()=>({rows:rowData})}),{isFetching:false}];
export const useLazyGetFieldAccountDataHistoryByPremiseQuery = () => [() => ({unwrap:async()=>[]}),{isFetching:false}];
const sessions = [{id:"preview-session",stagingId:"preview-session",lmPcode:"ZA5241",billingPeriod:"2026-09",status:"READY",createdAt:"2026-09-12T10:00:00Z"}];
const cycles = Array.from({length:8},(_,i)=>({cycleId:`cycle-${i+1}`,cycleName:`Preview cycle ${i+1}`,billingPeriod:"2026-09",isCurrentCycle:i===0,action:"STAGING",stagingAction:"STAGING",rowsCount:12,iteration:i+1}));
export const useListMreadStagingSessionsQuery = () => result({rows:sessions});
export const useListMreadStagingRowsQuery = arg => result({rows:scoped(arg),totalRows:12});
export const useListMreadStagingCyclesQuery = () => result({rows:cycles});
export const useGenerateMreadStagingMutation = () => [() => ({unwrap:async()=>{throw new Error("Preview: generation is disabled. No backend write was made.");}}),{isLoading:false}];
export const getFirestore = () => ({});
export const doc = (...args) => args;
export const getDoc = async () => ({exists:()=>false});
export const getDocs = async () => ({docs:[]});
export const collection = (...args) => args;
export const query = (...args) => args;
export const where = (...args) => args;
export const limit = (...args) => args;
export const useGetTrnByIdQuery = id => result(rowData.find(row=>row.trnId===id) || rowData[0]);
export const useGetErfBoundaryByIdQuery = () => result(null);
export const useGetWardBoundaryByPcodeQuery = () => result(null);
// DR-R001 3.1, 3.2 and 3.3: the Meter Registry's Credit control columns. The
// preview never reaches a backend, so the guard answers "cannot be checked"
// and the meter, premise and No Access history come back empty.
export const useCheckMeterRegistrationMutation = () => [
  () => ({ unwrap: async () => { throw new Error("Preview: the registration guard is disabled. No backend read was made."); } }),
  { isLoading: false },
];
export const useGetMeterByIdQuery = () => result(null);
export const useGetPremiseByIdQuery = () => result(null);
export const useGetMeterNoAccessHistoryQuery = () => result(empty);
export const useGetMeterDossierQuery = () => result(null);

const previewOnly = async () => { throw new Error("Preview: backend reporting is disabled. No backend write was made."); };
export const functions = {};
export const httpsCallable = () => previewOnly;
export const persistGeneratedReport = previewOnly;
export const authorizeGeneratedReportDownload = previewOnly;
export const sendGeneratedReportEmail = previewOnly;
