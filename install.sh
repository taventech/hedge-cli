#!/bin/sh
# Installer for the hedge CLI (self-contained binary, no Node required).
#
# Usage:
#   curl -fsSL https://github.com/taventech/hedge-cli/releases/latest/download/install.sh | sh
set -eu

REPO="taventech/hedge-cli"
BIN="hedge"
INSTALL_DIR="${HOME}/.local/bin"

info() { printf '%s\n' "$*"; }
err() { printf 'error: %s\n' "$*" >&2; }

# Detect OS.
os="$(uname -s)"
case "$os" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *)
    err "unsupported operating system: $os"
    err "hedge ships prebuilt binaries for macOS and Linux only."
    err "On other systems install with npm: npm install -g hedge-broker"
    exit 1
    ;;
esac

# Detect CPU architecture.
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *)
    err "unsupported CPU architecture: $arch"
    err "hedge ships prebuilt binaries for x86_64 and arm64 only."
    err "On other systems install with npm: npm install -g hedge-broker"
    exit 1
    ;;
esac

asset="${BIN}-${os}-${arch}"
url="https://github.com/${REPO}/releases/latest/download/${asset}"

# Pick a downloader.
if command -v curl >/dev/null 2>&1; then
  dl() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  dl() { wget -qO "$2" "$1"; }
else
  err "need curl or wget to download the binary."
  exit 1
fi

mkdir -p "$INSTALL_DIR"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

info "Downloading ${asset}..."
if ! dl "$url" "$tmp"; then
  err "download failed: $url"
  err "Check https://github.com/${REPO}/releases for available assets."
  exit 1
fi

chmod +x "$tmp"
mv "$tmp" "${INSTALL_DIR}/${BIN}"
trap - EXIT

info "Installed ${BIN} to ${INSTALL_DIR}/${BIN}"

# Warn if the install dir is not on PATH.
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    info "Run 'hedge --help' to get started."
    ;;
  *)
    info ""
    info "${INSTALL_DIR} is not on your PATH. Add it, then restart your shell:"
    info "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.profile"
    info "Or run it directly: ${INSTALL_DIR}/${BIN} --help"
    ;;
esac
