# Board Binho

Board Binho is a Board console prototype inspired by the physical Binho soccer-flick game.

The project recreates the field from a top-down view and uses Board piece detection to place five stationary defender pieces per side before play begins. During the match, players flick a digital ball, bank shots off the walls and defender pieces, and try to score into the opposing goal.

## Project notes

- Engine: Unity 6
- Target platform: Android / Board console
- Board package id: `com.defaultcompany.boardbinho`
- Main scene: `Assets/Scenes/BinhoBoard.unity`

## Open the project

1. Open the folder in Unity.
2. Confirm the Board SDK project settings are applied.
3. Open `Assets/Scenes/BinhoBoard.unity`.

## Build for Board

Use the editor menu item `Binho > Build Android APK` or the command-line build entry point in `Assets/Editor/BinhoBuild.cs`.
