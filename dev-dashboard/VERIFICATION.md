## 2026-09-27: approval workflow

- Codex CLI 0.157.1 generated schema verified for `thread/start`, `turn/start`, command/file/permission approval requests and decisions.
- `python3 -m unittest discover -s dev-dashboard/tests -v`: 24 tests passed. Includes accept/decline, retry with user reviewer, turn-scoped requested permissions, cancellation while awaiting approval, stale/duplicate/cross-task requests, and authenticated HTTP + Origin enforcement.
- `node --check dev-dashboard/static/app.js`, Python compilation, and `git diff --check`: passed.
- Real CLI from a systemd user service: `systemd-run --user --wait --pipe --collect --unit=astroforge-approval-smoke --setenv=PATH="$PATH" python3 /home/ampoi/Documents/astroforge/dev-dashboard/tests/smoke_codex.py --codex /home/ampoi/Documents/astroforge/dev-dashboard/.runtime/codex-cli/node_modules/.bin/codex --approval-check`: passed. Effective workspaceWrite/on-request/auto_review verified before starting the turn; arithmetic tests passed; real loopback socket was denied normally, then succeeded after Codex automatic review. Auto-review completion notification and socket success verified in the full log; changes committed/pushed only to disposable local bare remote. Total 62 seconds.
- First approval smoke run completed successfully but the test assertion used the wrong notification name (`guardianApprovalReview`); fixed to generated schema's `item/autoApprovalReview/completed` and reran successfully.
- Browser verification against disposable fixture: approval-waiting card → reason/command/cwd display → click “承認して続ける” → development-complete state. Real production tasks were not used as test fixtures.
- Scope limited to dev-dashboard; no application or ROS2 demo changes. Existing task data/worktrees retained; schema migration adds only per-task reviewer preference. Unsupported interactive requests fail closed; no full-access mode or persistent approval rules.

# Verification — 2026-09-27

## Completion and attention presentation

- Separated `review` (development/checks complete, awaiting review), `done` (merge verified), `blocked` and `cancelled` into distinct board columns. Added a completed-task count.
- Added reason, concrete next steps and unfinished-check evidence to task API responses and cards/details. Existing moon/cloud reports remain blocked because their full tests and visual checks were not completed; no success or merge state was fabricated.
- Future worker reports require `blocker_reason` and `next_steps`. Contradictory ready-with-blockers reports cannot publish. Retrying clears stale results; historical result files remain on disk.
- Full dashboard suite: 20 tests passed (8.509s). After excluding successful “失敗0” lines from unfinished-check evidence, the 6 guidance tests passed again. JavaScript syntax, Python compilation and diff checks passed.
- Verified the live Tailscale UI: six separate columns including completion, and the moon detail panel showing `npm test`, browser verification, the actual missing checks, and retry/cancel controls. Unchanged polling no longer replaces task cards or detail controls.
- The user subsequently applied the OS prerequisite repair described below; the service sandbox probe passed and workers executed repository commands. Their remaining verification limitations are accurately displayed by this change.


## Service sandbox correction

The initial real-Codex smoke test ran from the desktop tool environment. It did **not** validate the AppArmor context of the systemd user service. Actual queued work later failed before any repository command with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`.

- Reproduced with `manage.py doctor`, which launches `codex sandbox -P :workspace -- /usr/bin/true` via a new systemd user service, without calling a model.
- Ubuntu has `kernel.apparmor_restrict_unprivileged_userns=1`, bubblewrap 0.9.0 and AppArmor 4.0.1. The distro's `bwrap-userns-restrict` profile is absent. The desktop has its own user-namespace-enabled AppArmor profile; the service does not inherit it.
- Added a per-attempt sandbox preflight before setup/model execution. Failure blocks the task and pauses dispatch. Cancellation during preflight does not pause the entire queue.
- `python3 -m unittest discover -s dev-dashboard/tests -v`: **13 passed**, 8.075s, including failure-before-model and cancellation regression coverage. Python compilation, JavaScript syntax, shell syntax and diff checks passed.
- Added `repair-sandbox.sh` with the official Ubuntu prerequisite repair. **OS repair is not yet executed**: `sudo -n true` requires a password. Service sandbox verification still fails pending that repair; no successful production worker run is claimed.
- Queue paused while awaiting OS repair. Existing blocked/cancelled task worktrees retained. No AppArmor/sysctl restriction or Codex sandbox has been disabled.

The original results below describe the initial implementation and should be read with this correction.

## Environment

- Before implementation: `git pull --ff-only`, main fast-forwarded from `98e71f2` to `04ecda3`.
- Linux, Python 3.12.3, Node v26.1.0, Tailscale 1.102.3.
- Real worker: official `@openai/codex@0.157.1` installed only under `.runtime/codex-cli/`; existing CLI 0.146.0 could not run the configured model and was left unchanged.
- Source changes are confined to `dev-dashboard/`. No AstroForge or ROS2 demo implementation changes. SpaceROS validation is therefore not applicable to this change.

## Results

| Check | Result |
| --- | --- |
| `python3 -m unittest discover -s dev-dashboard/tests -v` | 12 tests passed, 4.847s |
| `node --check dev-dashboard/static/app.js` | Passed |
| `python3 -m py_compile dev-dashboard/server.py dev-dashboard/manage.py dev-dashboard/tests/smoke_codex.py` | Passed |
| `git diff --check` | Passed |
| `python3 dev-dashboard/tests/smoke_codex.py --codex /home/ampoi/Documents/astroforge/dev-dashboard/.runtime/codex-cli/node_modules/.bin/codex` | Real Codex implemented a small Python module in a disposable worktree, ran 3 passing unit tests, then the queue committed and pushed to a disposable local bare remote and reached `review`. Temporary repository removed. |
| `git worktree add --detach dev-dashboard/.runtime/worktrees/environment-check origin/main` followed by `npm ci --ignore-scripts --prefix dev-dashboard/.runtime/worktrees/environment-check` | 144 packages installed in isolated worktree; verification worktree removed normally afterward. |
| Service, authenticated API, listener | systemd user service running; settings/worktrees API returned successfully; `ss -ltn 'sport = :8766'` showed only `100.111.206.25:8766`. |
| Browser | Tailscale DNS URL loaded; token login, authenticated workboard, worktree list and ToDo form visibly rendered. |

The 12 automated tests cover HTTP authentication/cookies, Origin and Host rejection, invalid inputs, private file access rejection, OpenAPI delivery, concurrent task claiming, worker overlap, queue progression, priority, merge-gated dependencies, cancellation, timeout, blocked reports, retry, startup recovery, failed setup, failed push with commit retention, actual Git worktree creation and local push.

Remote access was checked from this host over its Tailscale address/DNS. Access from a separate tailnet device was not independently tested. Success reports from future Codex workers still require human review before merging. Squash/rebase integration is not recognized by the ancestry-based completion check. The transient service must be started again after reboot; no persistent service unit or Tailscale Serve configuration was installed.
