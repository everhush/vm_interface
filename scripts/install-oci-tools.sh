#!/usr/bin/env bash
set -euo pipefail
if ! command -v buildah >/dev/null; then
  sudo timeout 240s apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=25 update -qq
  sudo timeout 600s apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=25 install -y --no-install-recommends buildah
fi
buildah --version
