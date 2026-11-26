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
  # Hosted Ubuntu's mirror-list backend caused two download-only timeouts.
  # Use the official signed archive directly without changing host apt sources.
  source_args=()
  sources=""
  if [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] && [ "${RUNNER_OS:-}" = Linux ] && [ "$(dpkg --print-architecture)" = amd64 ]; then
    . /etc/os-release
    test "$VERSION_CODENAME" = noble
    sources="$(mktemp --suffix=.sources)"
    chmod 644 "$sources"
    trap 'rm -f "$sources"' EXIT
    cat >"$sources" <<'SOURCES'
Types: deb
URIs: https://archive.ubuntu.com/ubuntu/
Suites: noble noble-updates
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: https://security.ubuntu.com/ubuntu/
Suites: noble-security
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
SOURCES
    source_args=(-o "Dir::Etc::sourcelist=$sources" -o Dir::Etc::sourceparts=-)
  fi
  sudo timeout 240s apt-get "${opts[@]}" "${source_args[@]}" update -qq
  # Cached completed downloads are retained across the bounded second attempt.
  sudo timeout 1200s apt-get "${opts[@]}" "${source_args[@]}" --download-only install -y --no-install-recommends "${packages[@]}" ||
    sudo timeout 300s apt-get "${opts[@]}" "${source_args[@]}" --download-only install -y --no-install-recommends "${packages[@]}"
  sudo timeout 180s apt-get "${opts[@]}" "${source_args[@]}" --no-download install -y --no-install-recommends "${packages[@]}"
fi
ready
ffmpeg -version | sed -n '1p'
tesseract --version | sed -n '1p'
