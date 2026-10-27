import test from 'node:test';
import assert from 'node:assert/strict';
import { fitScene, projectShadow, sampleScene, validateScene, validateTargets } from '../src/core.js';

// These acceptance oracles do not call the production projection or fit metric.
function rayProject(sample) {
  const { light: l, occluder: o } = sample;
  assert.ok(Number.isFinite(l.z) && Number.isFinite(o.z) && o.z > 0 && l.z > o.z,
    'Every sampled cutout remains strictly between light and stage');
  const c = Math.cos(o.angle), s = Math.sin(o.angle);
  return o.vertices.map(([x,y]) => {
    const vx = o.x + c*x - s*y, vy = o.y + s*x + c*y;
    const k = l.z / (l.z - o.z);
    return [l.x + k*(vx-l.x), l.y + k*(vy-l.y)];
  });
}
function inside([x,y], polygon) {
  let result = false;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const [xi,yi]=polygon[i], [xj,yj]=polygon[j];
    if ((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) result=!result;
  }
  return result;
}
function maskError(a,b) {
  const all=[...a,...b], xs=all.map(p=>p[0]), ys=all.map(p=>p[1]);
  const loX=Math.min(...xs), loY=Math.min(...ys), w=Math.max(...xs)-loX, h=Math.max(...ys)-loY;
  let union=0, xor=0;
  for(let y=0;y<96;y++) for(let x=0;x<96;x++) {
    const p=[loX+w*(x+.5)/96,loY+h*(y+.5)/96];
    const aa=inside(p,a),bb=inside(p,b);
    if(aa||bb) union++;
    if(aa!==bb) xor++;
  }
  return union ? xor/union : 0;
}
function closePolygon(actual,expected,tolerance=1e-8) {
  assert.equal(actual.length,expected.length);
  actual.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Number.isFinite(v)&&Math.abs(v-expected[i][j])<tolerance,
    `Independent ray projection mismatch at vertex ${i}, axis ${j}: ${v} vs ${expected[i][j]}`)));
}
const base=[[-.7,-.4],[.6,-.4],[.2,.7],[-.5,.3]];
const shift=(dx,dy)=>base.map(([x,y])=>[x+dx,y+dy]);
const targets=[{t:0,polygon:shift(-.35,-.15)},{t:.5,polygon:shift(.3,.25)},{t:1,polygon:shift(.65,-.2)}];

test('synthesis preserves authored input and beats a static cutout at untrained times',()=>{
  const before=JSON.stringify(targets);
  const {scene,report}=fitScene(targets,{lightShare:.5,duration:4});
  assert.equal(JSON.stringify(targets),before,'Solver must not replace authored targets with its output');
  assert.equal(scene.format,'shadow-stage/scene-v1');
  validateScene(scene);
  const still=rayProject(sampleScene(scene,0));
  let solved=0,baseline=0;
  for(const t of [.125,.25,.375,.625,.75,.875,1]) {
    const i=t<=.5?0:1, a=targets[i],b=targets[i+1];
    let u=(t-a.t)/(b.t-a.t);u=u*u*(3-2*u);
    // Known correspondence and independent interpolation for this translation fixture.
    const polygon=a.polygon.map((p,j)=>p.map((v,k)=>v+u*(b.polygon[j][k]-v)));
    const actual=rayProject(sampleScene(scene,t));
    closePolygon(projectShadow(scene,t),actual);
    solved+=maskError(actual,polygon); baseline+=maskError(still,polygon);
  }
  assert.ok(baseline>.2,'Fixture must expose a real static-baseline failure');
  assert.ok(solved<baseline*.4,`Synthesis must improve held-out masks: ${solved} vs ${baseline}`);
  assert.ok(report.authoredKeyRms<1e-6);
});

test('exported scene independently reproduces continuous finite geometry',()=>{
  const {scene}=fitScene(targets,{lightShare:.6,duration:3});
  const restored=validateScene(JSON.parse(JSON.stringify(scene)));
  let previous;
  for(let i=0;i<=100;i++) {
    const t=i/100, actual=rayProject(sampleScene(restored,t));
    closePolygon(projectShadow(scene,t),actual);
    if(previous) {
      const step=Math.max(...actual.map((p,j)=>Math.hypot(p[0]-previous[j][0],p[1]-previous[j][1])));
      assert.ok(step<.12,`Continuous fixture cannot jump between frames: ${step}`);
    }
    previous=actual;
  }
});

test('editing physical light causes the independently predicted shadow displacement',()=>{
  const {scene}=fitScene(targets,{lightShare:.5,duration:4});
  const modified=JSON.parse(JSON.stringify(scene));
  const delta=.25;
  modified.light.keys.forEach(key=>{key.x+=delta;});
  const t=.37, before=sampleScene(scene,t), after=sampleScene(modified,t);
  const a=rayProject(before),b=rayProject(after);
  const expected=-before.occluder.z/(before.light.z-before.occluder.z)*delta;
  assert.ok(Math.abs(expected)>1e-6,'A physical edit must have an observable effect');
  b.forEach((p,i)=>{assert.ok(Math.abs(p[0]-a[i][0]-expected)<1e-8);assert.ok(Math.abs(p[1]-a[i][1])<1e-8);});
  closePolygon(projectShadow(modified,t),b);
});

test('incompatible targets retain a visible residual and one fixed cutout',()=>{
  const incompatible=[{t:0,polygon:[[-1,-1],[1,-1],[1,1],[-1,1]]},
    {t:1,polygon:[[-1,-1],[1,-1],[.1,.1],[-1,1]]}];
  const original=JSON.stringify(incompatible);
  const {scene,report}=fitScene(incompatible,{lightShare:.5,duration:3});
  assert.equal(JSON.stringify(incompatible),original);
  const vertices=JSON.stringify(sampleScene(scene,0).occluder.vertices);
  assert.equal(JSON.stringify(sampleScene(scene,1).occluder.vertices),vertices,'No hidden per-frame cutout morph');
  const residual=incompatible.reduce((sum,key)=>sum+maskError(rayProject(sampleScene(scene,key.t)),key.polygon),0);
  assert.ok(residual>.05,'Incompatible shape must not be presented as an exact physical fit');
  assert.ok(report.authoredKeyRms>.01,'Visible fit report must retain the actual incompatibility');
  assert.match(report.limitations,/residual|incompatible/i);
});

test('receiving malformed projects rejects invalid finite geometry',()=>{
  assert.throws(()=>validateTargets([{t:0,polygon:[[0,0],[1,0],[NaN,1]]}]));
  assert.throws(()=>validateTargets([{t:0,polygon:[[0,0],[1,1],[0,1],[1,0]]}]));
  const {scene}=fitScene(targets,{lightShare:.5,duration:4});
  const invalid=JSON.parse(JSON.stringify(scene)); invalid.occluder.keys[0].z=invalid.light.keys[0].z;
  assert.throws(()=>validateScene(invalid),'Cutout on light plane must be rejected before use');
});

test('light allocation changes mechanism while preserving requested shadow',()=>{
  const a=fitScene(targets,{lightShare:0,duration:4}).scene;
  const b=fitScene(targets,{lightShare:1,duration:4}).scene;
  assert.notDeepEqual(a.light.keys,b.light.keys);
  assert.notDeepEqual(a.occluder.keys,b.occluder.keys);
  for(const t of [0,.17,.5,.73,1])closePolygon(rayProject(sampleScene(a,t)),rayProject(sampleScene(b,t)));
});

test('wrapped angle tracks cross keyframes without a pose or shadow jump',()=>{
  const scene=validateScene({format:'shadow-stage/scene-v1',duration:3,
    light:{keys:[{t:0,x:0,y:0,z:5}]},
    occluder:{vertices:base,keys:[
      {t:0,x:0,y:0,z:1,angle:170*Math.PI/180},
      {t:.5,x:0,y:0,z:1,angle:-170*Math.PI/180},
      {t:1,x:0,y:0,z:1,angle:170*Math.PI/180}
    ]}});
  const before=sampleScene(scene,.5-1e-7),after=sampleScene(scene,.5+1e-7);
  assert.ok(Math.abs(before.occluder.angle-after.occluder.angle)<1e-5,'Unwrapped pose is continuous across authored key');
  closePolygon(rayProject(before),rayProject(after),1e-5);
});
