#!/usr/bin/env bash
# Avoid network-dependent apt updates when the hosted image already has the
# exact executable prerequisites. Fail within a bounded time on mirror outage.
set -euo pipefail
ready() {
  command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null &&
  command -v tesseract >/dev/null &&
  test -f /usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf &&
  tesseract --list-langs 2>/dev/null | grep -qx eng
}
if ! ready; then
  sudo timeout 240s apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=25 -o Acquire::https::Timeout=25 update -qq
  sudo timeout 240s apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=25 -o Acquire::https::Timeout=25 install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng fonts-dejavu-core
fi
ready
ffmpeg -version | sed -n '1p'
tesseract --version | sed -n '1p'
