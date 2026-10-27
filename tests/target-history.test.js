import test from 'node:test';
import assert from 'node:assert/strict';
import {TargetHistory} from '../src/target-history.js';
const clone=value=>structuredClone(value);
function base(){return {targets:[
 {t:0,polygon:[[-.5,-.4],[.5,-.4],[0,.5]]},
 {t:1,polygon:[[-.42,-.42],[.42,-.42],[.42,.42],[-.42,.42]]}
],active:0};}
function moved(value,amount=.1){const r=clone(value);r.targets[0].polygon[0][0]+=amount;return r;}
function applied(result){assert.equal(result.status,'applied');return result.snapshot;}
test('mixed edits restore exact moments, order and selection; a changed branch drops redo',()=>{
 const h=new TargetHistory(),a=base(),b=moved(a),c=clone(b);
 c.targets.splice(1,0,{t:.5,polygon:[[-.2,-.2],[.2,-.2],[0,.3]]});c.active=1;
 const d=clone(c);d.targets.splice(0,1);d.active=0;
 applied(h.commit(a,b,'Move'));applied(h.commit(b,c,'Add'));applied(h.commit(c,d,'Remove'));
 assert.deepEqual(applied(h.undo(d)),c);assert.deepEqual(applied(h.undo(c)),b);
 assert.deepEqual(applied(h.redo(b)),c);
 const branch=moved(c,.03),r=h.commit(c,branch,'Transform');
 assert.equal(r.clearedRedo,1);assert.equal(h.redo(branch).status,'empty');
 assert.deepEqual(applied(h.undo(branch)),c);assert.deepEqual(applied(h.undo(c)),b);
 assert.deepEqual(applied(h.undo(b)),a);assert.equal(h.undo(a).status,'empty');
});
test('callers cannot mutate retained snapshots through inputs or returned values',()=>{
 const h=new TargetHistory(),a=base(),b=moved(a),ea=clone(a),eb=clone(b);
 applied(h.commit(a,b));a.targets[0].polygon[0][0]=999;b.targets.reverse();
 const u=applied(h.undo(eb));assert.deepEqual(u,ea);u.targets[0].polygon[0][0]=123;
 const r=applied(h.redo(ea));assert.deepEqual(r,eb);r.targets[0].polygon.length=0;
 assert.deepEqual(applied(h.undo(eb)),ea);
});
test('navigation does not create a step or invalidate undo/redo',()=>{
 const h=new TargetHistory(),a=base(),b=moved(a);b.active=1;
 applied(h.commit(a,b));const n=clone(b);n.active=0;
 assert.equal(h.commit(b,n).status,'noop');assert.equal(h.state().steps,1);
 assert.deepEqual(applied(h.undo(n)),a);
 const navigated=clone(a);navigated.active=1;assert.deepEqual(applied(h.redo(navigated)),b);
});
test('no-op and rejected snapshots preserve redo and accounting',()=>{
 const h=new TargetHistory(),a=base(),b=moved(a);
 applied(h.commit(a,b));applied(h.undo(b));const state=h.state();
 assert.equal(h.commit(a,clone(a)).status,'noop');assert.deepEqual(h.state(),state);
 const bad=clone(a);bad.targets[0].polygon[0][0]=NaN;
 assert.equal(h.commit(a,bad).status,'invalid');assert.equal(h.undo(bad).status,'invalid');
 assert.deepEqual(h.state(),state);assert.deepEqual(applied(h.redo(a)),b);
});
test('stale current targets are never overwritten by undo or redo',()=>{
 const a=base(),b=moved(a);
 for(const direction of ['undo','redo']){
  const h=new TargetHistory();applied(h.commit(a,b));let current=b;
  if(direction==='redo')current=applied(h.undo(b));
  const unrelated=moved(current,.07),expected=clone(unrelated),r=h[direction](unrelated);
  assert.equal(r.status,'stale');assert.equal(r.snapshot,null);assert.equal(r.invalidated,true);
  assert.deepEqual(unrelated,expected);assert.equal(h.state().steps,0);assert.equal(h.state().bytes,0);
 }
});
test('a tracked edit after an untracked change starts a safe new chain',()=>{
 const h=new TargetHistory(),a=base(),b=moved(a);applied(h.commit(a,b));
 const c=moved(b,.2),d=moved(c,.03),r=h.commit(c,d);
 assert.equal(r.status,'applied');assert.equal(r.invalidated,true);assert.equal(h.state().steps,1);
 assert.deepEqual(applied(h.undo(d)),c);assert.equal(h.undo(c).status,'empty');
});
test('step limit includes both stacks, preserving whole transactions and accounting',()=>{
 const h=new TargetHistory({maxSteps:2}),a=base(),b=moved(a),c=moved(b),d=moved(c);
 applied(h.commit(a,b));applied(h.commit(b,c));assert.equal(h.commit(c,d).dropped,1);
 const bytes=h.state().bytes;assert.equal(h.state().steps,2);
 assert.deepEqual(applied(h.undo(d)),c);assert.equal(h.state().redoSteps,1);
 assert.deepEqual(applied(h.undo(c)),b);assert.equal(h.state().redoSteps,2);
 assert.equal(h.state().bytes,bytes);assert.equal(h.undo(b).status,'empty');
 const branch=moved(b,.08);applied(h.commit(b,branch));assert.equal(h.state().steps,1);
});
test('byte budget evicts old entries; moving entries between stacks costs no extra bytes',()=>{
 const a=base(),b=moved(a),c=moved(b),first=new TargetHistory(),second=new TargetHistory();
 applied(first.commit(a,b,'Move'));applied(second.commit(b,c,'Move'));
 const budget=Math.max(first.state().bytes,second.state().bytes),h=new TargetHistory({maxBytes:budget});
 applied(h.commit(a,b,'Move'));assert.equal(h.commit(b,c,'Move').dropped,1);
 assert.equal(h.state().steps,1);assert.ok(h.state().bytes<=budget);const bytes=h.state().bytes;
 assert.deepEqual(applied(h.undo(c)),b);assert.equal(h.state().bytes,bytes);
 assert.equal(h.undo(b).status,'empty');assert.deepEqual(applied(h.redo(b)),c);
});
test('oversize accepted edit clears unsafe history without mutating the edit',()=>{
 const a=base(),b=moved(a),probe=new TargetHistory();applied(probe.commit(a,b));
 const h=new TargetHistory({maxBytes:probe.state().bytes});applied(h.commit(a,b));applied(h.undo(b));
 const large=moved(a);large.targets[0].polygon=Array.from({length:200},(_,i)=>[i/201,(i+1)/203]);
 const expected=clone(large),r=h.commit(a,large,'Draw');
 assert.equal(r.status,'oversize');assert.equal(r.clearedRedo,1);assert.deepEqual(large,expected);
 assert.equal(h.state().steps,0);assert.equal(h.state().bytes,0);
});
test('precision, signed zero and target order survive history',()=>{
 const h=new TargetHistory(),a=base();a.targets[0].polygon[0][0]=-0;
 const b=clone(a);b.targets[0].polygon[0][0]=0;applied(h.commit(a,b));
 const restored=applied(h.undo(b));assert.ok(Object.is(restored.targets[0].polygon[0][0],-0));
 assert.deepEqual(applied(h.redo(restored)),b);
 const reordered=clone(b);reordered.targets.reverse();assert.equal(h.undo(reordered).status,'stale');
});
test('clear drops both stacks and returned state cannot alter history',()=>{
 const h=new TargetHistory(),a=base(),b=moved(a);applied(h.commit(a,b));applied(h.undo(b));
 const state=h.state();state.bytes=0;state.redoSteps=999;
 assert.equal(h.state().redoSteps,1);assert.ok(h.state().bytes>0);
 const cleared=h.clear();assert.equal(cleared.steps,0);assert.equal(cleared.bytes,0);
 assert.equal(cleared.canUndo,false);assert.equal(cleared.canRedo,false);assert.equal(h.redo(a).status,'empty');
});
test('invalid limits and active indices fail without damaging valid history',()=>{
 for(const options of [{maxSteps:0},{maxSteps:1.5},{maxBytes:-1},{maxBytes:Infinity}])
  assert.throws(()=>new TargetHistory(options),RangeError);
 const h=new TargetHistory(),a=base(),b=moved(a);applied(h.commit(a,b));const state=h.state();
 for(const active of [-1,2,.5,NaN,'0']){const invalid=clone(b);invalid.active=active;
  assert.equal(h.commit(a,invalid).status,'invalid');assert.equal(h.undo(invalid).status,'invalid');
  assert.deepEqual(h.state(),state);}
});
