"""Synthetic service-export integration and failure tests; no private fixtures."""
import collections
import copy
import concurrent.futures
import csv
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from taric_dataset import converter as c
from taric_dataset.formatting import CLEANED_FIELDS, OUTPUT_FIELDS, TEMPLATE, training_row
CLI = ROOT / 'scripts/taric_dataset_converter.py'


class ConverterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.export = subprocess.check_output(['node', str(ROOT / 'tests/helpers/taricDatasetExport.js')], cwd=ROOT)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.input = self.root / 'source.jsonl'
        self.input.write_bytes(self.export)
        self.manifest, self.rows, self.digest = c.read_export(self.input)
        self.profile = c.load_profile('newest-verified')

    def cli(self, *extra, output='out'):
        return subprocess.run([sys.executable, str(CLI), '--input', str(self.input), '--profile', 'newest-verified',
                               '--output-dir', str(self.root / output), *extra], cwd=self.root, capture_output=True, text=True)

    def reseal(self, rows=None, manifest=None):
        rows = self.rows if rows is None else rows
        m = copy.deepcopy(manifest or self.manifest)
        body = b''.join((json.dumps(r, ensure_ascii=False) + '\n').encode() for r in rows)
        m['rows'] = len(rows)
        m['rowsSha256'] = c.sha(body)
        m['summary'] = dict(available=len(rows), eligible=len(rows), selected=len(rows), excluded=0,
                            excludedByReason={}, perCode=dict(collections.Counter(r['targetCode'] for r in rows)),
                            perGroup=dict(collections.Counter(r['groupKey'] for r in rows)), groups=len(set(r['groupKey'] for r in rows)))
        m['skipped'] = []
        self.input.write_bytes((json.dumps(m) + '\n').encode() + body)
        return m

    def rebound(self, row):
        """Adversarial consistent fixtures, identities recomputed by actual JS domain."""
        script = "const d=require('./services/taric/historyDomain');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const r=JSON.parse(s);r.review.source=r.source;r.review.sourceHash=require('./utils/taricProtocol').hash(r.source);const x=d.deriveSource(r.source,{revision:r.reviewRevision,latest:r.review},r.sourceStorage==='archived_review');process.stdout.write(JSON.stringify(d.candidate(x)));});"
        return json.loads(subprocess.check_output(['node', '-e', script], input=json.dumps(row).encode(), cwd=ROOT))

    def test_actual_service_export_cli_csv_provenance_reproducibility(self):
        result = self.cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('Synthetic', result.stdout)
        self.assertEqual(self.input.read_bytes(), self.export)
        self.assertEqual(self.cli(output='rerun').returncode, 0)
        out = self.root / 'out'
        for p in out.iterdir():
            self.assertEqual(p.read_bytes(), (self.root / 'rerun' / p.name).read_bytes())
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
        self.assertEqual(out.stat().st_mode & 0o777, 0o700)
        cleaned = list(csv.DictReader(io.StringIO((out / 'cleaned.csv').read_text(), newline='')))
        trained = list(csv.DictReader(io.StringIO((out / 'prompt-response.csv').read_text(), newline='')))
        self.assertEqual(list(cleaned[0]), CLEANED_FIELDS)
        self.assertEqual(list(trained[0]), OUTPUT_FIELDS)
        self.assertEqual(len(cleaned), 7)
        meta = json.loads((out / 'manifest.json').read_text())
        self.assertEqual(meta['source']['sha256'], c.sha(self.export))
        for name, info in meta['files'].items():
            self.assertEqual(info['sha256'], c.sha((out / name).read_bytes()))
        self.assertEqual(meta['profileHash'], c.hash_json(self.profile))
        self.assertEqual(meta['aggregate']['missingOptionalSpecifications'], 1)
        sources = {r['requestId']: r for r in self.rows}
        for provenance, row, target in zip(meta['selected'], cleaned, trained):
            source = sources[provenance['requestId']]
            self.assertEqual(row['full_item_name'], source['facts']['name'])
            self.assertEqual(row['specs'], source['facts']['specifications'] or '')
            self.assertEqual(row['hs_code'], '0012.34')
            self.assertEqual(provenance['originalHs6'], '001234')
            self.assertIsInstance(provenance['jan'], str)
            self.assertEqual(row['description'], '')
            self.assertEqual(row['taric_description'], '')
            self.assertEqual(target, training_row(row))
            response = json.loads(target['response'])
            self.assertEqual(response, {'taric_code': source['review']['target'], 'description': source['review']['approvedDescription']})
            self.assertNotIn('WRONG MODEL', str(target))
        self.assertTrue(any(r['sourceStorage'] == 'archived_review' for r in meta['selected']))

    def test_dry_run_existing_destination_and_atomic_failure(self):
        self.assertEqual(self.cli('--dry-run').returncode, 0)
        self.assertFalse((self.root / 'out').exists())
        self.assertEqual(self.cli().returncode, 0)
        before = (self.root / 'out' / 'manifest.json').read_bytes()
        self.assertNotEqual(self.cli().returncode, 0)
        self.assertEqual(before, (self.root / 'out' / 'manifest.json').read_bytes())
        with mock.patch.object(c.os, 'fsync', side_effect=OSError('synthetic')):
            with self.assertRaises(OSError):
                c.publish(self.root / 'fail', {'a': b'1', 'b': b'2'})
        self.assertFalse((self.root / 'fail').exists())
        self.assertFalse(list(self.root.glob('.taric-dataset-*')))
        (self.root / 'link').symlink_to(self.root / 'out')
        with self.assertRaises(c.DatasetError):
            c.publish(self.root / 'link', {'x': b'x'})
        (self.root / 'empty').mkdir()
        with self.assertRaises(c.DatasetError):
            c.publish(self.root / 'empty', {'x': b'x'})
        (self.root / 'shared').mkdir(mode=0o755)
        with self.assertRaises(c.DatasetError):
            c.publish(self.root / 'shared' / 'run', {'x': b'x'})

    def test_js_hash_compatibility_unicode_null_arrays_integer_keys(self):
        values = [None, [None, True, False, 42, -8, 9007199254740991],
                  {'é': 'e\u0301', '日本語': '🧪\n"\\\t', '10': 'ten', '2': 'two', '\uffff': 1, '😀': None},
                  {'a': '\ud800', 'z': '\u2028\u2029', 'null': [None]}]
        script = "const h=require('./utils/taricContracts').hash;let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s).map(h))));"
        hashes = json.loads(subprocess.check_output(['node', '-e', script], input=json.dumps(values).encode(), cwd=ROOT))
        self.assertEqual(hashes, [c.hash_json(v) for v in values])

    def test_bom_corruption_duplicate_keys_limits_and_private_errors(self):
        self.input.write_bytes(b'\xef\xbb\xbf' + self.export)
        self.assertEqual(len(c.read_export(self.input)[1]), 8)
        self.input.write_bytes(self.export.replace(b'Synthetic', b'CORRUPTED', 1))
        self.assertNotEqual(self.cli('--dry-run').returncode, 0)
        for raw in [b'{"x":1,"x":2}', b'{"a":{"__proto__":{}}}', b'{"x":NaN}', b'{"x":1.2}',
                    b'[' * 22 + b'0' + b']' * 22, b'{"x":9007199254740992}']:
            with self.assertRaises(c.DatasetError):
                c.strict_json(raw)
        self.input.write_bytes(self.export)
        for options in [dict(max_bytes=20), dict(max_line=20), dict(max_rows=2), dict(max_rows=201)]:
            with self.assertRaises(c.DatasetError):
                c.read_export(self.input, **options)
        self.input.write_bytes(b'{"PRIVATE ROW TEXT": INVALID}\n{}\n')
        result = self.cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('PRIVATE ROW', result.stderr)
        self.assertFalse((self.root / 'out').exists())

    def test_binding_revocation_stale_and_proposal_archive_rejected(self):
        changes = [lambda r: r.update(verification='excluded'), lambda r: r['review'].update(status='needs_review'),
                   lambda r: r['source']['facts'].update(name='mutated'), lambda r: r.update(targetCode='9999999999'),
                   lambda r: r.update(reviewRevision=3), lambda r: r.update(groupKey='jan:changed'),
                   lambda r: r.update(stale=True), lambda r: r.update(reasons=['independent_holdout_overlap']),
                   lambda r: r['review'].update(feedbackHash='0' * 64),
                   lambda r: r['review'].update(sourceHash='0' * 64)]
        for change in changes:
            rows = copy.deepcopy(self.rows)
            change(rows[0])
            rows[0]['reviewHash'] = c.hash_json(rows[0]['review'])
            self.reseal(rows)
            with self.assertRaises(c.DatasetError):
                c.read_export(self.input)
        archived = copy.deepcopy(next(r for r in self.rows if r['sourceStorage'] == 'archived_review'))
        archived['source']['feedback'] = None
        archived['review'].update(feedbackId=None, feedbackHash=None)
        archived = self.rebound(archived)
        self.reseal([archived])
        with self.assertRaises(c.DatasetError):
            c.read_export(self.input)
        self.reseal([self.rows[0], self.rows[0]])
        with self.assertRaises(c.DatasetError):
            c.read_export(self.input)

    def test_conflicts_before_recency_filter_dedup_and_product_caps(self):
        rows = copy.deepcopy(self.rows[:3])
        # Same JAN, different input, conflicting code: both excluded even if one is old.
        rows[1]['source']['inputs']['jan'] = rows[0]['source']['inputs']['jan']
        rows[1]['review']['target'] = '9999999999'
        rows[1]['review']['correction'] = True
        rows[1]['review']['at'] = '2026-09-21T00:00:00.000Z'
        rows[1] = self.rebound(rows[1])
        self.profile['maxAgeDays'] = 2
        chosen, report = c.select(self.manifest, rows, self.profile)
        self.assertNotIn(rows[0]['requestId'], [r['requestId'] for r in chosen])
        self.assertEqual(report['aggregate']['exclusionReasons']['conflicting_verified_targets'], 2)
        rows[1]['review']['target'] = rows[0]['targetCode']
        rows[1] = self.rebound(rows[1])
        self.profile['maxAgeDays'] = None
        self.profile['perProduct'] = 1
        chosen, report = c.select(self.manifest, rows, self.profile)
        self.assertEqual(report['aggregate']['exclusionReasons']['per_product_cap'], 1)
        rows[1]['source']['inputs'] = copy.deepcopy(rows[0]['inputs'])
        rows[1]['source']['facts'] = copy.deepcopy(rows[0]['facts'])
        rows[1] = self.rebound(rows[1])
        chosen, report = c.select(self.manifest, rows, self.profile)
        self.assertEqual(report['aggregate']['exclusionReasons']['duplicate_input'], 1)
        self.assertIn(rows[0]['requestId'], [r['requestId'] for r in chosen])

    def test_balanced_newness_ties_cutoff_and_profiles(self):
        profile = c.load_profile('balanced-recent')
        profile.update(maxRows=4, perCode=2)
        a, report = c.select(self.manifest, self.rows, profile)
        b, _ = c.select(self.manifest, list(reversed(self.rows)), profile)
        self.assertEqual(a, b)
        self.assertEqual([r['targetCode'] for r in a], ['0000000002', '0000000003'] * 2)
        self.assertEqual(a[1]['requestId'], max(r['requestId'] for r in self.rows if r['targetCode'] == '0000000003'))
        self.assertEqual(report['aggregate']['selectedRows'], 4)
        older, _ = c.select(self.manifest, self.rows, profile, '2026-09-21T23:00:00.000Z')
        self.assertEqual(len(older), 1)
        with self.assertRaises(c.DatasetError):
            c.select(self.manifest, self.rows, profile, '2026-10-01T00:00:00.000Z')
        for key, value in [('system', 'override'), ('maxRows', True), ('perCode', 201), ('mode', 'eval'),
                           ('maxAgeDays', 0), ('missingRequired', 'fallback')]:
            p = dict(profile, **{key: value})
            path = self.root / 'bad-profile.json'
            path.write_text(json.dumps(p))
            with self.assertRaises(c.DatasetError):
                c.load_profile(str(path))

    def test_missing_facts_description_no_fallback_zero_and_strict(self):
        r = copy.deepcopy(self.rows[0])
        r['source']['facts']['name'] = None
        r['source']['inputs']['descriptive_name'] = ''
        r['source']['inputs']['input_hs_code'] = 'bad'
        r['review']['approvedDescription'] = None
        r = self.rebound(r)
        self.reseal([r])
        result = self.cli()
        self.assertNotEqual(result.returncode, 0)
        report = json.loads(result.stdout)
        self.assertEqual(report['selectedRows'], 0)
        for key in ('missing_full_item_name', 'missing_descriptive_name', 'missing_valid_original_hs6', 'missing_approved_description'):
            self.assertEqual(report['exclusionReasons'][key], 1)
        self.assertFalse((self.root / 'out').exists())
        self.input.write_bytes(self.export)
        p = dict(self.profile, missingRequired='error')
        path = self.root / 'strict.json'
        path.write_text(json.dumps(p))
        self.assertNotEqual(self.cli('--profile', str(path)).returncode, 0)
        self.assertFalse((self.root / 'out').exists())

    def test_atomic_concurrent_publish_never_replaces_winner(self):
        def run(n):
            try:
                c.publish(self.root / 'race', {'first': str(n).encode(), 'second': str(n).encode()})
                return True
            except c.DatasetError:
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, (1, 2)))
        self.assertEqual(results.count(True), 1)
        self.assertEqual((self.root / 'race/first').read_bytes(), (self.root / 'race/second').read_bytes())
        self.assertFalse(list(self.root.glob('.taric-dataset-*')))

    def test_latest_incomplete_duplicate_blocks_older_and_formula_facts_are_literal(self):
        newest, older = copy.deepcopy(self.rows[:2])
        newest['source']['inputs']['descriptive_name'] = '=SYNTHETIC()'
        newest['source']['facts']['name'] = '@Synthetic {specs}'
        newest['review']['approvedDescription'] = None
        newest = self.rebound(newest)
        older['source']['inputs'] = copy.deepcopy(newest['inputs'])
        older['source']['facts'] = copy.deepcopy(newest['facts'])
        older['review']['target'] = newest['targetCode']
        older['review']['correction'] = True
        older['review']['approvedDescription'] = 'Synthetic independently checked'
        older['review']['at'] = '2026-09-21T00:00:00.000Z'
        older = self.rebound(older)
        selected, report = c.select(self.manifest, [older, newest], self.profile)
        self.assertEqual(selected, [])
        self.assertEqual(report['aggregate']['exclusionReasons']['duplicate_input'], 1)
        row = c.cleaned_row(older)
        self.assertEqual(row['descriptive_name'], '=SYNTHETIC()')
        self.assertEqual(row['full_item_name'], '@Synthetic {specs}')
        self.assertIn('@Synthetic {specs}', training_row(row)['prompt'])
        # The reference/source renderer's NFKC grouping also agrees cross-language.
        older['source']['inputs']['descriptive_name'] = '  ＡＢＣ\u00a0category  '
        older = self.rebound(older)
        c.validate_candidate(older)

    def test_holdout_or_stale_skipped_cannot_be_selected(self):
        for reason in ('independent_holdout_overlap', 'stale_source', 'conflicting_verified_targets'):
            m = self.reseal()
            m['skipped'] = [{'id': self.rows[0]['requestId'], 'reason': reason, 'reasons': [reason]}]
            lines = self.input.read_bytes().split(b'\n', 1)
            self.input.write_bytes(json.dumps(m).encode() + b'\n' + lines[1])
            with self.assertRaises(c.DatasetError):
                c.read_export(self.input)


if __name__ == '__main__':
    unittest.main()
