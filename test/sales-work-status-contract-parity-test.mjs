// A23 adaptation: independent three-state/NGP/Python parity and no persistence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {classifySalesWorkStatus,resolveSalesTargetedBatchMembership,inspectSalesTbRefsIntegrity} from "../functions/salesAllMeters/sales-batch-policy.js";
import {classifyNonGpsSalesRow} from "../src/pages/sales/models/nonGpsBatchPlanningModel.js";
const corpus=JSON.parse(fs.readFileSync(new URL("../scripts/tools/sales-work-status-audit/fixtures/classifier_parity.json",import.meta.url),"utf8"));
test("A23 JS/Python share all statuses, membership and integrity without mutation",()=>{
 const audit=fileURLToPath(new URL("../scripts/tools/sales-work-status-audit/",import.meta.url));
 const code='import sys,json; from sales_work_status_classifier import derive_new_sales_status,resolve_current_membership,inspect_tbrefs; cases=json.load(sys.stdin); print(json.dumps([{ "status":derive_new_sales_status(c["data"]),"membership":resolve_current_membership(c["data"]),"valid":inspect_tbrefs(c["data"].get("tbRefs",[]))["valid"]} for c in cases]))';
 const python=JSON.parse(execFileSync("python",["-B","-c",code],{cwd:audit,input:JSON.stringify(corpus.canonicalCases),encoding:"utf8",env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"}}));
 const states=new Set();corpus.canonicalCases.forEach((item,index)=>{const before=JSON.stringify(item.data),status=classifySalesWorkStatus(item.data);states.add(status);assert.deepEqual(python[index],{status,membership:resolveSalesTargetedBatchMembership(item.data).state,valid:inspectSalesTbRefsIntegrity(item.data.tbRefs).valid},item.name);assert.equal(JSON.stringify(item.data),before);});
 assert.deepEqual([...states].sort(),["COMPLETED","IN_PROGRESS","NOT_STARTED"]);
});
test("A23 Non-GPS classification derives from raw Sales, never a persisted projection",()=>{
 const base={id:"00123",meterNo:"00123",meterNoNormalized:"00123",master:{id:"00123",visibility:"INVISIBLE"},lmPcode:"ZA5241",town:"Dundee",adr:{strNo:"1",strName:"Main"},tbRefs:[],hasUsableGps:false,salesWorkStatus:"COMPLETED"};
 assert.equal(classifyNonGpsSalesRow(base).classification,"OUTSTANDING");
 assert.equal(classifyNonGpsSalesRow({...base,master:{...base.master,visibility:"VISIBLE"}}).classification,"DISCOVERED");
 const started=corpus.validInProgressReference;
 assert.equal(classifyNonGpsSalesRow({...base,tbRefs:[started]}).classification,"ALREADY_BATCHED");
});
test("Sales projection module has no persistence or Mobile dependency",()=>{
 const source=fs.readFileSync(new URL("../src/redux/salesApi.js",import.meta.url),"utf8");
 assert.doesNotMatch(source,/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/);
 assert.doesNotMatch(source,/ireps-mobile/);
});
