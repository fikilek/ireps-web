import test from "node:test";
import assert from "node:assert/strict";
import { batchGeofenceNames, batchCreator } from "../src/redux/trnBgoRegisterDetails.js";
test("register uses all distinct batch geofence refs and recorded creator", () => {
 assert.equal(batchGeofenceNames([{geofenceRefs:[{id:"g1",name:"Zulu"},{id:"g2",name:"Alpha"}]},{geofenceRefs:[{id:"g1",name:"Zulu"}]}]), "Alpha, Zulu");
 assert.equal(batchGeofenceNames([{geofenceRefs:[{id:"g1"}]},{geofenceRefs:[{id:"g1",name:"Named fence"}]}]), "Named fence");
 assert.equal(batchGeofenceNames([]), "NAv");
 assert.equal(batchCreator({metadata:{createdByUser:"Owner",createdByUid:"uid"}}), "Owner");
 assert.equal(batchCreator({metadata:{createdByUid:"uid"}}), "uid");
 assert.equal(batchCreator({}), "NAv");
});
