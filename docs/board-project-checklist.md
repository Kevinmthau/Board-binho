# Board Binho Board Project Checklist

## Project Identity

- Game name: `Board Binho`
- Package id: `com.defaultcompany.boardbinho`
- Bundle id for launch commands: `com.defaultcompany.boardbinho`
- Piece model: `thrasos_arcade_v1.0.2.tflite`
- Build helper: `Assets/Editor/BinhoBuild.cs`
- APK output path: `Builds/Android/BoardBinho.apk`

## First-Run Setup

- Run `Board > Configure Unity Project...`
- Click `Apply Selected Settings`
- Restart the editor if prompted
- Open `Edit > Project Settings > Board > Input Settings`
- Click `Load Available Models`
- Download and select the correct `.tflite` piece-set model

## Required Project Settings

- Unity `2022.3 LTS` or later
- Platform `Android`
- Minimum API Level `33`
- Target API Level `33`
- Scripting Backend `IL2CPP`
- Architecture `ARM64`
- Input System `1.7.0+`
- Orientation `Landscape Left`
- Unity 6 entry point `Activity`

## Runtime Checks

- `Application.targetFrameRate = 60`
- `BoardUIInputModule` is installed on the active `EventSystem`
- Board piece state is keyed by `contactId`
- UI logic does not rely on mouse-only assumptions
- Save flow uses Board save APIs
- Pause flow uses Board application integration

## Build And Deploy

```bash
bdb status
bdb install Builds/Android/BoardBinho.apk
bdb launch com.defaultcompany.boardbinho
```
