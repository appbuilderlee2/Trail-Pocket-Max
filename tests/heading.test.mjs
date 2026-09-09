import test from 'node:test';
import assert from 'node:assert/strict';
import {compassReading, chooseHeading, destination} from '../heading.mjs';
const now=100000, fix=(over={})=>({timestamp:now,coords:{accuracy:8,speed:1,heading:90,...over}});
test('GPS direction is course, stationary or absent heading never points north by coercion',()=>{
 assert.equal(chooseHeading(fix(),null,now).bearing,90);
 for(const heading of [null,undefined,NaN]) assert.equal(chooseHeading(fix({heading}),null,now),null);
 assert.equal(chooseHeading(fix({speed:0}),null,now),null);
});
test('stale or poor fixes hide heading and compass expires independently',()=>{
 const compass={bearing:350,timestamp:now,source:'compass'};
 assert.equal(chooseHeading({...fix(),timestamp:now-21000},compass,now),null);
 assert.equal(chooseHeading(fix({accuracy:80}),compass,now),null);
 assert.equal(chooseHeading(fix({speed:0}),compass,now).source,'compass');
 assert.equal(chooseHeading(fix({speed:0}),{...compass,timestamp:now-4000},now),null);
});
test('compass rejects relative yaw, poor calibration and unsafe tilt, normalizes landscape',()=>{
 assert.equal(compassReading({alpha:90,absolute:false}),null);
 assert.equal(compassReading({webkitCompassHeading:20,webkitCompassAccuracy:-1}),null);
 assert.equal(compassReading({webkitCompassHeading:20,webkitCompassAccuracy:60}),null);
 assert.equal(compassReading({alpha:90,absolute:true,beta:80,gamma:0}),null);
 assert.equal(compassReading({webkitCompassHeading:350,webkitCompassAccuracy:10},90,now).bearing,80);
});
test('geographic direction offsets preserve cardinal directions for GeoPDF projection',()=>{
 const point=[138.8,-34.7];
 assert.ok(destination(point,0)[1]>point[1]);
 assert.ok(destination(point,90)[0]>point[0]);
 assert.ok(destination(point,180)[1]<point[1]);
 assert.ok(destination(point,270)[0]<point[0]);
});
