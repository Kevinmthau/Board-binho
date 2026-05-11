# Board Binho Web

Minimal Vite + TypeScript scaffold demonstrating the Board Web SDK. Each subsystem (input, session, save, pause) is wired up in a small readable chunk in `src/main.ts` so you can use it as a reference.

## Run it

```bash
npm install
npm run dev
```

Opens at <http://localhost:5173>. Off-device the status panel renders `isOnDevice: false` and the interactive sections are disabled — which is expected. This mode is useful for styling, wiring up UI, and syntax-checking your SDK calls.

## Run it against a real bridge

The SDK bridge (`window.BoardSDK` / `window.boardTouch`) only exists inside a Board WebView. Two ways to get one on your dev machine:

1. **Android wrapper (in this project).** Build this web app (`npm run build`), then run `cd ../android && ./gradlew assembleDebug`. The Gradle task copies `dist/` into `android/app/src/main/assets/web/`, which is the default Android asset path. The native bridge is arm64-only, so install the APK on an arm64 Android device or arm64 emulator image, not the default x86_64 emulator.
2. **A real Board device.** Serve the built `dist/` from anywhere, point the device's browser or WebView host app at the URL.

## Build

```bash
npm run build
```

Outputs to `dist/`. `vite.config.ts` uses `base: "./"` so the built HTML works whether it's loaded via `file://` from Android assets or served from any subpath.

## What's in `src/main.ts`

| Section | Shows |
|---|---|
| `renderStatus()` | Reading `Board.isOnDevice`, `Board.sdkVersion`, `Board.bridgeVersion`. |
| `wireTouchCanvas()` | Subscribing to `Board.input`, drawing finger + piece contacts, using orientation. |
| `wireSession()` | Listing players, presenting the add-player selector, opening the profile switcher. |
| `wireSaves()` | Listing saves, creating a throwaway save with `TextEncoder`. |
| `wirePauseMenu()` | Configuring the system pause menu with custom buttons and audio tracks, polling for results. |

## Linking the SDK

`package.json` references the SDK via `file:../vendor/harrishill-board-sdk-0.1.0.tgz`, so `npm install` uses the tarball in ../vendor.

If you're running this web app outside the scaffold, copy the tarball alongside it and update the relative `file:` path, or replace it with a published package version when one is available.
