"""Opt-in real Codex test; only modifies a disposable repository and local remote."""
import argparse
import json
import shutil
from pathlib import Path
import time
from test_dashboard import DashboardTests

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--codex', default=shutil.which('codex'))
parser.add_argument('--approval-check', action='store_true', help='Also exercise a real sandbox escalation for a loopback socket')
args = parser.parse_args()
fixture = DashboardTests()
fixture.setUp()
try:
    fixture.queue.config.update(codex=args.codex, timeout_minutes=4)
    task = fixture.queue.create({
        'title': 'Isolated real Codex smoke test',
        'prompt': 'Create arithmetic.py containing add(a, b). Add test_arithmetic.py using unittest with positive and negative numbers. Run python3 -m unittest -v. Do not install dependencies. This is a temporary test repository. Leave commits and push to the queue. Return ready only after the test passes.'})
    if args.approval_check:
        fixture.queue.update(task['id'], prompt=task['prompt'] + " Also create and run socket_smoke.py that opens a real socket.socket(), binds to ('127.0.0.1', 0), prints 'loopback smoke passed', then closes it. First try normally; if the sandbox blocks it, request require_escalated permission for that command using Codex tools. Do not substitute a fake socket. Report its actual result.")
    fixture.queue.tick()
    deadline = time.monotonic() + 270
    while time.monotonic() < deadline:
        result = fixture.queue.get(task['id'])
        if result['state'] not in {'queued', 'running'} and task['id'] not in fixture.queue.jobs:
            print(json.dumps(result, indent=2))
            if result['state'] != 'review':
                print(fixture.queue.log(result)[-12000:])
                raise SystemExit(1)
            if args.approval_check:
                log = (fixture.queue.runtime / 'logs' / f"{result['id']}-{result['attempt']}.jsonl").read_text()
                assert 'item/autoApprovalReview/completed' in log, 'Expected a real auto-review event'
                assert 'loopback smoke passed' in log, 'Expected real loopback check'
            assert result['branch'] in fixture.git('ls-remote', '--heads', 'origin')
            print('PASS: real Codex → worktree → tests → commit → local push → review')
            break
        time.sleep(1)
    else:
        raise SystemExit('Smoke test timed out')
finally:
    fixture.tearDown()
