#!/usr/bin/env bash
# Install real evidence prerequisites only when absent. Package download and
# dpkg configuration are separate so a slow mirror cannot interrupt dpkg.
set -euo pipefail
ready() {
  command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null &&
  command -v tesseract >/dev/null &&
  ffmpeg -version >/dev/null && ffprobe -version >/dev/null &&
  test -f /usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf &&
  tesseract --list-langs 2>/dev/null | grep -qx eng
}
if ! ready; then
  opts=(-o Acquire::Retries=3 -o Acquire::http::Timeout=25 -o Acquire::https::Timeout=25 -o DPkg::Lock::Timeout=30)
  packages=(ffmpeg tesseract-ocr tesseract-ocr-eng fonts-dejavu-core)
  sudo timeout 180s apt-get "${opts[@]}" update -qq ||
    sudo timeout 120s apt-get "${opts[@]}" update -qq
  # Cached completed downloads are retained across the bounded second attempt.
  sudo timeout 600s apt-get "${opts[@]}" --download-only install -y --no-install-recommends "${packages[@]}" ||
    sudo timeout 240s apt-get "${opts[@]}" --download-only install -y --no-install-recommends "${packages[@]}"
  sudo timeout 180s apt-get "${opts[@]}" --no-download install -y --no-install-recommends "${packages[@]}"
fi
ready
ffmpeg -version | sed -n '1p'
tesseract --version | sed -n '1p'
