#!/usr/bin/env bash
# Ubuntu 24.04 prerequisite repair from https://learn.chatgpt.com/docs/sandboxing
# Loads the distro's bwrap profile; does not disable AppArmor or Codex sandboxing.
set -euo pipefail
sudo apt-get update
sudo apt-get install -y bubblewrap apparmor-profiles apparmor-utils
profile_source=/usr/share/apparmor/extra-profiles/bwrap-userns-restrict
profile_target=/etc/apparmor.d/bwrap-userns-restrict
if [[ ! -f "$profile_target" ]]; then
  if [[ ! -f "$profile_source" ]]; then
    echo 'Distribution profile is unavailable; no custom security policy was installed.' >&2
    exit 1
  fi
  sudo install -m 0644 "$profile_source" "$profile_target"
fi
sudo apparmor_parser -r "$profile_target"
python3 "$(dirname "$0")/manage.py" doctor
