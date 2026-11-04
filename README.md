# Board Binho Web

Board Binho is a Vite and TypeScript canvas game for Board. It uses the Board
Web SDK for physical defenders and finger shots and ships as a `.webapp.zip`.

## Play

Use one Board Sports set. Blue defends the left goal and Orange defends the
right. Place any four of the eight Sports pieces on each half. Leave room
around each base and keep the center spot clear. Each side shows its count.

Blue takes the first shot. Flick the ball toward the other goal. When the ball
stops, the turn passes to the other side. After a goal, the team that conceded
kicks off from the center. Restart a match from the Board pause menu.

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

Click each half to place its four pieces, or select **Auto setup**. Drag a
piece to reposition it. Drag across the ball from its center to shoot.

Run the browser and SDK input regression tests in `web` with Node.js 20 or newer.

```bash
npx playwright install chromium
npm test
```
