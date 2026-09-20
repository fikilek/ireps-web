import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildTargetedBatchParentDoc, buildTargetedBatchRowDoc } from "../targetedBatches/documentFactory.js";
import { creationPayload } from "../targetedBatches/sales-batch-creation.js";

const fixture=JSON.parse(fs.readFileSync(new URL("./fixtures/sales-batch-fixtures.json",import.meta.url),"utf8"));
const schemaRoot=process.env.IREPS_SCHEMAS_ROOT || "C:/dev/ireps-schemas";
const head=execFileSync("git",["--no-optional-locks","-c",`safe.directory=${schemaRoot}`,"-C",schemaRoot,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
assert.equal(head,"09c763e592adc800391d2f070802fc96ce079e4a","Mount the approved immutable schema checkout");
const ajv=new Ajv2020({allErrors:true,allowUnionTypes:true,strictTypes:false,strictRequired:false,coerceTypes:false,useDefaults:false,removeAdditional:false});
for(const keyword of ["x-ireps","x-firestore-type"])ajv.addKeyword({keyword,valid:true});
addFormats(ajv);
const validators={};
for(const [name,hash] of [["tb-uploads","DEC4A0C0495E6DC66214C7F4F8843B9B35763BD2AF8EA6173566E15818E256B7"],["tb-rows","66772ACCD7DC23731915CDE9A4A8BC625D3DE3C7E98D09A521917B18A77BBC80"]]){
 const bytes=fs.readFileSync(`${schemaRoot}/${name}/${name}-schema.json`);
 assert.equal(crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase(),hash,"Canonical schema content changed");
 const schema=JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/,""));ajv.addSchema(schema);
 validators[name]={root:ajv.getSchema(schema.$id),fresh:ajv.compile({$ref:`${schema.$id}#/$defs/freshSalesCreation`})};
}
for(const source of ["PREPAID_SALES","PREPAID_SALES_NON_GPS"])for(const n of [1,30])test(`actual ${source} factory N=${n} matches root and fresh schema`,()=>{
 const payload=creationPayload({tbId:fixture.tbId,source,reason:"Test selection",salesPeriodFrom:"2026-07",salesPeriodTo:"2026-08"},fixture.scope,n,"ordinaryAutoFenceId1");
 const common={payload,creationDate:fixture.stamp,actorUid:fixture.actor.uid,actorName:fixture.actor.user};
 const parent=buildTargetedBatchParentDoc({...common,fingerprint:"A".repeat(64)});
 for(const validator of Object.values(validators["tb-uploads"]))assert.equal(validator(parent),true,JSON.stringify(validator.errors));
 assert.equal(parent.counts.totalRows,parent.creation.createdRows);assert.equal(parent.creation.createdRows,n);
 for(let i=1;i<=n;i++){
  const row=buildTargetedBatchRowDoc({...common,salesSource:fixture.sales,draftRow:{customerName:"FORGED",accountNumber:"FORGED",totalSalesC:999999,astId:"FORGED"},salesAllMeterId:"00123",rowNo:i,erfReference:{erfId:"ERF1",erfNo:"123"}});
  for(const validator of Object.values(validators["tb-rows"]))assert.equal(validator(row),true,JSON.stringify(validator.errors));
  assert.equal(row.customer.customerName,"Test Customer");assert.equal(row.salesSnapshot.totalSalesC,1000);assert.deepEqual(row.refs,{erfId:"ERF1",premiseId:null,meterId:null,trnId:null});
  if(source==="PREPAID_SALES"){assert.equal(row.selection.townKey,null);assert.equal(row.selection.streetKey,null);}
  const later=structuredClone(row);later.refs.premiseId="PREMISE1";later.execution.status="IN_PROGRESS";later.execution.startedAt=fixture.stamp;
  assert.equal(validators["tb-rows"].root(later),true);assert.equal(validators["tb-rows"].fresh(later),false);
  const extra=structuredClone(row);extra.location.latitude=-28.5;assert.equal(validators["tb-rows"].root(extra),false);
 }
});

test("each required root/fresh group is enforced without coercion or default insertion",()=>{
 const payload=creationPayload({tbId:fixture.tbId,source:"PREPAID_SALES_NON_GPS",reason:"Test"},fixture.scope,1,"ordinaryAutoFenceId1");
 const common={payload,creationDate:fixture.stamp,actorUid:fixture.actor.uid,actorName:fixture.actor.user};
 const parent=buildTargetedBatchParentDoc({...common,fingerprint:"A".repeat(64)}),row=buildTargetedBatchRowDoc({...common,salesSource:fixture.sales,salesAllMeterId:"00123",rowNo:1,erfReference:{erfId:"ERF1",erfNo:"123"}});
 for(const [name,doc,keys]of [["tb-uploads",parent,["id","scope","source","selection","creation","allocation","acceptance","execution","counts","metadata"]],["tb-rows",row,["id","tbId","rowNo","scope","source","meter","customer","location","decision","allocation","execution","refs","metadata"]]])for(const key of keys){const bad=structuredClone(doc);delete bad[key];const before=JSON.stringify(bad);assert.equal(validators[name].fresh(bad),false,`${name}.${key}`);assert.equal(JSON.stringify(bad),before);}
 const stringCount=structuredClone(parent);stringCount.counts.totalRows="1";assert.equal(validators["tb-uploads"].root(stringCount),false);
});

for (const version of ["0.1.0", "0.2.0"]) test(`historical ${version} documents remain valid only under the compatibility root`, () => {
 const payload=creationPayload({tbId:fixture.tbId,source:"PREPAID_SALES",reason:"Historical fixture"},fixture.scope,1,"ordinaryAutoFenceId1");
 const common={payload,creationDate:fixture.stamp,actorUid:fixture.actor.uid,actorName:fixture.actor.user};
 const parent={...buildTargetedBatchParentDoc({...common,fingerprint:"A".repeat(64)}),schemaVersion:version};
 const row={...buildTargetedBatchRowDoc({...common,salesSource:fixture.sales,salesAllMeterId:"00123",rowNo:1,erfReference:{erfId:"ERF1",erfNo:"123"}}),schemaVersion:version};
 if(version==="0.1.0"){row.meter.salesAllMeterId=row.salesAllMeterId;delete row.salesAllMeterId;}
 for(const [name,doc]of [["tb-uploads",parent],["tb-rows",row]]){assert.equal(validators[name].root(doc),true,JSON.stringify(validators[name].root.errors));assert.equal(validators[name].fresh(doc),false);}
});
