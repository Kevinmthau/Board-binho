# AGENTS.md

This repository targets **Board Binho**, a tabletop game platform project built on **Unity + Android** with the **Board Unity SDK**.

## What to assume

- This project uses the **Board Unity SDK**
- Treat this as a **Unity Android** project, not a desktop Unity project
- Prefer Board SDK APIs and patterns whenever Board functionality exists
- Use the Board docs root: `https://docs.dev.board.fun`

## Non-negotiable Board setup rules

Verify these before deeper debugging:

- **Unity**: `2022.3 LTS` or later. Unity 6 is supported.
- **Platform**: `Android`
- **Minimum API Level**: `Android 13 / API 33`
- **Target API Level**: `Android 13 / API 33`
- **Scripting Backend**: `IL2CPP`
- **Architecture**: `ARM64`
- **Input System**: Unity Input System `1.7.0+` enabled
- **Orientation**: `Landscape Left` only
- **Unity 6 Entry Point**: `Activity`, not `Game Activity`

## First thing to do in a fresh Board project

1. Run `Board > Configure Unity Project...`
2. Click `Apply Selected Settings`
3. Restart the editor if prompted by Input System changes
4. Open `Edit > Project Settings > Board > Input Settings`
5. Click `Load Available Models`
6. Select and download the correct piece-set model

## Required namespaces

Use:

```csharp
using Board.Core;
using Board.Input;
using Board.Session;
using Board.Save;
```

Do not use:

```csharp
using Board;
```

## Core Board rules

- Read contacts from `BoardInput.GetActiveContacts(...)`
- Track live piece instances by `contactId`, not `glyphId`
- Treat `glyphId` as a piece type identifier, not a unique instance id
- Use `BoardUIInputModule` for runtime UI interaction on Board hardware
- Use `BoardSession` for player/session flows
- Use `BoardSaveGameManager` for save integration
- Use `BoardApplication` for pause flow integration
- Set `Application.targetFrameRate = 60` unless there is a documented reason not to

## Repo-specific placeholders

- Android package id: `com.defaultcompany.boardbinho`
- App bundle id for launch examples: `com.defaultcompany.boardbinho`
- Unity build helper: `Assets/Editor/BinhoBuild.cs`
- Output APK path: `Builds/Android/BoardBinho.apk`
- Current piece model: `thrasos_arcade_v1.0.2.tflite`

## Build and deploy loop

```bash
bdb status
bdb install Builds/Android/BoardBinho.apk
bdb launch com.defaultcompany.boardbinho
bdb logs com.defaultcompany.boardbinho
bdb stop com.defaultcompany.boardbinho
```

## Default completion behavior

- After making code or content changes for this repo, finish by building the Android APK and installing it to Board hardware with the repo build helper unless the user explicitly asks not to, or the task is review-only / analysis-only.
- Preferred command: `./scripts/unity_build_android.sh --install`
- If Unity licensing or stale headless editor processes block the build, retry with `./scripts/unity_build_android.sh --clean-stale --install`

## Default git workflow

- For implementation tasks in this repo, automatically create and use a dedicated `git worktree` unless the user explicitly asks to stay in the current checkout.
- Use a branch name with the `codex/` prefix by default when creating that worktree.
- Keep review-only, debugging-only, or analysis-only tasks in the current checkout unless the user asks for isolation anyway.
- If the user has already prepared the correct branch or worktree, continue there instead of creating another one.

## Debug order

1. Verify Board project setup
2. Verify the correct piece model is installed and selected
3. Verify `BoardUIInputModule` if UI is involved
4. Reproduce in the simulator
5. Reproduce on hardware
6. Compare behavior to the Board sample scene
7. Only then conclude the bug is in gameplay code
