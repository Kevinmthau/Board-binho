# AGENTS.md

This repository is the **Board Web App** version of Board Binho.

## What to assume

- This is a Vite/TypeScript Board Web SDK game packaged as `.webapp.zip`.
- The Android wrapper is legacy compatibility code, not the primary build.
- Use `Board.input.subscribe(...)` for live contact frames.
- Track physical piece instances by `contactId`, not `glyphId`.
- Treat `glyphId` as a piece type identifier only.
- Always guard SDK calls with `Board.isOnDevice` so browser preview works.

## Project identity

- Package id: `com.defaultcompany.boardbinhoweb`
- Board app id: persisted in `board.config.json` after the first pack.
- Web app output: `Builds/Web/<appId>.webapp.zip`
- Web app source: `web/`
- Vendored SDK: `vendor/board.fun-web-sdk-1.0.0-beta.6.tgz`
- SDK source: `/Users/kevinthau/Board Studio/board.fun-web-sdk-1.0.0-beta.6.tgz`
- Piece model: `web/public/model.tflite`
- Legacy Android wrapper: `android/`

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
