"""Verify same-coordinator resume and the full session fence on the fixed Gateway.

Load committed Python modules with git show, never the Gateway working tree.
Actual ASGI routes, SQLite, session cleanup/state machine and scheduler run.
Docker, telemetry, model discovery and idle warming are synthetic; no app.py,
application lifespan, external HTTP, production journal or GPU is used.
"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

PIN = 'e20a437775bcf292d062d987c7850cd7d63a2a1a'
MODULES = (
    'durable_batch', 'durable_batch_sessions', 'durable_batch_store',
    'durable_batch_validation', 'durable_batch_media', 'durable_batch_vision',
    'durable_batch_outputs', 'durable_batch_workflows', 'comfy_thumbnails',
    'gpu_scheduler',
)
TOKEN = 'synthetic-batch-credential-not-for-deployment'
SESSION_TOKEN = 'a' * 64
NEXT_TOKEN = 'b' * 64


async def probe(root):
    import httpx
    from fastapi import FastAPI
    from durable_batch import DurableBatch, utc
    from gpu_scheduler import GpuJobScheduler

    # Fixed well inside the JST window; real monotonic/boot time still advances.
    # This makes the test independent of its invocation's proximity to 06:00.
    now = 1792256400.0  # 2026-10-17T17:00:00Z / 02:00 JST
    states = {'synthetic-mpnet': 'running'}
    docker_stops = []

    async def container_state(name):
        return states[name]

    async def stop_container(name, **kwargs):
        docker_stops.append(name)
        states[name] = 'exited'
        return True

    async def evidence():
        return {'blockers': [], 'eligible_idle_residents':
                ['mpnet'] if states['synthetic-mpnet'] == 'running' else []}

    warmed = AsyncMock()
    scheduler = GpuJobScheduler(on_idle=warmed, idle_delay_sec=0)
    gateway = SimpleNamespace(
        gpu_scheduler=scheduler, gpu_idle_training_lifecycle_lock=asyncio.Lock(),
        background_gpu_tasks=set(), gpu_resource_degraded_reason=None,
        _CONTAINER_STOPPED_STATES={'exited', 'stopped'},
        _gpu_service_spec=lambda _: SimpleNamespace(id='mpnet', container_name='synthetic-mpnet', stop_timeout_sec=1),
        get_container_state=container_state, stop_container=stop_container,
    )

    def make_service():
        service = DurableBatch(gateway, root=root / 'journal', enabled=True,
                               token=TOKEN, client_id='site-test', coverage='registered',
                               journal_options={'min_free_bytes': 0})
        gateway.durable_batch = service
        service.synchronous_blockers = lambda **kwargs: []
        service.readiness = AsyncMock(return_value={
            'healthy': True, 'idle_proven': True, 'eligible_idle_residents': ['mpnet']})
        service.resident_evidence = evidence
        service.verify_resident_reclaim = AsyncMock()
        return service

    auth = {'Authorization': 'Bearer ' + TOKEN, 'X-Batch-Client': 'site-test'}

    def authority(service, key, **changes):
        return {'X-Batch-Gateway-Epoch': service.epoch,
                'X-Batch-Coordinator-Id': 'same-live-site-process',
                'X-Batch-Session-Generation': '1', 'X-Batch-Session-Token': SESSION_TOKEN,
                'Idempotency-Key': key, **changes}

    def client_for(service):
        app = FastAPI()
        app.include_router(service.router)
        from durable_batch_sessions import SessionAdmissionMiddleware
        app.add_middleware(SessionAdmissionMiddleware, gateway=gateway)
        @app.delete('/gpu/reservation')
        async def delete_legacy():
            return {'released': True}
        @app.post('/llm/chat/jobs')
        async def ordinary_chat():
            return {'created': True}
        @app.post('/comfy/input/upload')
        async def cpu_upload():
            return {'uploaded': True}
        @app.get('/llm/models')
        async def catalog():
            return {'models': []}
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                base_url='http://synthetic.invalid', headers=auth)

    def answer(response):
        body = response.json()
        return {'status': response.status_code, 'code': body.get('detail', {}).get('code'),
                'state': body.get('state'), 'replayed': body.get('replayed'),
                'mutation_outcome': body.get('mutation_outcome'),
                'retry_after': response.headers.get('retry-after')}

    result = {'gateway_commit': PIN}
    service = make_service()
    with patch('time.time', return_value=now):
        try:
            await service.start()
            initial_epoch = service.epoch
            async with client_for(service) as client:
                caps = (await client.get('/batch/capabilities')).json()
                result['capabilities'] = {key: caps[key] for key in (
                    'session_capability_version', 'ledger_min_reader_version', 'features')}
                body = {'mode': 'manual', 'max_duration_seconds': 300, 'not_after': utc(now + 300)}
                acquisition = await client.put('/batch/sessions/site_session', json=body,
                                               headers=authority(service, 'acquire'))
                assert acquisition.status_code == 202, acquisition.text
                await service.sessions.tick()
                status = (await client.get('/batch/sessions/site_session')).json()
                assert status['state'] == 'held', status
                result['busy_contract'] = answer(await client.post('/llm/chat/jobs', json={}))
                result['stale_legacy_release'] = answer(await client.delete('/gpu/reservation'))
                result['cpu_routes'] = [(await client.post('/comfy/input/upload', json={})).status_code, (await client.get('/llm/models')).status_code]
                result['new_codex'] = answer(await client.put('/batch/activities/new_codex', json={'coordinator_id': 'new_codex_process'}))
                original_hard = status['hard_deadline']
                wire = {'mode': 'manual', 'not_before': utc(), 'deadline': original_hard,
                        'session_id': 'site_session', 'session_sequence': 1}
                registered = await client.put('/batch/runs/run_one', json=wire, headers=authority(service, 'unused'))
                assert registered.status_code == 200, registered.text
                renew = await client.post('/batch/sessions/site_session/renew', json={}, headers=authority(service, 'renew_before_restart'))
                assert renew.status_code == 200, renew.text
                old_lease = renew.json()['lease_deadline']
                original_record = service.store.get('runs', 'run_one')
                result['pre_restart'] = {'state': status['state'], 'docker_stops': list(docker_stops),
                                         'warming_calls': warmed.await_count}

            # New Gateway service/epoch, same ledger and unchanged Site identity.
            # No claim is made that the still-running Site process terminated.
            await service.close()
            service = make_service()
            await service.start()
            assert service.epoch != initial_epoch
            async with client_for(service) as client:
                status = (await client.get('/batch/sessions/site_session')).json()
                result['restart'] = {key: status[key] for key in (
                    'state', 'dispatch_allowed', 'generation', 'lease_remaining_seconds', 'hard_remaining_seconds')}
                result['restart']['hard_deadline_unchanged'] = status['hard_deadline'] == original_hard
                result['stale_epoch'] = answer(await client.post('/batch/sessions/site_session/renew', json={},
                    headers=authority(service, 'stale_epoch', **{'X-Batch-Gateway-Epoch': initial_epoch})))
                result['fresh_epoch_renew'] = answer(await client.post('/batch/sessions/site_session/renew', json={},
                    headers=authority(service, 'fresh_epoch_renew')))
                result['truthful_recovery'] = answer(await client.post('/batch/sessions/site_session/recover',
                    json={'previous_coordinator_terminated': False, 'coordinator_id': 'same-live-site-process'},
                    headers=authority(service, 'truthful_recover', **{'X-Batch-Next-Session-Token': NEXT_TOKEN})))
                # Even an invalid termination assertion cannot reuse that coordinator.
                result['same_id_recovery'] = answer(await client.post('/batch/sessions/site_session/recover',
                    json={'previous_coordinator_terminated': True, 'coordinator_id': 'same-live-site-process'},
                    headers=authority(service, 'same_id_recover', **{'X-Batch-Next-Session-Token': NEXT_TOKEN})))
                replay = await client.post('/batch/sessions/site_session/renew', json={},
                    headers=authority(service, 'renew_before_restart', **{'X-Batch-Gateway-Epoch': initial_epoch}))
                result['renew_replay'] = {**answer(replay), 'lease_unchanged': replay.json()['lease_deadline'] == old_lease}
                result['acquire_replay'] = answer(await client.put('/batch/sessions/site_session', json=body,
                    headers=authority(service, 'acquire', **{'X-Batch-Gateway-Epoch': initial_epoch})))
                result['new_run'] = answer(await client.put('/batch/runs/run_two',
                    json={**wire, 'session_sequence': 2}, headers=authority(service, 'unused')))
                result['close'] = answer(await client.post('/batch/sessions/site_session/close',
                    json={'last_run_sequence': 1, 'queue_revision': 'sealed_revision'}, headers=authority(service, 'close')))
                await service.sessions.tick()
                await service._tick()
                result['passive_reconciliation'] = {
                    'state': service.sessions.current()['state'],
                    'dispatch_allowed': service.sessions.eligible(('site_session', 1)),
                    'run_unchanged': service.store.get('runs', 'run_one') == original_record,
                    'warming_calls': warmed.await_count,
                }
                resumed = await client.post('/batch/sessions/site_session/resume', json={}, headers=authority(service, 'resume_one'))
                result['resume'] = {**answer(resumed), 'generation': resumed.json().get('generation'),
                                    'lease_unchanged': resumed.json().get('lease_deadline') == old_lease,
                                    'hard_unchanged': resumed.json().get('hard_deadline') == original_hard,
                                    'dispatch_allowed': resumed.json().get('dispatch_allowed')}
                replayed = await client.post('/batch/sessions/site_session/resume', json={}, headers=authority(service, 'resume_one'))
                result['resume_replay'] = answer(replayed)
                result['separate_renew'] = answer(await client.post('/batch/sessions/site_session/renew', json={}, headers=authority(service, 'renew_after_resume')))
                for sequence in (2, 3):
                    response = await client.put(f'/batch/runs/cohort_{sequence}', json={**wire, 'session_sequence': sequence}, headers=authority(service, 'unused'))
                    assert response.status_code == 200, response.text
                result['cohorts'] = {'runs': len(service.store.all('runs')), 'warming_calls': warmed.await_count,
                                     'docker_stops': list(docker_stops)}
            await service.close()
            service = make_service()
            await service.start()
            async with client_for(service) as client:
                old_resume = await client.post('/batch/sessions/site_session/resume', json={}, headers=authority(service, 'resume_one'))
                result['second_restart_old_replay'] = {**answer(old_resume), 'dispatch_allowed': old_resume.json()['dispatch_allowed']}
                fresh_resume = await client.post('/batch/sessions/site_session/resume', json={}, headers=authority(service, 'resume_two'))
                result['second_resume'] = answer(fresh_resume)
                result['stop'] = answer(await client.post('/batch/sessions/site_session/stop',
                    json={'mode': 'finish_current'}, headers=authority(service, 'owned_stop')))
                await service.sessions.tick()
                await asyncio.sleep(.01)
                released = (await client.get('/batch/sessions/site_session')).json()
                result['release'] = {key: released[key] for key in ('state', 'cleanup', 'generation', 'dispatch_allowed')}
                result['release'].update(warming_calls=warmed.await_count, docker_stops=list(docker_stops),
                                         run_status=(await client.get('/batch/runs/run_one')).json()['status'])
                result['released_renew'] = answer(await client.post('/batch/sessions/site_session/renew', json={},
                    headers=authority(service, 'released_renew')))
                result['stop_replay'] = answer(await client.post('/batch/sessions/site_session/stop',
                    json={'mode': 'finish_current'}, headers=authority(service, 'owned_stop')))
                result['reader_version'] = service.store.db.execute('PRAGMA user_version').fetchone()[0]
                public = json.dumps(result)
                assert SESSION_TOKEN not in public and NEXT_TOKEN not in public and TOKEN not in public
        finally:
            await service.close()
            await scheduler.close()
    return result


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='site-session-contract-') as directory:
        root = Path(directory)
        for module in MODULES:
            (root / (module + '.py')).write_bytes(subprocess.check_output(
                ['git', '-C', sys.argv[1], 'show', f'{PIN}:ai-gateway/{module}.py'], timeout=15))
        sys.path.insert(0, directory)
        os.environ['BATCH_SESSIONS_ENABLED'] = 'true'
        print(json.dumps(asyncio.run(probe(root))))
