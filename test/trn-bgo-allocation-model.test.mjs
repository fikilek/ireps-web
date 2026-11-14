import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrnAllocationModel,toggleTrnAllocationSelection} from '../src/pages/operations/md-bgo/trnAllocationModel.js';
test('Ward GeoJSON retains polygon holes and multipart boundaries for the shared map',()=>{
 const ring=[[30,-28],[31,-28],[31,-29],[30,-28]],hole=[[30.1,-28.1],[30.2,-28.1],[30.2,-28.2],[30.1,-28.1]];
 const model=buildTrnAllocationModel({batches:[{id:'B1',contractVersion:'current',workflowState:'READY_FOR_ALLOCATION',wardPcode:'W1',totalRows:200}],wards:[{id:'W1',geometry:{type:'MultiPolygon',coordinates:[[ring,hole],[ring]]}}]});
 assert.equal(model.items[0].fence.allocationPolygons.length,2);assert.equal(model.items[0].fence.allocationPolygons[0].length,2);assert.equal(model.readyNotOnMap,0);
});
test('TRN allocation selection enforces the existing 200-meter maximum and permits removal',()=>{
 const items=[{bgoBatchId:'A',state:'READY',erfCount:150},{bgoBatchId:'B',state:'READY',erfCount:50},{bgoBatchId:'C',state:'READY',erfCount:1}];
 assert.deepEqual(toggleTrnAllocationSelection(['A'],items[1],items).ids,['A','B']);
 assert.deepEqual(toggleTrnAllocationSelection(['A','B'],items[2],items).ids,['A','B']);
 assert.deepEqual(toggleTrnAllocationSelection(['A','B'],items[0],items).ids,['B']);
});
