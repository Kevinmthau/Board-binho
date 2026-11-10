import {
  Board,
  BoardContactPhase,
  BoardContactType,
  type BoardContact,
} from "@board.fun/web-sdk";
import Matter from "matter-js";
import { subscribeToBoardFrames, type BoardFrameChanges, type FingerTrace } from "./board-input";
import { cancelBoardControls, routeBoardControls, wireNativeClicks } from "./board-controls";
import { MatchScreens, byId } from "./screens";
import { ShotLesson } from "./shot-lesson";
import { GAME_NAME, readLocal, writeLocal } from "./match-settings";
import { BOARD_HEIGHT, BOARD_WIDTH, FIELD_WORLD_HEIGHT, createSportsBumper, sportsPieces, type SportsPiece } from "./sports";

type Vec = {
  x: number;
  y: number;
};

type PlayerSide = "left" | "right";
type MatchPhase = "setup" | "readyToShoot" | "ballInMotion" | "goalPause";

type DefenderContact = {
  contactId: number;
  piece: SportsPiece;
  position: Vec;
  angle: number;
};

type Defender = {
  side: PlayerSide;
  piece: SportsPiece;
  body: Matter.Body;
};

type BoardRecovery = {
  baseline: Map<number, DefenderContact>;
  countsBeforePause: Record<PlayerSide, number>;
  displaced: Map<number, number>;
  pendingIds: Set<number>;
  confirmedBeforeFocus: Set<number>;
  renewals: Map<number, { at: number; side?: PlayerSide; replacementId?: number }>;
  setupCandidates: Map<number, {
    at: number; contact: DefenderContact; originals: Array<{ id: number; side?: PlayerSide }>;
  }>;
  incompleteAtStart: boolean;
  occupiedSides: Set<PlayerSide>;
  rosterSize: number;
  fromPause: boolean;
  continuityConfirmed: boolean;
};

type SwipeSample = {
  position: Vec;
  timestamp: number;
};

type SwipeContactState = {
  samples: SwipeSample[];
  peakSpeed: number;
  peakVelocity: Vec;
  lastWindowedSpeed: number;
  armedAt: number | null;
};

type Layout = {
  cssWidth: number;
  cssHeight: number;
  pixelScale: number;
  fieldBackgroundWidth: number;
  fieldBackgroundHeight: number;
  pitchHalfWidth: number;
  pitchHalfHeight: number;
  uniformScale: number;
  wallThickness: number;
  ballRadius: number;
  ballSwipeCaptureRadius: number;
  minSwipeTravelDistance: number;
  minSwipeSpeed: number;
  maxSwipeSpeed: number;
  minShotImpulse: number;
  maxShotImpulse: number;
  ballRestVelocity: number;
  goalMouthTopY: number;
  goalMouthBottomY: number;
  goalTunnelDepth: number;
  goalScoreLineX: number;
};

const FIELD_WIDTH = 16;
const FIELD_HEIGHT = 9;
const FIELD_SCREEN_FILL = 0.94;
const FIELD_BACKGROUND_ASPECT = BOARD_WIDTH / BOARD_HEIGHT;
const GOAL_MOUTH_TOP_PIXEL_Y = 374;
const GOAL_MOUTH_BOTTOM_PIXEL_Y = 704;
// Outer edges of the small white boxes in field_background.png.
const GOAL_BOX_PIXEL_BOUNDS = {
  left: { min: { x: 0, y: 373 }, max: { x: 136, y: 706 } },
  right: { min: { x: 1780, y: 373 }, max: { x: BOARD_WIDTH, y: 706 } },
};
const DEFENDERS_PER_SIDE = 4;
const REDETECTION_WINDOW_MS = 900;
const BOARD_RESUME_GRACE_MS = 250;
const OFF_BOARD_GOAL_CLEARANCE = 0.22;
const WALL_THICKNESS = 0.22;
const GOAL_DEPTH = 0.9;
const BALL_RADIUS = 0.2;
const BALL_SWIPE_CAPTURE_RADIUS = 0.55;
const MIN_SWIPE_TRAVEL_DISTANCE = 0.05;
const MIN_SWIPE_SPEED = 2.5;
const MAX_SWIPE_SPEED = 22;
const MIN_SHOT_IMPULSE = 2.4;
const MAX_SHOT_IMPULSE = 14.5;
const BALL_REST_VELOCITY = 0.35;
const BALL_REST_TIME = 0.1;
const SWIPE_SAMPLE_WINDOW_SECONDS = 0.06;
const SWIPE_LATCH_TIMEOUT_SECONDS = 0.016;
const SWIPE_PEAK_HOLD_RATIO = 0.97;
const GOAL_PAUSE_DURATION = 1.15;
const FIXED_STEP_MS = 1000 / 60;
const PHYSICS_SUBSTEPS = 4;
const BOUNDARY_RESTITUTION = 0.94;
const DEFENDER_RESTITUTION = 0.94;
const FIELD_IMAGE_URL = "assets/field_background.png";
const GOAL_CHEER_AUDIO_URL = "assets/crowd-cheer.mp3";
const GOAL_CHEER_VOLUME = 0.85;
const MATTER_SHOT_VELOCITY_SCALE = 0.035;

const FIELD_EDGE_COLOR = "#071f0d";
const BACKGROUND_COLOR = "#e5ebe7";
const LEFT_COLOR = "#38bdf8";
const RIGHT_COLOR = "#f6a638";
const BALL_COLOR = "#fbfbfa";
const SHADOW_COLOR = "rgba(0, 0, 0, 0.2)";

const canvas = getElement<HTMLCanvasElement>("game-canvas");
const ctx = get2dContext(canvas);
const seatHud = {
  left: getSeatHud("blue"),
  right: getSeatHud("orange"),
};

const autoSetupButton = getElement<HTMLButtonElement>("auto-setup-button");
const resetButton = getElement<HTMLButtonElement>("reset-button");

const engine = Matter.Engine.create({ enableSleeping: false });
engine.gravity.x = 0;
engine.gravity.y = 0;

let layout = createLayout();
// Placement queries only: these rectangles never enter the physics world.
const goalBoxes = { left: createGoalBox("left"), right: createGoalBox("right") };
let ballBody: Matter.Body | null = null;
let ballInPlay = true;
let lastFrameTimestamp = performance.now();
let accumulatorMs = 0;
let suspended = document.hidden;
let windowBlurred = false;
let nativeSurfacePaused = false;
let surfaceCancellation: { remaining: Set<number>; startedAt: number } | null = null;
let resumeShotAt = 0;
let lastBoardResumeAt = -Infinity;
let lastBoardInputAt = -Infinity;
let phase: MatchPhase = "setup";
let currentTurn: PlayerSide = "left";
let lastScoringSide: PlayerSide = "left";
let leftScore = 0;
let rightScore = 0;
let ballStillTimer = 0;
let goalPauseTimer = 0;
let didPrepareInitialKickoff = false;
let didServeInitialKickoff = false;
let fieldImageLoaded = false;

const fieldImage = new Image();
fieldImage.onload = () => {
  fieldImageLoaded = true;
};
fieldImage.src = FIELD_IMAGE_URL;

const goalCheerAudio = new Audio(GOAL_CHEER_AUDIO_URL);
goalCheerAudio.preload = "auto";
goalCheerAudio.volume = GOAL_CHEER_VOLUME;
let cheerPausedWithMatch = false;

const defenders = new Map<number, Defender>();
const boardSwipeContacts = new Map<number, SwipeContactState>();
let latestBoardGlyphs = new Map<number, DefenderContact>();
let liveBoardContactIds = new Set<number>();
let boardRecovery: BoardRecovery | null = null;
// A provisional replacement yields its slot if the tracker confirms that the
// incumbent contact is still present. A confirmed tracker reset has no such slot.
const staleBoardIds = new Map<number, { replacementId?: number; side: PlayerSide; setupDeadline?: number } | null>();
const simulatedContacts = new Map<number, DefenderContact>();
const previewArt = new Map<number, HTMLImageElement>();
const pointerSwipeContacts = new Map<number, SwipeContactState>();
const pointerDefenderDrags = new Map<number, number>();
const ballTrail: Vec[] = [];

let nextSimulatedContactId = 1000;
let screens: MatchScreens;
let lesson: ShotLesson | undefined;
let flipped = false;
let rosterPollAt = 0;
let soundLevel = clamp(Number(readLocal("volume", 75)), 0, 100);
const pieceAngles = new Map<number, number>();
let visiblePieceIds = new Set<number>();
const cueAudio = { piece: new Audio("./sfx/piece.ogg"), flick: new Audio("./sfx/flick.ogg") };
goalCheerAudio.volume = GOAL_CHEER_VOLUME * soundLevel / 100;

document.body.classList.toggle("board-device", Board.isOnDevice);
document.body.classList.toggle("browser-preview", !Board.isOnDevice);

screens = new MatchScreens({ start: startMatch, flip: flipTable, changed: screenChanged });
resize();
buildPhysicsWorld();
wireControls();
wirePointerFallback();
wireBoard();
syncSuspension();
requestAnimationFrame(frame);

function wireControls(): void {
  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", () => { windowBlurred = true; syncSuspension(); });
  window.addEventListener("pageshow", () => { windowBlurred = false; nativeSurfacePaused = false; syncSuspension(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) nativeSurfacePaused = false;
    syncSuspension();
  });
  window.addEventListener("blur", () => {
    windowBlurred = true;
    syncSuspension();
  });
  window.addEventListener("focus", () => {
    windowBlurred = false;
    nativeSurfacePaused = false;
    syncSuspension();
  });
  autoSetupButton.addEventListener("click", autoSetupDefenders);
  resetButton.addEventListener("click", resetMatch);
  document.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("button")) cue("piece", .24);
  });
}

function cue(kind: keyof typeof cueAudio, gain: number) {
  if (windowBlurred || document.hidden || nativeSurfacePaused || soundLevel === 0) return;
  const audio = cueAudio[kind];
  audio.currentTime = 0;
  audio.volume = gain * soundLevel / 100;
  audio.playbackRate = kind === "piece" ? .94 + Math.random() * .12 : 1;
  void audio.play().catch(() => {});
}

function screenChanged() {
  if (!screens) return;
  CancelActiveShot();
  pointerDefenderDrags.clear();
  lesson?.cancelFingers();
  accumulatorMs = 0;
  lastFrameTimestamp = performance.now();
  document.body.classList.toggle("match-menu-open", !screens.playing);
  syncSuspension();
  configureBoardMenu();
}

function startMatch(teach: boolean) {
  // A new match cannot consume a native resume as a duplicate of player selection.
  lastBoardResumeAt = -Infinity;
  lesson = teach ? new ShotLesson(() => {
    screens.tutorialComplete();
    lesson = undefined;
    document.body.classList.remove("tutorial");
    byId("coach").hidden = true;
    resetMatch();
  }) : undefined;
  document.body.classList.toggle("tutorial", teach);
  byId("coach").hidden = !teach;
  visiblePieceIds.clear();
  resetMatch();
}

function flipTable() {
  if (!screens.playing) return;
  flipped = !flipped;
  byId("match-surface").classList.toggle("flipped", flipped);
  byId("flip").setAttribute("aria-pressed", String(flipped));
  CancelActiveShot();
  lesson?.cancelFingers();
  pointerDefenderDrags.clear();
  if (Board.isOnDevice) {
    // The glass did not move. Reproject stationary pieces as soon as the view turns.
    const opposite = (side: PlayerSide): PlayerSide => side === "left" ? "right" : "left";
    const mirror = (contact: DefenderContact): DefenderContact => ({
      ...contact, position: scaleVector(contact.position, -1), angle: contact.angle + Math.PI,
    });
    latestBoardGlyphs = new Map([...latestBoardGlyphs].map(([id, contact]) => [id, mirror(contact)]));
    for (const defender of defenders.values()) {
      defender.side = opposite(defender.side);
      Matter.Body.setPosition(defender.body, scaleVector(defender.body.position, -1));
      Matter.Body.setAngle(defender.body, defender.body.angle + Math.PI);
    }
    for (const substitute of staleBoardIds.values()) if (substitute) substitute.side = opposite(substitute.side);
    if (boardRecovery) {
      boardRecovery.baseline = new Map([...boardRecovery.baseline].map(([id, contact]) => [id, mirror(contact)]));
      const counts = boardRecovery.countsBeforePause;
      boardRecovery.countsBeforePause = { left: counts.right, right: counts.left };
      boardRecovery.occupiedSides = new Set([...boardRecovery.occupiedSides].map(opposite));
      for (const renewal of boardRecovery.renewals.values()) if (renewal.side) renewal.side = opposite(renewal.side);
      for (const candidate of boardRecovery.setupCandidates.values()) {
        candidate.contact = mirror(candidate.contact);
        for (const original of candidate.originals) if (original.side) original.side = opposite(original.side);
      }
    }
    updateDefenders(latestBoardGlyphs);
  }
}

function syncSuspension(): void {
  const foregroundLost = windowBlurred || document.hidden || nativeSurfacePaused;
  document.body.classList.toggle("foreground-paused", foregroundLost);
  if (foregroundLost) {
    cancelBoardControls();
    for (const audio of Object.values(cueAudio)) audio.pause();
  }
  setSuspended(foregroundLost || !screens.playing);
}

function setSuspended(value: boolean): void {
  if (suspended === value) return;
  suspended = value;
  surfaceCancellation = null;
  document.body.classList.toggle("match-suspended", value);
  if (value) {
    cancelBoardControls();
    lesson?.cancelFingers();
    for (const audio of Object.values(cueAudio)) audio.pause();
    cheerPausedWithMatch = !goalCheerAudio.paused && !goalCheerAudio.ended;
    if (cheerPausedWithMatch) goalCheerAudio.pause();
  } else if (cheerPausedWithMatch) {
    cheerPausedWithMatch = false;
    playGoalCheer(false);
  }
  CancelActiveShot();
  pointerDefenderDrags.clear();
  lastFrameTimestamp = performance.now();
  accumulatorMs = 0;
  if (Board.isOnDevice) {
    if (value) {
      // New IDs can precede the native menu result. Keep that cohort only if
      // its evidence is recent enough to belong to this interruption.
      if (boardRecovery && !boardRecovery.fromPause && [
        ...boardRecovery.renewals.values(), ...boardRecovery.setupCandidates.values(),
      ].some(({ at }) => lastFrameTimestamp - at <= REDETECTION_WINDOW_MS)) {
        boardRecovery.fromPause = true;
        finishMenuReconciliation(lastFrameTimestamp);
      } else {
        boardRecovery = createBoardRecovery(true);
      }
    } else {
      lastBoardResumeAt = lastFrameTimestamp;
      if (boardRecovery?.fromPause) {
        // Old tracker updates can continue while the WebView is blurred.
        // A fresh cohort after focus must be able to supersede those IDs.
        for (const id of boardRecovery.confirmedBeforeFocus) boardRecovery.pendingIds.add(id);
        boardRecovery.continuityConfirmed = false;
        finishMenuReconciliation(lastFrameTimestamp);
      }
      if (phase === "ballInMotion") resumeShotAt = lastFrameTimestamp + BOARD_RESUME_GRACE_MS;
    }
  }
}

function finishMenuReconciliation(now: number): void {
  if (!boardRecovery) return;
  const restarted = trackerRestartConfirmed(boardRecovery, now);
  reconcileSetupCandidates(boardRecovery, latestBoardGlyphs, now, restarted);
  if (!restarted) {
    updateDefenders(latestBoardGlyphs);
    return;
  }
  // The menu callback has no new sensor samples. Keep previously retired
  // IDs suppressed and retire only the remaining unconfirmed contacts.
  for (const id of boardRecovery.pendingIds) {
    staleBoardIds.set(id, null);
    latestBoardGlyphs.delete(id);
    liveBoardContactIds.delete(id);
  }
  for (const id of boardRecovery.renewals.keys()) {
    if (staleBoardIds.has(id)) staleBoardIds.set(id, null);
  }
  boardRecovery = null;
  updateDefenders(latestBoardGlyphs);
}

function configureBoardMenu(): void {
  if (!Board.isOnDevice) return;
  Board.pause.setContext({
    gameName: GAME_NAME,
    offerSaveOption: false,
    audioTracks: [{ id: "effects", name: "Sound effects", value: soundLevel }],
    customButtons: screens?.screen === "match" ? [
      { id: "restart", title: "Restart Match", icon: "circular_arrow" },
      { id: "modes", title: "Back to Mode Select", icon: "left_arrow" },
      { id: "help", title: "How to Play", icon: "question_mark" },
    ] : [],
  });
}
function wireBoard(): void {
  if (!Board.isOnDevice) return;
  configureBoardMenu();
  wireNativeClicks();
  subscribeToBoardFrames(handleBoardContacts);

  Board.pause.onResult((result) => {
    const volume = result.audioTracks?.find((track) => track.id === "effects");
    if (volume) {
      soundLevel = clamp(volume.value, 0, 100);
      writeLocal("volume", soundLevel); goalCheerAudio.volume = GOAL_CHEER_VOLUME * soundLevel / 100;
      configureBoardMenu();
    }
    if (result.action === "quit" || result.action === "save_and_quit") {
      Board.application.quit();
      return;
    }
    // The menu result may be the only lifecycle signal from the WebView.
    if (performance.now() - lastBoardResumeAt > BOARD_RESUME_GRACE_MS) setSuspended(true);
    windowBlurred = false;
    nativeSurfacePaused = false;
    syncSuspension();
    if (result.action === "custom_button" && result.customButtonId) screens.menu(result.customButtonId);
  });
}

function handleBoardContacts(contacts: readonly BoardContact[], reported: BoardFrameChanges): void {
  const wasPlaying = screens.playing;
  const buttons = windowBlurred || document.hidden || nativeSurfacePaused ? new Set<number>() : routeBoardControls(reported);
  const next = new Map<number, DefenderContact>();
  const fingerContacts: BoardContact[] = [];
  const now = performance.now();
  // A native menu can interrupt sensor frames without blurring the WebView.
  // Gestures need consecutive samples even if a late release is explicit.
  const frameSeconds = (now - lastBoardInputAt) / 1000;
  if (frameSeconds > SWIPE_SAMPLE_WINDOW_SECONDS) boardSwipeContacts.clear();
  lastBoardInputAt = now;
  updateBoardSuspension(contacts, reported, now);
  const previousLiveIds = liveBoardContactIds;
  liveBoardContactIds = new Set<number>();
  for (const contact of contacts) {
    if (!isSwipeContactPhase(contact.phase)) continue;
    if (isActiveContactPhase(contact.phase)) liveBoardContactIds.add(contact.contactId);
    const piece = sportsPieces.get(contact.glyphId);
    if (contact.type === BoardContactType.Glyph && piece && isActiveContactPhase(contact.phase)) {
      if (!pieceAngles.has(contact.contactId) || reported.get(contact.contactId)?.began || contact.isTouched) {
        pieceAngles.set(contact.contactId, -contact.orientation * Math.PI / 180);
      }
      next.set(contact.contactId, {
        contactId: contact.contactId,
        piece,
        position: boardContactWorldPosition(contact),
        angle: pieceAngles.get(contact.contactId)! + (flipped ? Math.PI : 0),
      });
    } else if (contact.type === BoardContactType.Finger && contact.glyphId === 0) {
      fingerContacts.push(contact);
    }
  }

  for (const id of pieceAngles.keys()) if (!liveBoardContactIds.has(id)) pieceAngles.delete(id);
  // The last defender can land or lift in the same snapshot as a flick.
  applyBoardRoster(next, reported, previousLiveIds);
  if (suspended || !wasPlaying || !screens.playing) return;
  const gameChanges = buttons.size ? new Map([...reported].filter(([id]) => !buttons.has(id))) : reported;
  if (lesson) {
    for (const [id, change] of gameChanges) for (const trace of change.fingerTraces ?? []) {
      // A canceled gesture in one packet must not fire from its earlier poses.
      if (trace.terminal === BoardContactPhase.Canceled) {
        lesson.finger(id, { x: 0, y: 0 }, "cancel");
        continue;
      }
      for (const [i, p] of trace.points.entries()) lesson.finger(id, logicalPoint(p.x / BOARD_WIDTH, p.y / BOARD_HEIGHT), trace.began && !i ? "down" : "move");
      if (trace.terminal !== undefined) {
        const last = trace.releasePosition ?? trace.points[trace.points.length - 1];
        if (last) lesson.finger(id, logicalPoint(last.x / BOARD_WIDTH, last.y / BOARD_HEIGHT), trace.terminal === BoardContactPhase.Ended ? "up" : "cancel");
        else lesson.finger(id, { x:0, y:0 }, "cancel");
      }
    }
  } else handleBoardFingerShotInput(fingerContacts.filter((finger) => !buttons.has(finger.contactId) && !staleBoardIds.has(finger.contactId)),
    now / 1000, Math.min(frameSeconds, SWIPE_SAMPLE_WINDOW_SECONDS), gameChanges);
}

function updateBoardSuspension(contacts: readonly BoardContact[], reported: BoardFrameChanges, now: number): void {
  const fresh = contacts.filter((contact) => isActiveContactPhase(contact.phase) && reported.has(contact.contactId));
  if (nativeSurfacePaused) {
    if (fresh.length) {
      nativeSurfacePaused = false;
      syncSuspension();
    }
    return;
  }
  if (suspended || (phase !== "ballInMotion" && phase !== "goalPause")) {
    surfaceCancellation = null;
    return;
  }
  if (surfaceCancellation && now - surfaceCancellation.startedAt > BOARD_RESUME_GRACE_MS) surfaceCancellation = null;
  if (!surfaceCancellation) {
    if (liveBoardContactIds.size < 2 || ![...liveBoardContactIds].some((id) => reported.get(id)?.canceled)) return;
    surfaceCancellation = { remaining: new Set(liveBoardContactIds), startedAt: now };
  }
  // The host can tear down the surface over several inference frames. A
  // stationary sample for a remaining ID is consistent with that teardown.
  const { remaining } = surfaceCancellation;
  if (fresh.some((contact) => contact.phase !== BoardContactPhase.Stationary ||
      reported.get(contact.contactId)?.began || !remaining.has(contact.contactId))) {
    surfaceCancellation = null;
    return;
  }
  for (const id of remaining) {
    const change = reported.get(id);
    if (change?.canceled) {
      remaining.delete(id);
    } else if (change?.terminated) {
      surfaceCancellation = null;
      return;
    }
  }
  if (!remaining.size) {
    nativeSurfacePaused = true;
    syncSuspension();
  }
}

function applyBoardRoster(next: Map<number, DefenderContact>, reported: BoardFrameChanges, previousLiveIds = liveBoardContactIds): void {
  const handoffs = new Map<number, DefenderContact>();
  reconcileBoardRoster(next, reported, previousLiveIds, handoffs);
  for (const id of staleBoardIds.keys()) liveBoardContactIds.delete(id);
  // A waiting extra piece cannot take an incumbent's slot during an ID handoff.
  const priority = new Map<number, DefenderContact>();
  for (const contact of handoffs.values()) priority.set(contact.contactId, contact);
  latestBoardGlyphs = priority.size ? new Map([...priority, ...next]) : next;
  updateDefenders(latestBoardGlyphs, reported);
}

function createBoardRecovery(fromPause: boolean, liveIds = liveBoardContactIds): BoardRecovery {
  return {
    baseline: new Map(latestBoardGlyphs), countsBeforePause: { left: countDefenders("left"), right: countDefenders("right") },
    displaced: new Map(),
    pendingIds: new Set(liveIds), confirmedBeforeFocus: new Set(), renewals: new Map(),
    setupCandidates: new Map(), incompleteAtStart: !didServeInitialKickoff && defenders.size < 2 * DEFENDERS_PER_SIDE,
    occupiedSides: new Set([...defenders.values()].map((defender) => defender.side)),
    rosterSize: latestBoardGlyphs.size, fromPause, continuityConfirmed: false,
  };
}

function trackerRestartConfirmed(recovery: BoardRecovery, now: number): boolean {
  if (!recovery.fromPause || recovery.continuityConfirmed) return false;
  // A recycled number and a physical pose can both identify the same arrival.
  // Give the pose match priority and count that arrival only once.
  const byArrival = new Map<number, [number, { at: number; side?: PlayerSide; replacementId?: number }]>();
  for (const [oldId, renewal] of recovery.renewals) {
    if (now - renewal.at > REDETECTION_WINDOW_MS) continue;
    const id = renewal.replacementId ?? oldId;
    if (!byArrival.has(id) || id !== oldId) byArrival.set(id, [oldId, renewal]);
  }
  const recent = new Map(byArrival.values());
  // Indistinguishable copies can corroborate the size of a returning cohort
  // without assigning an individual collider on the strength of a glyph.
  for (const [id, candidate] of recovery.setupCandidates) {
    if (byArrival.has(id) || now - candidate.at > REDETECTION_WINDOW_MS) continue;
    const side = candidate.contact.position.x < 0 ? "left" : "right";
    const onHalf = candidate.originals.filter((old) => old.side === side);
    const sources = onHalf.length ? onHalf : candidate.originals;
    const available = sources.find((old) => !recent.has(old.id));
    if (available) recent.set(available.id, { at: candidate.at, side: available.side, replacementId: id });
  }
  // A run of changes confined to one team cannot invalidate an untouched opponent.
  return recent.size >= Math.max(2, Math.ceil(recovery.rosterSize / 2)) &&
    [...recovery.occupiedSides].every((side) => [...recent.values()].some((renewal) => renewal.side === side));
}

function reconcileSetupCandidates(recovery: BoardRecovery, next: Map<number, DefenderContact>, now: number, restarted: boolean): void {
  if (!recovery.fromPause || didServeInitialKickoff) return;
  for (const [id, candidate] of recovery.setupCandidates) {
    if (!liveBoardContactIds.has(id) || staleBoardIds.has(id)) continue;
    const unresolved = candidate.originals.some((old) => next.has(old.id) && recovery.pendingIds.has(old.id));
    if (!restarted && !recovery.continuityConfirmed && unresolved && now - candidate.at < REDETECTION_WINDOW_MS) {
      next.delete(id);
    } else {
      next.set(id, candidate.contact);
    }
  }
}

function reconcileBoardRoster(
  next: Map<number, DefenderContact>, reported: BoardFrameChanges, previousLiveIds: Set<number>,
  handoffs: Map<number, DefenderContact>,
): boolean {
  const now = performance.now();
  // Beta.6 retains old tracker IDs as Stationary. A real sample makes an ID
  // authoritative again, even when the native sample is itself Stationary.
  for (const [id, substitute] of staleBoardIds) {
    const contact = next.get(id);
    const change = reported.get(id);
    const setupSettled = substitute?.setupDeadline !== undefined && now >= substitute.setupDeadline &&
      countDefenders(substitute.side) < DEFENDERS_PER_SIDE;
    if (!setupSettled && liveBoardContactIds.has(id) && (!change || (substitute && !contact && !change.began && !change.terminated))) {
      if (substitute?.replacementId !== undefined) {
        const replacementChange = reported.get(substitute.replacementId);
        if (replacementChange?.terminated || replacementChange?.began) substitute.replacementId = undefined;
      }
      next.delete(id);
      continue;
    }
    staleBoardIds.delete(id);
    if (contact && substitute && change && !change.began && !change.terminated &&
        placementSide(contact.position, contact.piece, contact.angle) === substitute.side) {
      if (boardRecovery) boardRecovery.continuityConfirmed = true;
      const replacementId = substitute.replacementId;
      const slot = replacementId !== undefined ? defenders.get(replacementId) : undefined;
      if (!didServeInitialKickoff && replacementId !== undefined && slot?.side === substitute.side) {
        defenders.delete(replacementId);
        defenders.set(id, slot);
      }
    }
  }
  const knownCandidates = boardRecovery?.setupCandidates;
  const arrivals = [...next.values()].filter(({ contactId }) =>
    (!knownCandidates?.has(contactId) || reported.get(contactId)?.began) &&
    (reported.get(contactId)?.began || (reported.has(contactId) && !latestBoardGlyphs.has(contactId))),
  );
  if (boardRecovery) {
    for (const [id, candidate] of boardRecovery.setupCandidates) {
      const contact = next.get(id);
      if (!contact || reported.get(id)?.began || now - candidate.at >= REDETECTION_WINDOW_MS) boardRecovery.setupCandidates.delete(id);
      else candidate.contact = contact;
    }
    for (const [id, { at }] of boardRecovery.renewals) {
      if (now - at > REDETECTION_WINDOW_MS || reported.get(id)?.terminated) boardRecovery.renewals.delete(id);
    }
    if (!boardRecovery.fromPause && !boardRecovery.renewals.size && !boardRecovery.setupCandidates.size) boardRecovery = null;
  }
  if (!boardRecovery && (!arrivals.length || !latestBoardGlyphs.size)) return false;
  // The first replacement IDs can arrive before any WebView lifecycle signal.
  const recovery = boardRecovery ?? createBoardRecovery(false, previousLiveIds);
  const { pendingIds } = recovery;
  for (const id of recovery.confirmedBeforeFocus) {
    const change = reported.get(id);
    if (change?.began || change?.terminated || !liveBoardContactIds.has(id) || staleBoardIds.has(id)) recovery.confirmedBeforeFocus.delete(id);
  }
  for (const id of pendingIds) {
    const change = reported.get(id);
    if (suspended && recovery.fromPause && change && !change.began && !change.terminated) recovery.confirmedBeforeFocus.add(id);
    // An ordinary update or a clean end for an incumbent establishes that
    // the old tracker is still reporting. Extra copies keep their own IDs.
    if (latestBoardGlyphs.has(id) && change && !change.canceled && (!change.began || change.terminated)) recovery.continuityConfirmed = true;
  }
  const cached = [...latestBoardGlyphs.values()].filter((old) => next.has(old.contactId) && !reported.has(old.contactId));
  const matchedArrivals = new Set<number>();
  const renewed = new Map<number, number>();
  for (const arrival of arrivals) {
    // An explicit lift ends ownership even when the same packet reuses the ID.
    const incumbent = reported.get(arrival.contactId)?.terminated ? undefined : latestBoardGlyphs.get(arrival.contactId);
    const sameBase = incumbent && distance(incumbent.position, arrival.position) < incumbent.piece.radius * 0.5;
    if (pendingIds.has(arrival.contactId) && incumbent) {
      renewed.set(arrival.contactId, arrival.contactId);
      const original = recovery.baseline.get(arrival.contactId);
      if (!sameBase && original && original.piece !== arrival.piece) recovery.displaced.set(arrival.contactId, now);
    }
    // A recycled ID at its own physical base already has a positional match.
    // A transient change of classification cannot borrow a second slot.
    if (sameBase) {
      matchedArrivals.add(arrival.contactId);
      if (defenders.has(arrival.contactId)) handoffs.set(arrival.contactId, arrival);
      continue;
    }
    // The same base can be assigned a new ID more than once in a cohort.
    // Match against the current live poses, independently of the pause baseline.
    for (const old of cached) {
      if (!next.has(old.contactId) || distance(old.position, arrival.position) >= old.piece.radius * 0.5) continue;
      next.delete(old.contactId);
      staleBoardIds.set(old.contactId, null);
      matchedArrivals.add(arrival.contactId);
      if (pendingIds.has(old.contactId)) renewed.set(old.contactId, arrival.contactId);
      if (defenders.has(old.contactId)) handoffs.set(old.contactId, arrival);
    }
    // Without a positional handoff, a returning ID of the same type keeps
    // its own slot. Another stationary copy cannot supply a second match.
    if (!matchedArrivals.has(arrival.contactId) && incumbent?.piece === arrival.piece) {
      matchedArrivals.add(arrival.contactId);
      if (recovery.fromPause && pendingIds.has(arrival.contactId) && defenders.has(arrival.contactId)) {
        handoffs.set(arrival.contactId, arrival);
      }
    }
  }
  // Isolated handoffs replace only their own contacts. Retire unrelated
  // cached poses only when a pause and a group of concurrent renewals agree.
  for (const [id, replacementId] of renewed) recovery.renewals.set(id, { at: now, side: defenders.get(id)?.side, replacementId });
  // The old glyph at a reused ID has gone from the SDK snapshot, but the
  // physical piece can return on a different ID in the next packet.
  for (const [id, displacedAt] of recovery.displaced) {
    const original = recovery.baseline.get(id);
    if (!original || now - displacedAt > REDETECTION_WINDOW_MS) {
      recovery.displaced.delete(id);
      continue;
    }
    const returns = arrivals.filter((arrival) => !matchedArrivals.has(arrival.contactId) &&
      arrival.contactId !== id && arrival.piece === original.piece);
    if (returns.length !== 1) continue;
    recovery.renewals.set(id, { at: now, side: original.position.x < 0 ? "left" : "right", replacementId: returns[0].contactId });
    matchedArrivals.add(returns[0].contactId);
    recovery.displaced.delete(id);
  }
  const relocations = new Map<number, DefenderContact>();
  if (!recovery.continuityConfirmed) {
    const nearPause = recovery.fromPause && (suspended || now - lastBoardResumeAt <= BOARD_RESUME_GRACE_MS);
    const incompleteSetup = !didServeInitialKickoff && (recovery.incompleteAtStart || defenders.size < 2 * DEFENDERS_PER_SIDE);
    // All recognized pieces can identify a new tracker, including a base
    // on a rail or straddling midfield. Only legal placements own slots.
    const retained = cached.filter((old) => pendingIds.has(old.contactId) && next.has(old.contactId));
    for (const old of retained) {
      if (renewed.has(old.contactId)) continue;
      const side = defenders.get(old.contactId)?.side;
      const matches = arrivals.filter((arrival) => !matchedArrivals.has(arrival.contactId) && arrival.piece === old.piece);
      const otherCopies = retained.filter((other) => other !== old && other.piece === old.piece);
      let match: DefenderContact | undefined;
      if (!otherCopies.length && matches.length === 1) {
        match = matches[0];
      } else if (side && !otherCopies.some((other) => defenders.get(other.contactId)?.side === side)) {
        const onHalf = matches.filter((arrival) => placementSide(arrival.position, arrival.piece, arrival.angle) === side);
        if (onHalf.length === 1) match = onHalf[0];
      }
      if (!match) continue;
      recovery.renewals.set(old.contactId, { at: now, side, replacementId: match.contactId });
      matchedArrivals.add(match.contactId);
      relocations.set(old.contactId, match);
      if (incompleteSetup) {
        recovery.setupCandidates.set(match.contactId, { at: now, contact: match, originals: [{ id: old.contactId, side }] });
      }
      const setupHandoff = recovery.fromPause && incompleteSetup;
      const pausedHandoff = nearPause && !recovery.confirmedBeforeFocus.has(old.contactId) &&
        placementSide(match.position, match.piece, match.angle) === side;
      if (side && (setupHandoff || pausedHandoff)) {
        // During an incomplete setup, count a possible handoff once while
        // the cohort arrives. Without corroboration, both distinct IDs stand.
        staleBoardIds.set(old.contactId, {
          replacementId: match.contactId, side, setupDeadline: !didServeInitialKickoff ? now + REDETECTION_WINDOW_MS : undefined,
        });
        next.delete(old.contactId);
        handoffs.set(old.contactId, match);
      }
    }
    if (incompleteSetup) {
      for (const arrival of arrivals) {
        if (matchedArrivals.has(arrival.contactId)) continue;
        const originals = retained.filter((old) => old.piece === arrival.piece && !renewed.has(old.contactId))
          .map((old) => ({ id: old.contactId, side: defenders.get(old.contactId)?.side }));
        if (originals.length) recovery.setupCandidates.set(arrival.contactId, { at: now, contact: arrival, originals });
      }
    }
  }
  const restarted = trackerRestartConfirmed(recovery, now);
  if (restarted) {
    for (const id of recovery.renewals.keys()) {
      if (staleBoardIds.has(id)) staleBoardIds.set(id, null);
    }
    for (const [oldId, match] of relocations) {
      if (defenders.has(oldId)) handoffs.set(oldId, match);
    }
  }
  for (const id of pendingIds) {
    if (restarted && !reported.has(id) && liveBoardContactIds.has(id)) {
      // The SDK also caches fingers and unclassified hands across a tracker restart.
      staleBoardIds.set(id, null);
      next.delete(id);
    }
    if (reported.has(id) || !liveBoardContactIds.has(id) || staleBoardIds.get(id) === null) pendingIds.delete(id);
  }
  reconcileSetupCandidates(recovery, next, now, restarted);
  if (!pendingIds.size && !(suspended && recovery.fromPause && recovery.confirmedBeforeFocus.size && !restarted)) boardRecovery = null;
  else if (recovery.renewals.size || recovery.setupCandidates.size) boardRecovery = recovery;
  return restarted;
}

function handleBoardFingerShotInput(
  fingers: readonly BoardContact[], now: number, frameSeconds: number, reported: BoardFrameChanges,
): void {
  if (phase !== "readyToShoot") {
    boardSwipeContacts.clear();
    return;
  }

  const replayed = new Set<number>();
  for (const [id, change] of reported) {
    for (const trace of change.fingerTraces ?? []) {
      // A single live pose is already available in the SDK snapshot below.
      if (!trace.terminal && trace.points.length <= 1) continue;
      replayFingerTrace(id, trace, now, frameSeconds);
      if (!trace.terminal) replayed.add(id);
      if (phase !== "readyToShoot") return;
    }
  }
  const seenFingerIds = new Set<number>();

  for (const contact of fingers) {
    if (contact.phase === BoardContactPhase.Canceled) {
      boardSwipeContacts.delete(contact.contactId);
      continue;
    }

    if (contact.phase === BoardContactPhase.Ended) {
      const worldPosition = boardContactWorldPosition(contact);
      finishSwipeContact(boardSwipeContacts, contact.contactId, worldPosition, now);
      continue;
    }

    seenFingerIds.add(contact.contactId);
    if (replayed.has(contact.contactId)) continue;
    const worldPosition = boardContactWorldPosition(contact);
    const existing = boardSwipeContacts.get(contact.contactId);

    const traces = reported.get(contact.contactId)?.fingerTraces;
    if (!existing || contact.phase === BoardContactPhase.Began || traces?.[traces.length - 1]?.began) {
      if (contact.phase !== BoardContactPhase.Stationary || reported.has(contact.contactId)) {
        boardSwipeContacts.set(contact.contactId, createSwipeContactState(worldPosition, now));
      }
      continue;
    }

    updateSwipeState(existing, worldPosition, now);
  }

  for (const id of boardSwipeContacts.keys()) if (!seenFingerIds.has(id)) boardSwipeContacts.delete(id);
}

function replayFingerTrace(id: number, trace: FingerTrace, now: number, frameSeconds: number): void {
  if (trace.began || trace.terminal === BoardContactPhase.Canceled) boardSwipeContacts.delete(id);
  if (trace.terminal === BoardContactPhase.Canceled) return;

  let swipe = boardSwipeContacts.get(id);
  const release = trace.releasePosition;
  const onBoard = release && release.x >= 0 && release.x <= BOARD_WIDTH && release.y >= 0 && release.y <= BOARD_HEIGHT;
  const last = trace.points[trace.points.length - 1];
  const hasFinalMove = onBoard && (release.x !== last?.x || release.y !== last?.y);
  const points = hasFinalMove ? [...trace.points, release] : trace.points;
  // The host supplies no individual timestamps for poses in one packet.
  const samples = points.map((point, index) => ({
    position: boardContactWorldPosition(point),
    timestamp: now - frameSeconds * (points.length - 1 - index) / Math.max(1, points.length - 1),
  }));
  if (!swipe) {
    const first = samples.shift();
    if (!first) return;
    swipe = createSwipeContactState(first.position, first.timestamp);
    boardSwipeContacts.set(id, swipe);
  }
  if (trace.terminal === BoardContactPhase.Ended) {
    finishSwipeSamples(swipe, samples, now);
    boardSwipeContacts.delete(id);
    return;
  }
  for (const sample of samples) {
    updateSwipeState(swipe, sample.position, sample.timestamp);
    if (phase !== "readyToShoot") return;
  }
}

function wirePointerFallback(): void {
  for (const piece of sportsPieces.values()) {
    const image = new Image();
    image.src = `piece-art/${piece.glyphId}.png`;
    previewArt.set(piece.glyphId, image);
  }
  if (Board.isOnDevice) return;
  canvas.addEventListener("pointerdown", (event) => {
    if (!screens.playing || suspended) return;
    const worldPosition = pointerWorldPosition(event);
    if (lesson) {
      lesson.finger(event.pointerId, pointerFraction(event), "down");
      canvas.setPointerCapture(event.pointerId); return;
    }

    if (CanLaunchSwipe() && distance(worldPosition, getBallPosition()) <= layout.ballSwipeCaptureRadius) {
      canvas.setPointerCapture(event.pointerId);
      pointerSwipeContacts.set(
        event.pointerId,
        createSwipeContactState(worldPosition, performance.now() / 1000),
      );
      event.preventDefault();
      return;
    }

    const contact = beginBrowserDefenderDrag(worldPosition);
    if (contact) {
      canvas.setPointerCapture(event.pointerId);
      pointerDefenderDrags.set(event.pointerId, contact.contactId);
      event.preventDefault();
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!screens.playing || suspended) return;
    const worldPosition = pointerWorldPosition(event);
    lesson?.finger(event.pointerId, pointerFraction(event), "move");
    const draggedContactId = pointerDefenderDrags.get(event.pointerId);
    if (draggedContactId !== undefined) {
      moveBrowserDefender(draggedContactId, worldPosition);
      event.preventDefault();
      return;
    }

    const swipe = pointerSwipeContacts.get(event.pointerId);
    if (!swipe) {
      return;
    }

    updateSwipeState(
      swipe,
      worldPosition,
      performance.now() / 1000,
    );
    event.preventDefault();
  });

  const finishPointer = (event: PointerEvent): void => {
    lesson?.finger(event.pointerId, pointerFraction(event), event.type === "pointerup" ? "up" : "cancel");
    if (event.type === "pointerup") {
      finishSwipeContact(
        pointerSwipeContacts,
        event.pointerId,
        pointerWorldPosition(event),
        performance.now() / 1000,
      );
    } else {
      pointerSwipeContacts.delete(event.pointerId);
    }

    pointerDefenderDrags.delete(event.pointerId);
  };

  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("lostpointercapture", finishPointer);
}

function updateSwipeState(
  swipeContact: SwipeContactState,
  worldPosition: Vec,
  now: number,
): void {
  if (!CanLaunchSwipe()) {
    resetSwipeSampler(swipeContact, worldPosition, now);
    return;
  }
  recordSwipeSample(swipeContact, worldPosition, now);
  const velocity = qualifyingSwipeVelocity(swipeContact, now);
  if (velocity) launchSwipeVelocity(velocity);
}

function finishSwipeContact(
  contacts: Map<number, SwipeContactState>,
  contactId: number,
  worldPosition: Vec,
  now: number,
): void {
  const swipeContact = contacts.get(contactId);
  if (!swipeContact) {
    return;
  }

  finishSwipeSamples(swipeContact, [{ position: worldPosition, timestamp: now }], now);
  contacts.delete(contactId);
}

function finishSwipeSamples(swipe: SwipeContactState, samples: readonly SwipeSample[], now: number): void {
  // A faster release can improve the shot. A final jitter sample can also age
  // the qualifying motion out of the sampling window, so retain the best one.
  let best = swipe.armedAt === null ? null : qualifyingSwipeVelocity(swipe, now, true);
  for (const sample of samples) {
    recordSwipeSample(swipe, sample.position, sample.timestamp);
    const velocity = qualifyingSwipeVelocity(swipe, sample.timestamp, true);
    if (velocity && (!best || dot(velocity, velocity) > dot(best, best))) best = velocity;
  }
  if (best) launchSwipeVelocity(best);
}

function createSwipeContactState(worldPosition: Vec, now: number): SwipeContactState {
  return {
    samples: [{ position: worldPosition, timestamp: now }],
    peakSpeed: 0,
    peakVelocity: { x: 0, y: 0 },
    lastWindowedSpeed: 0,
    armedAt: null,
  };
}

function recordSwipeSample(state: SwipeContactState, position: Vec, timestamp: number): void {
  state.samples.push({ position, timestamp });
  const cutoff = timestamp - SWIPE_SAMPLE_WINDOW_SECONDS;
  while (state.samples.length > 2 && state.samples[0].timestamp < cutoff) {
    state.samples.shift();
  }

  const oldest = state.samples[0];
  const newest = state.samples[state.samples.length - 1];
  const windowDt = Math.max(newest.timestamp - oldest.timestamp, 1 / 240);
  const windowDelta = subtract(newest.position, oldest.position);
  const windowSpeed = magnitude(windowDelta) / windowDt;
  state.lastWindowedSpeed = windowSpeed;
}

function resetSwipeSampler(state: SwipeContactState, position: Vec, timestamp: number): void {
  state.samples = [{ position, timestamp }];
  state.peakSpeed = 0;
  state.peakVelocity = { x: 0, y: 0 };
  state.lastWindowedSpeed = 0;
  state.armedAt = null;
}

function resetSwipePeak(state: SwipeContactState): void {
  state.peakSpeed = 0;
  state.peakVelocity = { x: 0, y: 0 };
}

function frame(timestamp: number): void {
  if (timestamp >= rosterPollAt && !windowBlurred && !document.hidden && !nativeSurfacePaused) {
    rosterPollAt = timestamp + 700; screens.refreshIfWaiting();
  }
  if (suspended || timestamp < resumeShotAt) {
    lastFrameTimestamp = timestamp;
    if (!suspended) render();
    requestAnimationFrame(frame);
    return;
  }
  const deltaMs = clamp(timestamp - Math.max(lastFrameTimestamp, resumeShotAt), 0, 100);
  lastFrameTimestamp = timestamp;
  if (!screens.playing) {
    requestAnimationFrame(frame); return;
  }
  if (lesson) {
    lesson.tick(deltaMs);
    render();
    requestAnimationFrame(frame); return;
  }
  accumulatorMs += deltaMs;

  updateTimers(deltaMs / 1000);

  while (accumulatorMs >= FIXED_STEP_MS) {
    fixedStep(FIXED_STEP_MS / 1000);
    accumulatorMs -= FIXED_STEP_MS;
  }

  render();
  requestAnimationFrame(frame);
}

function updateTimers(deltaSeconds: number): void {
  if (phase !== "goalPause") {
    return;
  }

  goalPauseTimer += deltaSeconds;
  if (goalPauseTimer >= GOAL_PAUSE_DURATION) {
    if (Math.max(leftScore, rightScore) >= screens.target) {
      goalPauseTimer = 0;
      screens.results(leftScore, rightScore);
      return;
    }
    goalPauseTimer = 0;
    ResetBallToCenter();
    currentTurn = lastScoringSide === "left" ? "right" : "left";
    phase = "readyToShoot";
    updateDefenders(Board.isOnDevice ? latestBoardGlyphs : simulatedContacts);
  }
}

function fixedStep(deltaSeconds: number): void {
  if (phase === "goalPause") {
    return;
  }

  if (phase !== "setup" && ballInPlay) {
    for (let step = 0; step < PHYSICS_SUBSTEPS; step += 1) {
      const incomingVelocity = ballBody
        ? { ...Matter.Body.getVelocity(ballBody) }
        : null;
      Matter.Engine.update(engine, FIXED_STEP_MS / PHYSICS_SUBSTEPS);
      ResolveBallDefenderCollisions(incomingVelocity);
      constrainBallSpeed();
      ConstrainBallToPlayfield(incomingVelocity);
      CheckForGoal();

      if (!ballInPlay) {
        return;
      }
    }

    updateBallTrail();
  }

  UpdateBallMotionState(deltaSeconds);
}

function resize(): void {
  const cssWidth = Math.max(1, window.innerWidth);
  const cssHeight = Math.max(1, window.innerHeight);
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  layout = createLayout(cssWidth, cssHeight);
  // A pointer sampled before a viewport change is in the old screen space.
  CancelActiveShot();
  pointerDefenderDrags.clear();
}

function createLayout(
  cssWidth = Math.max(1, window.innerWidth),
  cssHeight = Math.max(1, window.innerHeight),
): Layout {
  // Physics stays in the Board's 16:9 world. Only the projection resizes.
  const fieldBackgroundSize = { x: FIELD_WORLD_HEIGHT * FIELD_BACKGROUND_ASPECT, y: FIELD_WORLD_HEIGHT };
  const fieldBackgroundHalfWidth = fieldBackgroundSize.x * 0.5;
  const fieldBackgroundHalfHeight = fieldBackgroundSize.y * 0.5;
  const goalDisplayHalfWidth =
    FIELD_WIDTH * 0.5 + GOAL_DEPTH + WALL_THICKNESS + OFF_BOARD_GOAL_CLEARANCE;
  const uniformScale =
    Math.min(fieldBackgroundHalfWidth / goalDisplayHalfWidth, fieldBackgroundHalfHeight / (FIELD_HEIGHT * 0.5)) *
    FIELD_SCREEN_FILL;
  const pixelScale = Math.min(cssWidth / fieldBackgroundSize.x, cssHeight / fieldBackgroundSize.y);
  const scale = (value: number): number => value * uniformScale;
  const goalMouthTopY = lerp(
    fieldBackgroundHalfHeight,
    -fieldBackgroundHalfHeight,
    GOAL_MOUTH_TOP_PIXEL_Y / BOARD_HEIGHT,
  );
  const goalMouthBottomY = lerp(
    fieldBackgroundHalfHeight,
    -fieldBackgroundHalfHeight,
    GOAL_MOUTH_BOTTOM_PIXEL_Y / BOARD_HEIGHT,
  );

  return {
    cssWidth,
    cssHeight,
    pixelScale,
    fieldBackgroundWidth: fieldBackgroundSize.x,
    fieldBackgroundHeight: fieldBackgroundSize.y,
    pitchHalfWidth: fieldBackgroundHalfWidth,
    pitchHalfHeight: fieldBackgroundHalfHeight,
    uniformScale,
    wallThickness: scale(WALL_THICKNESS),
    ballRadius: scale(BALL_RADIUS),
    ballSwipeCaptureRadius: scale(BALL_SWIPE_CAPTURE_RADIUS),
    minSwipeTravelDistance: scale(MIN_SWIPE_TRAVEL_DISTANCE),
    minSwipeSpeed: scale(MIN_SWIPE_SPEED),
    maxSwipeSpeed: scale(MAX_SWIPE_SPEED),
    minShotImpulse: scale(MIN_SHOT_IMPULSE),
    maxShotImpulse: scale(MAX_SHOT_IMPULSE),
    ballRestVelocity: scale(BALL_REST_VELOCITY),
    goalMouthTopY,
    goalMouthBottomY,
    goalTunnelDepth: Math.max(scale(0.25), 0),
    goalScoreLineX: fieldBackgroundHalfWidth - scale(BALL_RADIUS),
  };
}

function buildPhysicsWorld(): void {
  buildWalls();
  ballBody = Matter.Bodies.circle(0, 0, layout.ballRadius, {
    label: "ball",
    restitution: 0.94,
    friction: 0.02,
    frictionStatic: 0,
    frictionAir: 0.018,
    density: 0.002,
    slop: 0.001,
  });
  Matter.Composite.add(engine.world, ballBody);
}

function buildWalls(): void {
  const upperWallHeight = layout.pitchHalfHeight - layout.goalMouthTopY;
  const upperWallCenterY = layout.goalMouthTopY + upperWallHeight * 0.5;
  const lowerWallHeight = layout.goalMouthBottomY + layout.pitchHalfHeight;
  const lowerWallCenterY = -layout.pitchHalfHeight + lowerWallHeight * 0.5;
  const sideWallX = layout.pitchHalfWidth + layout.wallThickness * 0.5;
  const goalInteriorX = layout.pitchHalfWidth + layout.goalTunnelDepth * 0.5;

  addWall({ x: 0, y: layout.pitchHalfHeight + layout.wallThickness * 0.5 }, {
    x: layout.pitchHalfWidth * 2,
    y: layout.wallThickness,
  });
  addWall({ x: 0, y: -layout.pitchHalfHeight - layout.wallThickness * 0.5 }, {
    x: layout.pitchHalfWidth * 2,
    y: layout.wallThickness,
  });
  addWall({ x: -sideWallX, y: upperWallCenterY }, { x: layout.wallThickness, y: upperWallHeight });
  addWall({ x: -sideWallX, y: lowerWallCenterY }, { x: layout.wallThickness, y: lowerWallHeight });
  addWall({ x: sideWallX, y: upperWallCenterY }, { x: layout.wallThickness, y: upperWallHeight });
  addWall({ x: sideWallX, y: lowerWallCenterY }, { x: layout.wallThickness, y: lowerWallHeight });
  addWall({ x: -goalInteriorX, y: layout.goalMouthTopY + layout.wallThickness * 0.5 }, {
    x: layout.goalTunnelDepth,
    y: layout.wallThickness,
  });
  addWall({ x: -goalInteriorX, y: layout.goalMouthBottomY - layout.wallThickness * 0.5 }, {
    x: layout.goalTunnelDepth,
    y: layout.wallThickness,
  });
  addWall({ x: goalInteriorX, y: layout.goalMouthTopY + layout.wallThickness * 0.5 }, {
    x: layout.goalTunnelDepth,
    y: layout.wallThickness,
  });
  addWall({ x: goalInteriorX, y: layout.goalMouthBottomY - layout.wallThickness * 0.5 }, {
    x: layout.goalTunnelDepth,
    y: layout.wallThickness,
  });
}

function addWall(position: Vec, size: Vec): void {
  if (size.x <= 0 || size.y <= 0) {
    return;
  }

  const wall = Matter.Bodies.rectangle(position.x, position.y, size.x, size.y, {
    label: "wall",
    isStatic: true,
    restitution: 0.94,
    friction: 0.05,
    frictionStatic: 0,
  });
  Matter.Composite.add(engine.world, wall);
}

// Range of sensor positions that keep the rotated base entirely on this half.
function placementBounds(piece: SportsPiece, angle: number, side: PlayerSide): Matter.Bounds {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (const vertex of piece.vertices) {
    const x = vertex.x * cos - vertex.y * sin;
    const y = vertex.x * sin + vertex.y * cos;
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
  }
  return {
    min: { x: (side === "left" ? -layout.pitchHalfWidth : 0) - min.x, y: -layout.pitchHalfHeight - min.y },
    max: { x: (side === "left" ? 0 : layout.pitchHalfWidth) - max.x, y: layout.pitchHalfHeight - max.y },
  };
}

function placementSide(position: Vec, piece: SportsPiece, angle: number): PlayerSide | null {
  const side = position.x < 0 ? "left" : "right";
  if (!Matter.Bounds.contains(placementBounds(piece, angle, side), position)) return null;
  if (Math.hypot(position.x, position.y) < piece.radius + layout.ballRadius) {
    const kickoff = Matter.Vector.rotate({ x: -position.x, y: -position.y }, -angle);
    const overlapsBall = piece.vertices.some((vertex, i, vertices) =>
      distanceFromPointToSegment(kickoff, vertex, vertices[(i + 1) % vertices.length]) < layout.ballRadius,
    );
    if (overlapsBall) return null;
  }
  return side;
}

function countDefenders(side: PlayerSide): number {
  let count = 0;
  for (const defender of defenders.values()) {
    if (defender.side === side) count += 1;
  }
  return count;
}

function createGoalBox(side: PlayerSide): Matter.Body {
  const { min, max } = GOAL_BOX_PIXEL_BOUNDS[side];
  const unitsPerPixel = layout.fieldBackgroundHeight / BOARD_HEIGHT;
  return Matter.Bodies.rectangle(
    ((min.x + max.x) / 2 - BOARD_WIDTH / 2) * unitsPerPixel,
    (BOARD_HEIGHT / 2 - (min.y + max.y) / 2) * unitsPerPixel,
    (max.x - min.x) * unitsPerPixel,
    (max.y - min.y) * unitsPerPixel,
    { isStatic: true },
  );
}

function countGoalBoxDefenders(side: PlayerSide): number {
  const bodies = [...defenders.values()].filter((defender) => defender.side === side).map(({ body }) => body);
  // Query the rotated base shapes, including their concave parts, so a piece
  // straddling the box line counts even when its sensor origin is outside.
  return Matter.Query.collides(goalBoxes[side], bodies).length;
}

function updateDefenders(
  contacts: ReadonlyMap<number, DefenderContact>, reported?: BoardFrameChanges,
): void {
  // The opening shot locks the blockers for the entire match, including goals,
  // menu visits and tracker interruptions. Only a new match reopens setup.
  if (didServeInitialKickoff) return;
  // Keep existing slots when extra pieces arrive. Copies share a glyph but
  // every contact owns its own collider until it leaves its half.
  for (const [id, defender] of defenders) {
    const contact = contacts.get(id);
    const change = reported?.get(id);
    const newLifetime = change?.began;
    if (!contact || newLifetime || placementSide(contact.position, contact.piece, contact.angle) !== defender.side) {
      Matter.Composite.remove(engine.world, defender.body);
      defenders.delete(id);
    }
  }

  for (const [id, contact] of contacts) {
    let defender = defenders.get(id);
    if (defender?.piece !== contact.piece) {
      const side = placementSide(contact.position, contact.piece, contact.angle);
      if (!side || (!defender && countDefenders(side) >= DEFENDERS_PER_SIDE)) continue;
      if (defender) Matter.Composite.remove(engine.world, defender.body);
      defender = { side, piece: contact.piece, body: createSportsBumper(contact.piece) };
      defenders.set(id, defender);
      Matter.Composite.add(engine.world, defender.body);
    }
    // During setup, align each blocker with its physical base.
    const { body } = defender;
    if (body.position.x !== contact.position.x || body.position.y !== contact.position.y) {
      Matter.Body.setPosition(body, contact.position);
    }
    if (body.angle !== contact.angle) Matter.Body.setAngle(body, contact.angle);
  }
  if (screens?.playing) {
    for (const id of contacts.keys()) if (!visiblePieceIds.has(id) || reported?.get(id)?.began) {
      cue("piece", .25);
    }
  }
  visiblePieceIds = new Set(contacts.keys());
  UpdateMatchPhaseFromPlacements();
}

function UpdateMatchPhaseFromPlacements(): void {
  if (!CanPlayWithCurrentDefenders()) {
    CancelActiveShot();
    StopBall();
    if (phase !== "goalPause") {
      phase = "setup";
    }
    return;
  }

  if (!didPrepareInitialKickoff) {
    didPrepareInitialKickoff = true;
    ResetBallToCenter();
    currentTurn = "left";
  }

  if (phase === "setup") {
    phase = "readyToShoot";
  }
}

function CanLaunchSwipe(): boolean {
  if (!screens.playing || lesson || suspended || phase === "setup" || phase === "goalPause") {
    return false;
  }

  if (!CanPlayWithCurrentDefenders() || !ballBody || !IsBallSlowEnoughForNextShot()) {
    return false;
  }

  TryCompleteShotTurnIfSettled();
  return phase === "readyToShoot";
}

function qualifyingSwipeVelocity(swipeContact: SwipeContactState, now: number, released = false): Vec | null {
  if (!CanLaunchSwipe() || !ballBody || swipeContact.samples.length < 2) {
    return null;
  }

  const samples = swipeContact.samples;
  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const windowDelta = subtract(newest.position, oldest.position);
  const windowDistance = magnitude(windowDelta);

  // A live sensor flick must travel beyond resting-finger jitter.
  const minimumTravel = Board.isOnDevice ? layout.ballRadius : layout.minSwipeTravelDistance;
  if (windowDistance < minimumTravel) {
    swipeContact.armedAt = null;
    resetSwipePeak(swipeContact);
    return null;
  }

  if (
    distanceFromPointToSegment(getBallPosition(), oldest.position, newest.position) >
    layout.ballSwipeCaptureRadius
  ) {
    swipeContact.armedAt = null;
    resetSwipePeak(swipeContact);
    return null;
  }

  const windowDt = Math.max(newest.timestamp - oldest.timestamp, 1 / 240);
  const windowedSpeed = swipeContact.lastWindowedSpeed;
  if (windowedSpeed > swipeContact.peakSpeed) {
    swipeContact.peakSpeed = windowedSpeed;
    swipeContact.peakVelocity = scaleVector(windowDelta, 1 / windowDt);
  }

  const triggerSpeed = Math.max(windowedSpeed, swipeContact.peakSpeed);
  if (triggerSpeed < layout.minSwipeSpeed) {
    swipeContact.armedAt = null;
    return null;
  }

  if (swipeContact.armedAt === null) {
    swipeContact.armedAt = now;
    if (!released) {
      return null;
    }
  }

  const armedFor = now - swipeContact.armedAt;
  const droppingFromPeak = windowedSpeed < swipeContact.peakSpeed * SWIPE_PEAK_HOLD_RATIO;
  if (!released && armedFor < SWIPE_LATCH_TIMEOUT_SECONDS && !droppingFromPeak) {
    return null;
  }

  return swipeContact.peakSpeed > windowedSpeed ? swipeContact.peakVelocity : scaleVector(windowDelta, 1 / windowDt);
}

function launchSwipeVelocity(velocity: Vec): void {
  const swipeStrength = inverseLerp(layout.minSwipeSpeed, layout.maxSwipeSpeed, magnitude(velocity));
  const impulseMagnitude = lerp(layout.minShotImpulse, layout.maxShotImpulse, swipeStrength);
  LaunchShot(scaleVector(normalize(velocity), impulseMagnitude));
}

function LaunchShot(impulse: Vec): void {
  if (!ballBody) {
    return;
  }

  didServeInitialKickoff = true;
  pointerDefenderDrags.clear();
  cue("flick", .45);
  CancelActiveShot();
  ballInPlay = true;
  const deltaV = scaleVector(impulse, MATTER_SHOT_VELOCITY_SCALE);
  Matter.Body.setVelocity(ballBody, {
    x: ballBody.velocity.x + deltaV.x,
    y: ballBody.velocity.y + deltaV.y,
  });
  Matter.Body.setAngularVelocity(ballBody, 0);
  phase = "ballInMotion";
  ballStillTimer = 0;
}

function IsBallSlowEnoughForNextShot(): boolean {
  return !!ballBody && getBallSpeedPerSecond() <= layout.ballRestVelocity;
}

function CompleteShotTurn(): void {
  if (!ballBody) {
    return;
  }

  CancelActiveShot();
  StopBall();
  ballStillTimer = 0;
  currentTurn = currentTurn === "left" ? "right" : "left";
  phase = "readyToShoot";
  updateDefenders(Board.isOnDevice ? latestBoardGlyphs : simulatedContacts);
}

function TryCompleteShotTurnIfSettled(): void {
  if (phase !== "ballInMotion" || ballStillTimer < BALL_REST_TIME) {
    return;
  }

  CompleteShotTurn();
}

function UpdateBallMotionState(deltaSeconds: number): void {
  if (!ballBody || phase === "setup" || phase === "goalPause") {
    return;
  }

  if (phase !== "ballInMotion") {
    ballStillTimer = 0;
    return;
  }

  if (IsBallSlowEnoughForNextShot()) {
    ballStillTimer += deltaSeconds;
  } else {
    ballStillTimer = 0;
  }

  TryCompleteShotTurnIfSettled();
}

function CheckForGoal(): void {
  if (!ballBody || phase !== "ballInMotion") {
    return;
  }

  const position = getBallPosition();
  if (!IsPositionInsideGoalMouth(position)) {
    return;
  }

  if (position.x <= -layout.goalScoreLineX) {
    RegisterGoal("right");
  } else if (position.x >= layout.goalScoreLineX) {
    RegisterGoal("left");
  }
}

function IsPositionInsideGoalMouth(position: Vec): boolean {
  const goalPostClearance = layout.uniformScale * 0.05;
  return (
    position.y <= layout.goalMouthTopY - goalPostClearance &&
    position.y >= layout.goalMouthBottomY + goalPostClearance
  );
}

function RegisterGoal(scorer: PlayerSide): void {
  StopBall();
  CancelActiveShot();
  ballInPlay = false;
  ballTrail.length = 0;

  lastScoringSide = scorer;
  if (scorer === "left") {
    leftScore += 1;
  } else {
    rightScore += 1;
  }

  phase = "goalPause";
  goalPauseTimer = 0;
  playGoalCheer();
}

function playGoalCheer(fromStart = true): void {
  if (!screens.playing || soundLevel === 0) return;
  try {
    if (fromStart) {
      goalCheerAudio.pause();
      goalCheerAudio.currentTime = 0;
    }
    void goalCheerAudio.play().catch(() => {
      // Some browser previews can block audio until they receive a user gesture.
    });
  } catch {
    // Audio support must never interrupt scoring or the next kickoff.
  }
}

function stopGoalCheer(): void {
  cheerPausedWithMatch = false;
  try {
    goalCheerAudio.pause();
    goalCheerAudio.currentTime = 0;
  } catch {
    // Reset the match even if this WebView cannot control media playback.
  }
}

function ResetBallToCenter(): void {
  if (!ballBody) {
    return;
  }

  ballInPlay = true;
  Matter.Body.setPosition(ballBody, { x: 0, y: 0 });
  Matter.Body.setVelocity(ballBody, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(ballBody, 0);
  ballStillTimer = 0;
  ballTrail.length = 0;
}

function StopBall(): void {
  if (!ballBody) {
    return;
  }

  Matter.Body.setVelocity(ballBody, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(ballBody, 0);
}

function CancelActiveShot(): void {
  boardSwipeContacts.clear();
  pointerSwipeContacts.clear();
}

function resetMatch(): void {
  stopGoalCheer();
  resumeShotAt = 0;
  surfaceCancellation = null;
  leftScore = 0;
  rightScore = 0;
  ballStillTimer = 0;
  goalPauseTimer = 0;
  didPrepareInitialKickoff = false;
  didServeInitialKickoff = false;
  currentTurn = "left";
  lastScoringSide = "left";
  phase = "setup";
  CancelActiveShot();
  StopBall();
  ResetBallToCenter();

  pointerDefenderDrags.clear();
  simulatedContacts.clear();
  updateDefenders(Board.isOnDevice ? latestBoardGlyphs : simulatedContacts);
}

function autoSetupDefenders(): void {
  if (Board.isOnDevice || lesson || didServeInitialKickoff) return;

  pointerDefenderDrags.clear();
  simulatedContacts.clear();
  const pieces = sportsPieces.values();
  for (const side of [-1, 1]) {
    const positions = [
      { x: side * layout.pitchHalfWidth * 0.90, y: layout.pitchHalfHeight * 0.22 },
      { x: side * layout.pitchHalfWidth * 0.50, y: layout.pitchHalfHeight * 0.43 },
      { x: side * layout.pitchHalfWidth * 0.50, y: -layout.pitchHalfHeight * 0.43 },
      { x: side * layout.pitchHalfWidth * 0.75, y: -layout.pitchHalfHeight * 0.60 },
    ];
    for (const position of positions) {
      const piece = pieces.next().value!;
      addSimulatedDefender(piece, position);
    }
  }
  updateDefenders(simulatedContacts);
}

function beginBrowserDefenderDrag(position: Vec): DefenderContact | null {
  if (lesson || didServeInitialKickoff) return null;
  const existing = Array.from(simulatedContacts.values()).find((contact) =>
    distance(contact.position, position) <= contact.piece.radius,
  );
  if (existing) return existing;

  const placed = new Set(Array.from(simulatedContacts.values(), (contact) => contact.piece.glyphId));
  const piece = Array.from(sportsPieces.values()).find((candidate) => !placed.has(candidate.glyphId));
  if (!piece) return null;

  const side = position.x < 0 ? "left" : "right";
  if (countDefenders(side) >= DEFENDERS_PER_SIDE) return null;
  const contact = addSimulatedDefender(piece, position);
  if (contact) updateDefenders(simulatedContacts);
  return contact;
}

function addSimulatedDefender(piece: SportsPiece, position: Vec): DefenderContact | null {
  const angle = position.x < 0 ? 0 : -Math.PI;
  if (!placementSide(position, piece, angle)) return null;
  const contact = { contactId: nextSimulatedContactId++, piece, position, angle };
  simulatedContacts.set(contact.contactId, contact);
  return contact;
}

function moveBrowserDefender(contactId: number, position: Vec): void {
  if (lesson || didServeInitialKickoff) return;
  const contact = simulatedContacts.get(contactId);
  if (!contact) return;

  const side = contact.position.x < 0 ? "left" : "right";
  const { min, max } = placementBounds(contact.piece, contact.angle, side);
  const next = {
    x: clamp(position.x, min.x, max.x),
    y: clamp(position.y, min.y, max.y),
  };
  if (!placementSide(next, contact.piece, contact.angle)) return;
  contact.position = next;
  updateDefenders(simulatedContacts);
}

function updateBallTrail(): void {
  if (!ballBody || !ballInPlay || phase !== "ballInMotion") {
    return;
  }

  const position = getBallPosition();
  const previous = ballTrail[ballTrail.length - 1];
  if (!previous || distance(previous, position) > layout.ballRadius * 0.15) {
    ballTrail.push(position);
  }

  while (ballTrail.length > 20) {
    ballTrail.shift();
  }
}

function constrainBallSpeed(): void {
  if (!ballBody) {
    return;
  }

  const velocity = Matter.Body.getVelocity(ballBody);
  const speed = magnitude(velocity);
  const maxSpeed = 0.62;
  if (speed <= maxSpeed) {
    return;
  }

  Matter.Body.setVelocity(ballBody, scaleVector(normalize(velocity), maxSpeed));
}

function ResolveBallDefenderCollisions(incomingVelocity: Vec | null): void {
  if (!ballBody || !incomingVelocity) {
    return;
  }

  // Matter separates the traced bumpers, but its resting threshold suppresses
  // rebounds at this world scale. Resolve all touching normals together.
  const normals: Vec[] = [];
  let closingOnDefender = false;
  const pairs: Matter.Pair[] = engine.pairs.list;
  for (const { isActive, collision } of pairs) {
    if (!isActive) continue;
    const { parentA, parentB, normal } = collision;
    if (parentA !== ballBody && parentB !== ballBody) continue;
    const other = parentA === ballBody ? parentB : parentA;
    const outward = parentA === ballBody ? normal : scaleVector(normal, -1);
    normals.push(outward);
    if (other.label === "defender" && dot(incomingVelocity, outward) < 0) closingOnDefender = true;
  }
  if (closingOnDefender) {
    Matter.Body.setVelocity(ballBody, ResolveDefenderManifoldVelocity(incomingVelocity, normals));
  }
}

function ResolveDefenderManifoldVelocity(
  incomingVelocity: Vec,
  contactNormals: Vec[],
): Vec {
  const constraints = contactNormals.map((normal) => {
    const normalVelocity = dot(incomingVelocity, normal);
    return {
      normal,
      minimumVelocity: normalVelocity < 0 ? -DEFENDER_RESTITUTION * normalVelocity : 0,
    };
  });
  // In a narrow wedge the restitution targets can conflict. A zero velocity
  // always satisfies the fallback requirement of no penetration.
  return FindClosestVelocitySatisfyingConstraints(incomingVelocity, constraints)
    ?? FindClosestVelocitySatisfyingConstraints(incomingVelocity, constraints.map(({ normal }) => ({ normal, minimumVelocity: 0 })))
    ?? { x: 0, y: 0 };
}

function FindClosestVelocitySatisfyingConstraints(
  incomingVelocity: Vec,
  constraints: Array<{ normal: Vec; minimumVelocity: number }>,
): Vec | null {
  const tolerance = 1e-10;
  let bestVelocity: Vec | null = null;
  let bestDeltaSquared = Number.POSITIVE_INFINITY;

  const considerCandidate = (candidate: Vec): void => {
    if (constraints.some(({ normal, minimumVelocity }) => (
      dot(candidate, normal) < minimumVelocity - tolerance
    ))) {
      return;
    }

    const delta = subtract(candidate, incomingVelocity);
    const deltaSquared = dot(delta, delta);
    if (
      deltaSquared < bestDeltaSquared - tolerance ||
      (
        Math.abs(deltaSquared - bestDeltaSquared) <= tolerance &&
        (!bestVelocity || candidate.x < bestVelocity.x || (
          candidate.x === bestVelocity.x && candidate.y < bestVelocity.y
        ))
      )
    ) {
      bestVelocity = candidate;
      bestDeltaSquared = deltaSquared;
    }
  };

  considerCandidate(incomingVelocity);

  for (const constraint of constraints) {
    const correction = constraint.minimumVelocity - dot(incomingVelocity, constraint.normal);
    considerCandidate(add(incomingVelocity, scaleVector(constraint.normal, correction)));
  }

  for (let leftIndex = 0; leftIndex < constraints.length; leftIndex += 1) {
    const left = constraints[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < constraints.length; rightIndex += 1) {
      const right = constraints[rightIndex];
      const determinant = left.normal.x * right.normal.y - left.normal.y * right.normal.x;
      if (Math.abs(determinant) <= tolerance) {
        continue;
      }

      considerCandidate({
        x: (
          left.minimumVelocity * right.normal.y -
          left.normal.y * right.minimumVelocity
        ) / determinant,
        y: (
          left.normal.x * right.minimumVelocity -
          left.minimumVelocity * right.normal.x
        ) / determinant,
      });
    }
  }

  return bestVelocity;
}

function ConstrainBallToPlayfield(incomingVelocity: Vec | null): void {
  if (!ballBody || !incomingVelocity) {
    return;
  }

  const position = getBallPosition();
  const velocity = Matter.Body.getVelocity(ballBody);
  const correctedPosition = { ...position };
  const correctedVelocity = { x: velocity.x, y: velocity.y };
  const maxBallX = layout.pitchHalfWidth - layout.ballRadius;
  const maxBallY = layout.pitchHalfHeight - layout.ballRadius;

  if (correctedPosition.y > maxBallY) {
    correctedPosition.y = maxBallY;
    if (incomingVelocity.y > 0) {
      correctedVelocity.y = -incomingVelocity.y * BOUNDARY_RESTITUTION;
    }
  } else if (correctedPosition.y < -maxBallY) {
    correctedPosition.y = -maxBallY;
    if (incomingVelocity.y < 0) {
      correctedVelocity.y = -incomingVelocity.y * BOUNDARY_RESTITUTION;
    }
  }

  if (!IsPositionInsideGoalMouth(correctedPosition)) {
    if (correctedPosition.x > maxBallX) {
      correctedPosition.x = maxBallX;
      if (incomingVelocity.x > 0) {
        correctedVelocity.x = -incomingVelocity.x * BOUNDARY_RESTITUTION;
      }
    } else if (correctedPosition.x < -maxBallX) {
      correctedPosition.x = -maxBallX;
      if (incomingVelocity.x < 0) {
        correctedVelocity.x = -incomingVelocity.x * BOUNDARY_RESTITUTION;
      }
    }
  }

  if (correctedPosition.x !== position.x || correctedPosition.y !== position.y) {
    Matter.Body.setPosition(ballBody, correctedPosition);
  }

  if (correctedVelocity.x !== velocity.x || correctedVelocity.y !== velocity.y) {
    Matter.Body.setVelocity(ballBody, correctedVelocity);
  }
}

function render(): void {
  ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, layout.cssWidth, layout.cssHeight);

  renderField();
  renderTrail();
  renderDefenders();
  if (lesson) lesson.draw(ctx, layout.cssWidth, layout.cssHeight);
  else renderBall();
  renderUi();
}

function renderField(): void {
  const fieldScreenWidth = layout.fieldBackgroundWidth * layout.pixelScale;
  const fieldScreenHeight = layout.fieldBackgroundHeight * layout.pixelScale;
  const x = (layout.cssWidth - fieldScreenWidth) * 0.5;
  const y = (layout.cssHeight - fieldScreenHeight) * 0.5;

  ctx.fillStyle = FIELD_EDGE_COLOR;
  ctx.fillRect(0, 0, layout.cssWidth, layout.cssHeight);

  if (fieldImageLoaded) {
    ctx.drawImage(fieldImage, x, y, fieldScreenWidth, fieldScreenHeight);
    return;
  }

  ctx.fillStyle = "#175c31";
  roundedRect(ctx, x, y, fieldScreenWidth, fieldScreenHeight, 0);
  ctx.fill();
}

function renderDefenders(): void {
  // Physical pieces are their own markers. Only the browser needs stand-ins.
  if (Board.isOnDevice) return;
  for (const { body, piece, side } of defenders.values()) {
    const point = worldToScreen(body.position);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(-body.angle);
    ctx.scale(layout.pixelScale, -layout.pixelScale);
    ctx.beginPath();
    for (const [i, vertex] of piece.vertices.entries()) {
      if (i === 0) ctx.moveTo(vertex.x, vertex.y);
      else ctx.lineTo(vertex.x, vertex.y);
    }
    ctx.closePath();
    ctx.fillStyle = side === "left" ? LEFT_COLOR : RIGHT_COLOR;
    ctx.fill();
    ctx.restore();
    const image = previewArt.get(piece.glyphId);
    if (image?.naturalWidth) {
      const size = piece.radius * layout.pixelScale * 2;
      const width = size * image.naturalWidth / image.naturalHeight;
      ctx.drawImage(image, point.x - width / 2, point.y - size / 2, width, size);
    }
  }
}

function renderTrail(): void {
  if (ballTrail.length < 2) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 1; i < ballTrail.length; i += 1) {
    const alpha = i / ballTrail.length;
    const start = worldToScreen(ballTrail[i - 1]);
    const end = worldToScreen(ballTrail[i]);
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.3})`;
    ctx.lineWidth = Math.max(1, layout.ballRadius * layout.pixelScale * 0.5 * alpha);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  ctx.restore();
}

function renderBall(): void {
  if (!ballBody || !ballInPlay) {
    return;
  }

  const point = worldToScreen(getBallPosition());
  const radius = layout.ballRadius * layout.pixelScale;
  drawDisc(point, radius * 1.35, SHADOW_COLOR, { x: radius * 0.28, y: radius * 0.36 }, 0.7);
  drawDisc(point, radius, BALL_COLOR);
  drawDisc({ x: point.x - radius * 0.28, y: point.y - radius * 0.28 }, radius * 0.28, "rgba(255,255,255,0.8)");
}

function getSeatHud(color: string) {
  return {
    panel: getElement<HTMLElement>(`${color}-seat`),
    value: getElement<HTMLElement>(`${color}-value`),
    prompt: getElement<HTMLElement>(`${color}-prompt`),
  };
}

function renderUi(): void {
  for (const side of ["left", "right"] as const) {
    const { panel, value, prompt } = seatHud[side];
    const name = panel.querySelector(".seat-heading span")!;
    const label = screens.names[side === "left" ? 0 : 1] + (side === "left" ? " ●" : " ▲");
    if (name.textContent !== label) name.textContent = label;
    const count = kickoffCount(side);
    const score = side === "left" ? leftScore : rightScore;
    const number = didServeInitialKickoff ? String(score) : `${count}/${DEFENDERS_PER_SIDE}`;
    const message = getSeatPrompt(side, count);
    // The HUD is a live region. Announce changes once, not on every frame.
    if (value.textContent !== number) value.textContent = number;
    if (prompt.textContent !== message) prompt.textContent = message;
    panel.classList.toggle("to-shoot", phase === "readyToShoot" && currentTurn === side);
  }
  autoSetupButton.toggleAttribute("disabled", !!lesson || didServeInitialKickoff);
  document.body.classList.toggle("show-setup", phase === "setup");
  document.body.classList.toggle("show-goal", phase === "goalPause");

  const ball = worldToScreen(getBallPosition());
  const radius = layout.ballRadius * layout.pixelScale;
  for (const { panel } of Object.values(seatHud)) {
    const rect = panel.getBoundingClientRect();
    panel.classList.toggle("over-ball", ballInPlay &&
      ball.x + radius >= rect.left && ball.x - radius <= rect.right &&
      ball.y + radius >= rect.top && ball.y - radius <= rect.bottom);
  }
}

function getSeatPrompt(side: PlayerSide, count: number): string {
  switch (phase) {
    case "setup": {
      const inGoalBox = countGoalBoxDefenders(side);
      if (inGoalBox > 1) return "Only 1 piece in your goal box. Move extras outside.";
      if (count === DEFENDERS_PER_SIDE) return inGoalBox === 1 ? "Team ready" : "Place 1 piece in your goal box.";
      return `Place ${DEFENDERS_PER_SIDE} pieces anywhere on your half. Keep 1 in the goal box.`;
    }
    case "readyToShoot":
      if (side === currentTurn) return "Flick the ball";
      return screens.names[currentTurn === "left" ? 0 : 1] + " to shoot";
    case "ballInMotion":
      return "Ball in play";
    case "goalPause":
      return side === lastScoringSide ? "Goal!" : "You kick off next";
  }
}

function kickoffCount(side: PlayerSide): number {
  const count = countDefenders(side);
  if (didServeInitialKickoff || !boardRecovery?.fromPause || !boardRecovery.incompleteAtStart || boardRecovery.continuityConfirmed) return count;
  const now = performance.now();
  const unresolved = [...boardRecovery.displaced.values()].some((at) => now - at <= REDETECTION_WINDOW_MS);
  return unresolved ? Math.min(count, boardRecovery.countsBeforePause[side]) : count;
}

function CanPlayWithCurrentDefenders(): boolean {
  return didServeInitialKickoff || (
    kickoffCount("left") === DEFENDERS_PER_SIDE && kickoffCount("right") === DEFENDERS_PER_SIDE &&
    countGoalBoxDefenders("left") === 1 && countGoalBoxDefenders("right") === 1
  );
}

function getBallPosition(): Vec {
  return ballBody ? { x: ballBody.position.x, y: ballBody.position.y } : { x: 0, y: 0 };
}

function getBallSpeedPerSecond(): number {
  if (!ballBody) {
    return 0;
  }

  return magnitude(Matter.Body.getVelocity(ballBody)) * 60;
}

function worldToScreen(position: Vec): Vec {
  return {
    x: layout.cssWidth * 0.5 + position.x * layout.pixelScale,
    y: layout.cssHeight * 0.5 - position.y * layout.pixelScale,
  };
}

function screenToWorld(position: Vec): Vec {
  return {
    x: (position.x - layout.cssWidth * 0.5) / layout.pixelScale,
    y: (layout.cssHeight * 0.5 - position.y) / layout.pixelScale,
  };
}

function pointerWorldPosition(event: PointerEvent): Vec {
  const rect = canvas.getBoundingClientRect();
  const p = logicalPoint((event.clientX-rect.left)/rect.width, (event.clientY-rect.top)/rect.height);
  return screenToWorld({
    x: p.x * layout.cssWidth,
    y: p.y * layout.cssHeight,
  });
}

function boardContactWorldPosition(contact: Pick<BoardContact, "x" | "y">): Vec {
  const p = logicalPoint(contact.x/BOARD_WIDTH, contact.y/BOARD_HEIGHT);
  return screenToWorld({
    x: p.x * layout.cssWidth,
    y: p.y * layout.cssHeight,
  });
}

function logicalPoint(x: number, y: number): Vec { return flipped ? { x:1-x, y:1-y } : { x,y }; }
function pointerFraction(event: PointerEvent): Vec { return logicalPoint(event.clientX/innerWidth, event.clientY/innerHeight); }

function isActiveContactPhase(phaseValue: BoardContactPhase): boolean {
  return (
    phaseValue !== BoardContactPhase.None &&
    phaseValue !== BoardContactPhase.Ended &&
    phaseValue !== BoardContactPhase.Canceled
  );
}

function isSwipeContactPhase(phaseValue: BoardContactPhase): boolean {
  return (
    isActiveContactPhase(phaseValue) ||
    phaseValue === BoardContactPhase.Ended ||
    phaseValue === BoardContactPhase.Canceled
  );
}

function drawDisc(
  point: Vec,
  radius: number,
  color: string,
  offset: Vec = { x: 0, y: 0 },
  yScale = 1,
): void {
  ctx.save();
  ctx.translate(point.x + offset.x, point.y + offset.y);
  ctx.scale(1, yScale);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function distanceFromPointToSegment(point: Vec, segmentStart: Vec, segmentEnd: Vec): number {
  const segment = subtract(segmentEnd, segmentStart);
  const segmentLengthSquared = dot(segment, segment);
  if (segmentLengthSquared <= Number.EPSILON) {
    return distance(point, segmentStart);
  }

  const projection = clamp(dot(subtract(point, segmentStart), segment) / segmentLengthSquared, 0, 1);
  const closestPoint = add(segmentStart, scaleVector(segment, projection));
  return distance(point, closestPoint);
}

function add(left: Vec, right: Vec): Vec {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Vec, right: Vec): Vec {
  return { x: left.x - right.x, y: left.y - right.y };
}

function scaleVector(vector: Vec, scale: number): Vec {
  return { x: vector.x * scale, y: vector.y * scale };
}

function dot(left: Vec, right: Vec): number {
  return left.x * right.x + left.y * right.y;
}

function magnitude(vector: Vec): number {
  return Math.hypot(vector.x, vector.y);
}

function normalize(vector: Vec): Vec {
  const length = magnitude(vector);
  if (length <= Number.EPSILON) {
    return { x: 0, y: 0 };
  }

  return { x: vector.x / length, y: vector.y / length };
}

function distance(left: Vec, right: Vec): number {
  return magnitude(subtract(left, right));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function inverseLerp(start: number, end: number, value: number): number {
  if (Math.abs(end - start) <= Number.EPSILON) {
    return 0;
  }

  return clamp((value - start) / (end - start), 0, 1);
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }

  return element as T;
}

function get2dContext(targetCanvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = targetCanvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas is not available");
  }

  return context;
}
