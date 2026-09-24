"""Strict source binding, deterministic selection and atomic private publication.

Hashes establish internal consistency, NOT authenticity, legal truth or freshness.
Only one trusted, fresh export is accepted; no network or database access.
"""
import collections
import ctypes
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import unicodedata
from pathlib import Path
from .formatting import ROOT, TEMPLATE, TEMPLATE_BYTES, CLEANED_FIELDS, OUTPUT_FIELDS, csv_bytes, training_row

VERSION = 'taric-dataset-converter/1'
ALGORITHM = 'taric-offline-selector/1'
SOURCE_SCHEMA = 'reviewed-code-candidates/1'
SOURCE_REASONS = {'unreviewed', 'needs_review', 'excluded', 'stale_source', 'pending_request',
                  'missing_valid_target', 'missing_full_item_name', 'missing_descriptive_name',
                  'missing_valid_original_hs6', 'conflicting_verified_targets', 'independent_holdout_overlap',
                  'duplicate_input', 'per_code_cap', 'overall_limit'}
HEX = re.compile(r'[a-f0-9]{64}\Z')
ID = re.compile(r'[a-f0-9]{32}\Z')
# ECMAScript whitespace, deliberately not Python's broader \s character class.
SPACE = re.compile('[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+')


class DatasetError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise DatasetError(message)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    """JS canonical -> JSON.stringify for the export's safe-integer JSON domain.

    JS sorts keys as UTF-16, then enumerates array-index keys numerically. Floats
    are rejected rather than guessing ECMAScript number serialization.
    """
    if isinstance(value, dict):
        keys = sorted(value, key=lambda k: k.encode('utf-16-be', 'surrogatepass'))
        indices = sorted((k for k in keys if re.fullmatch(r'0|[1-9][0-9]*', k)
                          and int(k) < 4294967295), key=int)
        value = {k: value[k] for k in indices + [k for k in keys if k not in indices]}
        return '{' + ','.join(canonical(k) + ':' + canonical(v) for k, v in value.items()) + '}'
    if isinstance(value, list):
        return '[' + ','.join(canonical(v) for v in value) + ']'
    require(not isinstance(value, float), 'Floating-point values are outside the export schema.')
    if type(value) is int:
        require(abs(value) <= 9007199254740991, 'Unsafe integer in JSON.')
    text = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    return ''.join(f'\\u{ord(c):04x}' if 0xD800 <= ord(c) <= 0xDFFF else c for c in text)


def hash_json(value):
    return sha(canonical(value).encode('utf-8'))


def strict_json(raw):
    def pairs(items):
        obj = {}
        for key, value in items:
            require(key not in obj and key not in ('__proto__', 'prototype', 'constructor'),
                    'Duplicate or unsafe JSON key.')
            obj[key] = value
        return obj
    def reject(_):
        raise DatasetError('Nonfinite or floating-point JSON number.')
    try:
        result = json.loads(raw, object_pairs_hook=pairs, parse_float=reject, parse_constant=reject)
    except (json.JSONDecodeError, UnicodeError, RecursionError):
        raise DatasetError('Malformed JSON or UTF-8.') from None
    def bounded(value, depth=0):
        require(depth <= 20, 'JSON nesting exceeds 20 levels.')
        if isinstance(value, dict):
            for item in value.values():
                bounded(item, depth + 1)
        elif isinstance(value, list):
            for item in value:
                bounded(item, depth + 1)
        elif type(value) is int:
            require(abs(value) <= 9007199254740991, 'Unsafe JSON integer.')
    bounded(result)
    return result


def keys(value, required, optional=()):
    require(isinstance(value, dict) and set(required) <= set(value)
            and set(value) <= set(required) | set(optional), 'Unexpected or missing schema fields.')


def is_text(value, maximum=12000):
    return isinstance(value, str) and len(value.encode('utf-16-le', 'surrogatepass')) // 2 <= maximum


def text_map(value, fields):
    keys(value, fields)
    require(all(v is None or is_text(v) for v in value.values()), 'Invalid source text field.')


def timestamp(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', value),
            'Timestamp must use UTC YYYY-MM-DDTHH:MM:SS.sssZ.')
    try:
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise DatasetError('Invalid timestamp.') from None


def normalize(value):
    return SPACE.sub(' ', unicodedata.normalize('NFKC', value or '').lower()).strip(' ')


def load_profile(name):
    path = ROOT / 'config/taric-dataset-profiles' / (name + '.json') if name in ('newest-verified', 'balanced-recent') else Path(name)
    with path.open('rb') as handle:
        raw = handle.read(16385)
    require(len(raw) <= 16384, 'Profile exceeds 16 KiB.')
    p = strict_json(raw)
    keys(p, ('schema', 'name', 'version', 'mode', 'maxRows', 'perCode', 'perProduct', 'maxAgeDays', 'missingRequired'))
    require(p['schema'] == 'taric-dataset-profile/1' and type(p['version']) is int and 1 <= p['version'] <= 1000000,
            'Unsupported profile schema/version.')
    require(isinstance(p['name'], str) and re.fullmatch('[a-z0-9][a-z0-9-]{0,63}', p['name']), 'Invalid profile name.')
    require(p['mode'] in ('newest', 'balanced') and p['missingRequired'] in ('skip', 'error'), 'Invalid profile mode/policy.')
    for key in ('maxRows', 'perCode', 'perProduct'):
        require(type(p[key]) is int and 1 <= p[key] <= 200, 'Profile caps must be integers from 1 to 200.')
    require(p['maxAgeDays'] is None or type(p['maxAgeDays']) is int and 1 <= p['maxAgeDays'] <= 36500,
            'maxAgeDays must be null or an integer from 1 to 36500.')
    return p


def validate_candidate(r):
    keys(r, ('type', 'schema', 'requestId', 'feedbackId', 'feedback', 'reviewId', 'reviewRevision',
             'sourceHash', 'source', 'sourceStorage', 'review', 'reviewHash', 'inputs', 'facts', 'evidence',
             'targetCode', 'approvedDescription', 'missingness', 'groupKey', 'dedupeKey', 'factsHash',
             'provenance', 'verifiedAt', 'verification', 'profile', 'formatterPending'))
    require(r['type'] == 'candidate' and r['schema'] == r['profile'] == SOURCE_SCHEMA,
            'Unsupported candidate schema.')
    s, v = r['source'], r['review']
    keys(s, ('id', 'createdAt', 'finishedAt', 'state', 'mode', 'inputs', 'facts', 'evidence', 'suggestion',
             'diagnostic', 'error', 'errorStage', 'provenance', 'feedback'))
    keys(v, ('revision', 'status', 'target', 'sourceHash', 'approvedDescription', 'actor', 'at', 'note', 'correction'),
         ('source', 'feedbackId', 'feedbackHash'))
    require(r['verification'] == v['status'] == 'verified', 'Source is not currently verified in this export.')
    require(r['formatterPending'] is True and r['sourceStorage'] in ('live_request', 'archived_review'), 'Invalid source storage/formatter flag.')
    require(isinstance(r['requestId'], str) and ID.fullmatch(r['requestId']) and r['requestId'] == r['reviewId'] == s['id'], 'Request/review identity mismatch.')
    require(type(r['reviewRevision']) is int and 1 <= r['reviewRevision'] <= 100 and r['reviewRevision'] == v['revision'], 'Review revision mismatch.')
    require(r['sourceHash'] == v['sourceHash'] == hash_json(s) and r['reviewHash'] == hash_json(v), 'Source/review hash mismatch or stale source.')
    if 'source' in v:
        require(v['source'] == s, 'Retained review source mismatch.')
    require(v['target'] is None or is_text(v['target'], 10), 'Invalid target type.')
    require(r['targetCode'] == v['target'] and r['approvedDescription'] == v['approvedDescription'] and r['verifiedAt'] == v['at'], 'Candidate/review binding mismatch.')
    require(is_text(v['actor'], 24) and re.fullmatch('[a-f0-9]{24}', v['actor']) and is_text(v['note'], 2000)
            and type(v['correction']) is bool, 'Invalid review metadata.')
    require(v['approvedDescription'] is None or is_text(v['approvedDescription'], 255), 'Invalid approved description.')
    for key in ('inputs', 'facts', 'evidence', 'feedback', 'provenance'):
        require(r[key] == s[key], 'Candidate/source field mismatch.')
    text_map(s['inputs'], ('jan', 'item_code', 'descriptive_name', 'input_hs_code'))
    text_map(s['facts'], ('name', 'specifications', 'details', 'remarks', 'brand', 'seriesTitle', 'characterName', 'releaseDate'))
    keys(s['evidence'], ('hash', 'gcode', 'provenance'))
    require(all(s['evidence'][k] is None or is_text(s['evidence'][k], 64) for k in ('hash', 'gcode')), 'Invalid evidence metadata.')
    text_map(s['evidence']['provenance'], ('source', 'resolution', 'name_field', 'identity', 'fetched_at'))
    keys(s['provenance'], ('adapter', 'benchmark', 'run', 'identity', 'runtime', 'fingerprint', 'template', 'templateHash', 'catalogVersion'))
    text_map(s['provenance']['runtime'], ('deploymentRevision', 'baseRevision', 'tokenizerRevision', 'adapterSha256'))
    require(all(val is None or is_text(val) for key, val in s['provenance'].items() if key != 'runtime'), 'Invalid provenance metadata.')
    require(all(s[k] is None or is_text(s[k], 100) for k in ('error', 'errorStage')), 'Invalid error metadata.')
    if s['diagnostic'] is not None:
        keys(s['diagnostic'], ('code', 'description', 'label'))
        require(s['diagnostic']['label'] == 'UNVALIDATED diagnostic candidate', 'Invalid diagnostic label.')
    require(s['mode'] in ('test', 'normal') and s['state'] in ('complete', 'failed', 'interrupted', 'cancelled'), 'Pending or invalid source state.')
    reviewed = timestamp(v['at'])
    require(timestamp(s['createdAt']) <= reviewed, 'Review predates source.')
    if s['finishedAt'] is not None:
        require(timestamp(s['finishedAt']) <= reviewed, 'Review predates completion.')
    f = s['feedback']
    require(r['feedbackId'] == (f['id'] if f else None), 'Feedback identity mismatch.')
    if f:
        keys(f, ('id', 'code', 'decision', 'createdAt'), ('catalogStatus',))
        require(isinstance(f['id'], str) and ID.fullmatch(f['id']) and isinstance(f['code'], str)
                and re.fullmatch('[0-9]{10}', f['code']) and f['decision'] in ('accepted', 'changed', 'manual'), 'Invalid final feedback.')
        require(timestamp(f['createdAt']) <= reviewed, 'Feedback arrived after verification.')
    if 'feedbackId' in v or 'feedbackHash' in v or r['sourceStorage'] == 'archived_review':
        require(v.get('feedbackId') == r['feedbackId'] and v.get('feedbackHash') == (hash_json(f) if f else None), 'Review/final feedback binding mismatch.')
    if r['sourceStorage'] == 'archived_review':
        require(f is not None and v.get('source') == s, 'Proposal-only archive or missing retained source is ineligible.')
    suggestion = s['suggestion']
    if suggestion:
        keys(suggestion, ('code', 'description'))
        require(isinstance(suggestion['code'], str) and re.fullmatch('[0-9]{10}', suggestion['code']), 'Invalid suggestion.')
    base = f['code'] if f else suggestion['code'] if suggestion else None
    require(base is not None and (v['target'] == base or v['correction']), 'Missing human target or unconfirmed correction.')
    canonical_input = dict(descriptive_name=s['inputs']['descriptive_name'], full_item_name=s['facts']['name'],
                           specs=s['facts']['specifications'], hs_code=s['inputs']['input_hs_code'])
    fingerprint = hash_json({k: normalize(val) for k, val in canonical_input.items()})
    group = 'jan:' + s['inputs']['jan'] if s['inputs']['jan'] else 'facts:' + fingerprint
    require(r['groupKey'] == group and r['factsHash'] == r['dedupeKey'] == fingerprint, 'Input fingerprint/group mismatch.')
    missing = dict(inputs={k: not val for k, val in s['inputs'].items()}, facts={k: not val for k, val in s['facts'].items()},
                   fullItemName=not s['facts']['name'], specifications=not s['facts']['specifications'],
                   details=not s['facts']['details'], approvedDescription=not v['approvedDescription'])
    require(r['missingness'] == missing, 'Missingness metadata mismatch.')


def read_export(path, max_bytes=8 * 1024 * 1024, max_line=2 * 1024 * 1024, max_rows=200):
    require(1 <= max_bytes <= 8 * 1024 * 1024 and 1 <= max_line <= 2 * 1024 * 1024 and 1 <= max_rows <= 200,
            'Input limits may only narrow the 8 MiB / 2 MiB line / 200 row hard caps.')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NONBLOCK), 'rb') as handle:
        require(stat.S_ISREG(os.fstat(handle.fileno()).st_mode), 'Input must be a regular file.')
        raw = handle.read(max_bytes + 1)
    require(len(raw) <= max_bytes, 'Input exceeds byte limit.')
    # BOM is accepted only before the manifest; candidate digest uses exact bytes.
    lines = raw.removeprefix(b'\xef\xbb\xbf').splitlines(keepends=True)
    require(2 <= len(lines) <= max_rows + 1 and all(len(line) <= max_line for line in lines), 'Input line/row limit or empty export.')
    require(all(line.endswith(b'\n') and line.strip() for line in lines), 'JSONL must have nonempty newline-terminated records.')
    m = strict_json(lines[0].decode('utf-8'))
    keys(m, ('type', 'schema', 'id', 'actor', 'validatedAt', 'snapshotHash', 'profile', 'algorithm', 'filters',
             'options', 'summary', 'skipped', 'rowsSha256', 'rows', 'formatterPending'))
    require(m['type'] == 'manifest' and m['schema'] == 'reviewed-taric-export/1' and m['profile'] == SOURCE_SCHEMA
            and m['algorithm'] == 'reviewed-selector/1' and m['formatterPending'] is True, 'Unsupported export manifest.')
    require(isinstance(m['id'], str) and ID.fullmatch(m['id']) and isinstance(m['snapshotHash'], str)
            and HEX.fullmatch(m['snapshotHash']), 'Invalid manifest identity/hash.')
    require(is_text(m['actor'], 24) and re.fullmatch('[a-f0-9]{24}', m['actor']), 'Invalid export actor.')
    keys(m['options'], ('mode', 'limit', 'perCode'))
    require(m['options']['mode'] in ('newest', 'balanced')
            and type(m['options']['limit']) is int and 1 <= m['options']['limit'] <= 200
            and type(m['options']['perCode']) is int and 1 <= m['options']['perCode'] <= 100, 'Invalid Site selection options.')
    keys(m['filters'], (), ('from', 'to', 'mode', 'state', 'feedback', 'review', 'error', 'jan', 'code',
                           'adapter', 'missing', 'eligible', 'search'))
    require(all(is_text(v, 100) for v in m['filters'].values()), 'Invalid Site filter metadata.')
    cutoff = timestamp(m['validatedAt'])
    require(type(m['rows']) is int and m['rows'] == len(lines) - 1 and m['rowsSha256'] == sha(b''.join(lines[1:])), 'Manifest row count/digest mismatch.')
    rows = [strict_json(line.decode('utf-8')) for line in lines[1:]]
    seen = set()
    for row in rows:
        validate_candidate(row)
        require(row['requestId'] not in seen, 'Duplicate request/revision in export; use one fresh snapshot.')
        seen.add(row['requestId'])
        require(timestamp(row['verifiedAt']) <= cutoff, 'Review is newer than the export cutoff.')
    summary = m['summary']
    keys(summary, ('available', 'eligible', 'selected', 'excluded', 'excludedByReason', 'perCode', 'perGroup', 'groups'))
    require(isinstance(m['skipped'], list) and len(m['skipped']) <= 2000, 'Invalid source exclusion list.')
    reasons = collections.Counter()
    excluded_ids = set()
    for skipped in m['skipped']:
        keys(skipped, ('id', 'reason', 'reasons'))
        require(isinstance(skipped['id'], str) and ID.fullmatch(skipped['id'])
                and skipped['id'] not in seen and skipped['id'] not in excluded_ids
                and isinstance(skipped['reason'], str) and skipped['reason'] in SOURCE_REASONS
                and isinstance(skipped['reasons'], list) and skipped['reasons']
                and all(isinstance(reason, str) and reason in SOURCE_REASONS for reason in skipped['reasons'])
                and skipped['reason'] == skipped['reasons'][0],
                'Selected row is also excluded or source exclusion is inconsistent.')
        excluded_ids.add(skipped['id'])
        reasons[skipped['reason']] += 1
    require(all(type(summary[k]) is int and 0 <= summary[k] <= 2000
                for k in ('available', 'eligible', 'selected', 'excluded', 'groups')), 'Invalid manifest counts.')
    require(summary['selected'] == len(rows) and summary['excluded'] == len(m['skipped'])
            and summary['available'] == len(rows) + len(m['skipped'])
            and type(summary['eligible']) is int and len(rows) <= summary['eligible'] <= summary['available']
            and summary['excludedByReason'] == dict(reasons)
            and summary['perCode'] == dict(collections.Counter(r['targetCode'] for r in rows))
            and summary['perGroup'] == dict(collections.Counter(r['groupKey'] for r in rows))
            and summary['groups'] == len(set(r['groupKey'] for r in rows)), 'Manifest selection summary mismatch.')
    require(len(rows) <= m['options']['limit'] and all(count <= m['options']['perCode'] for count in summary['perCode'].values()),
            'Manifest exceeds its declared Site selection caps.')
    return m, rows, sha(raw)


def select(source, rows, profile, as_of=None):
    cutoff = timestamp(as_of or source['validatedAt'])
    require(cutoff <= timestamp(source['validatedAt']), 'as-of cannot exceed the source validation cutoff.')
    cutoff_text = as_of or source['validatedAt']
    oldest = cutoff - dt.timedelta(days=profile['maxAgeDays']) if profile['maxAgeDays'] else None
    groups = collections.defaultdict(set)
    for r in rows:
        for group in (r['groupKey'], 'facts:' + r['factsHash']):
            groups[group].add(r['targetCode'])
    excluded, eligible, seen = [], [], set()
    missing_required = 0
    # Tie order matches Site: verification descending, then request ID descending.
    for r in sorted(rows, key=lambda r: (r['verifiedAt'], r['requestId']), reverse=True):
        reasons = []
        fields = r['source']
        for key, value in (('full_item_name', fields['facts']['name']), ('descriptive_name', fields['inputs']['descriptive_name']),
                           ('approved_description', r['approvedDescription'])):
            if not isinstance(value, str) or not value.strip():
                reasons.append('missing_' + key)
        for name, value, pattern in [('original_hs6', fields['inputs']['input_hs_code'], '[0-9]{6}'),
                                     ('target_code10', r['targetCode'], '[0-9]{10}')]:
            if not isinstance(value, str) or not re.fullmatch(pattern, value):
                reasons.append('missing_valid_' + name)
        if reasons:
            missing_required += 1
        if any(len(groups[g]) > 1 for g in (r['groupKey'], 'facts:' + r['factsHash'])):
            reasons.append('conflicting_verified_targets')
        when = timestamp(r['verifiedAt'])
        if when > cutoff:
            reasons.append('after_cutoff')
        if oldest and when < oldest:
            reasons.append('outside_recency_window')
        # The newest verified input wins even when its description is incomplete.
        # Never fall back to an older duplicate merely to fill a training row.
        if r['dedupeKey'] in seen:
            reasons.append('duplicate_input')
        seen.add(r['dedupeKey'])
        if reasons:
            excluded.append({'requestId': r['requestId'], 'reasons': reasons})
        else:
            eligible.append(r)
    ordered = eligible
    if profile['mode'] == 'balanced':
        buckets = collections.defaultdict(list)
        for r in eligible:
            buckets[r['targetCode']].append(r)
        ordered = [buckets[code][i] for i in range(len(eligible)) for code in sorted(buckets) if i < len(buckets[code])]
    selected, per_code, per_group = [], collections.Counter(), collections.Counter()
    for r in ordered:
        reason = ('per_code_cap' if per_code[r['targetCode']] >= profile['perCode'] else
                  'per_product_cap' if per_group[r['groupKey']] >= profile['perProduct'] else
                  'overall_limit' if len(selected) >= profile['maxRows'] else None)
        if reason:
            excluded.append({'requestId': r['requestId'], 'reasons': [reason]})
        else:
            selected.append(r)
            per_code[r['targetCode']] += 1
            per_group[r['groupKey']] += 1
    counts = dict(collections.Counter(reason for r in excluded for reason in r['reasons']))
    available_codes = sorted(set(r['targetCode'] for r in rows
                                 if isinstance(r['targetCode'], str) and re.fullmatch('[0-9]{10}', r['targetCode'])))
    aggregate = {'inputRows': len(rows), 'eligibleRows': len(eligible), 'selectedRows': len(selected),
                 'excludedRows': len(excluded), 'exclusionReasons': counts, 'missingRequired': missing_required,
                 'missingOptionalSpecifications': sum(not r['facts']['specifications'] for r in selected),
                 'perCode': {c: per_code[c] for c in available_codes},
                 'rareCodesUnder5': sum(0 < per_code[c] < 5 for c in available_codes),
                 'emptyCodes': sum(per_code[c] == 0 for c in available_codes),
                 'requestedMaxRows': profile['maxRows'],
                 'sourceExcludedByReason': source['summary']['excludedByReason'],
                 'warnings': ['Trusted export required; hashes are not signatures or later-revocation checks.',
                              'Selection covers this bounded export only; no oversampling or independent benchmark.',
                              'No tokenizer/truncation preflight; inspect actual trainer configuration.']}
    return selected, {'effectiveCutoff': cutoff_text, 'aggregate': aggregate, 'excluded': excluded}


def cleaned_row(r):
    hs = r['inputs']['input_hs_code']
    return dict(descriptive_name=r['inputs']['descriptive_name'], full_item_name=r['facts']['name'],
                specs=r['facts']['specifications'] or '', hs_code=hs[:4] + '.' + hs[4:], taric_code=r['targetCode'],
                description='', taric_description='', description_summary=r['approvedDescription'])


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def publish(output, artifacts):
    """Linux renameat2 NOREPLACE publishes the entire folder in one operation.

    Existing destinations (even empty/symlinks) are never replaced, including races.
    Private parent is operator-controlled; filesystem failures remove staging.
    """
    parent = output.absolute().parent
    require((ROOT / 'public').resolve() not in (parent.resolve(), *parent.resolve().parents),
            'Private datasets cannot be written beneath Site public/.')
    require(parent.is_dir() and not parent.is_symlink() and stat.S_IMODE(parent.stat().st_mode) & 0o077 == 0,
            'Output parent must exist with private permissions (chmod 700).')
    require(not os.path.lexists(output), 'Output directory already exists; choose a new run directory.')
    libc = ctypes.CDLL(None, use_errno=True)
    require(hasattr(libc, 'renameat2'), 'Atomic no-replace publication requires Linux renameat2.')
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    staging = Path(tempfile.mkdtemp(prefix='.taric-dataset-', dir=parent))
    try:
        for name, content in artifacts.items():
            fd = os.open(staging / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
        directory_fd = os.open(staging, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        if rename(-100, os.fsencode(staging), -100, os.fsencode(output.absolute()), 1) != 0:
            raise DatasetError('Atomic publication failed; destination must not exist and filesystem must support no-replace rename.')
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def convert(output, source, selected, source_digest, profile, report):
    cleaned = [cleaned_row(r) for r in selected]
    artifacts = {'cleaned.csv': csv_bytes(CLEANED_FIELDS, cleaned),
                 'prompt-response.csv': csv_bytes(OUTPUT_FIELDS, map(training_row, cleaned)),
                 'selection-report.json': json_bytes(report)}
    manifest = {'schema': 'taric-dataset/1', 'converter': VERSION, 'algorithm': ALGORITHM,
                'profile': profile, 'profileHash': hash_json(profile), 'effectiveCutoff': report['effectiveCutoff'],
                'source': {'exportId': source['id'], 'schema': source['schema'], 'sha256': source_digest,
                           'rowsSha256': source['rowsSha256'], 'snapshotHash': source['snapshotHash'],
                           'validatedAt': source['validatedAt'], 'options': source['options']},
                'renderer': {'version': TEMPLATE['version'], 'templateSha256': sha(TEMPLATE_BYTES),
                             'systemSha256': sha(TEMPLATE['system'].encode('utf-8')),
                             'moduleSha256': sha((ROOT / 'scripts/taric_dataset/formatting.py').read_bytes())},
                'converterSha256': sha(Path(__file__).read_bytes()),
                'cliSha256': sha((ROOT / 'scripts/taric_dataset_converter.py').read_bytes()), 'seed': None,
                'aggregate': report['aggregate'],
                'selected': [{k: r[k] for k in ('requestId', 'reviewId', 'reviewRevision', 'sourceHash', 'reviewHash',
                                               'sourceStorage', 'groupKey', 'factsHash', 'dedupeKey', 'verifiedAt', 'targetCode')}
                             | {'jan': r['inputs']['jan'], 'originalHs6': r['inputs']['input_hs_code']}
                             for r in selected],
                'files': {name: {'sha256': sha(content), 'bytes': len(content)} for name, content in artifacts.items()}}
    artifacts['manifest.json'] = json_bytes(manifest)
    publish(output, artifacts)
