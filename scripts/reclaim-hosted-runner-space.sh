#!/usr/bin/env bash
set -euo pipefail
# Never run this destructive space recovery on local or self-hosted machines.
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${RUNNER_OS:-}" = Linux
test ! -e /etc/rancher/k3s/k3s.yaml
mkdir -p evidence
df -h / > evidence/runner-disk-before.txt
# Unused preinstalled language/SDK trees, not needed by this KVM job.
for path in /usr/share/dotnet /usr/local/lib/android /opt/ghc /usr/share/swift /usr/local/share/boost; do
  if [ -d "$path" ] && [ ! -L "$path" ]; then sudo rm -rf -- "$path"; fi
done
# Image construction uses a separate temporary OCI store, never a shared cache.
sudo apt-get clean
df -h / > evidence/runner-disk-after.txt
node scripts/check-runner-space.ts before-provision 25
