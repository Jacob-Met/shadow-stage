#!/usr/bin/env python3
"""Import a deliberately small, explicit SVG silhouette sequence into a saved project."""
import argparse
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parent.parent
NUMBER=r'[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?'
TOKEN=re.compile(NUMBER+r'|[MmLlHhVvZz]')
MAX_SVG=256*1024

def sha(raw):return hashlib.sha256(raw).hexdigest()
def write(path,value):path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')
def unique(pairs):
    out={}
    for k,v in pairs:
        if k in out:raise ValueError('Duplicate JSON key: '+k)
        out[k]=v
    return out

def finite(value,name):
    if type(value) not in (int,float) or not math.isfinite(value):raise ValueError(name+' must be finite.')
    return value

def tokens(text,commands=False):
    pattern=TOKEN if commands else re.compile(NUMBER)
    out=[];end=0
    for match in pattern.finditer(text):
        token=match.group();gap=text[end:match.start()]
        if gap.strip(' \t\r\n,'):raise ValueError('Unsupported SVG token or path command.')
        if ',' in gap:
            # comma-wsp separates numbers only, never the start, a command or another comma.
            if gap.count(',')!=1 or not out or out[-1].isalpha() or token.isalpha():
                raise ValueError('Malformed SVG comma separator.')
        elif out and not gap and not out[-1].isalpha() and not token.isalpha():
            # Path numbers may meet at a new sign or decimal point (e.g. 10-20 or .5.6).
            # Polygon/viewBox number lists require an explicit comma-wsp separator.
            if not commands or token[0] not in '+-.':
                raise ValueError('Missing SVG number separator.')
        out.append(token);end=match.end()
    tail=text[end:]
    if tail.strip(' \t\r\n,'):raise ValueError('Unsupported SVG token or path command.')
    if ',' in tail:raise ValueError('Malformed SVG comma separator.')
    return out

def numbers(text):
    values=[float(v) for v in tokens(text)]
    if not all(math.isfinite(v) for v in values):raise ValueError('SVG numbers must be finite.')
    return values

def path_points(text):
    ts=tokens(text,True);i=0;command=None;current=(0.,0.);points=[];closed=False
    def number():
        nonlocal i
        if i>=len(ts) or ts[i].isalpha():raise ValueError('Incomplete straight-line path coordinate.')
        value=float(ts[i]);i+=1
        if not math.isfinite(value):raise ValueError('SVG numbers must be finite.')
        return value
    while i<len(ts):
        if ts[i].isalpha():command=ts[i];i+=1
        elif command is None:raise ValueError('Path must begin with M or m.')
        if command in 'Zz':
            if not points or i!=len(ts):raise ValueError('Exactly one closed subpath is required.')
            closed=True;break
        if not points and command not in 'Mm':raise ValueError('Path must begin with M or m.')
        if command in 'Mm' and points:raise ValueError('Multiple subpaths are unsupported.')
        relative=command.islower();kind=command.upper()
        if kind in ('M','L'):
            x,y=number(),number()
            if relative:x+=current[0];y+=current[1]
            current=(x,y)
        elif kind=='H':
            x=number();current=(x+current[0] if relative else x,current[1])
        elif kind=='V':
            y=number();current=(current[0],y+current[1] if relative else y)
        else:raise ValueError('Unsupported path command.')
        points.append(current)
        if len(points)>129:raise ValueError('SVG shape exceeds 128 vertices.')
        if kind=='M':command='l' if relative else 'L'
    if not closed:raise ValueError('Path must close with Z or z.')
    if len(points)>1 and points[-1]==points[0]:points.pop()
    return points

def svg(raw):
    text=raw.decode('utf-8')
    if re.search(r'<!|<\?',text):raise ValueError('XML declarations, entities, comments and processing instructions are unsupported.')
    root=ET.fromstring(text)
    def tag(element):
        if element.tag.startswith('{http://www.w3.org/2000/svg}'):return element.tag.split('}',1)[1]
        if '}' in element.tag:raise ValueError('Unsupported XML namespace.')
        return element.tag
    if tag(root)!='svg' or set(root.attrib)!={'viewBox'}:raise ValueError('SVG root must have only an explicit viewBox attribute.')
    box=numbers(root.attrib['viewBox'])
    if len(box)!=4 or box[2]<=0 or box[3]<=0:raise ValueError('viewBox needs four finite numbers and positive dimensions.')
    children=list(root)
    if len(children)!=1 or (root.text or '').strip():raise ValueError('SVG must contain exactly one polygon or path.')
    shape=children[0];kind=tag(shape)
    if kind not in ('polygon','path'):raise ValueError('Only polygon and straight closed path are supported.')
    key='points' if kind=='polygon' else 'd'
    if set(shape.attrib) not in ({key},{key,'fill'}):raise ValueError('Unsupported shape attribute; transforms, stroke and style are refused.')
    if shape.attrib.get('fill','black') not in ('black','#000','#000000'):raise ValueError('Only an opaque black fill is supported.')
    if list(shape) or (shape.text or '').strip() or (shape.tail or '').strip():raise ValueError('Nested SVG content is unsupported.')
    if kind=='polygon':
        values=numbers(shape.attrib[key])
        if len(values)%2:raise ValueError('Polygon coordinates must be pairs.')
        points=list(zip(values[::2],values[1::2]))
        if len(points)>1 and points[-1]==points[0]:points.pop()
    else:points=path_points(shape.attrib[key])
    if not 3<=len(points)<=128:raise ValueError('SVG shape needs 3–128 vertices.')
    if any(not box[0]<=x<=box[0]+box[2] or not box[1]<=y<=box[1]+box[3] for x,y in points):raise ValueError('Shape vertices must remain inside viewBox; viewport clipping is unsupported.')
    return box,points

def publish(stage,destination):
    libc=ctypes.CDLL(None,use_errno=True);rename=getattr(libc,'renameat2',None)
    if rename is None:raise RuntimeError('Atomic publication requires Linux renameat2; temporary evidence retained.')
    rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];rename.restype=ctypes.c_int
    if rename(-100,os.fsencode(stage),-100,os.fsencode(destination),1):
        number=ctypes.get_errno();raise OSError(number,os.strerror(number),str(destination))

def run(sequence,destination):
    sequence=sequence.resolve();destination=destination.absolute()
    if os.path.lexists(destination):raise ValueError('Output already exists; choose a new directory.')
    if not destination.parent.is_dir():raise ValueError('Output parent directory must exist.')
    stage=Path(tempfile.mkdtemp(prefix='.'+destination.name+'.partial-',dir=destination.parent));(stage/'inputs').mkdir()
    receipt={'status':'preparing','fitInvoked':False,'inputs':[]}
    try:
        source_names=['tools/import_svg.py','tools/fit_svg_targets.mjs','src/core.js','src/project.js','src/articulated.js']
        before={name:sha((ROOT/name).read_bytes()) for name in source_names}
        receipt['sourceSha256']=before
        with sequence.open('rb') as f:raw=f.read(65537)
        (stage/'inputs/sequence.json').write_bytes(raw)
        if len(raw)>65536:raise ValueError('Sequence exceeds 64 KiB.')
        data=json.loads(raw.decode('utf-8'),object_pairs_hook=unique)
        if type(data) is not dict or set(data)!={'format','title','duration','stageWidth','lightShare','moments'} or data['format']!='shadow-stage/svg-sequence-v1':raise ValueError('Unsupported sequence schema.')
        if type(data['title']) is not str or len(data['title'])>300:raise ValueError('Title must be a string of at most 300 characters.')
        duration=finite(data['duration'],'duration');width=finite(data['stageWidth'],'stageWidth');share=finite(data['lightShare'],'lightShare')
        if not 0<duration<=120 or not 0<width<=100 or not 0<=share<=1:raise ValueError('Require duration (0,120], stageWidth (0,100], lightShare [0,1].')
        moments=data['moments']
        if type(moments) is not list or not 2<=len(moments)<=16:raise ValueError('Require 2–16 moments.')
        targets=[];box=None;previous=-1;total=0
        for index,moment in enumerate(moments):
            if type(moment) is not dict or set(moment)!={'t','file'}:raise ValueError('Each moment needs exactly t and file.')
            t=finite(moment['t'],'moment time')
            if not 0<=t<=1 or t<=previous:raise ValueError('Moment times must increase strictly in [0,1].')
            previous=t;name=moment['file']
            if type(name) is not str or not name or Path(name).is_absolute() or '..' in Path(name).parts:raise ValueError('SVG files must be relative local filenames without parent traversal.')
            path=(sequence.parent/name).resolve()
            if not path.is_relative_to(sequence.parent):raise ValueError('SVG file escapes the sequence directory.')
            with path.open('rb') as f:content=f.read(MAX_SVG+1)
            saved=f'inputs/moment-{index:02d}.svg';(stage/saved).write_bytes(content)
            receipt['inputs'].append({'file':name,'retained':saved,'bytes':len(content),'sha256':sha(content),'t':t})
            total+=len(content)
            if len(content)>MAX_SVG or total>2*1024*1024:raise ValueError('SVG input exceeds per-file 256 KiB or total 2 MiB bound.')
            view,points=svg(content)
            if box is None:box=view
            elif box!=view:raise ValueError('All SVG inputs must have an identical viewBox.')
            x,y,w,h=box
            mapped=[[(px-(x+w/2))*width/w,((y+h/2)-py)*width/w] for px,py in points]
            if not all(math.isfinite(v) and abs(v)<=100 for p in mapped for v in p):raise ValueError('Mapped target exceeds finite ±100 stage-coordinate bounds.')
            targets.append({'t':t,'polygon':mapped})
        if targets[0]['t']!=0 or targets[-1]['t']!=1:raise ValueError('Moments must include endpoints 0 and 1.')
        write(stage/'targets.json',targets)
        admitted={k:data[k] for k in ('title','duration','lightShare')};admitted['targets']=targets
        write(stage/'admitted.json',admitted)
        node=shutil.which('node')
        if not node:raise ValueError('Node is required; nothing is installed automatically.')
        receipt.update(sequenceSha256=sha(raw),viewBox=box,stageWidth=width,fitInvoked=True)
        command=[node,str(ROOT/'tools/fit_svg_targets.mjs'),str(stage/'admitted.json'),str(stage)]
        receipt['fitterCommand']=command
        receipt['node']={'path':node,'sha256':sha(Path(node).read_bytes())}
        with (stage/'fitter.stdout').open('wb') as stdout,(stage/'fitter.stderr').open('wb') as stderr:
            result=subprocess.run(command,stdout=stdout,stderr=stderr,timeout=120)
        receipt['fitterExit']=result.returncode
        if result.returncode:raise RuntimeError('Target validation or fitting failed; see fitter.stderr.')
        helper=json.loads((stage/'fitter.stdout').read_text())
        if helper['sourceSha256']!={k:v for k,v in before.items() if k!='tools/import_svg.py'}:raise RuntimeError('Helper source identity changed during import.')
        receipt.update({k:v for k,v in helper.items() if k!='sourceSha256'})
        receipt['sourceUnchanged']=all(sha((ROOT/name).read_bytes())==digest for name,digest in receipt['sourceSha256'].items())
        if not receipt['sourceUnchanged']:raise RuntimeError('Source changed during import.')
        receipt['status']='complete';write(stage/'receipt.json',receipt);publish(stage,destination)
        return destination
    except BaseException as error:
        if (stage/'receipt.json').exists():(stage/'receipt.json').rename(stage/'prepublication-receipt.json')
        receipt.update(status='failed',error=str(error));write(stage/'failure.json',receipt);write(stage/'receipt.json',receipt)
        print('Import failed; evidence retained at '+str(stage),file=sys.stderr);raise

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('sequence',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args()
    try:print(run(args.sequence,args.output))
    except Exception as error:print(str(error),file=sys.stderr);return 1
    return 0
if __name__=='__main__':raise SystemExit(main())
