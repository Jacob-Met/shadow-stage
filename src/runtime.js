import {validateScene,sampleScene,projectShadow,measureFit} from './core.js';
import {validateArticulatedScene,sampleArticulatedScene,projectArticulated,measureArticulated} from './articulated.js';
export const isArticulated=scene=>scene?.format==='shadow-stage/articulated-v1';
export const validatePhysicalScene=scene=>isArticulated(scene)?validateArticulatedScene(scene):validateScene(scene);
export const projectPolygons=(scene,t)=>isArticulated(scene)?projectArticulated(scene,t):[projectShadow(scene,t)];
export function samplePhysicalScene(scene,t){if(isArticulated(scene))return sampleArticulatedScene(scene,t);const sample=sampleScene(scene,t);return {light:sample.light,occluders:[{id:'cutout-1',...sample.occluder}]};}
export const measurePhysicalScene=(scene,targets)=>isArticulated(scene)?measureArticulated(scene,targets):measureFit(scene,targets);
export const physicalPieces=scene=>isArticulated(scene)?scene.occluders:[scene.occluder];
