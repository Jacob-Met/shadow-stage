import {fitScene} from './core.js';
import {fitArticulated,refineArticulated} from './articulated.js';
self.onmessage=function solverHandler({data}){try{const begin=performance.now();const result=data.mode==='refine'?refineArticulated(data.targets,data.scene,data.options):data.mode==='pieces'?fitArticulated(data.targets,data.options):fitScene(data.targets,data.options);self.postMessage({id:data.id,result,elapsedMs:performance.now()-begin});}catch(error){self.postMessage({id:data.id,error:error.message});}};
