"""Collect installed npm and macOS Cargo license texts for release distribution.
Run after npm ci. Requires Python 3, Cargo, and network access for license texts
omitted from registry packages; upstream fallbacks use each crate's recorded commit.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
texts = {}
components = []
trees = {}
remote_texts = {}


def license_files(root):
    result = []
    for path in root.iterdir():
        if re.match(r"(?i)^(licen[cs]e|copying|notice)", path.name):
            result.extend([path] if path.is_file() else [p for p in path.rglob('*') if p.is_file()])
    return sorted(result)


def add(name, version, license_name, source, documents):
    if not documents:
        raise RuntimeError(f"No license text for {name} {version}")
    ids = []
    for label, body in documents:
        key = hashlib.sha256(body.encode()).hexdigest()[:16]
        texts[key] = body.strip()
        ids.append(f"{label}: {key}")
    components.append(f"{name} {version}\nLicense: {license_name}\nSource: {source}\n" + '\n'.join(ids))


def upstream(package, root):
    vcs = json.loads((root / '.cargo_vcs_info.json').read_text())
    commit = vcs['git']['sha1']
    repo = package['repository'].removesuffix('.git').rstrip('/')
    slug = repo.split('github.com/')[-1]
    key = (slug, commit)
    if key not in trees:
        with urlopen(f'https://api.github.com/repos/{slug}/git/trees/{commit}?recursive=1') as response:
            trees[key] = json.load(response)['tree']
    folder = Path(vcs.get('path_in_vcs', ''))
    ancestors = [folder, *folder.parents]
    paths = [item['path'] for item in trees[key] if item['type'] == 'blob'
             and Path(item['path']).parent in ancestors
             and re.match(r'(?i)^(licen[cs]e|copying|notice)', Path(item['path']).name)]
    result = []
    for path in sorted(paths):
        url = f'https://raw.githubusercontent.com/{slug}/{commit}/{path}'
        if url not in remote_texts:
            with urlopen(url) as response:
                remote_texts[url] = response.read().decode('utf-8')
        result.append((url, remote_texts[url]))
    if not result and package['license'] == 'MPL-2.0':
        url = 'https://www.mozilla.org/media/MPL/2.0/index.txt'
        with urlopen(url) as response:
            result.append((url, response.read().decode('utf-8')))
    return result


lock = json.loads((ROOT / 'package-lock.json').read_text())
fallbacks = {'@esbuild/darwin-arm64': 'esbuild', '@rollup/rollup-darwin-arm64': 'rollup',
             '@tauri-apps/cli-darwin-arm64': '@tauri-apps/cli'}
for folder, package in lock['packages'].items():
    root = ROOT / folder
    if not folder or not root.exists():
        continue
    name = folder.rsplit('node_modules/', 1)[-1]
    files = license_files(root)
    if not files and name in fallbacks:
        files = license_files(ROOT / 'node_modules' / fallbacks[name])
    add('npm: ' + name, package['version'], package.get('license', 'See license text'),
        f"https://www.npmjs.com/package/{name}/v/{package['version']}",
        [(p.name, p.read_text()) for p in files])

metadata = json.loads(subprocess.check_output(['cargo', 'metadata', '--manifest-path',
    str(ROOT / 'src-tauri/Cargo.toml'), '--format-version', '1', '--filter-platform',
    'aarch64-apple-darwin'], cwd=ROOT))
for package in metadata['packages']:
    if not package['source']:
        continue
    root = Path(package['manifest_path']).parent
    files = license_files(root)
    if package['license_file']:
        extra = root / package['license_file']
        if extra.exists() and extra not in files:
            files.append(extra)
    documents = [(p.name, p.read_text()) for p in files] if files else upstream(package, root)
    add('Cargo: ' + package['name'], package['version'], package['license'],
        f"https://crates.io/crates/{package['name']}/{package['version']}", documents)

header = '''Dum-E — Third-party notices

Dum-E is MIT licensed; third-party components retain their own licenses.
This inventory includes installed macOS runtime and build dependencies.
Identical license texts are included once and referenced by their text ID.
Cargo sources, including MPL-2.0 components, are available at the versioned
crate links below (use the Download link on crates.io).

'''
output = header + '\n\n'.join(components) + '\n\nLICENSE TEXTS\n'
for key, text in sorted(texts.items()):
    output += f'\n===== {key} =====\n{text}\n'
(ROOT / 'THIRD_PARTY_NOTICES.txt').write_text(output)
print(f'Collected {len(components)} components and {len(texts)} license texts.')
