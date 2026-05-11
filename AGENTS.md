# AGENTS.md

This repository is the **Board Web SDK** version of Board Binho.

## What to assume

- This is a WebSDK Android/WebView project, not a Unity project.
- The source Board Web SDK bundle lives at `/Users/kevinthau/board-websdk`.
- The original Unity prototype lives at `/Users/kevinthau/Board-binho`.
- Use `Board.input.subscribe(...)` for live contact frames.
- Track physical piece instances by `contactId`, not `glyphId`.
- Treat `glyphId` as a piece type identifier only.
- Always guard SDK calls with `Board.isOnDevice` so browser preview works.

## Project identity

- Android package id: `com.defaultcompany.boardbinhoweb`
- Board app id: `board-binhoweb`
- APK output: `Builds/Android/BoardBinhoWeb.apk`
- Web app: `web/`
- Android wrapper: `android/`
- Current piece model: `android/app/src/main/assets/model.tflite`

## Build and deploy loop

Prefer:

```bash
./scripts/build_android.sh --install
```

Use `--launch` to install and start the app:

```bash
./scripts/build_android.sh --launch
```

The script resolves `bdb` from `BDB_BIN`, `PATH`, `Tools/bdb`, `$HOME/Desktop/bdb`,
and `$HOME/Documents/bdb`.

## Browser loop

```bash
cd web
npm run dev
```

The browser preview uses simulated defenders and pointer swipes; do not fake
`Board.isOnDevice` in app code.
