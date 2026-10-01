import { useSyncExternalStore } from "react";

const listeners = new Set();
let users = Array.from({ length: 12 }, (_, i) => ({
  uid: `preview-user-${i}`, surname: ["Adams", "Banda", "Dlamini", "Kaiser", "Khumalo", "Mabena", "Mokoena", "Naidoo", "Nkosi", "Pillay", "Zulu", "NAv"][i],
  name: `User ${i + 1}`, displayName: `User ${i + 1}`, email: `user${i + 1}@example.com`,
  role: i === 0 ? "MNG" : i === 1 ? "SPV" : "FWR", serviceProviderId: i === 10 ? "outside" : "preview-sp",
  serviceProviderName: i === 10 ? "Outside company" : "Preview Services", accountStatus: i === 9 ? "DISABLED" : "ENABLED",
  onboardingStatus: i === 8 ? "PENDING" : "COMPLETED",
}));
const teams = [
  { id: "alpha", name: "Alpha Team", mncServiceProviderId: "preview-sp", memberUserIds: ["preview-user-1", "preview-user-2", "preview-user-3"] },
  { id: "beta", name: "Beta Team", mncServiceProviderId: "preview-sp", memberUserIds: ["preview-user-2", "preview-user-4", "preview-user-5"] },
];
export const db = {};
export const collection = () => null;
export const getDocsFromServer = async () => ({docs:[{id:'preview-sp',data:()=>({clients:[]})}]});
export const useAuth = () => ({uid:'preview-user-0',role:'MNG',serviceProvider:{id:'preview-sp'}});
export const useGetAvailableTeamsQuery = () => ({data:teams,isLoading:false,isError:false});
const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
export function useGetUsersDirectoryQuery() {
  const data=useSyncExternalStore(subscribe,()=>users);
  return {data,isLoading:false,isFetching:false,isError:false};
}
export const useUpdateUserRoleMutation = () => [({userUid,newRole}) => ({unwrap: async () => {
  users=users.map(u=>u.uid===userUid?{...u,role:newRole}:u);
  listeners.forEach(fn=>fn());
  return {message:'Preview role updated.'};
}})];
