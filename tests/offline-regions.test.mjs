import test from 'node:test';
import assert from 'node:assert/strict';
import {areaKm2} from '../core.mjs';
import {OFFLINE_REGIONS,filterRegions} from '../offline-regions.mjs';
test('suggested hiking regions are unique and within downloadable limits',()=>{assert.equal(new Set(OFFLINE_REGIONS.map(r=>r.id)).size,OFFLINE_REGIONS.length);for(const r of OFFLINE_REGIONS){assert.ok(r.name&&r.places);assert.ok(areaKm2(r.bounds)>1);assert.ok(areaKm2(r.bounds)<=500);}});
test('region search matches park and trail names',()=>{assert.equal(filterRegions(OFFLINE_REGIONS,'devils')[0].id,'para-wirra');assert.equal(filterRegions(OFFLINE_REGIONS,'Waterfall Gully')[0].id,'cleland');assert.equal(filterRegions(OFFLINE_REGIONS,'missing').length,0);});
