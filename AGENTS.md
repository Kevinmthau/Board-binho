# AGENTS.md

This repository is **Flick Soccer**, a Board Web App.

## What to assume

- This is a Vite/TypeScript Board Web SDK game packaged as `.webapp.zip`.
- Use `Board.input.subscribe(...)` for live contact frames.
- Track physical piece instances by `contactId`, not `glyphId`.
- Treat `glyphId` as a piece type identifier only.
- Always guard SDK calls with `Board.isOnDevice` so browser preview works.
- The build and packed ZIP must contain no web addresses, including in asset metadata.
- Keep asset source links in repository documentation and preserve shipped license terms.
- Pieces are placed once before kickoff and stay fixed as blockers for the whole match. Only the ball is swiped during play.
- Touch gates orientation updates during setup. Menu, swipe practice, flip, and profile flows have browser regressions.

## Project identity

- Package id: `com.defaultcompany.boardbinhoweb`
- Board app id: persisted in `board.config.json` after the first pack.
- Web app output: `Builds/Web/<appId>.webapp.zip`
- Web app source: `web/`
- Vendored SDK: `vendor/board.fun-web-sdk-1.0.0-beta.6.tgz`
- SDK source: `/Users/kevinthau/Board Studio/board.fun-web-sdk-1.0.0-beta.6.tgz`
- Piece set: Board Sports v0.1.0, four defenders per half. Any Sports piece can defend either side.
- Piece model: `web/public/model.tflite` (SHA-256 `4d75343e149b72f8410cad10f518c64791634ae6e6932880088a34c164026ad9`).

## Build and deploy loop

Build and pack locally:

```bash
./scripts/build_webapp.sh
```

Install or install and launch on a paired Board:

```bash
./scripts/build_webapp.sh --install
./scripts/build_webapp.sh --launch
```

The script uses `web-pack` to create the bundle and `board-connect` for device
installation. Override them with `WEB_PACK_BIN` or `BOARD_CONNECT_BIN`.

Refresh the vendored SDK from Board Studio with its `update-game-sdk.sh`
workflow, passing `--pack-only` when no device deployment is requested.

## Browser loop

```bash
cd web
npm run dev
```

The browser preview uses simulated defenders and pointer swipes; do not fake
`Board.isOnDevice` in app code.

Use `./scripts/release_webapp.sh` for a versioned release with its freshly
rendered 1536 × 864 title card. Refer to `PLAN.md` for the standards revision,
decisions, and remaining hardware checks.
