import {validateTargets, targetAt} from './core.js';
import {validateArticulatedScene, projectArticulated, refineArticulated} from './articulated.js';

const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function integer(value, low, high, name) {
  if (!Number.isInteger(value) || value < low || value > high)
    throw new Error(name + ' must be an integer within ' + low + '–' + high);
  return value;
}
function geometry(scene) {
  return {pieces:scene.occluders.length,
    vertices:scene.occluders.reduce((sum, piece) => sum + piece.vertices.length, 0)};
}
function equalGeometry(a, b) {
  const x = geometry(a), y = geometry(b);
  if (x.pieces !== y.pieces || x.vertices !== y.vertices)
    throw new Error('Comparison requires equal actual piece and total vertex counts');
  return x;
}
function assertUnlocked(value, name) {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error(name + ' must be an array');
  if (value.length) throw new Error(name + ': locked cutouts are not supported by this comparison');
}
function assertFixedConstruction(before, after, name) {
  if (!equal(before.light, after.light))
    throw new Error(name + ' refinement changed the fixed light track');
  const fixed = scene => scene.occluders.map(piece => ({id:piece.id, vertices:piece.vertices}));
  if (!equal(fixed(before), fixed(after)))
    throw new Error(name + ' refinement changed fixed piece IDs, ordering, or local vertices');
}
function inside(point, polygon) {
  const [x, y] = point;
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > y) !== (b[1] > y) &&
      x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
function observationWindow(frames) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const frame of frames) for (const polygon of [frame.target, ...Object.values(frame.shadows).flat()])
    for (const point of polygon) {
      if (!Array.isArray(point) || point.length !== 2 || point.some(v => !Number.isFinite(v)))
        throw new Error('Comparison encountered nonfinite observation geometry');
      minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
    }
  const width = maxX - minX, height = maxY - minY;
  if (!(width > 0 && height > 0 && Number.isFinite(width + height)))
    throw new Error('Comparison observation window is degenerate');
  return {minX:minX - width * .02, maxX:maxX + width * .02,
    minY:minY - height * .02, maxY:maxY + height * .02};
}
function observeFrame(frame, window, resolution) {
  const names = Object.keys(frame.shadows);
  const counts = Object.fromEntries(names.map(name => [name,
    {intersectionCells:0, unionCells:0, spillCells:0, missedCells:0}]));
  let targetCells = 0;
  for (let row = 0; row < resolution; row++) for (let column = 0; column < resolution; column++) {
    const point = [
      window.minX + (column + .5) / resolution * (window.maxX - window.minX),
      window.minY + (row + .5) / resolution * (window.maxY - window.minY)
    ];
    const target = inside(point, frame.target);
    if (target) targetCells++;
    for (const name of names) {
      const shadow = frame.shadows[name].some(polygon => inside(point, polygon)), count = counts[name];
      if (shadow && target) count.intersectionCells++;
      if (shadow || target) count.unionCells++;
      if (shadow && !target) count.spillCells++;
      if (target && !shadow) count.missedCells++;
    }
  }
  if (targetCells < 4)
    throw new Error('Unresolved target occupancy at t=' + frame.t + ': ' + targetCells + ' cells');
  return {t:frame.t, authored:frame.authored, targetCells,
    cases:Object.fromEntries(names.map(name => {
      const count = counts[name];
      return [name, {...count, iou:count.intersectionCells / count.unionCells,
        missedTargetFraction:count.missedCells / targetCells,
        spillRelativeToTarget:count.spillCells / targetCells}];
    }))};
}
function summarize(rows, name) {
  if (!rows.length) return null;
  const mean = field => rows.reduce((sum, row) => sum + row.cases[name][field], 0) / rows.length;
  return {sampleCount:rows.length, meanIoU:mean('iou'),
    meanMissedTargetFraction:mean('missedTargetFraction'),
    meanSpillRelativeToTarget:mean('spillRelativeToTarget')};
}
function actualWork(result, configured) {
  const optimization = result.report?.optimization, work = optimization?.work;
  if (!work || !Number.isInteger(work.candidateAttempts) || work.candidateAttempts < 0 ||
    work.candidateAttempts > configured.maxEvaluations ||
    !Number.isInteger(work.candidateRasterEvaluations) || work.candidateRasterEvaluations < 0 ||
    work.candidateRasterEvaluations > work.candidateAttempts ||
    !Number.isInteger(work.initialObjectiveEvaluations) || work.initialObjectiveEvaluations < 0 ||
    work.finalMeasurement === undefined || optimization.evaluations !== work.candidateAttempts)
    throw new Error('Refinement did not report consistent actual work counts');
  return {actualCandidateAttempts:work.candidateAttempts,
    candidateRasterEvaluations:work.candidateRasterEvaluations,
    initialObjectiveEvaluations:work.initialObjectiveEvaluations,
    finalMeasurement:clone(work.finalMeasurement),
    optimizerEvaluationsAlias:optimization.evaluations,
    optimizerEvaluationsAliasMeaning:'candidate attempts, not raster evaluations',
    configuredMaxEvaluations:configured.maxEvaluations,
    configuredIterations:configured.iterations, configuredResolution:configured.resolution,
    optimizerReportedInitialObjective:optimization.initialObjective ?? null,
    optimizerReportedFinalObjective:optimization.finalObjective ?? null};
}

// Both constructions receive the same target-derived refinement objective and
// configured budget. All reported fidelity uses a separate shared observation
// window. This comparison establishes neither model provenance nor causal gain.
export function compareConstructions(targetInput, baselineInput, proposedInput, options = {}) {
  assertUnlocked(options.baselineLockedCutouts, 'baselineLockedCutouts');
  assertUnlocked(options.currentLockedCutouts, 'currentLockedCutouts');
  assertUnlocked(baselineInput?.lockedCutouts, 'baseline scene lockedCutouts');
  assertUnlocked(proposedInput?.lockedCutouts, 'current scene lockedCutouts');
  const targets = validateTargets(targetInput);
  const baseline = validateArticulatedScene(baselineInput), proposed = validateArticulatedScene(proposedInput);
  const counts = equalGeometry(baseline, proposed);
  if (baseline.duration !== proposed.duration) throw new Error('Comparison requires equal performance durations');
  const configured = {
    iterations:integer(options.iterations ?? 4, 1, 16, 'iterations'),
    resolution:integer(options.resolution ?? 32, 16, 96, 'refinement resolution'),
    maxEvaluations:integer(options.maxEvaluations ?? 1000, 1, 20000, 'maxEvaluations')
  };
  const observationResolution = integer(options.observationResolution ?? 64, 16, 256, 'observation resolution');
  const samples = integer(options.samples ?? 25, 3, 101, 'samples');
  const authoredByTime = new Map(targets.map(key => [key.t, key.polygon]));
  const times = [...new Set([...authoredByTime.keys(),
    ...Array.from({length:samples}, (_, i) => i / (samples - 1))])].sort((a, b) => a - b);
  const targetVertexBound = Math.max(64, ...targets.map(key => key.polygon.length));
  const assessmentEdgeChecksUpperBound =
    times.length * observationResolution ** 2 * (4 * counts.vertices + targetVertexBound);
  const maximumAssessmentEdgeChecks = 250000000;
  if (assessmentEdgeChecksUpperBound > maximumAssessmentEdgeChecks)
    throw new Error('Comparison assessment budget exceeded; reduce geometry, samples or observation resolution');
  const baselineResult = refineArticulated(clone(targets), clone(baseline), {...configured});
  const proposedResult = refineArticulated(clone(targets), clone(proposed), {...configured});
  const baselineFinal = validateArticulatedScene(baselineResult.scene);
  const proposedFinal = validateArticulatedScene(proposedResult.scene);
  assertFixedConstruction(baseline, baselineFinal, 'Baseline');
  assertFixedConstruction(proposed, proposedFinal, 'Current');
  equalGeometry(baseline, baselineFinal); equalGeometry(proposed, proposedFinal);
  if (baselineFinal.duration !== baseline.duration || proposedFinal.duration !== proposed.duration)
    throw new Error('Refinement changed the comparison duration');
  const work = {baseline:actualWork(baselineResult, configured), proposed:actualWork(proposedResult, configured)};
  const scenes = {baselineInitial:baseline, baselineFinal, proposedInitial:proposed, proposedFinal};
  const frames = times.map(t => ({t, authored:authoredByTime.has(t),
    target:authoredByTime.get(t) ?? targetAt(targets, t),
    shadows:Object.fromEntries(Object.entries(scenes).map(([name, scene]) => [name, projectArticulated(scene, t)]))}));
  const window = observationWindow(frames);
  const observations = frames.map(frame => observeFrame(frame, window, observationResolution));
  const authored = observations.filter(row => row.authored), intermediate = observations.filter(row => !row.authored);
  const fidelity = Object.fromEntries(Object.keys(scenes).map(name => [name, {
    authoredKeys:summarize(authored, name), authorSelectedIntermediateMorph:summarize(intermediate, name)}]));
  const cells = observations.length * observationResolution ** 2;
  return {format:'shadow-stage/comparison-v1', targets:clone(targets), geometry:counts,
    optimizationDomain:{basis:'identical authored target polygons',
      construction:'bounds(targets.map(k=>k.polygon), .5)', sharedBetweenConstructions:true,
      objective:'Authored-key raster mask error plus outside-vertex penalty on the same target-derived domain.',
      resolution:configured.resolution},
    observation:{window, resolution:observationResolution, times, minimumResolvedTargetCells:4,
      sampledFrames:observations.length, rasterCellsPerCase:cells,
      targetCellTests:cells, shadowUnionCellTests:4 * cells,
      assessmentEdgeChecksUpperBound, maximumAssessmentEdgeChecks},
    fidelity,
    differences:{
      finalAuthoredMeanIoU:fidelity.proposedFinal.authoredKeys.meanIoU - fidelity.baselineFinal.authoredKeys.meanIoU,
      baselineAuthoredRefinementDelta:fidelity.baselineFinal.authoredKeys.meanIoU - fidelity.baselineInitial.authoredKeys.meanIoU,
      proposedAuthoredRefinementDelta:fidelity.proposedFinal.authoredKeys.meanIoU - fidelity.proposedInitial.authoredKeys.meanIoU
    },
    work, observations, scenes:{baselineFinal, proposedFinal},
    limitations:[
      'Sampled raster estimates; the minimum occupancy threshold does not establish convergence.',
      'Intermediate targets are author-selected interpolation, not observed ground truth.',
      'The window contains all four constructions at sampled times, not every continuous instant.',
      'Equal configured budgets do not imply equal actual optimizer work.',
      'Optimizer objectives are retained separately from the shared-window comparison score.',
      'No model execution or causal model advantage is established by this comparison alone.'
    ]};
}
