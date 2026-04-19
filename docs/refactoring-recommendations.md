# Refactoring Recommendations — Board Binho

## Context

The game's entire runtime logic lives in a single 1,143-line god-object
(`Assets/Scripts/Binho/BinhoGameController.cs`) that mixes field construction,
runtime-asset generation, Board SDK input, physics/state, goal detection,
defender placement, and a legacy `OnGUI` HUD. This file is approaching the
point where adding features — e.g. a proper aim indicator, power-ups, match
timers, analytics — requires editing an already-hard-to-reason-about class.

The goal of this document is to present a prioritized set of refactoring
recommendations that reduce coupling, make the core game-logic unit testable,
and align the codebase with Board SDK conventions in `AGENTS.md`. Nothing else
in the repo (the two small Editor scripts) needs structural change; this doc
is focused on the controller.

**Deliverable:** this recommendations document. No code changes are being made
as part of this task.

---

## Files Reviewed

- `Assets/Scripts/Binho/BinhoGameController.cs` (1,143 lines) — primary target
- `Assets/Editor/BinhoBuild.cs` (45 lines) — fine as-is
- `Assets/Editor/BinhoProjectBootstrap.cs` (80 lines) — fine as-is
- `AGENTS.md` — Board SDK conventions to honor

---

## Top-Level Diagnosis

`BinhoGameController` does ~7 distinct jobs in one MonoBehaviour:

1. Runtime resource generation (procedural textures, sprites, materials) —
   lines 206–261
2. Playfield construction (walls, lines, slots, ball) — lines 263–512,
   1001–1091
3. Field geometry / camera-aspect scaling — lines 14–124
4. Board + mouse swipe input handling — lines 613–792
5. Ball physics, settle detection, turn completion — lines 794–863
6. Goal detection and scoring — lines 865–905
7. Legacy `OnGUI` HUD — lines 179–204

28 instance fields, no tests possible without a full Unity play session, and
no separation between "build the field once" vs. "tick the match".

---

## Recommended Refactors (Prioritized)

### P1 — High impact, low risk

#### R1. Extract `FieldGeometry` (pure helper)
- **What:** Move the constants (L14–46), the scale properties (L79–109), and
  `ScaleX/ScaleY/Scale` (L111–124) into a standalone `FieldGeometry` class
  that takes a `Camera` in its constructor.
- **Why:** Every later refactor needs these values. Today they're only
  reachable via the god-object's private members.
- **Shape:** plain C# class, no `MonoBehaviour`. Exposes `PitchHalfWidth`,
  `BallRadius`, `GoalHalfHeight`, `MinSwipeSpeed`, etc.

#### R2. Extract `BinhoFieldBuilder`
- **What:** Move `EnsureRuntimeResources` (L206–261), `BuildPlayfield`
  (L263–278), `BuildWalls` (L280–302), `BuildFieldLines` (L304–366),
  `BuildSlots` (L368–389), `ConfigureCamera` (L391–402), `BuildBall`
  (L404–454), `CreateSlot` (L456–512), and the `CreateWall/Quad/Disc/Line/
  CircleLine/RectangleLine` primitives (L1001–1091) into a builder.
- **Why:** Removes ~600 lines of one-shot construction code from the runtime
  class. The controller goes from "field + match" to just "match".
- **Shape:** `Build(Transform root, FieldGeometry geom)` returns a
  `PlayfieldRefs { Rigidbody2D ball; IReadOnlyList<DefenderSlot> leftSlots;
  IReadOnlyList<DefenderSlot> rightSlots; LineRenderer aimLine; }`.

#### R3. Extract `MatchStateMachine`
- **What:** Move the `MatchPhase` enum (L1099–1106), the phase field, the
  `GoalPause` timer logic (L155–165), `UpdateMatchPhaseFromPlacements`
  (L587–611), turn-flip logic in `CompleteShotTurn` (L814–825), and the score
  counters (L69–70) into a state machine.
- **Why:** Phase transitions are currently scattered across Update,
  FixedUpdate, LaunchShot, and RegisterGoal. A single class with
  `BallLaunched()`, `BallRested()`, `GoalScored(side)`, `SlotsFilled()`,
  `SlotsEmptied()` makes the game flow self-documenting and reviewable.
- **Shape:** plain class with `CurrentPhase`, `CurrentTurn`, `LeftScore`,
  `RightScore`, and events `PhaseChanged`, `GoalPauseEnded`.

### P2 — Isolate the interesting game logic so it's testable

#### R4. Extract `DefenderSlotManager`
- **What:** Move `m_LeftSlots/m_RightSlots/m_AllSlots` (L51–53),
  `UpdateDefenderPlacements` (L514–540), `AssignSlots` (L542–585),
  `CountOccupied` (L970–982), `AllSlotsOccupied` (L984–987) into a manager.
- **Why:** The greedy assignment in `AssignSlots` has subtle rules
  (per-side filtering, `SlotSnapRadius` clamp, first-best wins) — testing
  those today requires a full scene.
- **Shape:** `UpdatePlacements(ReadOnlySpan<BoardContact>)`, `AllOccupied`,
  `AnyChanged` event. Visual update stays on `DefenderSlot` via
  `SetOccupied`.

#### R5. Extract `ShotInputHandler`
- **What:** Move `m_BoardSwipeContacts` / `m_ExpiredBoardSwipeContacts`
  (L54–55), mouse tracking fields (L71–72, L76–77), `UpdateShotInput`
  (L613–626), `HandleBoardFingerShotInput` (L628–684), `HandleMouseShotInput`
  (L686–720), `CancelActiveShot` (L722–731), `TryLaunchSwipe` (L763–792),
  and the static `DistanceFromPointToSegment` helper (L950–963) into an
  input handler.
- **Why:** 57-line `HandleBoardFingerShotInput` is the single biggest method
  and mixes three concerns: tracking new contacts, detecting swipes, pruning
  expired contacts. Extracting cleans up `Update()` to a three-line dispatch.
- **Shape:** fires `event Action<Vector2> ShotFired` with the impulse vector.
  The controller subscribes and forwards to `BallPhysicsController.Launch`.
- **Bonus:** makes mouse fallback trivially mockable for editor play.

#### R6. Extract `BallPhysicsController`
- **What:** Move `m_BallBody/m_BallRenderer` (L62–63), `m_BallStillTimer`
  (L73), `LaunchShot` (L794–807), `IsBallSlowEnoughForNextShot` (L809–812),
  `UpdateBallMotionState` (L837–863), `ResetBallToCenter` (L907–918),
  `StopBall` (L920–929).
- **Why:** "Is the ball at rest?" is the core trigger for turn completion and
  today lives entangled with phase checks. Isolating it gives a clean
  `OnRested` event.
- **Shape:** `Launch(Vector2 impulse)`, `ResetToCenter()`,
  `event Action Rested`. Ticks from `FixedUpdate`.

#### R7. Extract `GoalDetector`
- **What:** Move `CheckForGoal` (L865–886) and the firing half of
  `RegisterGoal` (L888–905) into a detector that takes `FieldGeometry` +
  `Rigidbody2D`.
- **Why:** Pure function on ball position + field geometry. Trivially
  testable once decoupled.
- **Shape:** `event Action<PlayerSide> GoalScored`; controller routes into
  `MatchStateMachine.GoalScored`.

### P3 — Polish

#### R8. Replace `OnGUI` HUD with UGUI Canvas
- **What:** Lines 179–204 use `OnGUI` + per-frame `GUIStyle` allocation. Swap
  for a Canvas + TextMeshPro `ScoreboardView` bound to `MatchStateMachine`
  events.
- **Why:** `OnGUI` runs multiple times per frame, allocates a `GUIStyle` each
  pass, and can't be themed to match the Board hardware output. Also avoids
  screen-aware font math (L184, L192).

#### R9. Hoist magic numbers into a `[SerializeField] BinhoTuning` asset
- **What:** Ball damping `0.85f/1.5f` (L426–427), ball mass `0.9f` (L425),
  slot alphas `0.08f/0.16f/0.4f/0.92f` (L1123–1124), bumper-core scale
  `0.55f` (L479), shadow scale `2.25f` (L407). Expose via a
  `ScriptableObject` so designers can iterate without recompiles.
- **Why:** Tuning a physics/feel game through recompiles is slow and the
  values are currently hidden deep in construction code.

#### R10. Rename for clarity (low-priority, do inside other refactors)
- `kFieldLineInset` → `kFieldLineMarginFromBoundary`
- `m_BallStillTimer` / `kBallRestTime` → `m_BallRestElapsed` /
  `kBallRestSettleTime` (the existing pair collides with `kBallRestVelocity`
  and reads ambiguously)
- `m_DidServeInitialKickoff` → `m_HasKickedOff`
- `m_HandledBoardShotThisFrame` → disappears once input moves behind an
  event (see R5)
- `SlotFill` / `SlotOutline` → `BackgroundRenderer` / `BorderLine`

---

## Board SDK Compliance Check

Spot-verified the controller against `AGENTS.md` — already compliant:

- `BoardInput.GetActiveContacts(BoardContactType.Glyph)` at L516
- `BoardInput.GetActiveContacts(BoardContactType.Finger)` at L630
- Tracks by `contactId`, not `glyphId` (L523, L640)
- `BoardApplication.UpdatePauseScreenContext` at L129
- `Application.targetFrameRate = 60` at L128

No SDK-level changes recommended. Keep these call sites intact while
extracting — just move them to `DefenderSlotManager` and `ShotInputHandler`.

---

## Post-Refactor Shape

`BinhoGameController` becomes a thin orchestrator (~150 lines) that:

1. In `Awake`: builds a `FieldGeometry`, runs `BinhoFieldBuilder`, wires up
   `DefenderSlotManager`, `ShotInputHandler`, `BallPhysicsController`,
   `GoalDetector`, and `MatchStateMachine`.
2. In `Update`: ticks slot manager + input handler + state machine.
3. In `FixedUpdate`: ticks ball physics + goal detector.
4. Holds only serialized inspector refs (`m_WorldCamera`,
   `m_EnableMouseFallback`, the new `BinhoTuning` asset).

Each extracted class gets its own `.cs` file under `Assets/Scripts/Binho/`
(e.g. `Match/MatchStateMachine.cs`, `Input/ShotInputHandler.cs`,
`Physics/BallPhysicsController.cs`, `Field/BinhoFieldBuilder.cs`).

---

## Suggested Sequencing

Do these in order so each step stays green in the editor:

1. R1 `FieldGeometry` (no behavior change, just relocation)
2. R2 `BinhoFieldBuilder` (one-time setup code; big LOC drop)
3. R3 `MatchStateMachine` (unlocks event-driven wiring)
4. R6 `BallPhysicsController` + R7 `GoalDetector` (both feed state machine)
5. R4 `DefenderSlotManager` + R5 `ShotInputHandler`
6. R8 UGUI HUD (optional, standalone)
7. R9 tuning asset + R10 renames (cleanup pass)

After R1–R3 the controller is already half its current size and readable;
the rest is high-value but not blocking.

---

## Verification

After each step, since the project is Unity + Board hardware:

1. Open `Assets/Scenes/BinhoBoard.unity` and confirm the scene still renders
   with no missing-script warnings.
2. Run `./scripts/unity_build_android.sh` and confirm a clean build.
3. Install + smoke-test on Board hardware: `./scripts/unity_build_android.sh
   --install` — verify (a) field renders, (b) 10 glyphs snap into slots,
   (c) a finger swipe launches the ball, (d) a goal increments score and
   triggers the pause, (e) turns alternate correctly.
4. Once extracted classes are pure C# (R1, R3, R6, R7), add Edit-mode tests
   under `Assets/Tests/` — e.g. `MatchStateMachineTests` covering
   `GoalScored` → `GoalPause` → next turn transitions without needing a
   scene.
