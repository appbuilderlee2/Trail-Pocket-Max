import test from 'node:test';
import assert from 'node:assert/strict';
import {isWalkable,walkingCost} from '../package-index-core.mjs';

test('South Australia graph excludes restricted access and unmarked driveways',()=>{
  assert.equal(isWalkable({highway:'path',access:'private'}),false);
  assert.equal(isWalkable({highway:'service',service:'driveway'}),false);
  assert.equal(isWalkable({highway:'service',service:'driveway',foot:'designated'}),true);
  assert.equal(isWalkable({highway:'motorway'}),false);
});

test('walking graph prefers official trails over traffic roads',()=>{
  assert.ok(walkingCost({highway:'path',route:'hiking'})<walkingCost({highway:'path'}));
  assert.ok(walkingCost({highway:'path'})<walkingCost({highway:'residential'}));
  assert.ok(walkingCost({highway:'residential'})<walkingCost({highway:'tertiary'}));
});
