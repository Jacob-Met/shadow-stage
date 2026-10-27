#!/usr/bin/env python3
"""Build a reproducible, allowlisted Shadow Stage runtime/source ZIP."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = (
    'docs/geometry-quality.json',
    'src/articulated.js',
    'src/scene-proposals.js',
    'src/runtime.js',
    'src/player.js',
    'src/solver-worker.js',
    'src/comparison.js', 'src/comparison-ui.js', 'src/video.js',
    'src/transition.js', 'src/transition-ui.js', 'tests/transition.test.js', 'tests/transition-receiving.mjs',
    'tests/comparison.test.js', 'tests/comparison-receiving.mjs', 'tests/comparison-browser.mjs',
    'tests/video-scene-receiving.mjs', 'tests/video-production-receiving.mjs', 'tests/video-browser.mjs',
    'tests/video-probe.mjs',
    'tests/articulated.test.js',
    'tests/articulated-receiving.test.js',
    'tests/scene-proposals.test.js',
    'README.md', 'package.json', 'server.mjs', 'index.html', 'styles.css', 'app.js',
    'src/core.js', 'src/project.js', 'src/proposals.js',
    'scripts/package.py', 'tests/core.test.js', 'tests/receiving.test.js',
    'tests/project.test.js', 'tests/proposals.test.js', 'tests/server.test.js', 'tests/browser-receiving.mjs',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist', help='Output directory (default: project/dist)')
    args = parser.parse_args()
    output = args.output.resolve()
    payload = {}
    for name in FILES:
        source = ROOT / name
        if source.is_symlink() or not source.is_file():
            raise SystemExit(f'Required regular package file missing or symlinked: {name}')
        payload[name] = source.read_bytes()
    manifest = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in sorted(payload.items()))
    payload['SHA256SUMS'] = manifest.encode('utf-8')
    output.mkdir(parents=True, exist_ok=True)
    archive = output / 'shadow-stage.zip'
    # STORED avoids dependence on a particular zlib version. Every timestamp,
    # permission, file ordering, and path separator is explicitly deterministic.
    temporary = output / 'shadow-stage.zip.tmp'
    with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_STORED) as bundle:
        for name, data in sorted(payload.items()):
            info = zipfile.ZipInfo('shadow-stage/' + name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_STORED
            bundle.writestr(info, data)
    temporary.replace(archive)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / 'shadow-stage.zip.sha256').write_text(f'{digest}  shadow-stage.zip\n', encoding='utf-8')
    (output / 'SHA256SUMS').write_text(manifest, encoding='utf-8')
    print(json.dumps({'archive': str(archive), 'sha256': digest, 'bytes': archive.stat().st_size,
                      'sourceFiles': len(FILES), 'manifest': str(output / 'SHA256SUMS')}, sort_keys=True))


if __name__ == '__main__':
    main()
