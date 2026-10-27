import test from 'node:test';
import assert from 'node:assert/strict';
import {fitScene,sampleScene} from '../src/core.js';
import {fitArticulated,sampleArticulatedScene,projectArticulated,validateArticulatedScene} from '../src/articulated.js';

const square=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
const stair=[[-.5,-.5],[.5,-.5],[.5,0],[1,0],[1,1],[0,1],[0,.5],[-.5,.5]];
const targets=[{t:0,polygon:square},{t:1,polygon:stair}];
function ray(light,piece){
  assert.ok(piece.z>0&&light.z-piece.z>=.05,'Every persistent piece has finite positive clearance');
  const c=Math.cos(piece.angle),s=Math.sin(piece.angle),travel=light.z/(light.z-piece.z);
  return piece.vertices.map(([x,y])=>{
    const X=piece.x+c*x-s*y,Y=piece.y+s*x+c*y;
    const p=[light.x+travel*(X-light.x),light.y+travel*(Y-light.y)];
    assert.ok(p.every(Number.isFinite));return p;
  });
}
function independent(scene,t){const s=sampleArticulatedScene(scene,t);return s.occluders.map(p=>ray(s.light,p));}
function inside(x,y,p){let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function maskError(a,b){
  // Fixed independent observation window and sampling grid, unlike production's
  // target-dependent bounds and 96-pixel evaluation grid.
  let union=0,xor=0;
  for(let y=0;y<151;y++)for(let x=0;x<151;x++){
    const X=-.75+(x+.5)*2/151,Y=-.75+(y+.5)*2/151;
    const aa=a.some(p=>inside(X,Y,p)),bb=b.some(p=>inside(X,Y,p));
    if(aa||bb)union++;if(aa!==bb)xor++;
  }
  return union?xor/union:0;
}
function knownPhysicalUnion(t){const u=t*t*(3-2*t);return [square,square.map(([x,y])=>[x+.5*u,y+.5*u])];}

test('two persistent physical pieces realize a genuinely different concave silhouette',()=>{
  const before=JSON.stringify(targets);
  const {scene,report}=fitArticulated(targets,{maxPieces:2,resolution:48,coverageTolerance:0,duration:4});
  assert.equal(JSON.stringify(targets),before);
  assert.equal(scene.format,'shadow-stage/articulated-v1');
  assert.equal(scene.occluders.length,2,'Known feasible two-piece scene needs no extra geometry');
  const initial=independent(scene,0),end=independent(scene,1);
  assert.ok(maskError(initial,[square])<.02);
  assert.ok(maskError(end,[stair])<.02,'Actual projected union reproduces distinct target geometry');
  assert.ok(maskError(initial,[stair])>.3,'Static first silhouette must fail this fixture');
  assert.ok(report.authoredMaskError<.025);
  const planar=fitScene(targets,{lightShare:.5,duration:4}).scene;
  const p=sampleScene(planar,1),planarError=maskError([ray(p.light,p.occluder)],[stair]);
  assert.ok(planarError>.1,`Single-template similarity remains insufficient: ${planarError}`);
  assert.ok(maskError(end,[stair])<planarError*.25);
});

test('known feasible intermediate masks are independent of boundary-morph targets',()=>{
  const {scene}=fitArticulated(targets,{maxPieces:2,resolution:48,coverageTolerance:0,duration:4});
  for(const t of [.13,.29,.47,.71,.89]){
    const actual=independent(scene,t);
    assert.ok(maskError(actual,knownPhysicalUnion(t))<.025,`Independent physical fixture mismatch at t=${t}`);
    const published=projectArticulated(scene,t);
    published.forEach((polygon,i)=>polygon.forEach((p,j)=>p.forEach((v,k)=>assert.ok(Math.abs(v-actual[i][j][k])<1e-8))));
  }
});

test('insufficient piece budget preserves visible residual and reports it honestly',()=>{
  const {scene,report}=fitArticulated(targets,{maxPieces:1,resolution:48,coverageTolerance:0,duration:4});
  assert.equal(scene.occluders.length,1);
  const residual=targets.reduce((sum,k)=>sum+maskError(independent(scene,k.t),[k.polygon]),0)/targets.length;
  assert.ok(residual>.15,'One physical square cannot reproduce the concave target');
  assert.ok(report.authoredMaskError>.15,'Reported fit must retain budget failure');
  assert.ok(Math.abs(residual-report.authoredMaskError)<.035,'Independent mask and visible report agree');
  assert.ok(report.optimization.keyCoverage.at(-1).uncoveredFraction>.2);
});

test('exported articulated scene retains identity, geometry and bounded continuous motion',()=>{
  const {scene}=fitArticulated(targets,{maxPieces:2,resolution:48,coverageTolerance:0,duration:4});
  const reopened=validateArticulatedScene(JSON.parse(JSON.stringify(scene)));
  const ids=scene.occluders.map(p=>p.id),geometry=scene.occluders.map(p=>JSON.stringify(p.vertices));
  let previous;
  for(let i=0;i<=100;i++){
    const t=i/100,sample=sampleArticulatedScene(reopened,t),polygons=independent(reopened,t);
    assert.deepEqual(sample.occluders.map(p=>p.id),ids);
    assert.deepEqual(sample.occluders.map(p=>JSON.stringify(p.vertices)),geometry);
    for(const p of sample.occluders){assert.ok(!('opacity' in p)&&!('visible' in p),'No piece disappears through alpha or visibility');}
    if(previous)polygons.forEach((p,j)=>p.forEach((v,k)=>assert.ok(Math.hypot(v[0]-previous[j][k][0],v[1]-previous[j][k][1])<.025)));
    assert.ok(maskError(polygons,independent(scene,t))===0,'Fresh serialized scene retains rendering');
    previous=polygons;
  }
});
