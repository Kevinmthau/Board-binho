# Board Binho Web App

This directory contains the Vite and TypeScript game source.

## Browser Preview

```bash
npm ci
npm run dev
```

`Board.isOnDevice` remains false in the browser. Simulated defenders and
pointer swipes provide preview input without faking the Board bridge.

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
