import {validateTargets,validateScene,sampleScene,projectShadow,targetAt} from './core.js';

const FORMAT='shadow-stage/articulated-v1';
const single=(scene,piece)=>({format:'shadow-stage/scene-v1',duration:scene.duration,light:scene.light,occluder:piece});
export function validateArticulatedScene(scene) {
  if(!scene||scene.format!==FORMAT||!Array.isArray(scene.occluders)||!scene.occluders.length||scene.occluders.length>64)throw new Error('Articulated scene requires 1–64 persistent cutouts.');
  const ids=new Set();
  for(const piece of scene.occluders){if(typeof piece.id!=='string'||!piece.id||ids.has(piece.id))throw new Error('Cutout IDs must be unique.');ids.add(piece.id);validateScene(single(scene,piece));}
  return JSON.parse(JSON.stringify(scene));
}
export function sampleArticulatedScene(scene,t){return {light:sampleScene(single(scene,scene.occluders[0]),t).light,occluders:scene.occluders.map(piece=>({id:piece.id,...sampleScene(single(scene,piece),t).occluder}))};}
export function projectArticulated(scene,t){return scene.occluders.map(piece=>projectShadow(single(scene,piece),t));}
function inside([x,y],polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function bounds(polygons,pad=.04){const points=polygons.flat(),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);const x=Math.min(...xs),y=Math.min(...ys),side=Math.max(Math.max(...xs)-x,Math.max(...ys)-y);return {x:x-side*pad,y:y-side*pad,side:side*(1+2*pad)};}
function mask(polygons,b,n){return Array.from({length:n*n},(_,i)=>polygons.some(p=>inside([b.x+(i%n+.5)*b.side/n,b.y+(Math.floor(i/n)+.5)*b.side/n],p)));}
function maskError(actual,target){let union=0,xor=0;for(let i=0;i<actual.length;i++){if(actual[i]||target[i])union++;if(actual[i]!==target[i])xor++;}return union?xor/union:0;}
function cover(polygon,n,maxPieces,tolerance){
  const b=bounds([polygon],0),desired=mask([polygon],b,n),uncovered=desired.slice(),dp=Array((n+1)*(n+1)).fill(0),candidates=[];
  // Largest entirely occupied square at each cell. Each candidate is evaluated
  // against uncovered area, so redundant overlaps cannot masquerade as gains.
  for(let y=n-1;y>=0;y--)for(let x=n-1;x>=0;x--)if(desired[y*n+x]){const k=y*(n+1)+x;const size=1+Math.min(dp[k+1],dp[k+n+1],dp[k+n+2]);dp[k]=size;candidates.push({x,y,size});}
  const total=desired.filter(Boolean).length;
  if(!total)throw new Error('Silhouette has no occupied cells at this resolution.');
  const result=[];let remaining=total;
  while(result.length<maxPieces&&remaining/total>tolerance){
    const prefix=Array((n+1)*(n+1)).fill(0);
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){const k=(y+1)*(n+1)+x+1;prefix[k]=Number(uncovered[y*n+x])+prefix[k-1]+prefix[k-n-1]-prefix[k-n-2];}
    let best=null,gain=0;
    for(const c of candidates){const {x,y,size:s}=c,score=prefix[(y+s)*(n+1)+x+s]-prefix[y*(n+1)+x+s]-prefix[(y+s)*(n+1)+x]+prefix[y*(n+1)+x];if(score>gain){gain=score;best=c;}}
    if(!best||!gain)break;
    for(let y=best.y;y<best.y+best.size;y++)for(let x=best.x;x<best.x+best.size;x++)uncovered[y*n+x]=false;
    remaining-=gain;
    result.push({x:b.x+(best.x+best.size/2)*b.side/n,y:b.y+(best.y+best.size/2)*b.side/n,side:best.size*b.side/n});
  }
  return {squares:result,uncoveredFraction:remaining/total,candidates:candidates.length};
}
function assign(previous,squares,count){
  // Surplus physical pieces overlap the largest existing shadow; none vanish.
  const remaining=squares.map(p=>({...p}));while(remaining.length<count)remaining.push({...squares[0]});
  if(!previous)return remaining;
  return previous.map(a=>{let selected=0,cost=Infinity;remaining.forEach((b,i)=>{const value=(a.x-b.x)**2+(a.y-b.y)**2+.1*Math.log(a.side/b.side)**2;if(value<cost){cost=value;selected=i;}});return remaining.splice(selected,1)[0];});
}
export function measureArticulated(scene,input,{resolution=96,samples=17}={}){
  scene=validateArticulatedScene(scene);const targets=validateTargets(input);
  if(!Number.isInteger(resolution)||resolution<16||resolution>256||!Number.isInteger(samples)||samples<2||samples>101)throw new Error('Invalid measurement resolution or sample count.');
  const b=bounds([...targets.map(k=>k.polygon),...targets.flatMap(k=>projectArticulated(scene,k.t))]);
  const evaluate=(t,polygon)=>({t,maskError:maskError(mask(projectArticulated(scene,t),b,resolution),mask([polygon],b,resolution))});
  const authoredKeys=targets.map(k=>evaluate(k.t,k.polygon));
  const interpolatedTargets=Array.from({length:samples},(_,i)=>{const t=i/(samples-1);return evaluate(t,targetAt(targets,t));});
  const baseline=mask([targets[0].polygon],b,resolution);
  const mean=rows=>rows.reduce((s,r)=>s+r.maskError,0)/rows.length;
  const baselineError=targets.reduce((sum,k)=>sum+maskError(baseline,mask([k.polygon],b,resolution)),0)/targets.length;
  let maximumStep=0;for(let i=1;i<=64;i++){const a=projectArticulated(scene,(i-1)/64),c=projectArticulated(scene,i/64);a.forEach((p,j)=>p.forEach((v,k)=>{maximumStep=Math.max(maximumStep,Math.hypot(v[0]-c[j][k][0],v[1]-c[j][k][1]));}));}
  return {authoredKeys,authoredMaskError:mean(authoredKeys),interpolatedTargets,interpolatedMaskError:mean(interpolatedTargets),noSolveBaselineMaskError:baselineError,complexity:{occluders:scene.occluders.length,vertices:scene.occluders.reduce((s,p)=>s+p.vertices.length,0)},geometricallyValid:true,persistentGeometry:true,maximumSampledVertexStep:maximumStep,metric:'Raster union symmetric difference / union; lower is better. Finite-resolution estimate.',targetInterpolation:'Boundary morph is an authoring choice, not observed intermediate ground truth.',limitations:'Rigid square-piece approximation; finite resolution and piece budget leave boundary residual. Continuous tracks need not match intermediate silhouettes. No seamless-loop guarantee. Cutouts may intersect in 3D; collision clearance and fabricability are not enforced.'};
}
export function fitArticulated(input,{maxPieces=24,resolution=32,duration=8,coverageTolerance=.01}={}){
  const targets=validateTargets(input);
  if(!Number.isInteger(maxPieces)||maxPieces<1||maxPieces>64||!Number.isInteger(resolution)||resolution<8||resolution>64||!Number.isFinite(coverageTolerance)||coverageTolerance<0||coverageTolerance>.5)throw new Error('Invalid piece budget, grid resolution or coverage tolerance.');
  const fits=targets.map(k=>cover(k.polygon,resolution,maxPieces,coverageTolerance));
  const count=Math.max(...fits.map(f=>f.squares.length)),minSide=Math.min(...fits.flatMap(f=>f.squares.map(s=>s.side))),baseSide=minSide/2;
  let previous=null;const assigned=fits.map(f=>{previous=assign(previous,f.squares,count);return previous;});
  const vertices=[[-1,-1],[1,-1],[1,1],[-1,1]].map(p=>p.map(v=>v*baseSide/2));
  const scene=validateArticulatedScene({format:FORMAT,duration,light:{keys:[{t:0,x:0,y:0,z:5}]},occluders:Array.from({length:count},(_,j)=>({id:`piece-${j+1}`,vertices:vertices.map(p=>p.slice()),keys:targets.map((k,i)=>{const p=assigned[i][j],scale=p.side/baseSide;return {t:k.t,x:p.x/scale,y:p.y/scale,z:5*(1-1/scale),angle:0};})}))});
  const report=measureArticulated(scene,targets);
  report.optimization={method:'Bounded greedy inscribed-square cover with incremental union-area gain; nearest-piece temporal assignment.',resolution,maxPieces,coverageTolerance,keyCoverage:fits.map((f,i)=>({t:targets[i].t,uncoveredFraction:f.uncoveredFraction,candidates:f.candidates}))};
  return {scene,report};
}

// Refine a supplied physical construction without changing its fixed geometry,
// piece count, light path, target data, or replacing it with the cover solution.
export function refineArticulated(input,initialScene,{iterations=4,resolution=32,maxEvaluations=1000}={}){
  const targets=validateTargets(input),original=validateArticulatedScene(initialScene);
  if(!Number.isInteger(iterations)||iterations<1||iterations>16||!Number.isInteger(resolution)||resolution<16||resolution>96||!Number.isInteger(maxEvaluations)||maxEvaluations<1||maxEvaluations>20000)throw new Error('Invalid refinement budget.');
  const scene={...original,light:structuredClone(original.light),occluders:original.occluders.map(piece=>({...piece,vertices:piece.vertices.map(v=>v.slice()),keys:targets.map(k=>{const pose=sampleScene(single(original,piece),k.t).occluder;return {t:k.t,x:pose.x,y:pose.y,z:pose.z,angle:pose.angle};})}))};
  const domain=bounds(targets.map(k=>k.polygon),.5),desired=targets.map(k=>mask([k.polygon],domain,resolution));
  let evaluations=0;
  function objective(index){
    const polygons=projectArticulated(scene,targets[index].t);
    let outside=0;
    for(const p of polygons)for(const [x,y] of p)outside+=Math.max(0,domain.x-x,x-domain.x-domain.side,domain.y-y,y-domain.y-domain.side)/domain.side;
    return maskError(mask(polygons,domain,resolution),desired[index])+outside;
  }
  const initialErrors=targets.map((_,i)=>objective(i)),scores=initialErrors.slice();
  const minimumLight=Math.min(...scene.light.keys.map(k=>k.z));
  outer:for(let iteration=0;iteration<iterations;iteration++){
    const fraction=.16*2**(-iteration);
    for(let index=0;index<targets.length;index++)for(let pieceIndex=0;pieceIndex<scene.occluders.length;pieceIndex++){
      const piece=scene.occluders[pieceIndex],key=piece.keys[index],light=sampleScene(single(scene,piece),key.t).light;
      const m=light.z/(light.z-key.z),step=domain.side*fraction/m;
      for(const [field,amount] of [['x',step],['y',step],['z',Math.min(.5,(light.z-key.z)*fraction*2)],['angle',Math.PI*fraction]]){
        const old=key[field];let selected=old,best=scores[index];
        for(const direction of [-1,1]){
          if(evaluations>=maxEvaluations){key[field]=selected;scores[index]=best;break outer;}
          const candidate=old+direction*amount;
          evaluations++;
          if(!Number.isFinite(candidate)||Math.abs(candidate)>100||(field==='z'&&(candidate<.01||candidate>=minimumLight-.05)))continue;
          key[field]=candidate;
          const score=objective(index);
          if(score<best-1e-12){best=score;selected=candidate;}
        }
        key[field]=selected;scores[index]=best;
      }
    }
  }
  validateArticulatedScene(scene);
  const report=measureArticulated(scene,targets);
  report.optimization={method:'Supplied-scene coordinate search over x/y/depth/rotation; fixed geometry and piece count.',iterations,resolution,maxEvaluations,evaluations,initialObjective:initialErrors,finalObjective:scores,targetsPreserved:true,initializationRetained:true,objective:'Raster union error on fixed target-derived domain plus out-of-domain vertex penalty.'};
  return {scene,report};
}
