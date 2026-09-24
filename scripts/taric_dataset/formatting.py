"""Versioned, literal formatter; no evaluation of product contents or templates."""
import csv
import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_BYTES = (ROOT / 'config/taric-training-template.json').read_bytes()
TEMPLATE = json.loads(TEMPLATE_BYTES)
CLEANED_FIELDS = ['descriptive_name', 'full_item_name', 'specs', 'hs_code',
                  'taric_code', 'description', 'taric_description', 'description_summary']
OUTPUT_FIELDS = ['system', 'prompt', 'response']


def training_row(row):
    return {
        'system': TEMPLATE['system'],
        'prompt': re.sub(r'\{(descriptive_name|full_item_name|specs|hs_code)\}',
                         lambda match: row[match[1]], TEMPLATE['prompt']),
        'response': json.dumps({'taric_code': row['taric_code'],
                                'description': row['description_summary']},
                               ensure_ascii=False, indent=2),
    }


def csv_bytes(fields, rows):
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode('utf-8')
