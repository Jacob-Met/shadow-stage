"""One original target-artwork export/reimport course; preserve every output and refusal."""
import argparse
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT/'tests/svg-target-export'
SOURCE_NAMES = [
    'tools/export_svg_targets.mjs', 'tools/import_svg.py', 'tools/fit_svg_targets.mjs',
    'src/core.js', 'src/project.js', 'src/articulated.js',
    'tests/svg-target-export/receiver.py', 'tests/svg-target-export/validate-projects.mjs',
    'tests/svg-target-export/PROTOCOL.json',
] + ['tests/svg-target-export/'+name for name in [
    'project.json', 'expected.json', 'duration-121.json', 'missing-endpoint.json',
    'missing-share.json', 'vertices-129.json', 'numerical-edge.json',
]]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def save(path, value):
    with path.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write('\n'); stream.flush(); os.fsync(stream.fileno())

def need(condition, message):
    if not condition:
        raise AssertionError(message)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
out = args.output.absolute()
need(not os.path.lexists(out), 'Existing receiving output: preserve it; do not replay.')
out.mkdir(parents=False)
result = dict(passed=False, status='preparing', successful_exports=0, successful_imports=0,
              helper_fit_calls=0, expected_refusals=0, movie_encodes=0, movie_decodes=0,
              old_course_replays=0, command_records=[])
started = time.monotonic()


def run(name, command, timeout, expected_exit):
    row = dict(command=command, cwd=str(ROOT), timeout_seconds=timeout,
               expected_exit=expected_exit, status='announced', child_started=False)
    record_path = out/(name+'-exec.json')
    save(record_path, row)
    child = None
    beginning = time.monotonic()
    try:
        with (out/(name+'.stdout')).open('xb') as stdout, (out/(name+'.stderr')).open('xb') as stderr:
            child = subprocess.Popen(command, cwd=ROOT, stdout=stdout, stderr=stderr,
                                     start_new_session=True)
            row.update(status='running', child_started=True, pid=child.pid)
            save(record_path, row)
            child.wait(timeout=timeout)
            row.update(status='completed', exit=child.returncode)
    except BaseException as error:
        row.update(status='failed', error=dict(type=type(error).__name__, message=str(error)))
        raise
    finally:
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=5)
            row['exit'] = child.returncode
        row['wall_seconds'] = time.monotonic()-beginning
        for stream_name in ['stdout', 'stderr']:
            path = out/(name+'.'+stream_name)
            if path.is_file():
                row[stream_name+'_sha256'] = sha(path)
        save(record_path, row)
        result['command_records'].append(record_path.name)
        save(out/'result.json', result)
    need(row.get('exit') == expected_exit, name+' unexpected exit: '+str(row.get('exit')))
    return row


def compare_targets(targets, expected):
    need(len(targets) == len(expected), 'Target count changed')
    maximum = 0.0
    for actual, wanted in zip(targets, expected):
        need(actual['t'] == wanted['t'], 'Authored time changed')
        polygon = actual['polygon']
        need(len(polygon) == len(wanted['target']), 'Vertex count or correspondence changed')
        for actual_point, wanted_point in zip(polygon, wanted['target']):
            need(len(actual_point) == 2 and all(math.isfinite(x) for x in actual_point), 'Invalid point')
            maximum = max(maximum, *(abs(a-b) for a,b in zip(actual_point, wanted_point)))
    need(maximum <= 1e-12, 'Authored coordinate mismatch')
    return maximum


def inspect_export(folder, input_path, expected, share, share_source, command_name):
    files = {p.name for p in folder.iterdir()}
    want_names = {'sequence.json', 'receipt.json'} | {f'moment-{i:02d}.svg' for i in range(3)}
    need(files == want_names and all(p.is_file() and not p.is_symlink() for p in folder.iterdir()), 'Unexpected export payload')
    receipt = json.loads((folder/'receipt.json').read_text())
    stdout = json.loads((out/(command_name+'.stdout')).read_text())
    need(receipt['status'] == 'complete' and receipt['fitInvoked'] is False and receipt['sceneExported'] is False, 'Exporter effect receipt differs')
    need(receipt['inputSha256'] == sha(input_path) and receipt['inputBytes'] == input_path.stat().st_size and receipt['inputComplete'] is True, 'Input byte identity differs')
    need(receipt['lightShare'] == share and receipt['lightShareSource'] == share_source, 'Light preference changed')
    need(receipt['roundtripGeometry']['valid'] is True, 'Mapped geometry not admitted')
    need(receipt['sourceUnchanged'] is True and receipt['sourceSha256'] == receipt['sourceAfterSha256'], 'Exporter source changed')
    for name, digest in receipt['sourceSha256'].items():
        need(sha(ROOT/name) == digest, 'Exporter source receipt differs')
    need(stdout['receiptSha256'] == sha(folder/'receipt.json'), 'Export stdout does not identify receipt')
    need({k:v for k,v in stdout.items() if k not in ['output','receiptSha256']} == receipt, 'Export stdout and receipt differ')
    recorded = {row['file']:row for row in receipt['outputs']}
    need(len(recorded) == len(receipt['outputs']) == 4 and set(recorded) == want_names-{'receipt.json'}, 'Output inventory differs')
    for name, row in recorded.items():
        need(row['bytes'] == (folder/name).stat().st_size and row['sha256'] == sha(folder/name), 'Output byte identity differs')
    sequence = json.loads((folder/'sequence.json').read_text())
    need(set(sequence) == {'format','title','duration','stageWidth','lightShare','moments'}, 'Wrong sequence fields')
    need(sequence['format'] == 'shadow-stage/svg-sequence-v1', 'Wrong sequence format')
    need(sequence['title'] == expected['title'] and sequence['duration'] == expected['duration'] and sequence['stageWidth'] == expected['stageWidth'] and sequence['lightShare'] == share, 'Sequence metadata changed')
    reconstructed = []
    observations = []
    number = re.compile(r'[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z')
    need(len(sequence['moments']) == 3, 'Sequence moment count differs')
    for i,(moment,wanted) in enumerate(zip(sequence['moments'], expected['moments'])):
        name = f'moment-{i:02d}.svg'
        need(moment == {'t':wanted['t'],'file':name}, 'Moment order, time or filename differs')
        raw = (folder/name).read_bytes()
        tree = ET.fromstring(raw)
        need(tree.tag == '{http://www.w3.org/2000/svg}svg' and set(tree.attrib) == {'viewBox'}, 'Unexpected SVG root')
        need([Fraction(v) for v in tree.attrib['viewBox'].split()] == list(map(Fraction, expected['viewBox'])), 'ViewBox differs')
        need(len(list(tree)) == 1 and not (tree.text or '').strip(), 'SVG needs one direct shape')
        polygon = list(tree)[0]
        need(polygon.tag == '{http://www.w3.org/2000/svg}polygon' and set(polygon.attrib) == {'points','fill'} and polygon.attrib['fill'] == 'black', 'Unexpected SVG shape')
        need(len(list(polygon)) == 0 and not (polygon.text or '').strip() and not (polygon.tail or '').strip(), 'Unexpected nested SVG content')
        tokens = polygon.attrib['points'].replace(',', ' ').split()
        need(len(tokens) == 12 and all(number.fullmatch(v) for v in tokens), 'Unexpected SVG coordinate encoding')
        points = [[Fraction(tokens[j]), Fraction(tokens[j+1])] for j in range(0, len(tokens), 2)]
        exact_expected = [[Fraction(v) for v in point] for point in wanted['svg_rational']]
        need(points == exact_expected, 'Emitted SVG differs from independently authored exact coordinates')
        inverse = [[(x-200)/125, (150-y)/125] for x,y in points]
        need(inverse == [[Fraction(v) for v in point] for point in wanted['target_rational']], 'Independent inverse changed target')
        reconstructed.append({'t':moment['t'], 'polygon':[[float(v) for v in point] for point in inverse]})
        observations.append({'t':moment['t'], 'svg':[[str(v) for v in point] for point in points], 'inverse_target':[[str(v) for v in point] for point in inverse], 'svg_sha256':sha(folder/name)})
    error = compare_targets(reconstructed, expected['moments'])
    save(out/(command_name+'-independent-coordinates.json'), observations)
    need(not list(out.glob('.'+folder.name+'.partial-*')), 'Successful export left an unexpected partial directory')
    return {'receipt_sha256':sha(folder/'receipt.json'), 'sequence_sha256':sha(folder/'sequence.json'), 'max_target_coordinate_error':error, 'exact_rational_svg_match':True, 'share':share, 'share_source':share_source}

try:
    before = {name:sha(ROOT/name) for name in SOURCE_NAMES}
    save(out/'sources-before.json', before)
    expected = json.loads((FIXTURES/'expected.json').read_text())
    need(sha(FIXTURES/'project.json') == expected['source_project_sha256'], 'Independent source oracle hash differs')
    source_project = json.loads((FIXTURES/'project.json').read_text())
    need(source_project['scene']['format'] == 'shadow-stage/scene-v1' and len(source_project['scene']['occluder']['vertices']) == 3, 'Source physical triangle missing')
    need(len(source_project['targets']) == 3 and all(len(t['polygon']) == 6 for t in source_project['targets']), 'Source authored L targets missing')
    need(compare_targets(source_project['targets'], expected['moments']) == 0, 'Independent oracle differs from source targets')
    result['input_distinction'] = {'physical_cutout_vertices':3,'authored_vertices_per_moment':6,'authored_moments':3,'targets_exported_not_scene':True,'source_project_sha256':sha(FIXTURES/'project.json')}
    node = shutil.which('node'); need(node is not None, 'Node is required')
    save(out/'runtime.json', {'python':sys.executable, 'python_version':sys.version, 'node':node, 'node_sha256':sha(Path(node)), 'fit_count_semantics':'Fixed helper control flow plus actual receipts; not independent dynamic tracing.'})
    exporter = str(ROOT/'tools/export_svg_targets.mjs')
    main = out/'exported'
    run('export-main', [node, exporter, str(FIXTURES/'project.json'), str(main)], 20, 0)
    result['successful_exports'] += 1
    result['main_export'] = inspect_export(main, FIXTURES/'project.json', expected, expected['saved_lightShare'], 'project', 'export-main')
    fallback = out/'fallback'
    run('export-fallback', [node, exporter, str(FIXTURES/'missing-share.json'), str(fallback), '--light-share', '0'], 20, 0)
    result['successful_exports'] += 1
    result['fallback_export'] = inspect_export(fallback, FIXTURES/'missing-share.json', expected, 0, 'explicit-option', 'export-fallback')
    cases = [
        ('duration', 'duration-121.json', [], 'SVG sequence duration must not exceed 120 seconds.'),
        ('endpoint', 'missing-endpoint.json', [], 'SVG sequence targets must include endpoints 0 and 1.'),
        ('vertices', 'vertices-129.json', [], 'SVG target exceeds 128 vertices.'),
        ('missing-share', 'missing-share.json', [], 'Project lacks lightShare; supply --light-share explicitly.'),
        ('saved-share', 'project.json', ['--light-share','0'], 'Saved lightShare cannot be overridden; omit --light-share.'),
        ('numerical-edge', 'numerical-edge.json', [], 'SVG roundtrip geometry refused: Polygon has a repeated adjacent vertex.'),
    ]
    result['refusals'] = []
    for name, fixture, options, message in cases:
        destination = out/('refused-'+name)
        run('refusal-'+name, [node, exporter, str(FIXTURES/fixture), str(destination), *options], 20, 2)
        need(not os.path.lexists(destination), name+' unexpectedly published output')
        partials = list(out.glob('.'+destination.name+'.partial-*'))
        need(len(partials) == 1 and partials[0].is_dir(), name+' missing retained partial')
        partial = partials[0]
        receipt = json.loads((partial/'receipt.json').read_text())
        failure = json.loads((partial/'failure.json').read_text())
        stderr = (out/('refusal-'+name+'.stderr')).read_text()
        need(receipt['status'] == 'failed' and receipt['fitInvoked'] is False and receipt['sceneExported'] is False, 'Refusal effect status differs')
        need(receipt['error']['message'] == message and failure['message'] == message and message in stderr and str(partial) in stderr, 'Expected refusal/path not observed')
        need(receipt['inputSha256'] == sha(FIXTURES/fixture) and receipt['inputComplete'] is True, 'Refusal input identity differs')
        if name == 'numerical-edge':
            need(receipt['roundtripGeometry']['valid'] is False, 'Numerical refusal did not identify the geometry check')
        result['refusals'].append({'name':name,'fixture':fixture,'message':message,'partial':partial.name,'receipt_sha256':sha(partial/'receipt.json'),'failure_sha256':sha(partial/'failure.json'),'published':False})
        result['expected_refusals'] += 1
    existing = out/'already-present'; existing.mkdir()
    sentinel = existing/'sentinel.bin'; sentinel.write_bytes(b'keep this exact existing destination\x00\xff\n')
    original_stat = sentinel.stat(); sentinel_hash = sha(sentinel)
    run('refusal-existing', [node, exporter, str(FIXTURES/'project.json'), str(existing)], 20, 2)
    need(set(p.name for p in existing.iterdir()) == {'sentinel.bin'} and sha(sentinel) == sentinel_hash, 'Existing destination content changed')
    now = sentinel.stat()
    need((now.st_ino,now.st_size,now.st_mtime_ns) == (original_stat.st_ino,original_stat.st_size,original_stat.st_mtime_ns), 'Existing sentinel identity changed')
    need(not list(out.glob('.already-present.partial-*')), 'Existing destination refusal unexpectedly staged output')
    need((out/'refusal-existing.stderr').read_text().strip() == 'Output already exists; choose a new directory.', 'Existing destination error differs')
    result['refusals'].append({'name':'existing','message':'Output already exists; choose a new directory.','sentinel_sha256':sentinel_hash,'sentinel_preserved':True,'partial_created':False})
    result['expected_refusals'] += 1
    imported = out/'reimported'
    run('reimport', [sys.executable,'-B',str(ROOT/'tools/import_svg.py'),str(main/'sequence.json'),str(imported)], 60, 0)
    result['successful_imports'] += 1
    receipt = json.loads((imported/'receipt.json').read_text())
    project = json.loads((imported/'project.json').read_text())
    need(receipt['status'] == 'complete' and receipt['fitInvoked'] is True and receipt['fitCalls'] == 1 and receipt['roundtrip'] is True and receipt['fitEngine'] == 'fitScene' and receipt['construction'] == {'mode':'single','maxPieces':1}, 'Unexpected importer/fitter receipt')
    result['helper_fit_calls'] = receipt['fitCalls']
    need(receipt['sourceUnchanged'] is True and receipt['sequenceSha256'] == sha(main/'sequence.json') and receipt['projectSha256'] == sha(imported/'project.json'), 'Importer identity chain differs')
    need((imported/'inputs/sequence.json').read_bytes() == (main/'sequence.json').read_bytes(), 'Importer consumed a different sequence')
    exported_sequence = json.loads((main/'sequence.json').read_text())
    need(len(receipt['inputs']) == len(exported_sequence['moments']) == 3, 'Importer input inventory incomplete')
    for i,(row,moment) in enumerate(zip(receipt['inputs'],exported_sequence['moments'])):
        need(row['file'] == moment['file'] and row['t'] == moment['t'] and row['retained'] == f'inputs/moment-{i:02d}.svg', 'Importer input order, time or retained path differs')
        need((imported/row['retained']).read_bytes() == (main/row['file']).read_bytes(), 'Importer consumed different SVG bytes')
        need(row['sha256'] == sha(main/row['file']) and row['bytes'] == (main/row['file']).stat().st_size, 'Importer input receipt identity differs')
    need(project['title'] == expected['title'] and project['duration'] == expected['duration'] and project['lightShare'] == expected['saved_lightShare'], 'Reimport changed authored metadata')
    need(project['scene'] is not None, 'Reimport produced no physical scene')
    result['reimport'] = {'max_target_coordinate_error':compare_targets(project['targets'], expected['moments']), 'project_sha256':sha(imported/'project.json'),'scene_sha256':receipt['sceneSha256'],'roundtrip':receipt['roundtrip'],'fit_engine':receipt['fitEngine'],'fit_options':receipt['fitOptions'],'scene_preservation_claim':False}
    # Real maintained parser validates the ordinary-project fixtures and received project.
    fixtures = ['project.json','duration-121.json','missing-endpoint.json','missing-share.json','vertices-129.json','numerical-edge.json']
    run('validate-projects', [node,str(FIXTURES/'validate-projects.mjs'),*[str(FIXTURES/name) for name in fixtures],str(imported/'project.json')], 20, 0)
    validated = json.loads((out/'validate-projects.stdout').read_text())
    need(validated['count'] == 7 and all(row['roundtrip'] for row in validated['projects']), 'General project validity not observed')
    need(validated['projects'][0]['scenePresent'] is True and validated['projects'][-1]['scenePresent'] is True, 'Saved and received physical project validation missing')
    need([row['sha256'] for row in validated['projects']] == [sha(FIXTURES/name) for name in fixtures]+[sha(imported/'project.json')], 'Validated inputs differ')
    result['general_project_validation'] = validated
    result['limits'] = ['One original fixture and seven selected refusals do not qualify every accepted input or platform.','Coordinate fidelity is observed on this independent concave fixture; unsupported numerical boundaries are refused, not repaired.','Reimport constructs a new physical scene; no prior-scene, lock, piece-ID or proposal-evidence preservation is claimed.','No real-browser interaction, vector-editor save, movie, performance benchmark or concurrent publication-race course.']
    need(result['successful_exports'] == 2 and result['successful_imports'] == result['helper_fit_calls'] == 1 and result['expected_refusals'] == 7, 'Course counts differ')
    command_rows = [json.loads((out/name).read_text()) for name in result['command_records']]
    result['exporter_processes_started'] = sum(row['child_started'] and len(row['command']) > 1 and row['command'][1] == exporter for row in command_rows)
    need(len(command_rows) == 11 and result['exporter_processes_started'] == 9, 'Original command inventory differs')
    result.update(passed=True,status='completed')
except BaseException as error:
    result.update(passed=False,status='failed',error={'type':type(error).__name__,'message':str(error)})
    save(out/'receiving-failure.json', result['error'])
finally:
    try:
        after = {name:sha(ROOT/name) for name in SOURCE_NAMES}
        save(out/'sources-after.json', after)
        result['source_unchanged'] = before == after
        if not result['source_unchanged']:
            result.update(passed=False,status='failed',error={'type':'SourceChanged','message':'Course source changed'})
    except BaseException as error:
        result.update(passed=False,status='failed',finalization_error={'type':type(error).__name__,'message':str(error)})
    result['wall_seconds_metadata_only'] = time.monotonic()-started
    save(out/'result.json', result)
print(json.dumps(result, allow_nan=False))
raise SystemExit(0 if result['passed'] else 1)
