"""Offline contract probe: exact pinned Gateway router/journal, no app or GPU import.

Reads synthetic cases from stdin. Only git objects from the explicit checkout are
read; all journals and imported modules live in a disposable temporary directory.
"""
import asyncio
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

PIN = 'd566158117d0bf55d61367dc3f026d6948e0d246'


async def probe(root, cases):
    import httpx
    from fastapi import FastAPI
    from durable_batch import DurableBatch
    from durable_batch_store import Journal

    token = 'synthetic-test-only-token-xxxxxxxxxxxxxxxx'
    service = DurableBatch(SimpleNamespace(), root=root / 'journal', enabled=True,
                           token=token, client_id='site-test')
    service.store = Journal(root / 'journal', min_free_bytes=0)
    app = FastAPI()
    app.include_router(service.router)
    answers = []
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                                    headers={'Authorization': 'Bearer ' + token, 'X-Batch-Client': 'site-test'}) as client:
            for case in cases:
                with patch('durable_batch.time.time', return_value=case['now'] / 1000):
                    response = await client.put('/batch/runs/' + case['id'], json=case['wire'])
                answers.append({'status': response.status_code, 'body': response.json()})
    finally:
        service.store.close()
    return answers


with tempfile.TemporaryDirectory(prefix='site-pinned-validator-') as directory:
    root = Path(directory)
    for module in ['durable_batch', 'durable_batch_store', 'durable_batch_validation']:
        source = subprocess.check_output(['git', '-C', sys.argv[1], 'show', f'{PIN}:ai-gateway/{module}.py'])
        (root / f'{module}.py').write_bytes(source)
    sys.path.insert(0, directory)
    print(json.dumps(asyncio.run(probe(root, json.load(sys.stdin)))))
