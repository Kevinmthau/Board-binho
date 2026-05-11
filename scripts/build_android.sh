#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$PROJECT_ROOT/web"
ANDROID_DIR="$PROJECT_ROOT/android"
APK_SOURCE="$ANDROID_DIR/app/build/outputs/apk/debug/BoardBinhoWeb-debug.apk"
APK_OUTPUT="$PROJECT_ROOT/Builds/Android/BoardBinhoWeb.apk"
PACKAGE_ID="com.defaultcompany.boardbinhoweb"
DEFAULT_JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
DEFAULT_ANDROID_HOME="$HOME/Library/Android/sdk"

install_after_build=false
launch_after_install=false

usage() {
    cat <<'EOF'
Usage: scripts/build_android.sh [--install] [--launch]

Builds the Board Binho WebSDK Android APK.

Options:
  --install  Install the freshly built APK with bdb.
  --launch   Launch the app after installing. Implies --install.
  --help     Show this help text.
EOF
}

log() {
    printf '[build] %s\n' "$1"
}

fail() {
    printf '[build] %s\n' "$1" >&2
    exit 1
}

resolve_bdb_bin() {
    if [[ -n "${BDB_BIN:-}" ]]; then
        [[ -x "$BDB_BIN" ]] && printf '%s\n' "$BDB_BIN" && return 0
        return 1
    fi

    local path_bdb
    path_bdb="$(command -v bdb 2>/dev/null || true)"
    if [[ -n "$path_bdb" && -x "$path_bdb" ]]; then
        printf '%s\n' "$path_bdb"
        return 0
    fi

    local candidate
    for candidate in "$PROJECT_ROOT/Tools/bdb" "$HOME/Desktop/bdb" "$HOME/Documents/bdb"; do
        if [[ -x "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    return 1
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
        --help)
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

if [[ -z "${JAVA_HOME:-}" && -x "$DEFAULT_JAVA_HOME/bin/java" ]]; then
    export JAVA_HOME="$DEFAULT_JAVA_HOME"
fi

if [[ -z "${ANDROID_HOME:-}" && -d "$DEFAULT_ANDROID_HOME" ]]; then
    export ANDROID_HOME="$DEFAULT_ANDROID_HOME"
fi

log "Building web app."
(
    cd "$WEB_DIR"
    if [[ ! -d node_modules ]]; then
        log "Installing web dependencies."
        if [[ -f package-lock.json ]]; then
            npm ci
        else
            npm install
        fi
    fi
    npm run build
)

log "Building Android wrapper."
(
    cd "$ANDROID_DIR"
    ./gradlew assembleDebug
)

[[ -f "$APK_SOURCE" ]] || fail "APK not found at $APK_SOURCE"
mkdir -p "$(dirname "$APK_OUTPUT")"
cp "$APK_SOURCE" "$APK_OUTPUT"
log "APK ready: $APK_OUTPUT"

if [[ "$install_after_build" == true ]]; then
    bdb_bin="$(resolve_bdb_bin)" || fail "bdb not found. Set BDB_BIN=/path/to/bdb or add bdb to PATH."
    log "Checking Board connection."
    "$bdb_bin" status
    log "Installing APK."
    "$bdb_bin" install "$APK_OUTPUT"

    if [[ "$launch_after_install" == true ]]; then
        log "Launching $PACKAGE_ID."
        "$bdb_bin" launch "$PACKAGE_ID"
    fi
fi
