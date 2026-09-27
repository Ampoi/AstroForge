#!/usr/bin/env python3
"""Local administration; credentials never appear in process arguments."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import urllib.parse

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime'
UNIT = 'astroforge-dev-dashboard'


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def config():
    return json.loads((RUNTIME / 'config.json').read_text())


def request(path, method='GET', body=None):
    cfg = config()
    url = f"http://{cfg['host']}:{cfg['port']}"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    headers = {'Authorization': 'Bearer ' + (RUNTIME / 'token').read_text().strip(),
               'Host': urllib.parse.urlsplit(cfg['public_url']).netloc, 'Content-Type': 'application/json'}
    req = urllib.request.Request(url + '/api/' + path.lstrip('/'), headers=headers,
                                 method=method, data=json.dumps(body).encode() if body is not None else None)
    with opener.open(req, timeout=130) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    init = sub.add_parser('init')
    init.add_argument('--tailscale', action='store_true')
    for name in ('start', 'stop', 'status', 'token', 'cleanup'):
        sub.add_parser(name)
    api = sub.add_parser('api')
    api.add_argument('path')
    api.add_argument('--method', default='GET', choices=['GET', 'POST', 'PATCH'])
    api.add_argument('--data', help='JSON object, or @filename')
    args = parser.parse_args()
    if args.action == 'init':
        RUNTIME.mkdir(exist_ok=True, mode=0o700)
        if (RUNTIME / 'config.json').exists():
            raise SystemExit('Already initialized; edit .runtime/config.json while stopped.')
        cfg = json.loads((ROOT / 'config.example.json').read_text())
        local_codex = RUNTIME / 'codex-cli/node_modules/.bin/codex'
        cfg['codex'] = str(local_codex) if local_codex.exists() else (shutil.which('codex') or 'codex')
        if (ROOT.parent / 'package-lock.json').exists():
            cfg['setup_commands'] = [['npm', 'ci', '--ignore-scripts']]
        if args.tailscale:
            status = json.loads(subprocess.check_output(['tailscale', 'status', '--json'], text=True))
            if status['BackendState'] != 'Running':
                raise SystemExit('Tailscale must be running')
            cfg['host'] = next(ip for ip in status['TailscaleIPs'] if ':' not in ip)
            hostname = status['Self']['DNSName'].rstrip('.')
            cfg['public_url'] = f"http://{hostname}:{cfg['port']}"
        (RUNTIME / 'config.json').write_text(json.dumps(cfg, indent=2) + '\n')
        print(cfg['public_url'])
    elif args.action == 'start':
        cfg = config()
        run('systemd-run', '--user', '--unit=' + UNIT, '--collect',
            '--property=KillMode=control-group', '--property=TimeoutStopSec=150',
            '--property=Restart=on-failure', '--property=RestartSec=5',
            '--property=WorkingDirectory=' + str(ROOT),
            '--property=ConditionPathExists=' + str(ROOT / 'server.py'),
            '--setenv=PATH=' + os.environ['PATH'], sys.executable, str(ROOT / 'server.py'))
        print(cfg['public_url'])
    elif args.action == 'stop':
        run('systemctl', '--user', 'stop', UNIT)
    elif args.action == 'status':
        run('systemctl', '--user', 'status', UNIT, '--no-pager')
    elif args.action == 'token':
        print((RUNTIME / 'token').read_text().strip())
    elif args.action == 'api':
        raw = args.data
        if raw and raw.startswith('@'):
            raw = Path(raw[1:]).read_text()
        print(json.dumps(request(args.path, args.method, json.loads(raw) if raw else None), ensure_ascii=False, indent=2))
    elif args.action == 'cleanup':
        # Never force removal of dirty worktrees or delete task branches.
        subprocess.run(['systemctl', '--user', 'stop', UNIT], check=False)
        trees = RUNTIME / 'worktrees'
        if trees.exists():
            for path in trees.iterdir():
                run('git', '-C', str(ROOT.parent), 'worktree', 'remove', str(path))
        print('Stopped; clean managed worktrees removed. Branches and data retained. You may now delete dev-dashboard/.')


if __name__ == '__main__':
    main()
