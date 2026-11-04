# Flick Soccer

Flick Soccer is a Vite and TypeScript canvas game for Board. It uses the Board
Web SDK for physical defenders and finger shots and ships as a `.webapp.zip`.

## Play

Choose PLAY, COMPETITIVE, and two players from the Board profile picker.
House Rules offers a goal target of 1, 3, 5, or 7. The standard is 3.
The first match for each group starts with a short swipe practice. No pieces
need to be moved or touched for practice. HOW TO PLAY explains the rules;
PRACTICE SWIPING repeats practice.

Use one Board Sports set. Blue defends the left goal and Orange defends the
right. Use four Sports pieces total, with two on each half. Leave room
around each base and keep the center spot clear. Each side shows its count.
Set the pieces once before kickoff, then leave them untouched as fixed blockers
for the whole match.

Blue takes the first shot. Swipe the ball toward the other goal. When the ball
stops, the other player swipes from where it rests. After a goal, the team that
conceded kicks off from the center. The first team to the chosen goal target wins.
Restart, return to modes, or open How to Play from the Board pause menu.
The flip button turns the table view.

## Layout

- `web/`: game source and browser preview.
- `web/public/model.tflite`: Board Sports v0.1.0 recognition model.
- `web/PIECE_SET.json`: Sports glyphs, names, and sizes from the board-games-ai catalog.
- `vendor/`: vendored Board Web SDK package.
- `scripts/build_webapp.sh`: build, pack, install, and launch workflow.

## Identity

- Package id: `com.defaultcompany.boardbinhoweb`
- Board app id: stored in `board.config.json` after the first pack.
- Output: `Builds/Web/<appId>.webapp.zip`

Commit `board.config.json` after it is created. Its UUID keeps the installed
application identity, saves, and profiles stable across future builds.

## Build

```bash
./scripts/build_webapp.sh
```

The script installs web dependencies when needed, builds `web/dist`, runs
`web-pack`, validates the archive, and writes the final bundle under
`Builds/Web/`.

It scans every shipped file for web addresses, including binary metadata
and compressed fonts. Source links live in `docs/ASSET-MANIFEST.md`.

Create a versioned release with its 1536 × 864 title card and install notes:

```bash
./scripts/release_webapp.sh
```

Releases go into a new `releases/Flick-Soccer-v<version>/` directory.
The script renders the current title card and runs the test suite before
packing. Increase `web/package.json`'s version before the next release.

To reuse an existing Vite build:

```bash
./scripts/build_webapp.sh --skip-web-build
```

## Install On Board

Pair the `board-connect` CLI once, then run:

```bash
./scripts/build_webapp.sh --install
./scripts/build_webapp.sh --launch
```

Set `BOARD_CONNECT_BIN=/path/to/board-connect` or
`WEB_PACK_BIN=/path/to/web-pack` when the tools are not on `PATH`.

## Update The SDK

The game vendors the SDK payload installed in `/Users/kevinthau/Board Studio`.
Refresh it with Board Studio's update workflow:

```bash
cd "/Users/kevinthau/Board Studio"
./scripts/update-game-sdk.sh \
  --game "/Users/kevinthau/Board-binho" \
  --sdk-tarball board.fun-web-sdk-1.0.0-beta.6.tgz \
  --pack-only
```

## Browser Preview

```bash
cd web
npm ci
npm run dev
```

Click each half to place its two pieces, or select **Auto setup**. You can
adjust their positions by dragging during setup. The first shot locks the
blockers until the match is restarted. Take turns swiping from the ball to shoot.

Run the browser and SDK input regression tests in `web` with Node.js 20 or newer.

```bash
npx playwright install chromium
npm test
```
