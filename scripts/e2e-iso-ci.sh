#!/usr/bin/env bash
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "$(uname -m)" == x86_64 ]]
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/root/boot/grub" evidence
cat > "$work/root/boot/grub/grub.cfg" <<'GRUB'
set timeout=0
set default=0
menuentry 'VM Interface ISO boot evidence' {
  echo VMINTERFACEISOBOOTOK
  sleep --interruptible 600
}
GRUB
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends grub-common grub-pc-bin grub-efi-amd64-bin xorriso mtools
grub-mkrescue -o "$work/test.iso" "$work/root"
sha256sum "$work/test.iso" | cut -d' ' -f1 > evidence/iso-sha256.txt
python3 scripts/e2e-iso.py "$work/test.iso"
