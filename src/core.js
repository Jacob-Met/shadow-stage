// A single persistent planar cutout, illuminated by a point source onto z=0.
const FORMAT = 'shadow-stage/scene-v1';
const finite = v => typeof v === 'number' && Number.isFinite(v);
const clone = v => JSON.parse(JSON.stringify(v));
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
function polygon(p) {
  if (!Array.isArray(p) || p.length < 3 || p.length > 512 || p.some(v => !Array.isArray(v) || v.length !== 2 || v.some(x => !finite(x) || Math.abs(x)>100))) throw new Error('Polygon needs 3–512 finite 2D vertices within ±100.');
  const area = p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
  if (Math.abs(area)<1e-8) throw new Error('Polygon must have nonzero area.');
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<p.length;i++) {
    const a=p[i],b=p[(i+1)%p.length];
    if(distance(a,b)<1e-10)throw new Error('Polygon has a repeated adjacent vertex.');
    for(let j=i+2;j<p.length;j++) {
      if(i===0&&j===p.length-1)continue;
      const c=p[j],d=p[(j+1)%p.length];
      const overlap=Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))+1e-12&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]))+1e-12;
      if(overlap&&orient(a,b,c)*orient(a,b,d)<=0&&orient(c,d,a)*orient(c,d,b)<=0)throw new Error('Polygon boundary must not intersect itself.');
    }
  }
  return p.map(v=>v.slice());
}
function keyTimes(keys) {
  if (!Array.isArray(keys) || !keys.length || keys.length>128) throw new Error('Provide 1–128 keyframes.');
  let previous=-1;
  for (const k of keys) { if (!finite(k.t)||k.t<0||k.t>1||k.t<=previous) throw new Error('Key times must increase strictly within [0,1].'); previous=k.t; }
}
export function validateTargets(targets) {
  keyTimes(targets);
  return targets.map(k=>({t:k.t,polygon:polygon(k.polygon)}));
}
export function validateScene(scene) {
  if (!scene || scene.format!==FORMAT || !finite(scene.duration)||scene.duration<=0||scene.duration>3600) throw new Error('Invalid scene format or duration.');
  polygon(scene.occluder?.vertices);
  for (const [name,keys] of [['light',scene.light?.keys],['occluder',scene.occluder?.keys]]) {
    keyTimes(keys);
    for(const k of keys) {
      for(const f of ['x','y','z',...(name==='occluder'?['angle']:[])]) if(!finite(k[f])||Math.abs(k[f])>100) throw new Error(`Invalid ${name} ${f}.`);
      if(name==='light' && k.z<0.2) throw new Error('Light must remain above screen.');
      if(name==='occluder' && k.z<0.01) throw new Error('Cutout must remain above screen.');
    }
  }
  // Conservative separation guarantees validity throughout bounded interpolation.
  if(Math.max(...scene.occluder.keys.map(k=>k.z)) >= Math.min(...scene.light.keys.map(k=>k.z))-0.05) throw new Error('Cutout must stay at least 0.05 below light.');
  return clone(scene);
}
function interpolate(keys,t,fields) {
  if(!finite(t)) throw new Error('Time must be finite.');
  t=Math.max(0,Math.min(1,t));
  let i=0; while(i<keys.length-1 && keys[i+1].t<t)i++;
  const a=keys[i],b=keys[Math.min(i+1,keys.length-1)];
  let u=b.t===a.t?0:Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t)));
  u=u*u*(3-2*u); // bounded C1 smoothstep: zero velocity at authored keys
  const out={}; for(const f of fields) {
    if(f!=='angle'){out[f]=u===0?a[f]:u===1?b[f]:a[f]+u*(b[f]-a[f]);continue;}
    let start=keys[0].angle;for(let j=1;j<=i;j++){const delta=keys[j].angle-keys[j-1].angle;start+=Math.atan2(Math.sin(delta),Math.cos(delta));}
    const delta=b.angle-a.angle;out.angle=start+u*Math.atan2(Math.sin(delta),Math.cos(delta));
  } return out;
}
export function sampleScene(scene,t) {
  return {light:interpolate(scene.light.keys,t,['x','y','z']),occluder:{...interpolate(scene.occluder.keys,t,['x','y','z','angle']),vertices:scene.occluder.vertices.map(p=>p.slice())}};
}
export function projectShadow(scene,t) {
  const {light:l,occluder:o}=sampleScene(scene,t), scale=l.z/(l.z-o.z);
  if(!(o.z>0&&l.z-o.z>=0.049999)||!finite(scale))throw new Error('Invalid light/cutout separation.');
  const c=Math.cos(o.angle),s=Math.sin(o.angle);
  return o.vertices.map(([x,y])=>[scale*(o.x+c*x-s*y)+(1-scale)*l.x,scale*(o.y+s*x+c*y)+(1-scale)*l.y]);
}
function resample(p,n=64) {
  const lengths=p.map((v,i)=>distance(v,p[(i+1)%p.length])),total=lengths.reduce((a,b)=>a+b,0);
  let edge=0,start=0;
  return Array.from({length:n},(_,i)=>{const d=i*total/n;while(edge<lengths.length-1&&start+lengths[edge]<d){start+=lengths[edge++];}const u=lengths[edge]? (d-start)/lengths[edge]:0,a=p[edge],b=p[(edge+1)%p.length];return [a[0]+u*(b[0]-a[0]),a[1]+u*(b[1]-a[1])];});
}
const center=p=>p.reduce((s,v)=>[s[0]+v[0]/p.length,s[1]+v[1]/p.length],[0,0]);
function similarity(base,target) {
  // Exact vertex correspondence avoids phase quantization when authored polygons
  // have equal topology but a different starting vertex or winding direction.
  const native=base.length===target.length;
  const a=native?base:resample(base),raw=native?target:resample(target),ac=center(a),bc=center(raw);
  let best;
  for(const reversed of [false,true]) for(let shift=0;shift<a.length;shift++) {
    const b=a.map((_,i)=>raw[(shift+(reversed?-i:i)+a.length)%a.length]);
    let dot=0,cross=0,den=0;
    a.forEach((p,i)=>{const x=p[0]-ac[0],y=p[1]-ac[1],u=b[i][0]-bc[0],v=b[i][1]-bc[1];dot+=x*u+y*v;cross+=x*v-y*u;den+=x*x+y*y;});
    const angle=Math.atan2(cross,dot),scale=Math.hypot(dot,cross)/den,c=Math.cos(angle),s=Math.sin(angle);
    const x=bc[0]-scale*(c*ac[0]-s*ac[1]),y=bc[1]-scale*(s*ac[0]+c*ac[1]);
    const rms=Math.sqrt(a.reduce((sum,p,i)=>sum+(scale*(c*p[0]-s*p[1])+x-b[i][0])**2+(scale*(s*p[0]+c*p[1])+y-b[i][1])**2,0)/a.length);
    if(!best||rms<best.rms)best={x,y,angle,scale,rms,aligned:native?resample(b):b};
  }
  return best;
}
export function targetAt(targets,t) {
  if(!finite(t))throw new Error('Time must be finite.');
  let i=0;while(i<targets.length-1&&targets[i+1].t<t)i++;
  const a=targets[i],b=targets[Math.min(i+1,targets.length-1)],ap=resample(a.polygon),bp=similarity(a.polygon,b.polygon).aligned;
  let u=a.t===b.t?0:Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t)));u=u*u*(3-2*u);
  return ap.map((v,j)=>[v[0]+u*(bp[j][0]-v[0]),v[1]+u*(bp[j][1]-v[1])]);
}
function boundaryError(a,b) {
  function directed(p,q) {return p.reduce((sum,v)=>sum+Math.min(...q.map((w,i)=>{const e=q[(i+1)%q.length],dx=e[0]-w[0],dy=e[1]-w[1],den=dx*dx+dy*dy,u=den?Math.max(0,Math.min(1,((v[0]-w[0])*dx+(v[1]-w[1])*dy)/den)):0;return (v[0]-w[0]-u*dx)**2+(v[1]-w[1]-u*dy)**2;})),0)/p.length;}
  return Math.sqrt((directed(resample(a),b)+directed(resample(b),a))/2);
}
export function measureFit(scene,targets,options={}) {
  validateScene(scene);targets=validateTargets(targets);
  const authored=targets.map(k=>({t:k.t,rms:boundaryError(projectShadow(scene,k.t),k.polygon)}));
  const count=Math.min(201,Math.max(3,Math.round(options.samples||25)));
  const interpolated=Array.from({length:count},(_,i)=>{const t=i/(count-1);return {t,rms:boundaryError(projectShadow(scene,t),targetAt(targets,t))};});
  const mean=rows=>Math.sqrt(rows.reduce((s,r)=>s+r.rms*r.rms,0)/rows.length);
  const baseline=targets.map(k=>({t:k.t,rms:boundaryError(targets[0].polygon,k.polygon)}));
  return {authoredKeyRms:mean(authored),authoredKeys:authored,interpolatedTargetRms:mean(interpolated),interpolatedTargets:interpolated,noSolveBaselineRms:mean(baseline),geometricallyValid:true,persistentCutout:true,residualMetric:'Symmetric sampled boundary-to-segment RMS in stage coordinates; not pixel overlap.',targetInterpolation:'Cyclic boundary correspondence and bounded smoothstep; an authoring choice, not observed ground truth.',limitations:'One planar persistent cutout; incompatible shapes retain measurable residual.'};
}
export function fitScene(input,{lightShare=0.65,duration=8}={}) {
  const targets=validateTargets(input);
  if(!finite(lightShare)||lightShare<0||lightShare>1)throw new Error('Light share must be between 0 and 1.');
  const origin=center(targets[0].polygon),base=targets[0].polygon.map(p=>[p[0]-origin[0],p[1]-origin[1]]);
  const fits=targets.map(k=>similarity(base,k.polygon));
  const shrink=Math.min(...fits.map(f=>f.scale))/1.4;
  if(!(shrink>1e-6))throw new Error('Targets require a degenerate cutout.');
  const vertices=base.map(p=>p.map(v=>v*shrink));
  const light=[],occluder=[];
  fits.forEach((f,i)=>{const scale=f.scale/shrink,z=5*(1-1/scale);light.push({t:targets[i].t,x:-f.x*lightShare/(scale-1),y:-f.y*lightShare/(scale-1),z:5});occluder.push({t:targets[i].t,x:f.x*(1-lightShare)/scale,y:f.y*(1-lightShare)/scale,z,angle:f.angle});});
  const scene=validateScene({format:FORMAT,duration,light:{keys:light},occluder:{vertices,keys:occluder}});
  return {scene,report:measureFit(scene,targets)};
}
const shape=[[-.48,-.38],[.25,-.42],[.48,-.05],[.2,.45],[-.4,.3]];
export const DEFAULT_TARGETS=[{t:0,polygon:shape},{t:.5,polygon:shape.map(([x,y])=>[.8*(.866*x-.5*y)+.35,.8*(.5*x+.866*y)+.15])},{t:1,polygon:shape.map(([x,y])=>[1.15*x-.25,1.15*y-.1])}];
