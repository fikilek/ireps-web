import test from "node:test";
import assert from "node:assert/strict";
import * as validators from "../meterLifecycle/helpers.js";
import { adoptBulkInstruction, BULK_CONTRACT } from "../tcUploads/bulkPolicy.js";
for (const suffix of ["Disconnection", "Reconnection", "Inspection", "Removal", "Reading"]) {
 test(`verified bulk ${suffix} needs no office reason or substitute text, and retains No Access evidence checks`,()=>{
  const validate=validators[`validateMeter${suffix}`];
  const data={trnType:`METER_${suffix.toUpperCase()}`,origin:{channel:"OFFICE",trnBgo:{contractVersion:BULK_CONTRACT}},assignment:{instruction:{}},accessData:{access:{hasAccess:"no",reason:"Property Locked"}},media:[{tag:"noAccessPhoto",url:"https://example.test/na.jpg"}]};
  const astDoc={meterType:"electricity",status:{state:suffix==="Reconnection"?"DISCONNECTED":"CONNECTED"},ast:{astData:{meter:{type:"conventional"}}}};
  assert.match(validate({data,astDoc}).code,/INSTRUCTION_REQUIRED$/,"a JSON origin flag cannot bypass individual safeguards");
  adoptBulkInstruction(data,data);
  assert.equal(validate({data,astDoc}).ok,true);
  data.media=[];assert.equal(validate({data,astDoc}).code,"MISSING_NO_ACCESS_PHOTO");
  data.accessData.access.reason="";assert.equal(validate({data,astDoc}).code,"NO_ACCESS_REASON_REQUIRED");
 });
}
