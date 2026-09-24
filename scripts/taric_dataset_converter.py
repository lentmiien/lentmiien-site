#!/usr/bin/env python3
"""Offline verified TARIC JSONL -> private cleaned and Qwen CSV snapshot (Linux)."""
import argparse
import json
import sys
from pathlib import Path
from taric_dataset.converter import DatasetError, convert, load_profile, read_export, select


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path, help='Fresh trusted Site JSONL export only')
    parser.add_argument('--profile', required=True, help='newest-verified, balanced-recent, or JSON path')
    parser.add_argument('--output-dir', required=True, type=Path, help='New directory under an existing private parent')
    parser.add_argument('--dry-run', action='store_true', help='Validate and report aggregates without writing')
    parser.add_argument('--as-of', help='Optional UTC ISO cutoff, no later than export validatedAt')
    parser.add_argument('--max-input-bytes', type=int, default=8 * 1024 * 1024)
    parser.add_argument('--max-line-bytes', type=int, default=2 * 1024 * 1024)
    parser.add_argument('--max-input-rows', type=int, default=200)
    args = parser.parse_args()
    try:
        profile = load_profile(args.profile)
        source, rows, digest = read_export(args.input, args.max_input_bytes, args.max_line_bytes, args.max_input_rows)
        selected, report = select(source, rows, profile, args.as_of)
        print(json.dumps(report['aggregate'], ensure_ascii=True, sort_keys=True))
        if not selected:
            raise DatasetError('Zero eligible rows: inspect exclusion counts; approve descriptions in history and export fresh sources.')
        if profile['missingRequired'] == 'error' and report['aggregate']['missingRequired']:
            raise DatasetError('Profile requires complete rows: repair required facts/approved descriptions and re-export.')
        if not args.dry_run:
            convert(args.output_dir, source, selected, digest, profile, report)
        return 0
    except DatasetError as error:
        print(f'Error: {error}', file=sys.stderr)
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, RecursionError):
        # Never echo untrusted row text, private paths, or JSON parser excerpts.
        print('Error: malformed input or filesystem operation failed; check schema, UTF-8, limits and private output permissions.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
