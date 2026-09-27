import concurrent.futures
import http.client
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Queue, Handler, ThreadingHTTPServer, command


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Test')
        self.git('config', 'user.email', 'test@example.invalid')
        (self.repo / 'original.txt').write_text('original\n')
        self.git('add', '.')
        self.git('commit', '-m', 'initial')
        command(['git', 'init', '--bare', str(self.root / 'remote.git')], self.root)
        self.git('remote', 'add', 'origin', str(self.root / 'remote.git'))
        self.git('push', '-u', 'origin', 'main')
        self.fake = self.root / 'fake-codex'
        self.fake.write_text('''#!/usr/bin/env python3
import json, pathlib, sys, time
args=sys.argv
if args[1] == 'sandbox':
    if pathlib.Path(__file__).with_name('fail-sandbox').exists():
        print('bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted', flush=True)
        sys.exit(9)
    sys.exit(0)
def emit(message): print(json.dumps(message), flush=True)
for line in sys.stdin:
    m=json.loads(line)
    if m.get('method') == 'initialize': emit({'id':m['id'],'result':{}})
    if m.get('method') == 'thread/start':
        assert m['params']['sandbox']=='workspace-write'
        assert m['params']['approvalPolicy']=='on-request'
        pathlib.Path('reviewer.txt').write_text(m['params']['approvalsReviewer'])
        emit({'id':m['id'],'result':{'thread':{'id':'fixture'},'sandbox':{'type':'workspaceWrite'},'approvalPolicy':'on-request','approvalsReviewer':m['params']['approvalsReviewer']}})
        emit({'method':'thread.started','params':{}})
    if m.get('method') != 'turn/start': continue
    emit({'id':m['id'],'result':{'turn':{'id':'turn'}}})
    prompt=m['params']['input'][0]['text']
    if 'SLOW_TEST' in prompt: time.sleep(30)
    if 'FAIL_TEST' in prompt: sys.exit(3)
    result={'status':'ready','summary':'Implemented test change','checks':['fixture check passed'], 'blocker_reason':'', 'next_steps':[]}
    if 'APPROVAL_TEST' in prompt:
        method='item/permissions/requestApproval' if 'PERMISSION_TEST' in prompt else 'item/commandExecution/requestApproval'
        emit({'id':42,'method':method,'params':{'threadId':'fixture','turnId':'turn','itemId':'cmd','command':'echo approved','cwd':str(pathlib.Path.cwd()),'reason':'Fixture approval','permissions':{'network':{'enabled':True}}}})
        response=json.loads(sys.stdin.readline())
        assert response['id']==42
        pathlib.Path('decision.json').write_text(json.dumps(response['result']))
        if response['result'].get('decision')=='decline':
            result.update(status='blocked', blocker_reason='User declined command', next_steps=['Review denied operation'])
    if 'BLOCK_TEST' in prompt:
        result.update(status='blocked', blocker_reason='Required fixture input missing', next_steps=['Supply fixture input then retry'])
    if 'CONTRADICT_TEST' in prompt:
        result.update(blocker_reason='Unresolved test failure', next_steps=['Fix failing test'])
    pathlib.Path('change.txt').write_text('completed')
    emit({'method':'item/completed','params':{'item':{'id':'result','type':'agentMessage','text':json.dumps(result)}}})
    emit({'method':'turn/completed','params':{'turn':{'status':'completed'}}})
''')
        self.fake.chmod(0o755)
        self.queue = Queue(self.repo, self.root / 'runtime', {'codex':str(self.fake), 'max_workers':2})
        self.http = None

    def git(self, *args):
        return command(['git', *args], self.repo)

    def tearDown(self):
        if self.http:
            self.http.shutdown()
            self.http.server_close()
        self.queue.stop()
        self.queue.db.close()
        self.tmp.cleanup()

    def task(self, prompt='Make the fixture change', **kwargs):
        return self.queue.create({'title':'Test task', 'prompt':prompt, **kwargs})

    def await_state(self, task_id, states, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            task = self.queue.get(task_id)
            if task['state'] in states and task_id not in self.queue.jobs:
                return task
            time.sleep(.05)
        self.fail('Timed out: ' + str(self.queue.get(task_id)))

    def test_roundtrip_real_git_and_worker(self):
        task = self.task()
        self.queue.tick()
        result = self.await_state(task['id'], {'review'})
        self.assertTrue(Path(result['worktree'], 'change.txt').exists())
        self.assertFalse((self.repo / 'change.txt').exists())
        self.assertEqual(self.git('branch', '--show-current'), 'main')
        self.assertIn(result['branch'], self.git('ls-remote', '--heads', 'origin'))
        self.assertIn('fixture check passed', result['result']['checks'])
        self.assertIsNone(result['attention'])
        self.assertIn('thread.started', self.queue.log(result))
        self.assertEqual(2, len(self.queue.worktrees()))

    def await_approval(self, task):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            current = self.queue.get(task['id'])
            if current['approvals']:
                return current['approvals'][0]
            time.sleep(.05)
        self.fail('No approval received: ' + str(current))

    def test_approval_accept_and_duplicate_rejected(self):
        task = self.task('APPROVAL_TEST')
        self.queue.tick()
        approval = self.await_approval(task)
        self.assertEqual('echo approved', approval['params']['command'])
        with self.queue.lock:
            session = self.queue.sessions[task['id']]
            session.decide(approval['id'], 'accept')
            with self.assertRaises(ValueError):
                session.decide(approval['id'], 'accept')
        result = self.await_state(task['id'], {'review'})
        self.assertEqual([], result['approvals'])
        self.assertEqual('auto_review', Path(result['worktree'], 'reviewer.txt').read_text())

    def test_decline_then_manual_review_retry(self):
        task = self.task('APPROVAL_TEST')
        self.queue.tick()
        approval = self.await_approval(task)
        with self.queue.lock:
            self.queue.sessions[task['id']].decide(approval['id'], 'decline')
        result = self.await_state(task['id'], {'blocked'})
        self.assertIn('declined', result['error'])
        self.assertNotIn(result['branch'], self.git('ls-remote', '--heads', 'origin'))
        self.queue.action(task['id'], 'retry-with-approval')
        self.queue.tick()
        new = self.await_approval(task)
        with self.queue.lock:
            session = self.queue.sessions[task['id']]
            with self.assertRaises(ValueError):
                session.decide(approval['id'], 'accept')
            session.decide(new['id'], 'accept')
        result = self.await_state(task['id'], {'review'})
        self.assertEqual('user', Path(result['worktree'], 'reviewer.txt').read_text())

    def test_cancel_pending_approval_never_publishes(self):
        task = self.task('APPROVAL_TEST')
        self.queue.tick()
        self.await_approval(task)
        self.queue.action(task['id'], 'cancel')
        result = self.await_state(task['id'], {'cancelled'})
        self.assertEqual([], result['approvals'])
        self.assertFalse(Path(result['worktree'], 'change.txt').exists())

    def test_permission_grant_is_limited_to_requested_turn(self):
        task = self.task('APPROVAL_TEST PERMISSION_TEST')
        self.queue.tick()
        approval = self.await_approval(task)
        with self.queue.lock:
            self.queue.sessions[task['id']].decide(approval['id'], 'accept')
        result = self.await_state(task['id'], {'review'})
        decision = json.loads(Path(result['worktree'], 'decision.json').read_text())
        self.assertEqual({'permissions':{'network':{'enabled':True}},'scope':'turn'}, decision)

    def test_atomic_capacity_and_priority(self):
        low = self.task(priority=-10)
        high = self.task(priority=10)
        self.task()
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            claims = list(pool.map(lambda _: self.queue.claim(), range(8)))
        claimed = [t for t in claims if t]
        self.assertEqual(2, len(claimed))
        self.assertIn(high['id'], [t['id'] for t in claimed])
        self.assertNotIn(low['id'], [t['id'] for t in claimed])

    def test_dependencies_require_merged_commit(self):
        first = self.task()
        second = self.task(dependencies=[first['id']])
        self.queue.tick()
        finished = self.await_state(first['id'], {'review'})
        self.assertIsNone(self.queue.claim())
        with self.assertRaises(RuntimeError):
            self.queue.action(first['id'], 'done')
        self.git('merge', '--ff-only', finished['branch'])
        self.git('push', 'origin', 'main')
        self.queue.action(first['id'], 'done')
        self.assertEqual('done', self.queue.get(first['id'])['state'])
        self.assertIsNone(self.queue.get(first['id'])['attention'])
        self.assertEqual(second['id'], self.queue.claim()['id'])

    def test_failure_and_retry_preserve_worktree(self):
        task = self.task('FAIL_TEST')
        self.queue.tick()
        failed = self.await_state(task['id'], {'blocked'})
        self.assertIn('code 3', failed['error'])
        self.assertTrue(Path(failed['worktree']).is_dir())
        self.queue.update(task['id'], prompt='Now succeed')
        self.queue.action(task['id'], 'retry')
        self.queue.tick()
        result = self.await_state(task['id'], {'review'})
        self.assertEqual(failed['worktree'], result['worktree'])
        self.assertEqual(2, result['attempt'])

    def test_cancel_and_timeout(self):
        task = self.task('SLOW_TEST')
        self.queue.tick()
        deadline = time.monotonic()+5
        while self.queue.jobs.get(task['id']) is None and time.monotonic()<deadline:
            time.sleep(.03)
        self.queue.action(task['id'], 'cancel')
        result = self.await_state(task['id'], {'cancelled'})
        self.assertNotIn(result['branch'], self.git('ls-remote', '--heads', 'origin'))
        self.queue.config['timeout_minutes'] = .01
        other = self.task('SLOW_TEST')
        self.queue.tick()
        self.assertIn('time limit', self.await_state(other['id'], {'blocked'})['error'])

    def test_blocked_report_never_publishes(self):
        task = self.task('BLOCK_TEST')
        self.queue.tick()
        blocked = self.await_state(task['id'], {'blocked'})
        self.assertNotIn(blocked['branch'], self.git('ls-remote', '--heads', 'origin'))
        self.assertEqual('Required fixture input missing', blocked['attention']['reason'])
        self.assertEqual(['Supply fixture input then retry'], blocked['attention']['steps'])
        queued = self.queue.action(task['id'], 'retry')
        self.assertIsNone(queued['result'])
        self.assertIsNone(queued['attention'])

    def test_ready_with_unresolved_blockers_never_publishes(self):
        task = self.task('CONTRADICT_TEST')
        self.queue.tick()
        result = self.await_state(task['id'], {'blocked'})
        self.assertIn('unresolved blockers', result['error'])
        self.assertNotIn(result['branch'], self.git('ls-remote', '--heads', 'origin'))

    def test_pause_and_restart_recovery(self):
        task = self.task()
        self.queue.settings({'paused':True, 'max_workers':3})
        self.assertIsNone(self.queue.claim())
        self.queue.settings({'paused':False})
        self.queue.claim()
        other = Queue(self.repo, self.root / 'runtime')
        self.assertEqual('blocked', other.get(task['id'])['state'])
        self.assertEqual(3, other.config['max_workers'])
        self.assertEqual(self.queue.token, other.token)
        other.db.close()

    def test_workers_overlap_and_dispatch_next(self):
        self.queue.config['timeout_minutes'] = .02
        first = self.task('SLOW_TEST')
        second = self.task('SLOW_TEST')
        third = self.task()
        self.queue.tick()
        self.assertEqual('running', self.queue.get(first['id'])['state'])
        self.assertEqual('running', self.queue.get(second['id'])['state'])
        self.assertEqual('queued', self.queue.get(third['id'])['state'])
        self.await_state(first['id'], {'blocked'})
        self.await_state(second['id'], {'blocked'})
        self.queue.config['timeout_minutes'] = 1
        self.queue.tick()
        self.await_state(third['id'], {'review'})

    def test_push_failure_retains_commit(self):
        hook = self.root / 'remote.git/hooks/pre-receive'
        hook.write_text('#!/bin/sh\nexit 1\n')
        hook.chmod(0o755)
        task = self.task()
        self.queue.tick()
        result = self.await_state(task['id'], {'blocked'})
        self.assertIn('rejected', result['error'])
        self.assertTrue(Path(result['worktree'], 'change.txt').exists())
        self.assertNotEqual(result['base_commit'], self.git('rev-parse', result['branch']))

    def test_setup_failure_blocks_codex(self):
        self.queue.config['setup_commands'] = [[sys.executable, '-c', 'raise SystemExit(8)']]
        task = self.task()
        self.queue.tick()
        result = self.await_state(task['id'], {'blocked'})
        self.assertIn('code 8', result['error'])
        self.assertFalse(Path(result['worktree'], 'change.txt').exists())

    def test_sandbox_failure_pauses_before_setup_or_model(self):
        (self.root / 'fail-sandbox').touch()
        self.queue.config['setup_commands'] = [[sys.executable, '-c', "open('setup-ran', 'w').close()"]]
        task = self.task()
        self.queue.tick()
        result = self.await_state(task['id'], {'blocked'})
        self.assertTrue(self.queue.config['paused'])
        self.assertIn('sandbox preflight failed', result['error'])
        self.assertIn('Failed RTM_NEWADDR', self.queue.log(result))
        self.assertNotIn('thread.started', self.queue.log(result))
        self.assertFalse(Path(result['worktree'], 'setup-ran').exists())
        self.assertFalse(Path(result['worktree'], 'change.txt').exists())

    def test_validation(self):
        for bad in [{'title':''}, {'prompt':''}, {'priority':True}, {'dependencies':'wrong'}]:
            with self.assertRaises(ValueError):
                self.queue.create({'title':'Valid', 'prompt':'Valid', **bad})
        with self.assertRaises(KeyError):
            self.task(dependencies=['missing'])
        with self.assertRaises(ValueError):
            self.queue.settings({'max_workers':0})
        with self.assertRaises(ValueError):
            self.queue.settings({'codex':'arbitrary command'})

    def test_api_auth_origin_and_lifecycle(self):
        self.queue.settings({'paused':True})
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.http.queue = self.queue
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        def req(path, method='GET', data=None, headers=None):
            conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
            conn.request(method, path, json.dumps(data) if data is not None else None,
                         {'Content-Type':'application/json', **(headers or {})})
            res=conn.getresponse()
            body=res.read()
            code=res.status
            cookie=res.getheader('Set-Cookie')
            conn.close()
            return code, body, cookie
        self.assertEqual(200, req('/healthz')[0])
        self.assertEqual(401, req('/api/tasks')[0])
        self.assertEqual(401, req('/api/login', 'POST', {'token':'wrong'})[0])
        auth={'Authorization':'Bearer '+self.queue.token}
        self.assertEqual(403, req('/api/tasks',headers={**auth,'Origin':'https://evil.invalid'})[0])
        self.assertEqual(403, req('/api/tasks',headers={**auth,'Host':'evil.invalid'})[0])
        code,body,cookie=req('/api/login','POST',{'token':self.queue.token})
        self.assertEqual(200,code)
        self.assertIn('HttpOnly',cookie)
        self.assertEqual(200, req('/api/tasks',headers={'Cookie':cookie.split(';')[0]})[0])
        code,body,_=req('/api/tasks','POST',{'title':'API task','prompt':'Add something'},auth)
        self.assertEqual(201,code)
        task=json.loads(body)
        self.assertEqual(200,req('/api/tasks/'+task['id']+'/cancel','POST',{},auth)[0])
        self.assertEqual('3.1.0', json.loads(req('/api/openapi.json',headers=auth)[1])['openapi'])
        pending = self.task('APPROVAL_TEST')
        self.queue.settings({'paused':False})
        self.queue.tick()
        approval = self.await_approval(pending)
        route = '/api/tasks/' + pending['id'] + '/approval'
        answer = {'id':approval['id'], 'decision':'accept'}
        self.assertEqual(401, req(route, 'POST', answer)[0])
        self.assertEqual(403, req(route, 'POST', answer, {**auth,'Origin':'https://evil.invalid'})[0])
        self.assertEqual(400, req('/api/tasks/'+task['id']+'/approval', 'POST', answer, auth)[0])
        self.assertEqual(400, req(route, 'POST', {**answer,'decision':'acceptForSession'}, auth)[0])
        self.assertEqual(200, req(route, 'POST', answer, auth)[0])
        self.assertEqual(400, req(route, 'POST', answer, auth)[0])
        self.await_state(pending['id'], {'review'})

        self.assertEqual(400,req('/api/settings','PATCH',{'max_workers':99},auth)[0])
        self.assertEqual(404,req('/.runtime/token',headers=auth)[0])
        self.assertEqual(404,req('/../../etc/passwd',headers=auth)[0])
        for path in ['/','/app.js','/style.css']:
            self.assertEqual(200,req(path)[0])


if __name__ == '__main__':
    unittest.main()
