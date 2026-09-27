"""Small stdio app-server client; approvals stay scoped to a live task attempt."""
import json
import queue
import subprocess
import threading
import time
import uuid

APPROVALS = {'item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
             'item/permissions/requestApproval'}


class CodexSession:
    def __init__(self, owner, task, worktree, log, deadline):
        self.owner, self.task, self.worktree = owner, task, worktree
        self.log, self.deadline = log, deadline
        self.proc = None
        self.pending = {}
        self.items = {}
        self.messages = queue.Queue()
        self.sequence = 0
        self.thread_id = None
        self.final = None

    def send(self, message):
        self.proc.stdin.write(json.dumps(message) + '\n')
        self.proc.stdin.flush()

    def request(self, method, params):
        self.sequence += 1
        self.send({'id': 'client-' + str(self.sequence), 'method': method, 'params': params})
        return 'client-' + str(self.sequence)

    def reader(self):
        try:
            for line in self.proc.stdout:
                self.messages.put(json.loads(line))
        except Exception as exc:
            self.messages.put({'reader_error': str(exc)})
        finally:
            self.messages.put(None)

    def check(self):
        if (self.owner.stopping.is_set() or self.owner.get(self.task['id'])['state'] != 'running'
                or time.monotonic() >= self.deadline):
            raise RuntimeError('Worker stopped or exceeded time limit; worktree retained')

    def receive(self):
        while True:
            self.check()
            try:
                message = self.messages.get(timeout=.2)
            except queue.Empty:
                continue
            if message is None:
                code = self.proc.wait(timeout=5)
                raise RuntimeError(f'Codex app-server exited with code {code} before completion; inspect task log')
            if 'reader_error' in message:
                raise RuntimeError('Invalid app-server output: ' + message['reader_error'])
            self.log.write(json.dumps(message, ensure_ascii=False) + '\n')
            self.log.flush()
            return message

    def wait_response(self, request_id):
        while True:
            message = self.receive()
            if message.get('id') == request_id and 'method' not in message:
                if 'error' in message:
                    raise RuntimeError('Codex app-server: ' + json.dumps(message['error']))
                return message['result']
            self.event(message)

    def event(self, message):
        method, params = message.get('method'), message.get('params', {})
        if 'id' in message and method:
            if method in APPROVALS:
                if params.get('threadId') != self.thread_id:
                    raise RuntimeError('Approval belongs to an unexpected thread')
                item = self.items.get(params.get('itemId'), {})
                approval = {'id': uuid.uuid4().hex, 'method': method, 'request_id': message['id'],
                            'params': params, 'item': item}
                with self.owner.lock:
                    self.check()
                    self.pending[approval['id']] = approval
            else:
                # Never silently approve unsupported requests (MCP forms, credentials, tools).
                self.send({'id': message['id'], 'error': {'code': -32601,
                           'message': 'Dashboard cannot answer this request. Report the required user input.'}})
            return
        if method == 'serverRequest/resolved':
            with self.owner.lock:
                for key, value in list(self.pending.items()):
                    if value['request_id'] == params.get('requestId'):
                        self.pending.pop(key)
        if method in {'item/started', 'item/completed'}:
            item = params.get('item', {})
            self.items[item.get('id')] = item
            if method == 'item/completed' and item.get('type') == 'agentMessage':
                self.final = item.get('text')

    def approvals(self):
        return [{k: v for k, v in value.items() if k != 'request_id'} for value in self.pending.values()]

    def decide(self, approval_id, decision):
        # Called under the queue lock; stale/double/cross-task approvals cannot execute.
        self.check()
        if decision not in {'accept', 'decline'}:
            raise ValueError('decision must be accept or decline')
        approval = self.pending.get(approval_id)
        if not approval:
            raise ValueError('Approval has expired or was already answered')
        params = approval['params']
        available = params.get('availableDecisions')
        if available and decision not in available:
            raise ValueError('This decision is not available for this request')
        if approval['method'] == 'item/permissions/requestApproval':
            result = {'permissions': params['permissions'] if decision == 'accept' else {}, 'scope': 'turn'}
        else:
            result = {'decision': decision}
        self.send({'id': approval['request_id'], 'result': result})
        self.pending.pop(approval_id)
        self.log.write(json.dumps({'type': 'dashboard.approval', 'id': approval_id,
                                   'decision': decision, 'attempt': self.task['attempt']}) + '\n')
        self.log.flush()

    def run(self, prompt, schema):
        try:
            with self.owner.lock:
                self.check()
                self.proc = subprocess.Popen([self.owner.config['codex'], 'app-server'], cwd=self.worktree,
                                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log,
                                             text=True, start_new_session=True)
                self.owner.jobs[self.task['id']] = self.proc
                self.owner.sessions[self.task['id']] = self
            threading.Thread(target=self.reader, daemon=True).start()
            self.wait_response(self.request('initialize', {'clientInfo': {'name': 'astroforge_dashboard', 'version': '1.0'},
                                                           'capabilities': {'experimentalApi': True}}))
            self.send({'method': 'initialized', 'params': {}})
            thread = self.wait_response(self.request('thread/start', {
                'cwd': str(self.worktree), 'sandbox': 'workspace-write', 'approvalPolicy': 'on-request',
                'approvalsReviewer': self.task.get('approval_reviewer') or 'auto_review'}))
            if (thread.get('sandbox', {}).get('type') != 'workspaceWrite'
                    or thread.get('approvalPolicy') != 'on-request'
                    or thread.get('approvalsReviewer') != (self.task.get('approval_reviewer') or 'auto_review')):
                raise RuntimeError('Codex did not apply the requested sandbox/approval settings; stopped before execution')
            self.thread_id = thread['thread']['id']
            self.wait_response(self.request('turn/start', {'threadId': self.thread_id,
                'input': [{'type': 'text', 'text': prompt}], 'outputSchema': schema}))
            while True:
                message = self.receive()
                self.event(message)
                if message.get('method') == 'turn/completed':
                    turn = message['params']['turn']
                    if turn['status'] != 'completed':
                        raise RuntimeError('Codex turn did not complete: ' + json.dumps(turn.get('error') or turn['status']))
                    if not self.final:
                        raise RuntimeError('Codex returned no final result')
                    return json.loads(self.final)
        finally:
            with self.owner.lock:
                self.pending.clear()
                self.owner.sessions.pop(self.task['id'], None)
            if self.proc:
                self.owner.terminate(self.proc)
                try:
                    self.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    import os, signal
                    os.killpg(self.proc.pid, signal.SIGKILL)
                    self.proc.wait()
                self.proc.stdin.close()
                self.proc.stdout.close()
