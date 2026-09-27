"""Opt-in real Codex test; only modifies a disposable repository and local remote."""
import argparse
import json
import shutil
import time
from test_dashboard import DashboardTests

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--codex', default=shutil.which('codex'))
args = parser.parse_args()
fixture = DashboardTests()
fixture.setUp()
try:
    fixture.queue.config.update(codex=args.codex, timeout_minutes=4)
    task = fixture.queue.create({
        'title': 'Isolated real Codex smoke test',
        'prompt': 'Create arithmetic.py containing add(a, b). Add test_arithmetic.py using unittest with positive and negative numbers. Run python3 -m unittest -v. Do not install dependencies. This is a temporary test repository. Leave commits and push to the queue. Return ready only after the test passes.'})
    fixture.queue.tick()
    deadline = time.monotonic() + 270
    while time.monotonic() < deadline:
        result = fixture.queue.get(task['id'])
        if result['state'] not in {'queued', 'running'} and task['id'] not in fixture.queue.jobs:
            print(json.dumps(result, indent=2))
            if result['state'] != 'review':
                print(fixture.queue.log(result)[-12000:])
                raise SystemExit(1)
            assert result['branch'] in fixture.git('ls-remote', '--heads', 'origin')
            print('PASS: real Codex → worktree → tests → commit → local push → review')
            break
        time.sleep(1)
    else:
        raise SystemExit('Smoke test timed out')
finally:
    fixture.tearDown()
