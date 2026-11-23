"""Export only this investigation's disposable-fixture evidence, sanitizing paths."""
import csv
import json
import math
import os
import statistics
from pathlib import Path

LAB = Path(os.environ.get('TPV_LAB_ROOT', 'E:/temp/tpv-smb-investigation-20261123'))
OUT = Path(__file__).resolve().parents[1] / 'docs/investigations/issue-23-windows-smb-2026-11-23'
OUT.mkdir(parents=True, exist_ok=True)

def clean(text):
    locations = json.loads((LAB/'locations-private.json').read_text(encoding='utf-8-sig'))
    replacements = {}
    for raw, label in [(locations['unc'], '<UNC_SCRATCH>'), (locations['mapped'], '<MAPPED_SCRATCH>'), (str(LAB), '<LOCAL_LAB>'), (str(OUT.parents[2]), '<SOURCE_WORKTREE>')]:
        forward = raw.replace('\\', '/')
        replacements[raw] = label
        replacements[forward] = label
        replacements[raw.replace('/', '\\')] = label
        replacements[json.dumps(raw.replace('/', '\\'))[1:-1]] = label
        uri = 'file:' + (forward if forward.startswith('//') else '///' + forward)
        replacements[uri] = 'file:///' + label
        if not forward.startswith('//'):
            replacements['file:///' + forward.replace(':', '%3A')] = 'file:///' + label
    # Replace independent of case without interpreting replacement backslashes.
    import re
    for old, new in replacements.items():
        text = re.sub(re.escape(old), lambda _: new, text, flags=re.I)
    return re.sub(r'(?i)([a-z]:[/\\]Users[/\\])[^/\\\s]+', r'\1<USER>', text)

def save(name, value):
    # Sanitize strings before encoding, preserving valid JSON backslash escapes.
    def sanitize(obj):
        if isinstance(obj, str): return clean(obj)
        if isinstance(obj, dict): return {clean(k): sanitize(v) for k, v in obj.items()}
        if isinstance(obj, list): return [sanitize(x) for x in obj]
        return obj
    (OUT/name).write_text(json.dumps(sanitize(value), indent=2)+'\n', encoding='utf-8')

summary = {'watchers': [], 'acceptance': [], 'resources': []}
for file in LAB.glob('*.json'):
    if file.name not in ['installed-identity.json', 'environment.json', 'shutdown.json'] and not file.name.startswith(('local-', 'unc-', 'mapped-')):
        continue
    r = json.loads(file.read_text(encoding='utf-8-sig'))
    save(file.name, r)
    if not isinstance(r, dict): continue
    if isinstance(r.get('snapshots'), list):
        for pattern in ['string-star', 'uri-star', 'uri-recursive']:
            rows = [x for x in r['snapshots'] if x['pattern'] == pattern]
            if not rows: continue
            summary['watchers'].append({'case': file.stem, 'pattern': pattern, 'transitions': len(rows),
                'transitionsWithApiEvents': sum(bool(x['apiEvents']) for x in rows),
                'correctDiagnosticSnapshots': sum(any(d['code']=='TPV022' for d in x['diagnostics']) == (x['action'] in ['create','rename-back']) for x in rows)})
    if 'checks' in r:
        cycles = [x for x in r['checks'] if x['name'].startswith('cycle-') and 'ms' in (x.get('details') or {})]
        times = sorted(x['details']['ms'] for x in cycles)
        summary['acceptance'].append({'case': file.stem, 'statuses': {s: sum(x['status']==s for x in r['checks']) for s in ['PASS','FAIL','BLOCKED']},
            'cycleTransitions': len(cycles), 'cyclePasses': sum(x['status']=='PASS' for x in cycles),
            'latencyMedianMs': statistics.median(times) if times else None,
            'latencyP95Ms': times[math.ceil(len(times)*.95)-1] if times else None,
            'latencyMaxMs': max(times, default=None), 'failure': r.get('failure')})
        pid = r['environment']['pid']
        samples = list(csv.DictReader((LAB/'resource-samples.csv').open()))
        samples = [x for x in samples if int(x['pid']) == pid]
        if samples:
            summary['resources'].append({'case': file.stem, 'pid': pid, 'samples': len(samples),
                'handlesFirst': int(samples[0]['handles']), 'handlesLast': int(samples[-1]['handles']),
                'handlesMin': min(int(x['handles']) for x in samples), 'handlesMax': max(int(x['handles']) for x in samples),
                'cpuSecondsDelta': float(samples[-1]['cpuSeconds'])-float(samples[0]['cpuSeconds']),
                'peakWorkingSetBytes': max(int(x['workingSet']) for x in samples)})
for mode in (LAB/'profiles').iterdir():
    lines = []
    for log in mode.glob('logs/*/window1/fileWatcher.log'):
        lines.extend(line for line in log.read_text(encoding='utf-8', errors='replace').splitlines()
                     if 'tpv-smb-investigation-20261123' in line or 'UNKNOWN' in line or 'gave up attempting' in line)
    if lines: (OUT/(mode.name+'-watcher-trace.txt')).write_text(clean('\n'.join(lines))+'\n', encoding='utf-8')
save('summary.json', summary)
depth = LAB/'depth.log'
if depth.exists():
    lines = [line for line in depth.read_text(encoding='utf-8', errors='replace').splitlines()
             if 'MainThreadFileSystemEventService#$watch' in line or 'MainThreadFileSystemEventService#$unwatch' in line]
    (OUT/'depth-registration-trace.txt').write_text(clean('\n'.join(lines))+'\n', encoding='utf-8')
for name in ['resource-samples.csv', 'windows-suite.log']:
    import re
    text = clean((LAB/name).read_text(encoding='utf-8', errors='replace'))
    text = re.sub(r'\x1b\[[0-9;]*m', '', text)
    (OUT/name).write_text('\n'.join(line.rstrip() for line in text.splitlines())+'\n', encoding='utf-8')
print(json.dumps(summary, indent=2))
