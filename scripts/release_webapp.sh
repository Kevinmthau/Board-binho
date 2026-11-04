#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
version="$(node -p "require('./web/package.json').version")"
release="releases/Flick-Soccer-v$version"
[[ ! -e "$release" ]] || { printf 'Release already exists: %s\n' "$release" >&2; exit 1; }
mkdir -p releases
temporary="$release.lock"
mkdir "$temporary" || { printf 'Release is already in progress: %s\n' "$release" >&2; exit 1; }
trap 'rm -rf "$temporary"' EXIT
(cd web && node scripts/render-title.mjs && npm test)
node web/scripts/render-title.mjs --check
./scripts/build_webapp.sh --skip-web-build
app_id="$(node -p "require('./board.config.json').appId")"
cp "Builds/Web/$app_id.webapp.zip" "$temporary/Flick-Soccer-v$version.webapp.zip"
cp web/public/assets/flick-soccer-cover.png "$temporary/Flick-Soccer-v$version-title-card.png"
cat > "$temporary/INSTALL.md" <<EOF
# Flick Soccer v$version

Install Flick-Soccer-v$version.webapp.zip using Board Connect or upload it to Studio.
The matching 1536 × 864 title card is beside the bundle.

Requires one Board Sports set and two people. Choose Competitive, select the
players, and choose a goal target in House Rules. Each new group gets the
interactive Piece tutorial. PLAY TUTORIAL repeats it.

The full browser regression suite and the packed offline checks passed when
this release was built. All gameplay, artwork, fonts and audio are bundled.

- App ID $app_id
- Package ID com.defaultcompany.boardbinhoweb

Run the installation command from this folder.
\`\`\`sh
board-connect install Flick-Soccer-v$version.webapp.zip
\`\`\`
EOF
mv "$temporary" "$release"
trap - EXIT
printf 'Release ready: %s/%s\n' "$ROOT_DIR" "$release"
