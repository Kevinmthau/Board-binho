#!/usr/bin/env bash
set -euo pipefail

GAME_NAME="Board Binho"
SLUG="board-binho"
PACKAGE_ID="com.defaultcompany.boardbinhoweb"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
DIST_DIR="$WEB_DIR/dist"
MODEL_PATH="$WEB_DIR/public/model.tflite"
OUTPUT_DIR="$ROOT_DIR/Builds/Web"

build_web=true
install_after_build=false
launch_after_install=false

usage() {
    cat <<'EOF'
Usage: scripts/build_webapp.sh [--install] [--launch] [--skip-web-build]

Builds the Vite app and packs a Board .webapp.zip at:
  Builds/Web/<appId>.webapp.zip

Options:
  --install          Install the packed web app with board-connect.
  --launch           Install and launch the packed web app.
  --skip-web-build   Pack the existing web/dist output without rebuilding it.
  --help             Show this help text.
EOF
}

log() {
    printf '[build] %s\n' "$1"
}

fail() {
    printf '[build] Error: %s\n' "$1" >&2
    exit 1
}

resolve_web_pack() {
    if [[ -n "${WEB_PACK_BIN:-}" ]]; then
        if command -v "$WEB_PACK_BIN" >/dev/null 2>&1; then
            command -v "$WEB_PACK_BIN"
            return
        fi
        if [[ -x "$WEB_PACK_BIN" ]]; then
            printf '%s\n' "$WEB_PACK_BIN"
            return
        fi
        return 1
    fi

    if [[ -x "$WEB_DIR/node_modules/.bin/web-pack" ]]; then
        printf '%s\n' "$WEB_DIR/node_modules/.bin/web-pack"
        return
    fi

    command -v web-pack 2>/dev/null || return 1
}

resolve_board_connect() {
    if [[ -n "${BOARD_CONNECT_BIN:-}" ]]; then
        if command -v "$BOARD_CONNECT_BIN" >/dev/null 2>&1; then
            command -v "$BOARD_CONNECT_BIN"
            return
        fi
        if [[ -x "$BOARD_CONNECT_BIN" ]]; then
            printf '%s\n' "$BOARD_CONNECT_BIN"
            return
        fi
        return 1
    fi

    command -v board-connect 2>/dev/null || return 1
}

read_sdk_version() {
    WEB_DIR="$WEB_DIR" node <<'NODE'
const fs = require("fs");
const path = require("path");
const packagePath = path.join(process.env.WEB_DIR, "node_modules", "@board.fun", "web-sdk", "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (typeof pkg.version !== "string" || pkg.version.length === 0) process.exit(1);
process.stdout.write(pkg.version);
NODE
}

read_app_id() {
    ROOT_DIR="$ROOT_DIR" node <<'NODE'
const fs = require("fs");
const path = require("path");
const configPath = path.join(process.env.ROOT_DIR, "board.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (typeof config.appId !== "string" || config.appId.length === 0) process.exit(1);
process.stdout.write(config.appId);
NODE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --install)
            install_after_build=true
            ;;
        --launch)
            install_after_build=true
            launch_after_install=true
            ;;
        --skip-web-build)
            build_web=false
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            usage >&2
            fail "Unknown argument: $1"
            ;;
    esac
    shift
done

[[ -f "$WEB_DIR/package.json" ]] || fail "Missing web/package.json."
[[ -f "$MODEL_PATH" ]] || fail "Missing touch model at $MODEL_PATH."

if [[ "$build_web" == true ]]; then
    if [[ ! -d "$WEB_DIR/node_modules" ]]; then
        log "Installing web dependencies."
        (cd "$WEB_DIR" && npm ci)
    fi

    log "Building web app."
    (cd "$WEB_DIR" && npm run build)
fi

[[ -f "$DIST_DIR/index.html" ]] || fail "Missing web/dist/index.html. Build without --skip-web-build first."
[[ -f "$DIST_DIR/model.tflite" ]] || fail "The Vite build did not copy model.tflite into web/dist."

web_pack_bin="$(resolve_web_pack)" || fail "web-pack not found. Run npm ci or set WEB_PACK_BIN."
sdk_version="$(read_sdk_version)" || fail "Could not read the installed Board Web SDK version."
mkdir -p "$OUTPUT_DIR"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/board-binho.XXXXXX")"
temporary_zip="$temporary_dir/BoardBinho.webapp.zip"
trap 'rm -rf "$temporary_dir"' EXIT

log "Packing Board web app."
(
    cd "$ROOT_DIR"
    "$web_pack_bin" "$DIST_DIR" \
        --package-id "$PACKAGE_ID" \
        --name "$GAME_NAME" \
        --sdk-version "$sdk_version" \
        --model model.tflite \
        --out "$temporary_zip"
)

app_id="$(read_app_id)" || fail "web-pack did not create a valid board.config.json."
output_webapp="$OUTPUT_DIR/$app_id.webapp.zip"
mv "$temporary_zip" "$output_webapp"
unzip -tq "$output_webapp" >/dev/null || fail "Packed web app failed zip validation."
rm -rf "$temporary_dir"
trap - EXIT

log "Web app ready: $output_webapp"
log "Board app id: $app_id"

if [[ "$install_after_build" == true ]]; then
    board_connect_bin="$(resolve_board_connect)" || fail "board-connect not found. Set BOARD_CONNECT_BIN or add it to PATH."
    log "Installing web app."
    if [[ "$launch_after_install" == true ]]; then
        "$board_connect_bin" -y install "$output_webapp" --launch
    else
        "$board_connect_bin" -y install "$output_webapp"
    fi
fi
