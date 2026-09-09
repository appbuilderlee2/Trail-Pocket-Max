import test from 'node:test';
import assert from 'node:assert/strict';
import {addFix,newActivity,resume} from '../activity-core.mjs';

const fix=(timestamp,longitude,accuracy)=>({
  timestamp,
  coords:{longitude,latitude:-34,altitude:null,altitudeAccuracy:null,accuracy},
});

test('GPS diagnostics explain accepted and filtered fixes',()=>{
  const activity=newActivity(null,0);
  resume(activity,0);
  addFix(activity,fix(1000,138,2),1000);
  addFix(activity,fix(2000,138.000001,2),2000);
  addFix(activity,fix(3000,138.1,2),3000);
  addFix(activity,fix(4000,138.2,90),4000);
  assert.deepEqual({...activity.gpsStats},{
    received:4,accepted:1,invalid:0,waiting:0,poor:1,jumps:1,drift:1,gaps:0,
    accuracyTotal:2,lastAccuracy:2,
  });
});
