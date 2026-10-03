import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeWardSummaries,COUNT_FIELDS} from './wardRegistryModel.js';
const wards=[1,2,3].map(n=>({id:'W'+n,code:n,parents:{localMunicipalityId:'LM'}}));
const summary={ward:{pcode:'W2'},counts:Object.fromEntries(COUNT_FIELDS.map(k=>[k,0]))};
test('all source wards remain present and successful zero is distinct from pending',()=>{const rows=mergeWardSummaries(wards,[summary]);assert.equal(rows.length,3);assert.equal(rows[0].counts.totalErfs,'Pending');assert.equal(rows[1].counts.totalErfs,0);assert.equal(rows[1].calculation.state,'READY');});
test('failed read and failed calculation display unavailable',()=>{assert.equal(mergeWardSummaries(wards,[summary],true)[1].counts.totalErfs,'Unavailable');assert.equal(mergeWardSummaries(wards,[{...summary,calculation:{state:'UNAVAILABLE'}}])[1].counts.totalErfs,'Unavailable');});
test('incomplete and queued summaries cannot display zeros',()=>{for(const s of [{...summary,counts:{}},{...summary,calculation:{state:'PENDING'}}]) assert.equal(mergeWardSummaries(wards,[s])[1].counts.totalErfs,'Pending');});
test('orphan summaries do not introduce wards outside the source list',()=>{assert.equal(mergeWardSummaries([], [summary]).length,0);});
