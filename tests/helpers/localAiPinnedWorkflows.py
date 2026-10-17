"""Read-only extraction of Gateway 8105a1b. CPU ASGI routes, no app startup/GPU.
Synthetic final histories stand in for Comfy; actual journal/validators/outputs run.
"""
import asyncio
import ast
import base64
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
PIN = '8105a1b'

async def probe(root, cases):
    import httpx
    from PIL import Image
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import JSONResponse
    from durable_batch import DurableBatch, utc
    from durable_batch_store import Journal, JournalError
    import durable_batch_workflows as workflows
    from durable_batch_outputs import materialize
    from durable_batch_media import deny_reserved
    source = subprocess.check_output(['git', '-C', sys.argv[1], 'show', f'{PIN}:ai-gateway/app.py']).decode()
    path_functions = {'_comfy_input_root', '_comfy_input_relative_path', '_resolve_comfy_input_path', '_comfy_input_path_from_parts'}
    nodes = [n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name in path_functions]
    assert len(nodes) == 4
    path_source = 'from __future__ import annotations\n' + '\n'.join(ast.unparse(n) for n in nodes)
    output = io.BytesIO(); Image.new('RGB', (64, 48), 'blue').save(output, format='PNG'); png = output.getvalue()
    video_path = root / 'synthetic.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=24:d=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', str(video_path)], check=True, timeout=30, capture_output=True)
    video = video_path.read_bytes()
    answers = []
    for index, case in enumerate(cases):
        folder = root / str(index); folder.mkdir(); (folder / 'input').mkdir(); (folder / 'output').mkdir()
        namespace = {'Path': Path, 'HTTPException': HTTPException, 'COMFY_INPUT_DIR': folder/'input', 'deny_batch_namespace': deny_reserved}
        exec(path_source, namespace)
        gateway = SimpleNamespace(COMFY_INPUT_DIR=folder/'input', COMFY_OUTPUT_DIR=folder/'output', _comfy_input_path_from_parts=namespace['_comfy_input_path_from_parts'])
        service = DurableBatch(gateway, root=folder/'journal', enabled=True, token='synthetic-test-token-xxxxxxxxxxxxxxxx', client_id='site-test')
        service.store = Journal(folder/'journal', min_free_bytes=0)
        app = FastAPI(); app.include_router(service.router)
        @app.exception_handler(JournalError)
        async def error(request, exc):
            return JSONResponse({'detail': {'code': str(exc)}}, status_code=507 if str(exc) in {'storage_quota', 'storage_free_space', 'record_quota'} else 503)
        headers = {'Authorization': 'Bearer synthetic-test-token-xxxxxxxxxxxxxxxx', 'X-Batch-Client': 'site-test'}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test', headers=headers) as client:
            source = folder/'input'/'reference.png'; source.write_bytes(png)
            imported_id = 'in_' + 'f'*32
            import_body = {'schema_version': 2, 'source': {'filename': 'reference.png', 'subfolder': ''}}
            imported = await client.put('/batch/inputs/' + imported_id + '/import', json=import_body)
            assert imported.status_code == 201, imported.text
            source.write_bytes(b'overwritten original')
            replay_import = await client.put('/batch/inputs/' + imported_id + '/import', json=import_body)
            assert replay_import.status_code == 200 and replay_import.json() == imported.json()
            assert (await client.get('/batch/inputs/' + imported_id + '/content')).content == png
            bad_import = await client.put('/batch/inputs/in_' + 'e'*32 + '/import', json={'schema_version': 2, 'source': {'filename': 'reference.png [output]', 'subfolder': ''}})
            assert bad_import.status_code >= 400
            p = workflows.registry()[case['request']['workflow_id']]
            catalog = (await client.get('/batch/workflows')).json()
            assert len(catalog['workflows']) == 20
            policy = (await client.get(workflows.describe(p)['version_url'])).json()
            body = copy.deepcopy(case)
            for slot in p['bindings']:
                artifact = 'in_' + f'{int(slot.replace(":", "")):032x}'
                uploaded = await client.put('/batch/inputs/' + artifact, files={'manifest': (None, '{"schema_version":2}'), 'file': ('ignored', png)})
                assert uploaded.status_code in (200, 201), uploaded.text
                body['request']['bindings'][slot] = {k: uploaded.json()[k] for k in ('artifact_id', 'sha256')}
            wire = {'schema_version': 2, 'operation_ids': ['op_site'], 'operation_budgets': [{'operation_id': 'op_site', 'type': 'comfy.workflow', 'workflow_id': p['workflow_id'], 'template_sha256': p['template_sha256']}], 'mode': 'manual', 'not_before': utc(), 'deadline': utc(__import__('time').time() + 180)}
            admitted = await client.put('/batch/runs/run_site', json=wire)
            assert admitted.status_code == 200, admitted.text
            accepted = await client.put('/batch/runs/run_site/operations/op_site', json=body)
            assert accepted.status_code == 202, accepted.text
            replay = await client.put('/batch/runs/run_site/operations/op_site', json=body)
            assert replay.json() == accepted.json()
            bad = await client.post('/batch/runs/run_site/start', json={'operations': []})
            seal = {'operations': [{'operation_id': 'op_site', 'request_digest': accepted.json()['request_digest']}]}
            sealed = await client.post('/batch/runs/run_site/start', json=seal)
            assert sealed.status_code == 200, sealed.text
            op = service.store.get('operations', 'op_site'); materialize(service, op)
            history = {'status': {'completed': True, 'status_str': 'success'}, 'outputs': {}}
            content = video if p['limits']['require_audio'] else png
            for slot in op['frozen']['outputs']:
                prefix = Path(slot['prefix']); destination = folder/'output'/prefix.parent; destination.mkdir(parents=True, exist_ok=True)
                name = prefix.name + '_00001_' + ('.mp4' if slot['kind'] == 'video' else '.png')
                (destination/name).write_bytes(content)
                history['outputs'][slot['node_id']] = {'images': [{'filename': name, 'subfolder': prefix.parent.as_posix(), 'type': 'output'}], 'animated': [slot['kind'] == 'video']}
            result = await service.outputs.read_result(op, history)
            service._finish_operation(op, 'succeeded', result=result)
            public_response = await client.get('/batch/operations/op_site')
            public = public_response.json()
            downloads = []
            for a in result['artifacts']:
                response = await client.get(a['url']); assert response.content == content
                head = await client.head(a['url'], headers={'Range': 'bytes=0-7'}); assert head.status_code == 206 and head.headers['content-length'] == '8'
                downloads.append({'headers': dict(response.headers), 'status': response.status_code, 'bytes': base64.b64encode(response.content).decode()})
            ack = await client.post('/batch/operations/op_site/ack', json={'result_digest': public['result_digest']})
            answers.append({'policy': policy, 'accepted': accepted.json(), 'operation': public, 'raw_operation': public_response.text, 'downloads': downloads, 'incomplete_seal': bad.status_code, 'ack': ack.status_code, 'wire': wire, 'imported': imported.json(), 'import_replay': replay_import.status_code})
        service.store.close()
    return answers

with tempfile.TemporaryDirectory(prefix='site-comfy-contract-') as directory:
    root = Path(directory)
    for module in ['durable_batch', 'durable_batch_store', 'durable_batch_validation', 'durable_batch_media', 'durable_batch_vision', 'durable_batch_outputs', 'durable_batch_workflows', 'comfy_thumbnails']:
        (root/(module+'.py')).write_bytes(subprocess.check_output(['git', '-C', sys.argv[1], 'show', f'{PIN}:ai-gateway/{module}.py']))
    paths = subprocess.check_output(['git', '-C', sys.argv[1], 'ls-tree', '-r', '--name-only', PIN, 'ai-gateway/config/batch-workflows', 'ai-gateway/config/batch-comfy-runtime.json']).decode().splitlines()
    for path in paths:
        dest = root/path.removeprefix('ai-gateway/'); dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(subprocess.check_output(['git', '-C', sys.argv[1], 'show', f'{PIN}:{path}']))
    sys.path.insert(0, directory)
    for key in ['BATCH_INPUTS_ENABLED', 'BATCH_COMFY_WORKFLOWS_ENABLED', 'BATCH_SHARED_IMPORT_ENABLED']:
        os.environ[key] = 'true'
    print(json.dumps(asyncio.run(probe(root, json.load(sys.stdin)))))
