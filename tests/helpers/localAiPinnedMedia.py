"""Exercise committed 2975356 CPU routes/journal, never import or edit live Gateway.
The only stub is Ollama's upstream preparer; no scheduler task or inference starts.
"""
import asyncio
import base64
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
PIN = '2975356ab4f0111929c9b2d82fa360b891f2a625'

async def probe(root, case):
    import httpx
    from fastapi import FastAPI
    from durable_batch import DurableBatch
    from durable_batch_store import Journal, JournalError
    spec = {'provider': 'ollama', 'model': 'gemma3:12b', 'allow_images': True, 'max_images': 3, 'max_image_bytes': 6000000}
    gateway = SimpleNamespace(load_llm_config=lambda: {'models': {'gemma3:12b': spec}},
        llm_model_provider=lambda s: s['provider'], OLLAMA_URL='http://no-inference.invalid',
        prepare_llm_chat_request=lambda body: SimpleNamespace(provider='ollama', gpu_affinity='ollama|gemma3', body=copy.deepcopy(body)))
    service = DurableBatch(gateway, root=root / 'journal', enabled=True,
        token='synthetic-test-token-xxxxxxxxxxxxxxxx', client_id='site-test')
    service.store = Journal(root / 'journal', min_free_bytes=0)
    app = FastAPI(); app.include_router(service.router)
    @app.exception_handler(JournalError)
    async def journal_error(request, exc):
        from fastapi.responses import JSONResponse
        return JSONResponse({'detail': {'code': str(exc)}}, status_code=507 if str(exc) in {'storage_quota', 'storage_free_space', 'record_quota'} else 503)
    headers = {'Authorization': 'Bearer synthetic-test-token-xxxxxxxxxxxxxxxx', 'X-Batch-Client': 'site-test'}
    answers = {}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test', headers=headers) as client:
        response = await client.put('/batch/inputs/' + case['input_id'], files={'manifest': (None, '{"schema_version":2}'), 'file': ('ignored', base64.b64decode(case['bytes']))})
        answers['upload'] = {'status': response.status_code, 'body': response.json()}
        for method in ['GET', 'HEAD']:
            response = await client.request(method, '/batch/inputs/' + case['input_id'] + '/content', headers={'Range': 'bytes=0-7'})
            answers[method] = {'status': response.status_code, 'length': response.headers.get('content-length')}
        with patch('durable_batch.time.time', return_value=case['now'] / 1000):
            response = await client.put('/batch/runs/run_site', json=case['run'])
        answers['run'] = {'status': response.status_code, 'body': response.json()}
        before = (await client.get('/batch/capacity')).json()
        response = await client.put('/batch/runs/run_site', json=case['run'])
        answers['run_replay'] = response.status_code
        after = (await client.get('/batch/capacity')).json()
        answers['replay_reservation_unchanged'] = before['reserved_bytes'] == after['reserved_bytes']
        oversized = {**case['run'], 'operation_ids': ['overflow_' + str(i) for i in range(100)]}
        with patch('durable_batch.time.time', return_value=case['now'] / 1000):
            response = await client.put('/batch/runs/run_overflow', json=oversized)
        answers['whole_cohort_quota'] = response.status_code
        after = (await client.get('/batch/capacity')).json()
        answers['rejected_reservation_unchanged'] = before['reserved_bytes'] == after['reserved_bytes']
        response = await client.put('/batch/runs/run_site/operations/op_site', json=case['operation'])
        answers['operation'] = {'status': response.status_code, 'body': response.json()}
        response = await client.post('/batch/runs/run_site/start', json={'operations': []})
        answers['incomplete_seal'] = response.status_code
        response = await client.post('/batch/runs/run_site/start', json=case['seal'])
        answers['seal'] = {'status': response.status_code, 'body': response.json()}
        response = await client.post('/batch/runs/run_site/start', json=case['seal'])
        answers['replay_seal'] = response.status_code
    service.store.close()
    return answers

with tempfile.TemporaryDirectory(prefix='site-media-contract-') as directory:
    root = Path(directory)
    for module in ['durable_batch', 'durable_batch_store', 'durable_batch_validation', 'durable_batch_media', 'durable_batch_vision', 'comfy_thumbnails']:
        (root / (module + '.py')).write_bytes(subprocess.check_output(['git', '-C', sys.argv[1], 'show', f'{PIN}:ai-gateway/{module}.py']))
    sys.path.insert(0, directory)
    os.environ['BATCH_INPUTS_ENABLED'] = 'true'; os.environ['BATCH_OLLAMA_VISION_ENABLED'] = 'true'
    print(json.dumps(asyncio.run(probe(root, json.load(sys.stdin)))))
