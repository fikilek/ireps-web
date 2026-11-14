import { toggleMdBgoSelection } from "./allocationModel.js";
import { parseGeometry, geoJsonPolygonToGooglePaths } from "../geofence-map-helpers.js";
export function buildTrnAllocationModel({batches=[],wards=[]}) {
 const items=[];let readyNotOnMap=0;
 for(const batch of batches) {
  if(!batch.contractVersion)continue;
  const ward=wards.find(w=>(w.wardPcode||w.id)===batch.wardPcode);
  const geometry=parseGeometry(ward?.geometry);
  const polygons=geometry?.type==="MultiPolygon"?geometry.coordinates.map(coordinates=>geoJsonPolygonToGooglePaths({type:"Polygon",coordinates})):geometry?.type==="Polygon"?[geoJsonPolygonToGooglePaths(geometry)]:[];
  if(!polygons.some(paths=>paths[0]?.length>=3)){if(batch.workflowState==="READY_FOR_ALLOCATION")readyNotOnMap++;continue;}
  const state=batch.workflowState==="READY_FOR_ALLOCATION"&&!batch.assignment?.targets?.length?"READY":["ISSUED","ACCEPTED"].includes(batch.workflowState)?"ISSUED":"UNAVAILABLE";
  items.push({bgoBatchId:batch.id,geofenceId:ward.id,name:batch.id,erfCount:batch.totalRows||0,unitLabel:"meters",state,targetName:batch.assignment?.targets?.[0]?.name||"",wardPcode:batch.wardPcode,wardLabel:ward.name||batch.wardPcode,fence:{...ward,polygon:ward.geometry,allocationPolygons:polygons,geometry:{points:polygons.flatMap(paths=>paths[0]||[]) }}});
 }
 return {items,readyNotOnMap,counts:{ready:items.filter(x=>x.state==="READY").length,issued:items.filter(x=>x.state==="ISSUED").length}};
}

export function toggleTrnAllocationSelection(ids,item,items) {
 const next=toggleMdBgoSelection(ids,item);
 const count=items.filter(row=>next.ids.includes(row.bgoBatchId)).reduce((sum,row)=>sum+Number(row.erfCount||0),0);
 return count>200?{ids,message:`That selection contains ${count} meters. Maximum per allocation action is 200.`}:next;
}
