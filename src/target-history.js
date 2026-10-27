// Session-local target history. Physical scenes and project settings stay outside it.
const encoder = new TextEncoder();
function record(value) {
  if (value === null || typeof value !== 'object') return false;
  const p = Object.getPrototypeOf(value);
  return p === Object.prototype || p === null;
}
function keys(value, expected) {
  return Reflect.ownKeys(value).length === expected.length &&
    expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
function snapshot(value) {
  if (!record(value) || !keys(value, ['targets','active']) ||
      !Array.isArray(value.targets) || !value.targets.length ||
      !Number.isInteger(value.active) || value.active < 0 ||
      value.active >= value.targets.length) throw new TypeError('Invalid target snapshot');
  const targets = value.targets.map(target => {
    if (!record(target) || !keys(target, ['t','polygon']) ||
        !Number.isFinite(target.t) || !Array.isArray(target.polygon) ||
        target.polygon.length < 3) throw new TypeError('Invalid target');
    const polygon = target.polygon.map(point => {
      if (!Array.isArray(point) || point.length !== 2 ||
          !point.every(Number.isFinite)) throw new TypeError('Invalid polygon point');
      return [point[0],point[1]];
    });
    return {t:target.t,polygon};
  });
  return {targets,active:value.active};
}
// Preserve accepted precision, including signed zero, without normalizing geometry.
const serialize = value => JSON.stringify(value, (_key,item) =>
  typeof item === 'number' && Object.is(item,-0) ? '-0' : item);
const fingerprint = value => serialize(value.targets);
function positiveInteger(value,name) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(name+' must be a positive safe integer');
  return value;
}
export class TargetHistory {
  #undo=[]; #redo=[]; #bytes=0; #maxSteps; #maxBytes;
  constructor({maxSteps=32,maxBytes=4*1024*1024}={}) {
    this.#maxSteps=positiveInteger(maxSteps,'maxSteps');
    this.#maxBytes=positiveInteger(maxBytes,'maxBytes');
  }
  state() {
    return {canUndo:!!this.#undo.length,canRedo:!!this.#redo.length,
      undoSteps:this.#undo.length,redoSteps:this.#redo.length,
      steps:this.#undo.length+this.#redo.length,bytes:this.#bytes,
      maxSteps:this.#maxSteps,maxBytes:this.#maxBytes};
  }
  clear() {this.#undo=[];this.#redo=[];this.#bytes=0;return this.state();}
  #result(status,details={}) {
    return {status,snapshot:null,dropped:0,clearedRedo:0,invalidated:false,...details,state:this.state()};
  }
  #boundary() {
    return this.#undo.at(-1)?.afterFingerprint ?? this.#redo.at(-1)?.beforeFingerprint ?? null;
  }
  commit(before,after,label='') {
    let entry;
    try {
      if (typeof label !== 'string') throw new TypeError('Invalid label');
      const a=snapshot(before),b=snapshot(after);
      const af=fingerprint(a),bf=fingerprint(b);
      if (af===bf) return this.#result('noop');
      entry={before:a,after:b,beforeFingerprint:af,afterFingerprint:bf,label,
        bytes:encoder.encode(serialize({before:a,after:b,label})).byteLength};
    } catch {return this.#result('invalid');}
    const boundary=this.#boundary();
    const invalidated=boundary!==null && boundary!==entry.beforeFingerprint;
    const clearedRedo=this.#redo.length;
    let dropped=0;
    if (entry.bytes>this.#maxBytes) {
      dropped=this.#undo.length;this.clear();
      return this.#result('oversize',{dropped,clearedRedo,invalidated});
    }
    if (invalidated) this.clear();
    else {for (const old of this.#redo) this.#bytes-=old.bytes;this.#redo=[];}
    this.#undo.push(entry);this.#bytes+=entry.bytes;
    while (this.#undo.length>this.#maxSteps || this.#bytes>this.#maxBytes) {
      this.#bytes-=this.#undo.shift().bytes;dropped++;
    }
    return this.#result('applied',{dropped,clearedRedo,invalidated});
  }
  undo(current) {return this.#move(current,'undo');}
  redo(current) {return this.#move(current,'redo');}
  #move(current,direction) {
    let currentFingerprint;
    try {currentFingerprint=fingerprint(snapshot(current));}
    catch {return this.#result('invalid');}
    const boundary=this.#boundary();
    if (boundary!==null && currentFingerprint!==boundary) {
      this.clear();return this.#result('stale',{invalidated:true});
    }
    const source=direction==='undo'?this.#undo:this.#redo;
    const destination=direction==='undo'?this.#redo:this.#undo;
    if (!source.length) return this.#result('empty');
    const entry=source.at(-1);
    const restored=snapshot(direction==='undo'?entry.before:entry.after);
    source.pop();destination.push(entry);
    return this.#result('applied',{snapshot:restored});
  }
}
