#!/bin/zsh

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly UNITY_APP="/Applications/Unity/Hub/Editor/6000.4.2f1/Unity.app/Contents/MacOS/Unity"
readonly UNITY_PROCESS_PATTERN="${UNITY_APP}.*-batchmode.*-projectPath ${PROJECT_ROOT}"
readonly LICENSING_PROCESS_PATTERN="Unity\\.Licensing\\.Client --namedPipe Unity-LicenseClient-${USER}"
readonly BUILD_METHOD="BoardBinho.EditorTools.BinhoBuild.BuildAndroidApkFromCommandLine"
readonly BUILD_LOG="${TMPDIR:-/tmp}/board-binho-build.log"
readonly LOCK_DIR="${TMPDIR:-/tmp}/board-binho-unity-build.lock"
readonly APK_PATH="${PROJECT_ROOT}/Builds/Android/BoardBinho.apk"
readonly DEFAULT_BDB="/Users/kevinthau/Board-demo/Tools/bdb"

install_after_build=false
clean_stale=false

usage() {
    cat <<'EOF'
Usage: scripts/unity_build_android.sh [--install] [--clean-stale]

Builds the Android APK for Board Binho using Unity batchmode.

Options:
  --install      Install the freshly built APK with bdb after a successful build.
  --clean-stale  Kill stale headless Unity/licensing processes for this project before building.
  --help         Show this help text.
EOF
}

log() {
    printf '[build] %s\n' "$1"
}

fail() {
    printf '[build] %s\n' "$1" >&2
    exit 1
}

cleanup_lock() {
    rm -rf "$LOCK_DIR"
}

ensure_prerequisites() {
    [[ -x "$UNITY_APP" ]] || fail "Unity not found at $UNITY_APP"
}

acquire_lock() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        printf '%s\n' "$$" > "$LOCK_DIR/pid"
        trap cleanup_lock EXIT
        return
    fi

    local existing_pid=""
    if [[ -f "$LOCK_DIR/pid" ]]; then
        existing_pid="$(<"$LOCK_DIR/pid")"
    fi

    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
        fail "Another Board Binho build helper is already running (pid $existing_pid)."
    fi

    log "Removing stale build lock."
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR"
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    trap cleanup_lock EXIT
}

project_batch_pids() {
    pgrep -f "$UNITY_PROCESS_PATTERN" || true
}

any_unity_editor_pids() {
    pgrep -f "$UNITY_APP" || true
}

kill_stale_project_processes() {
    local batch_pids
    batch_pids="$(project_batch_pids)"

    if [[ -n "$batch_pids" ]]; then
        if [[ "$clean_stale" != true ]]; then
            fail "A Unity batch build for this project is already running: ${batch_pids//$'\n'/, }. Re-run with --clean-stale only if those processes are stuck."
        fi

        log "Killing stale Unity batch processes for this project: ${batch_pids//$'\n'/, }"
        pkill -f "$UNITY_PROCESS_PATTERN" || true
        sleep 1
    fi

    local editor_pids
    editor_pids="$(any_unity_editor_pids)"

    if [[ -z "$editor_pids" ]] && pgrep -f "$LICENSING_PROCESS_PATTERN" >/dev/null 2>&1; then
        log "Killing stale Unity licensing client with no active editor."
        pkill -f "$LICENSING_PROCESS_PATTERN" || true
        sleep 1
    fi
}

diagnose_failure() {
    if [[ ! -f "$BUILD_LOG" ]]; then
        return
    fi

    if rg -q "attempt to write a readonly database" "$BUILD_LOG"; then
        log "Diagnosis: Unity was started without enough filesystem access. Run this build outside the sandbox."
    fi

    if rg -q "Licensing initialization failed|Timed-out after 60.00s, waiting for Licensing to initialize" "$BUILD_LOG"; then
        log "Diagnosis: Unity timed out waiting for licensing startup. Re-run with --clean-stale."
    fi

    if rg -q "Build Finished, Result: Success." "$BUILD_LOG"; then
        log "The build log shows success even though the wrapper saw a failure. Check the final Unity shutdown lines in $BUILD_LOG."
    fi
}

run_build() {
    log "Starting Unity Android build. Log: $BUILD_LOG"
    "$UNITY_APP" \
        -batchmode \
        -quit \
        -projectPath "$PROJECT_ROOT" \
        -executeMethod "$BUILD_METHOD" \
        -logFile "$BUILD_LOG"
}

install_apk() {
    local bdb_bin="${BDB_BIN:-$DEFAULT_BDB}"
    [[ -x "$bdb_bin" ]] || fail "bdb not found at $bdb_bin"
    [[ -f "$APK_PATH" ]] || fail "APK not found at $APK_PATH"

    log "Checking Board connection."
    "$bdb_bin" status

    log "Installing APK: $APK_PATH"
    "$bdb_bin" install "$APK_PATH"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --install)
            install_after_build=true
            ;;
        --clean-stale)
            clean_stale=true
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

ensure_prerequisites
acquire_lock
kill_stale_project_processes

if ! run_build; then
    diagnose_failure
    exit 1
fi

log "Unity build succeeded."

if [[ "$install_after_build" == true ]]; then
    install_apk
fi
