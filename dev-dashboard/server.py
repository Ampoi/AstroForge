#!/usr/bin/env python3
"""Independent, dependency-free worktree queue. Python 3.12+, Linux."""
import argparse
import fcntl
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import signal
import sqlite3
import subprocess
import threading
import time
import uuid
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DEFAULTS = json.loads((ROOT / 'config.example.json').read_text())
STATES = {'queued', 'running', 'review', 'done', 'blocked', 'cancelled'}


def command(args, cwd, timeout=120):
    result = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout,
                            env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'})
    if result.returncode:
        raise RuntimeError(result.stdout[-6000:] or f'Command failed: {args[0]}')
    return result.stdout.strip()


class Queue:
    def __init__(self, repo, runtime, config=None, recover=True):
        self.repo, self.runtime = Path(repo).resolve(), Path(runtime).resolve()
        self.runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.config_path = self.runtime / 'config.json'
        self.config = {**DEFAULTS, **(json.loads(self.config_path.read_text()) if self.config_path.exists() else {}), **(config or {})}
        self.lock = threading.RLock()
        self.git_lock = threading.Lock()
        self.stopping = threading.Event()
        self.jobs = {}
        self.threads = []
        self.db = sqlite3.connect(self.runtime / 'queue.sqlite', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('''CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt TEXT NOT NULL,
            state TEXT NOT NULL, priority INTEGER NOT NULL, dependencies TEXT NOT NULL,
            created REAL NOT NULL, updated REAL NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
            branch TEXT, worktree TEXT, base_commit TEXT, error TEXT, result TEXT)''')
        if recover:
            self.db.execute("UPDATE tasks SET state='blocked', error='Service restarted; inspect retained worktree before retry.', updated=? WHERE state='running'", (time.time(),))
        self.db.commit()
        token_file = self.runtime / 'token'
        if not token_file.exists():
            token_file.write_text(secrets.token_urlsafe(32) + '\n')
        token_file.chmod(0o600)
        self.token = token_file.read_text().strip()

    def git(self, *args, cwd=None):
        return command(['git', *args], cwd or self.repo)

    def rows(self):
        with self.lock:
            return [self.decode(r) for r in self.db.execute('SELECT * FROM tasks ORDER BY priority DESC, created')]

    @staticmethod
    def decode(row):
        value = dict(row)
        for key in ('dependencies', 'result'):
            value[key] = json.loads(value[key]) if value[key] else ([] if key == 'dependencies' else None)
        return value

    def get(self, task_id):
        with self.lock:
            row = self.db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
            if row is None:
                raise KeyError('Task not found')
            return self.decode(row)

    def update(self, task_id, **fields):
        with self.lock:
            fields['updated'] = time.time()
            self.db.execute('UPDATE tasks SET ' + ','.join(f'{k}=?' for k in fields) + ' WHERE id=?', [*fields.values(), task_id])
            self.db.commit()

    def create(self, data):
        title, prompt = data.get('title'), data.get('prompt')
        if not isinstance(title, str) or not title.strip() or len(title) > 200:
            raise ValueError('title must contain 1–200 characters')
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 30000:
            raise ValueError('prompt must contain 1–30000 characters')
        priority = data.get('priority', 0)
        dependencies = data.get('dependencies', [])
        if type(priority) is not int or not -100 <= priority <= 100:
            raise ValueError('priority must be an integer between -100 and 100')
        if not isinstance(dependencies, list) or not all(isinstance(x, str) for x in dependencies):
            raise ValueError('dependencies must be an array of task IDs')
        with self.lock:
            for dep in dependencies:
                self.get(dep)
            task_id = uuid.uuid4().hex[:12]
            now = time.time()
            self.db.execute('INSERT INTO tasks (id,title,prompt,state,priority,dependencies,created,updated) VALUES (?,?,?,?,?,?,?,?)',
                            (task_id, title.strip(), prompt.strip(), 'queued', priority, json.dumps(dependencies), now, now))
            self.db.commit()
            return self.get(task_id)

    def settings(self, data):
        if set(data) - {'paused', 'max_workers'}:
            raise ValueError('Only paused and max_workers can be changed via API')
        if 'paused' in data and type(data['paused']) is not bool:
            raise ValueError('paused must be boolean')
        if 'max_workers' in data and (type(data['max_workers']) is not int or not 1 <= data['max_workers'] <= 16):
            raise ValueError('max_workers must be 1–16')
        with self.lock:
            self.config.update(data)
            temporary = self.config_path.with_suffix('.tmp')
            temporary.write_text(json.dumps(self.config, indent=2) + '\n')
            temporary.replace(self.config_path)
            return self.public_settings()

    def public_settings(self):
        return {k: self.config[k] for k in ('paused', 'max_workers', 'base_branch', 'push', 'timeout_minutes')}

    def action(self, task_id, action):
        with self.lock:
            task = self.get(task_id)
            if action == 'cancel' and task['state'] in {'queued', 'running', 'blocked'}:
                self.update(task_id, state='cancelled')
                proc = self.jobs.get(task_id)
                if proc:
                    self.terminate(proc)
            elif action == 'retry' and task['state'] in {'blocked', 'cancelled'}:
                if task_id in self.jobs:
                    raise ValueError('Worker is still stopping; retry shortly')
                self.update(task_id, state='queued', error=None)
            elif action == 'done' and task['state'] == 'review':
                # Dependencies must include the actual merged work, not just a checked box.
                with self.git_lock:
                    self.git('fetch', self.config['remote'], self.config['base_branch'])
                    tip = self.git('rev-parse', task['branch'])
                    try:
                        self.git('merge-base', '--is-ancestor', tip, self.base_ref())
                    except RuntimeError as exc:
                        raise RuntimeError('Branch tip is not in remote main yet; merge normally, push main, then retry.') from exc
                self.update(task_id, state='done', error=None)
            else:
                raise ValueError('Invalid action for current state')
            return self.get(task_id)

    def base_ref(self):
        return f"{self.config['remote']}/{self.config['base_branch']}"

    def claim(self):
        with self.lock:
            if self.stopping.is_set() or self.config['paused']:
                return None
            tasks = self.rows()
            if len(self.jobs) >= self.config['max_workers']:
                return None
            done = {t['id'] for t in tasks if t['state'] == 'done'}
            for task in tasks:
                if task['state'] == 'queued' and task['id'] not in self.jobs and set(task['dependencies']) <= done:
                    self.jobs[task['id']] = None
                    self.update(task['id'], state='running', attempt=task['attempt'] + 1, error=None)
                    return self.get(task['id'])
        return None

    def prepare(self, task):
        with self.git_lock:
            if task['worktree']:
                path = Path(task['worktree'])
                if not path.is_dir():
                    raise RuntimeError('Retained worktree is missing; create a new task')
                if self.git('branch', '--show-current', cwd=path) != task['branch']:
                    raise RuntimeError('Worktree branch changed; inspect before retry')
                return path
            self.git('fetch', self.config['remote'], self.config['base_branch'])
            branch = 'codex/task-' + task['id']
            path = self.runtime / 'worktrees' / task['id']
            path.parent.mkdir(exist_ok=True)
            base = self.git('rev-parse', self.base_ref())
            self.git('worktree', 'add', '-b', branch, str(path), base)
        self.update(task['id'], branch=branch, worktree=str(path), base_commit=base)
        return path

    @staticmethod
    def terminate(proc):
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        # Reaping/escalation is handled by the worker without holding the queue lock.

    def worker(self, task):
        task_id = task['id']
        proc = None
        try:
            worktree = self.prepare(task)
            log_dir = self.runtime / 'logs'
            log_dir.mkdir(exist_ok=True)
            prefix = log_dir / f"{task_id}-{task['attempt']}"
            result_file = prefix.with_suffix('.result.json')
            prompt = f'''Work only in this dedicated worktree. Read and follow AGENTS.md.
Implement the user's task, run appropriate checks, and report their exact results.
Do not modify other worktrees or the dashboard runtime. Do not merge into main.
The queue service handles commit and push after successful checks: leave changes uncommitted.
If checks cannot run or fail, set status to blocked, never ready. Do not claim unverified success.
For ROS2/demo changes the repository's SpaceROS verification requirements apply.
This is noninteractive: report missing information/permissions as blocked.
Do not use other Codex tasks, agents, or external messaging services.
Task: {task['title']}

{task['prompt']}
'''
            args = [self.config['codex'], 'exec', '--sandbox', 'workspace-write',
                    '-c', 'approval_policy="never"', '--json', '--color', 'never',
                    '-C', str(worktree), '--output-schema', str(ROOT / 'result.schema.json'),
                    '-o', str(result_file), '-']
            deadline = time.monotonic() + self.config['timeout_minutes'] * 60
            commands = [(setup, '') for setup in self.config['setup_commands']] + [(args, prompt)]
            with prefix.with_suffix('.jsonl').open('w') as log:
                for argv, input_text in commands:
                    log.write(json.dumps({'type': 'dashboard.command', 'command': argv[0]}) + '\n')
                    log.flush()
                    with self.lock:
                        if self.get(task_id)['state'] != 'running' or self.stopping.is_set():
                            return
                        proc = subprocess.Popen(argv, cwd=worktree, stdin=subprocess.PIPE, stdout=log,
                                                stderr=subprocess.STDOUT, text=True, start_new_session=True)
                        self.jobs[task_id] = proc
                    proc.stdin.write(input_text)
                    proc.stdin.close()
                    while proc.poll() is None:
                        if self.stopping.is_set() or self.get(task_id)['state'] != 'running' or time.monotonic() >= deadline:
                            self.terminate(proc)
                            try:
                                proc.wait(timeout=5)
                            except subprocess.TimeoutExpired:
                                os.killpg(proc.pid, signal.SIGKILL)
                                proc.wait()
                            raise RuntimeError('Worker stopped or exceeded time limit; worktree retained')
                        time.sleep(0.25)
                    if proc.returncode:
                        raise RuntimeError(f'{Path(argv[0]).name} exited with code {proc.returncode}; inspect task log')
            result = json.loads(result_file.read_text())
            self.update(task_id, result=json.dumps(result))
            if result.get('status') != 'ready' or not result.get('checks'):
                raise RuntimeError(result.get('summary') or 'Worker did not provide successful check evidence')
            with self.lock:
                if self.get(task_id)['state'] != 'running' or self.stopping.is_set():
                    return
                # Publication is serialized with cancellation: a cancelled task cannot later publish.
                with self.git_lock:
                    current = self.get(task_id)
                    if self.git('branch', '--show-current', cwd=worktree) != current['branch']:
                        raise RuntimeError('Worker changed branches; publication stopped')
                    self.git('add', '--all', cwd=worktree)
                    if self.git('diff', '--cached', '--name-only', cwd=worktree):
                        self.git('commit', '-m', task['title'], cwd=worktree)
                    if self.config['push']:
                        self.git('push', '--set-upstream', self.config['remote'], current['branch'], cwd=worktree)
                self.update(task_id, state='review', error=None)
        except Exception as exc:
            with self.lock:
                if self.get(task_id)['state'] == 'running':
                    self.update(task_id, state='blocked', error=str(exc)[:6000])
        finally:
            if proc and proc.poll() is None:
                self.terminate(proc)
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
            with self.lock:
                self.jobs.pop(task_id, None)

    def tick(self):
        while task := self.claim():
            thread = threading.Thread(target=self.worker, args=(task,), daemon=True)
            self.threads.append(thread)
            thread.start()
        self.threads = [t for t in self.threads if t.is_alive()]

    def stop(self):
        self.stopping.set()
        with self.lock:
            for proc in self.jobs.values():
                if proc:
                    self.terminate(proc)
        for thread in self.threads:
            thread.join(timeout=130)

    def worktrees(self):
        result = []
        for record in self.git('worktree', 'list', '--porcelain').split('\n\n'):
            item = {}
            for line in record.splitlines():
                key, _, value = line.partition(' ')
                item[key] = value
            if item:
                result.append(item)
        return result

    def log(self, task):
        path = self.runtime / 'logs' / f"{task['id']}-{task['attempt']}.jsonl"
        if not path.exists():
            return ''
        with path.open('rb') as stream:
            stream.seek(max(0, path.stat().st_size - 64000))
            return stream.read().decode('utf-8', errors='replace')


class Handler(BaseHTTPRequestHandler):
    server_version = 'DevDashboard/1'

    def log_message(self, fmt, *args):
        # Never log headers, tokens, request bodies, or URL query strings.
        pass

    @property
    def queue(self):
        return self.server.queue

    def reply(self, status, value, content_type='application/json; charset=utf-8', cookie=None):
        payload = json.dumps(value, ensure_ascii=False).encode() if content_type.startswith('application/json') else value
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(payload)

    def authorized(self):
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            return hmac.compare_digest(auth[7:].encode(), self.queue.token.encode())
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get('Cookie', ''))
            token = cookies['dev_session'].value if 'dev_session' in cookies else ''
            return hmac.compare_digest(token.encode(), self.queue.token.encode())
        except Exception:
            return False

    def body(self):
        size = int(self.headers.get('Content-Length', '0'))
        if not 0 < size <= 65536:
            raise ValueError('JSON body must be 1–65536 bytes')
        if self.headers.get_content_type() != 'application/json':
            raise ValueError('Content-Type must be application/json')
        data = json.loads(self.rfile.read(size))
        if not isinstance(data, dict):
            raise ValueError('JSON body must be an object')
        return data

    def dispatch(self, method):
        try:
            # Reject DNS rebinding and cross-origin browser mutations, including login CSRF.
            public = urlsplit(self.queue.config['public_url'])
            allowed_hosts = {public.netloc, f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if self.headers.get('Host') not in allowed_hosts:
                return self.reply(403, {'error': 'Host not allowed'})
            origin = self.headers.get('Origin')
            if origin and origin not in {self.queue.config['public_url'], f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}'}:
                return self.reply(403, {'error': 'Origin not allowed'})
            path = urlsplit(self.path).path
            if method == 'GET' and path == '/healthz':
                return self.reply(200, {'ok': True})
            if method == 'GET' and path in {'/', '/app.js', '/style.css'}:
                filename, mime = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'), '/style.css': ('style.css', 'text/css')}[path]
                return self.reply(200, (ROOT / 'static' / filename).read_bytes(), mime + '; charset=utf-8')
            if method == 'POST' and path == '/api/login':
                token = self.body().get('token', '')
                if not isinstance(token, str) or not hmac.compare_digest(token.encode(), self.queue.token.encode()):
                    return self.reply(401, {'error': 'Invalid token'})
                secure = '; Secure' if public.scheme == 'https' else ''
                return self.reply(200, {'ok': True}, cookie=f'dev_session={self.queue.token}; Path=/; HttpOnly; SameSite=Strict{secure}')
            if not self.authorized():
                return self.reply(401, {'error': 'Authentication required'})
            if method == 'POST' and path == '/api/logout':
                return self.reply(200, {'ok': True}, cookie='dev_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
            if method == 'GET' and path == '/api/openapi.json':
                return self.reply(200, json.loads((ROOT / 'openapi.json').read_text()))
            if path == '/api/tasks':
                if method == 'GET':
                    return self.reply(200, {'tasks': self.queue.rows()})
                if method == 'POST':
                    return self.reply(201, self.queue.create(self.body()))
            if path == '/api/settings':
                if method == 'GET':
                    return self.reply(200, self.queue.public_settings())
                if method == 'PATCH':
                    return self.reply(200, self.queue.settings(self.body()))
            if path == '/api/worktrees' and method == 'GET':
                return self.reply(200, {'worktrees': self.queue.worktrees()})
            match = re.fullmatch(r'/api/tasks/([a-f0-9]{12})(?:/(log|cancel|retry|done))?', path)
            if match:
                task_id, action = match.groups()
                task = self.queue.get(task_id)
                if method == 'GET' and not action:
                    return self.reply(200, task)
                if method == 'GET' and action == 'log':
                    return self.reply(200, {'log': self.queue.log(task)})
                if method == 'POST' and action in {'cancel', 'retry', 'done'}:
                    self.body()
                    return self.reply(200, self.queue.action(task_id, action))
            return self.reply(404, {'error': 'Not found'})
        except KeyError as exc:
            self.reply(404, {'error': str(exc)})
        except (ValueError, TypeError) as exc:
            self.reply(400, {'error': str(exc)})
        except (RuntimeError, subprocess.SubprocessError) as exc:
            self.reply(409, {'error': str(exc)})
        except Exception:
            self.reply(500, {'error': 'Internal error; check service logs'})
            import traceback
            traceback.print_exc()

    def do_GET(self):
        self.dispatch('GET')

    def do_POST(self):
        self.dispatch('POST')

    def do_PATCH(self):
        self.dispatch('PATCH')

    def setup(self):
        super().setup()
        self.connection.settimeout(15)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, default=ROOT.parent)
    parser.add_argument('--runtime', type=Path, default=ROOT / '.runtime')
    args = parser.parse_args()
    args.runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    singleton = (args.runtime / 'server.lock').open('w')
    try:
        fcntl.flock(singleton, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit('Dashboard is already running for this runtime')
    queue = Queue(args.repo, args.runtime)
    host = queue.config['host']
    address = ipaddress.ip_address(host)
    if not (address.is_loopback or address in ipaddress.ip_network('100.64.0.0/10')):
        raise SystemExit('Bind only to loopback or a Tailscale IPv4 address')
    server = ThreadingHTTPServer((host, queue.config['port']), Handler)
    server.queue = queue
    server.timeout = 0.5
    def stop(*_):
        queue.stopping.set()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print(f"Dashboard listening on {queue.config['public_url']}", flush=True)
    try:
        while not queue.stopping.is_set() and ROOT.exists():
            server.handle_request()
            queue.tick()
    finally:
        queue.stop()
        server.server_close()
        queue.db.close()


if __name__ == '__main__':
    main()
