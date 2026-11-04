# Flick Soccer Web App

This directory contains the Vite and TypeScript game source.

## Browser Preview

```bash
npm ci
npm run dev
```

Click to place four Sports defenders on each half, or choose **Auto setup**.
Drag a piece to reposition it. Hover over it and press R to turn it.
Drag from the ball to shoot. The browser uses pointer input and draws the
Sports pieces. Board hardware uses the physical pieces and SDK finger input.

After the Board pause menu closes, a piece can acquire a new contact ID while
the SDK still reports its old one. During setup, the game counts a possible
replacement once while the tracker settles. A confirmed restart retires the
old ID. Otherwise, a sensor frame after 900 ms can count both IDs if they are
still active.

Run `npx playwright install chromium` once, then `npm test` to exercise the
production build in Chromium. The Board input tests feed sensor frames through
the vendored SDK using a test host.

## Board Package

Run the repository build script from the project root:

```bash
./scripts/build_webapp.sh
```

It builds this directory, includes `public/model.tflite`, and writes
`Builds/Web/<appId>.webapp.zip`. The relative Vite base must remain `./` so
assets resolve from the Board bundle root.

The Board Studio SDK payload is vendored at
`../vendor/board.fun-web-sdk-1.0.0-beta.6.tgz` and installed as
`@board.fun/web-sdk`.

## Asset credits

The physics engine is [Matter.js](https://brm.io/matter-js/). Its MIT license is
included in the bundled JavaScript. The goal sound is an excerpt of
[Crowd Cheer 5 by Krizin](https://freesound.org/people/Krizin/sounds/651646/),
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
The game ships the audio and its credit locally.

The complete provenance, font changes, and local license paths are recorded
in `../docs/ASSET-MANIFEST.md`.
