import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {SourceTextModule,SyntheticModule,createContext} from "node:vm";
import {polygonFromPoints} from "../../../functions/geofences/sales-batch-geometry.js";
async function fixture(){
 const state=[];let cursor=0;const context=createContext({});
 const source=fs.readFileSync(new URL("./use-geofence-polygon-draft.js",import.meta.url),"utf8"),module=new SourceTextModule(source,{context});
 const mocks={react:{useCallback:fn=>fn,useState:initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return[state[index],value=>{state[index]=typeof value==="function"?value(state[index]):value;}];}},"../../../functions/geofences/sales-batch-geometry.js":{polygonFromPoints}};
 await module.link(name=>{assert.ok(mocks[name]);return new SyntheticModule(Object.keys(mocks[name]),function(){for(const[k,v]of Object.entries(mocks[name]))this.setExport(k,v);},{context});});await module.evaluate();
 return()=>{cursor=0;return module.namespace.useGeofencePolygonDraft();};
}
test("drawing finish validates, undo invalidates completion, clear resets all state",async()=>{
 const render=await fixture();render().setDrawing(true);render().addPoint([0,0]);render().addPoint([1,0]);render().finish();assert.ok(render().error);assert.equal(render().complete,false);
 render().addPoint([1,1]);render().finish();assert.equal(render().complete,true);assert.equal(render().drawing,false);
 render().undo();assert.equal(render().points.length,2);assert.equal(render().complete,false);
 render().clear();assert.equal(render().points.length,0);assert.equal(render().error,"");assert.equal(render().drawing,false);
});
test("drawing cardinality stays bounded at 300 vertices",async()=>{const render=await fixture();for(let i=0;i<301;i++)render().addPoint([i/100,1]);assert.equal(render().points.length,300);});
