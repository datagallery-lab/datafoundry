#!/usr/bin/env bash
set -Eeuo pipefail

ACTION="${1:-}"
NON_INTERACTIVE=0
if [[ "${2:-}" == "--non-interactive" ]] || [[ "${DEPLOY_NON_INTERACTIVE:-}" == "1" ]]; then
  NON_INTERACTIVE=1
fi

usage() {
  echo "Usage: install-dependency.sh <node|python|uv> [--non-interactive]" >&2
  exit 2
}

case "${ACTION}" in
  node|python|uv) ;;
  *) usage ;;
esac

run_privileged() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif [[ "${NON_INTERACTIVE}" -eq 1 ]]; then
    sudo -n "$@"
  else
    sudo "$@"
  fi
}

install_python() {
  run_privileged apt-get update
  run_privileged apt-get install -y python3 python3-venv
  local version
  version="$(python3 --version 2>&1 || true)"
  if [[ ! "${version}" =~ Python\ (3)\.([0-9]+) ]]; then
    echo "Python 3.10+ is required after installation; found ${version:-none}." >&2
    exit 1
  fi
  local minor="${BASH_REMATCH[2]}"
  if [[ "${BASH_REMATCH[1]}" -lt 3 || "${minor}" -lt 10 ]]; then
    echo "Python 3.10+ is required after installation; found ${version}." >&2
    exit 1
  fi
}

install_uv() {
  local installer
  installer="$(mktemp)"
  trap 'rm -f "${installer}"' RETURN
  curl -fsSL "https://astral.sh/uv/install.sh" -o "${installer}"
  sh "${installer}"
  rm -f "${installer}"
  trap - RETURN
  export PATH="${HOME}/.local/bin:${PATH}"
  if ! command -v uv >/dev/null 2>&1; then
    echo "uv installation did not produce a working uv command." >&2
    exit 1
  fi
  uv --version >/dev/null
}

install_node() {
  local setup
  local nodesource_url="https://deb.nodesource.com/setup_22.x"
  setup="$(mktemp)"
  trap 'rm -f "${setup}"' RETURN
  curl -fsSL "${nodesource_url}" -o "${setup}"
  run_privileged bash "${setup}"
  run_privileged apt-get install -y nodejs
  rm -f "${setup}"
  trap - RETURN
  node --version >/dev/null
  npm --version >/dev/null
}

case "${ACTION}" in
  python) install_python ;;
  uv) install_uv ;;
  node) install_node ;;
esac
