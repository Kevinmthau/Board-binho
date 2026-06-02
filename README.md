# Board Binho Web

Board Binho Web is a Board Web SDK port of the Unity Board Binho prototype. It
runs as a Vite + TypeScript canvas game inside the Board WebView Android
wrapper.

## Layout

- `web/`: Vite + TypeScript game source.
- `android/`: Android WebView wrapper with Board touch bridge integration.
- `Builds/Android/`: copied APK output from the project build helper.
- Shared SDK bundle: `$HOME/board/board-websdk/`.

## Identity

- Android package/application id: `com.defaultcompany.boardbinhoweb`
- Android display label: `Board Binho Web`
- Board app id: `board-binhoweb`
- APK output: `Builds/Android/BoardBinhoWeb.apk`

## Download APK

Download the latest debug APK from the GitHub release:

https://github.com/Kevinmthau/Board-binho/releases/latest/download/board-binho-web-debug.apk

This APK is debug-signed for testing and local installation.

## Build And Install

```bash
./scripts/build_android.sh
./scripts/build_android.sh --install
./scripts/build_android.sh --launch
```

The wrapper builds `web/dist`, packages it into Android assets, copies the debug
APK to `Builds/Android/BoardBinhoWeb.apk`, and can install or launch with `bdb`.
The web dependency and Android AAR resolve from the shared SDK bundle at
`$HOME/board/board-websdk/`. Override this with `BOARD_WEBSDK_DIR=/path/to/sdk`
or `-PboardWebSdkDir=/path/to/sdk`.

For browser-only iteration:

```bash
cd web
npm install
npm run dev
```

The browser preview includes fallback defender placement and swipe controls.
Board hardware uses `Board.input.subscribe(...)` for glyph and finger contacts.
