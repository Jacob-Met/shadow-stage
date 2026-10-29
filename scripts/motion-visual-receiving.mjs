import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import{chromium}from'playwright';
const root=path.resolve('..'),motion=JSON.parse(fs.readFileSync(path.join(root,'estate95a-motion-refinement-v1.json'))),initial=JSON.parse(fs.readFileSync(path.join(root,'estate95a-transition-v9-quality-v1.json'))),out=path.join(root,'motion-visual-a');
fs.mkdirSync(out,{recursive:false});const browser=await chromium.launch({headless:true,chromiumSandbox:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4323',{waitUntil:'networkidle'});
const results=[];
try{
 for(const row of motion.cases){
  const prior=initial.cases.find(r=>r.name===row.name),data={name:row.name,targets:prior.targets,original:prior.initialScene,candidate:row.originalCandidate,proposal:row.proposedScene,qualified:row.qualifiedImprovement,motion:row.motion};
  const result=await page.evaluate(async data=>{
   const{projectArticulated}=await import('/src/articulated.js');const canvas=document.createElement('canvas');canvas.width=1660;canvas.height=900;const c=canvas.getContext('2d'),times=[0,.25,.5,.75,1],scenes=[data.original,data.candidate,data.proposal],labels=['Original motion','Shape candidate','Motion proposal'];
   c.fillStyle='#f3f4eb';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#253f32';c.font='bold 26px sans-serif';c.fillText(data.name.replaceAll('_',' '),30,40);c.font='16px sans-serif';c.fillText('Experimental · not adopted · eight seconds · shared fixed frame [-1.2, 1.2]² · no target overlay',30,70);
   const clipped=[];
   for(let r=0;r<3;r++){
    c.fillStyle='#253f32';c.font='bold 17px sans-serif';c.fillText(labels[r],25,150+r*245);
    if(r){const m=r===1?data.motion.candidate:data.motion.proposal;c.font='13px sans-serif';c.fillText('Peak sampled speed',25,176+r*245);c.fillText(m.maximumVelocityWorldUnitsPerSecond.toFixed(3)+' stage units / s',25,196+r*245);}
    for(let j=0;j<times.length;j++){
     const x=210+j*280,y=110+r*245,w=265,h=210,polygons=projectArticulated(scenes[r],times[j]),world=([a,b])=>[x+w/2+a*h*.9/2.4,y+h/2-b*h*.9/2.4];
     c.fillStyle='#e7ebd7';c.fillRect(x,y,w,h);c.save();c.beginPath();c.rect(x,y,w,h);c.clip();c.fillStyle='#283e32';
     for(const polygon of polygons){c.beginPath();polygon.forEach((p,i)=>{const q=world(p);i?c.lineTo(...q):c.moveTo(...q);});c.closePath();c.fill();}c.restore();
     const isClipped=polygons.flat().some(([a,b])=>a< -1.2||a>1.2||b< -1.2||b>1.2);if(isClipped)clipped.push({row:labels[r],t:times[j]});
     c.fillStyle=isClipped?'#a04f20':'#253f32';c.font='14px sans-serif';c.fillText((times[j]*8).toFixed(1)+' s'+(isClipped?' · outside declared frame':''),x+8,y+h+20);
    }
   }
   c.fillStyle='#4e594c';c.font='14px sans-serif';c.fillText('Stills show sampled shape progression. They do not establish perceptual smoothness; hidden piece motion can change without a visible silhouette change.',25,875);
   return{png:canvas.toDataURL('image/png').split(',')[1],clipped};
  },data);
  const file=path.join(out,row.name+'.png');fs.writeFileSync(file,Buffer.from(result.png,'base64'));results.push({name:row.name,file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),qualifiedNumerically:row.qualifiedImprovement,clipped:result.clipped,peaks:{candidate:row.motion.candidate.velocityPeak,proposal:row.motion.proposal.velocityPeak}});
 }
 if(errors.length)throw Error(errors.join(';'));fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({results,pageErrors:errors},null,2)+'\n');console.log(JSON.stringify({results,pageErrors:errors}));
}finally{await browser.close();}
