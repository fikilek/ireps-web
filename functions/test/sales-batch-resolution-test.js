import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { acceptGoogleGeocode, geocodeSalesAddress } from "../targetedBatches/sales-batch-geocoding.js";
import { createProofCodec, findContainingErf, recordFailedLookup } from "../targetedBatches/sales-batch-resolution.js";
import { composeSalesGeocodingAddress } from "../salesAllMeters/sales-batch-policy.js";

const stamp={seconds:1789257600,nanoseconds:0};
const sales=()=>({master:{id:"00123",visibility:"INVISIBLE"},meterNo:"00123",meterNoNormalized:"00123",lmPcode:"ZA5241",town:"Dundee",adr:{strNo:"01A",strName:"Smith",strType:"Street"},tbRefs:[],metadata:{createdAt:stamp,createdByUid:"ORIGINAL",createdByUser:"Original",updatedAt:stamp,updatedByUid:"ORIGINAL",updatedByUser:"Original"},monthlyCategories:{"2026-08":{leakageCategory:"A"}}});
const response=()=>({status:"OK",results:[{geometry:{location_type:"ROOFTOP",location:{lat:-28.1,lng:30.2}},address_components:[{types:["street_number"],long_name:"01A"},{types:["route"],long_name:"Smith Street",short_name:"Smith St"},{types:["locality"],long_name:"Dundee"},{types:["country"],short_name:"ZA"}]}]});
test("only exact unambiguous rooftop address results are accepted",()=>{
  assert.equal(acceptGoogleGeocode(response(),sales()).ok,true);
  for(const precision of ["RANGE_INTERPOLATED","GEOMETRIC_CENTER","APPROXIMATE"]){const r=response();r.results[0].geometry.location_type=precision;assert.equal(acceptGoogleGeocode(r,sales()).code,"NO_EXACT_POSITION");}
  for(const number of ["1A","01","01B"]){const r=response();r.results[0].address_components[0].long_name=number;assert.equal(acceptGoogleGeocode(r,sales()).ok,false);}
  const partial=response();partial.results[0].partial_match=true;assert.equal(acceptGoogleGeocode(partial,sales()).ok,false);
  const multiple=response();multiple.results.push(structuredClone(multiple.results[0]));multiple.results[1].geometry.location.lat=-28.2;assert.equal(acceptGoogleGeocode(multiple,sales()).ok,false);
  assert.equal(acceptGoogleGeocode({status:"ZERO_RESULTS"},sales()).code,"NO_EXACT_POSITION");
  assert.equal(acceptGoogleGeocode({status:"REQUEST_DENIED"},sales()).incomplete,true);
});
test("provider failures expose no raw error or key, with bounded attempts",async()=>{
  let calls=0;
  const result=await geocodeSalesAddress({sales:sales(),apiKey:"mock-private-value",fetchImpl:async()=>{calls++;throw new Error("mock-private-value");}});
  assert.equal(calls,2);assert.equal(result.code,"GEOCODING_UNAVAILABLE");assert.equal(JSON.stringify(result).includes("mock-private-value"),false);
});
test("signed evidence binds identity, refuses forgery, and has no time limit (rules 18.4)",()=>{
  const codec=createProofCodec("a".repeat(32));const token=codec.sign({kind:"RESOLUTION",actorUid:"A",salesId:"00123"});
  assert.equal(codec.verify(token,{actorUid:"A"}).salesId,"00123");
  assert.throws(()=>codec.verify(token,{actorUid:"B"}));assert.throws(()=>codec.verify(token+"bad"));
  assert.equal("expiresAt" in codec.verify(token),false);
  const realNow=Date.now;Date.now=()=>realNow()+365*24*60*60*1000;
  try{assert.equal(codec.verify(token,{actorUid:"A"}).salesId,"00123");}finally{Date.now=realNow;}
  // A note signed before 1.3.6 still carries an old expiresAt; it is no longer refused for it.
  const legacyBody=Buffer.from(JSON.stringify({actorUid:"A",expiresAt:1,kind:"RESOLUTION",salesId:"00123"})).toString("base64url");
  const legacy=`${legacyBody}.${crypto.createHmac("sha256","a".repeat(32)).update(legacyBody).digest("base64url")}`;
  assert.equal(codec.verify(legacy,{actorUid:"A"}).salesId,"00123");
});
test("overlapping ERFs are a completed MULTIPLE_ERFS outcome, capped or failed queries are incomplete",async()=>{
  const geometry={type:"Polygon",coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]]]};
  const calls=[];const query={where(...args){calls.push(args);return this;},limit(n){calls.push(["limit",n]);return this;}};
  const db={collection(name){assert.equal(name,"ireps_erfs");return query;}};
  const docs=["E1","E2"].map(id=>({id,data:()=>({geometry})}));
  assert.equal((await findContainingErf({db,point:{latitude:5,longitude:5},lmPcode:"ZA5241",read:async()=>({docs})})).code,"MULTIPLE_ERFS");
  assert.equal(calls[0][0],"admin.localMunicipality.pcode");
  await assert.rejects(findContainingErf({db,point:[5,5],lmPcode:"ZA5241",read:async()=>({docs:Array(201).fill(docs[0])})}),/limit/);
  await assert.rejects(findContainingErf({db,point:[5,5],lmPcode:"ZA5241",read:async()=>{throw Error("missing index");}}),/incomplete/);
});
test("failed lookup writes only exact TB9 and update triple, preserving creation metadata and all other Sales",async()=>{
  const row=sales(), before=structuredClone(row);let patch=null;
  const profile={employment:{role:"MNG"},displayName:"Supervisor",access:{activeWorkbase:{id:"ZA5241"},workbases:[{id:"ZA5241"}]}};
  const db={doc:path=>({path}),runTransaction:fn=>fn({get:async ref=>({exists:true,data:()=>ref.path.startsWith("users/")?profile:row}),update:(ref,value)=>{assert.equal(ref.path,"sales-all-meters/00123");patch=value;}})};
  await recordFailedLookup({db,request:{auth:{uid:"U1",token:{}}},intent:{lmPcode:"ZA5241",source:"PREPAID_SALES_NON_GPS"},salesId:"00123",address:composeSalesGeocodingAddress(row),outcome:"MULTIPLE_ERFS",now:()=>stamp});
  assert.deepEqual(Object.keys(patch).sort(),["erfLookup","metadata.updatedAt","metadata.updatedByUid","metadata.updatedByUser"]);
  assert.deepEqual(Object.keys(patch.erfLookup).sort(),["address","attemptedAt","attemptedByUid","attemptedByUser","outcome","provider","version"]);
  assert.deepEqual(row,before);
  assert.equal(patch.erfLookup.outcome,"MULTIPLE_ERFS");
  patch=null;await assert.rejects(recordFailedLookup({db,request:{auth:{uid:"U1",token:{}}},intent:{lmPcode:"ZA5241",source:"PREPAID_SALES_NON_GPS"},salesId:"00123",address:"different",outcome:"NO_ERF",now:()=>stamp}),/address changed/);assert.equal(patch,null);
});
