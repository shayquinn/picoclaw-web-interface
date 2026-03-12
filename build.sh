#!/usr/bin/env bash
set -e

echo "============================================================"
echo " PicoClaw Full Build (Go binary + Electron package)"
echo "============================================================"

# ── Prerequisite checks ───────────────────────────────────────────────────────

if ! command -v go &>/dev/null; then
    echo "ERROR: 'go' not found in PATH."
    echo "       Install Go from https://go.dev/dl/ and re-run this script."
    exit 1
fi

if ! command -v node &>/dev/null; then
    echo "ERROR: 'node' not found in PATH."
    echo "       Install Node.js from https://nodejs.org/ and re-run this script."
    exit 1
fi

if ! command -v npm &>/dev/null; then
    echo "ERROR: 'npm' not found in PATH."
    echo "       Install Node.js (includes npm) from https://nodejs.org/ and re-run this script."
    exit 1
fi

# ── Platform detection ────────────────────────────────────────────────────────

OS_RAW="$(uname -s)"
ARCH_RAW="$(uname -m)"

case "${OS_RAW}" in
    Linux)  PLATFORM="linux" ;;
    Darwin) PLATFORM="darwin" ;;
    *)      PLATFORM="${OS_RAW}" ;;
esac

case "${ARCH_RAW}" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    arm64)   ARCH="arm64" ;;
    *)       ARCH="${ARCH_RAW}" ;;
esac

BINARY_NAME="picoclaw-${PLATFORM}-${ARCH}"
echo "Detected platform: ${PLATFORM}/${ARCH} → build/${BINARY_NAME}"

# ── Go generate (workspace embedding) ────────────────────────────────────────

echo ""
echo "[1/5] Running go generate..."

# Clean up any stale embedded workspace copy
rm -rf ./cmd/picoclaw/internal/onboard/workspace

go generate ./...

# ── Build Go binary ───────────────────────────────────────────────────────────

echo ""
echo "[2/5] Building Go binary..."

mkdir -p build

CGO_ENABLED=0 go build -v -tags stdjson -o "build/${BINARY_NAME}" ./cmd/picoclaw
echo "      Built: build/${BINARY_NAME}"

# Create a plain symlink so dev-mode Electron finds it without the platform suffix
ln -sf "${BINARY_NAME}" build/picoclaw
echo "      Symlink: build/picoclaw -> ${BINARY_NAME}"

# ── Clean up embedded workspace copy ─────────────────────────────────────────

echo ""
echo "[3/5] Cleaning up embedded workspace copy..."
rm -rf ./cmd/picoclaw/internal/onboard/workspace

# ── Node dependencies ─────────────────────────────────────────────────────────

echo ""
echo "[4/5] Installing Node dependencies..."

cd web-interface

if [ ! -d node_modules ]; then
    echo "      node_modules not found – running npm install..."
    npm install
else
    echo "      node_modules already present – skipping npm install."
fi

# ── Build Electron package ────────────────────────────────────────────────────

echo ""
echo "[5/5] Building Electron package..."

case "${PLATFORM}" in
    linux)  npm run dist:linux ;;
    darwin) npm run dist:mac ;;
    *)
        echo "ERROR: Unsupported platform '${PLATFORM}' for Electron packaging."
        cd ..
        exit 1
        ;;
esac

cd ..

echo ""
echo "============================================================"
echo " Build complete!"
echo " Go binary : build/${BINARY_NAME}"
echo " Package   : web-interface/dist/"
echo "============================================================"
