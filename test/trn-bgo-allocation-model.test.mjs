import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrnAllocationMeterPins, buildTrnAllocationModel, toggleTrnAllocationSelection } from '../src/pages/operations/md-bgo/trnAllocationModel.js';
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
test('buildTrnAllocationModel sorts newest first and marks started batches non-reallocatable', () => {
 const model = buildTrnAllocationModel({
  batches: [
   { id: 'OLD', contractVersion: 'current', workflowState: 'READY_FOR_ALLOCATION', wardPcode: 'W1', totalRows: 5, createdAt: '2026-11-16T10:00:00Z' },
   { id: 'NEW_STARTED', contractVersion: 'current', workflowState: 'ISSUED', wardPcode: 'W1', totalRows: 3, createdAt: '2026-11-17T10:00:00Z', progress: { inProgress: 1 }, assignment: { targets: [{ type: 'SP', name: 'Acorn' }] } },
  ],
  wards: [],
 });
 assert.deepEqual(model.items.map((i) => i.bgoBatchId), ['NEW_STARTED', 'OLD']);
 assert.equal(model.items[0].allocatedTo, 'SP: Acorn');
 assert.equal(model.items[0].canAllocate, false);
 assert.equal(model.items[1].allocatedTo, 'Unallocated');
 assert.equal(model.items[1].canAllocate, true);
});
test('buildTrnAllocationMeterPins extracts GPS and InfoWindow metadata from asts and premises', () => {
 const pins = buildTrnAllocationMeterPins({
  rawRows: [{ id: 'R1', astId: 'A1', input: { meterNo: 'M1', erfNo: '101' }, premise: { address: '1 Main St' } }],
  asts: [{ id: 'A1', status: { state: 'DISCONNECTED' }, astData: { location: { gps: { latitude: -28.16, longitude: 30.23 } } } }],
 });
 assert.equal(pins.length, 1);
 assert.equal(pins[0].meterNo, 'M1');
 assert.equal(pins[0].meterStatus, 'DISCONNECTED');
 assert.deepEqual(pins[0].position, { lat: -28.16, lng: 30.23 });
});
