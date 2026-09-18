#!/usr/bin/env python3
"""Loopback-only generation bridge to Gateway's real test runtime.

Imports the separately checked-out Gateway helper. Production lifespan never runs;
only Docker, telemetry and upstream computation are faked by that shared runtime.
This bridge adds bounded synthetic generation and test-only counter/control routes.
"""
import argparse
import asyncio
from contextlib import asynccontextmanager
import importlib.util
import json
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--test-only', action='store_true', required=True)
parser.add_argument('--helper', required=True)
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--scenario', choices=['warm-benchmark', 'external-reservation', 'disconnect'], required=True)
args = parser.parse_args()
if not 1024 <= args.port <= 65535:
    parser.error('Invalid loopback port')
spec = importlib.util.spec_from_file_location('gateway_contract', Path(args.helper).resolve())
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)
g = contract.g
import httpx
import uvicorn
from fastapi.responses import JSONResponse

stats = {'upstream_calls': 0, 'adapters': [], 'creates': 0, 'deletes': 0, 'foreign_deletes': 0}
state = {}

@asynccontextmanager
async def lifespan(app):
    async with contract.contract_runtime('unused-residents') as hw:
        state['hardware'] = hw
        async def upstream(request):
            if request.method == 'GET' and request.url.path == '/health':
                return httpx.Response(200, json={'status': 'ok', 'model_ready': True})
            if request.method != 'POST' or request.url.path != '/generate':
                raise AssertionError('Unexpected fake upstream route')
            body = json.loads(request.content)
            stats['upstream_calls'] += 1
            adapter = body.get('adapter_name')
            stats['adapters'].append(adapter)
            # Cold and warm waits both exceed the five-second transport symptom.
            delay = [7, 6][stats['upstream_calls'] - 1] if args.scenario == 'warm-benchmark' and stats['upstream_calls'] <= 2 else 0
            if args.scenario == 'disconnect':
                delay = 1
            await asyncio.sleep(delay)
            text = json.dumps({'taric_code': '0000000001', 'description': 'Synthetic description'})
            return httpx.Response(200, json={'model': 'Qwen/Qwen3-4B-Instruct-2507', 'adapter_name': adapter,
                'content': text, 'raw_content': text, 'tool_calls': [],
                'usage': {'prompt_tokens': 200, 'completion_tokens': 30, 'total_tokens': 230}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            original = g.http_client
            original_adapters = g.QWEN3_LORA_ADAPTERS_DIR
            metadata = tempfile.TemporaryDirectory(prefix='taric-synthetic-adapters-')
            adapter_dir = Path(metadata.name) / 'taric-v1-20260917-2'
            adapter_dir.mkdir()
            (adapter_dir / 'adapter_config.json').write_text('{}')
            g.QWEN3_LORA_ADAPTERS_DIR = Path(metadata.name)
            g.http_client = client
            try:
                yield
            finally:
                g.http_client = original
                g.QWEN3_LORA_ADAPTERS_DIR = original_adapters
                metadata.cleanup()

g.app.router.lifespan_context = lifespan

async def test_app(scope, receive, send):
    # Transparent ASGI filter: never consume/rebuild the production request body
    # or introduce BaseHTTPMiddleware that could mask a disconnect/stream bug.
    if scope['type'] != 'http':
        return await g.app(scope, receive, send)
    path = scope['path']
    method = scope['method']
    response = None
    if path == '/__test__/state' and method == 'GET':
        hw = state['hardware']
        sessions = list(g.qwen_inference_sessions.sessions.values())
        response = JSONResponse({**stats,
            'starts': sum(method == 'POST' and name == hw.qwen and action == 'start' for method, name, action in hw.events),
            'stops': sum(method == 'POST' and name == hw.qwen and action == 'stop' for method, name, action in hw.events),
            'session_ids': [s.id for s in sessions],
            'operations': sum(len(s.operations) for s in sessions),
            'terminal_operations': sum(op['state'] == 'terminal' for s in sessions for op in s.operations.values()),
            'reclaimed': all(s.state in {'closed', 'expired'} for s in sessions) if sessions else False,
            'reservation': g.gpu_reservation is not None})
    elif path == '/__test__/operator' and args.scenario == 'external-reservation':
        if method == 'POST':
            await g.gpu_reservation_start({'service': 'qwen3_lora', 'wait': True, 'idle_timeout_sec': 120}, None)
            response = JSONResponse({'reserved': True})
        elif method == 'DELETE':
            await g.gpu_reservation_release({}, None)
            response = JSONResponse({'released': True})
    if response is not None:
        return await response(scope, receive, send)
    if not (path in ('/openapi.json', '/qwen3-lora/adapters', '/qwen3-lora/generate', '/qwen3-lora/inference-sessions')
            or path.startswith('/qwen3-lora/inference-sessions/')):
        return await JSONResponse({'detail': 'test-only route unavailable'}, status_code=404)(scope, receive, send)
    async def observe(message):
        if message['type'] == 'http.response.start':
            if path == '/qwen3-lora/inference-sessions' and method == 'POST' and message['status'] == 201:
                stats['creates'] += 1
            if method == 'DELETE':
                stats['deletes'] += 1
                if message['status'] in (403, 404):
                    stats['foreign_deletes'] += 1
        await send(message)
    await g.app(scope, receive, observe)

async def main():
    server = uvicorn.Server(uvicorn.Config(test_app, host='127.0.0.1', port=args.port, workers=1, access_log=False, timeout_graceful_shutdown=3))
    async def expire():
        await asyncio.sleep(90)
        server.should_exit = True
    timer = asyncio.create_task(expire())
    try:
        await server.serve()
    finally:
        timer.cancel()
        await asyncio.gather(timer, return_exceptions=True)

asyncio.run(main())
