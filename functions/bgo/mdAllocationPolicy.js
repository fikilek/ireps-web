import { serviceProviderName } from "../serviceProviders/serviceProviderName.js";
const text=value=>String(value??"").trim();
const upper=value=>text(value).toUpperCase();
const fail=(code,message)=>Object.assign(new Error(message),{code});
export function mncIdFor(request, authority) {
  const token = request?.auth?.token || {};
  const profile = authority?.profile || {};
  return text(token.serviceProviderId || token.employmentServiceProviderId || token.mncServiceProviderId || profile.profile?.employment?.serviceProvider?.id || profile.employment?.serviceProvider?.id || profile.serviceProvider?.id || authority?.serviceProviderId);
}

function targetName(data, id, type) {
  return text(type === "TEAM" ? data.team?.name || data.name || id : serviceProviderName(data) || id);
}

function isSubcontractorOf(data, mncId) {
  return Array.isArray(data.clients) && data.clients.some(client => upper(client.clientType) === "SP" && upper(client.relationshipType) === "SUBC" && text(client.id) === mncId);
}


export async function readMdAllocationTarget({db,transaction,targetType,targetId,actorMncId}) {
 const targetRef=db.collection(targetType === "TEAM" ? "teams" : "serviceProviders").doc(targetId);
      const targetSnapshot = await transaction.get(targetRef);
      if (!targetSnapshot.exists) throw fail(`ALLOCATION_${targetType}_NOT_FOUND`, `${targetType} ${targetId} was not found.`);
      const targetData = targetSnapshot.data() || {};
      const status = upper(targetData.team?.status || targetData.status || targetData.lifecycleStatus);
      if (status !== "ACTIVE") throw fail(`ALLOCATION_${targetType}_NOT_ACTIVE`, `${targetType} ${targetId} is not ACTIVE.`);
      if (targetType === "TEAM" && text(targetData.ownership?.mncServiceProviderId) !== actorMncId) throw fail("ALLOCATION_TEAM_OUTSIDE_MNC", "The selected TEAM does not belong to the authorised MNC.");
      if (targetType === "SP" && !isSubcontractorOf(targetData, actorMncId)) throw fail("ALLOCATION_SERVICE_PROVIDER_OUTSIDE_MNC", "The selected SP is not a subcontractor of the authorised MNC.");
      const target = { type: targetType, id: targetId, name: targetName(targetData, targetId, targetType), email: text(targetData.email), phone: text(targetData.phone) };

 return target;
}
