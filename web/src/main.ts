import {
  Board,
  BoardContactPhase,
  BoardContactType,
  type BoardContact,
} from "@harrishill/board-sdk";
import Matter from "matter-js";

type Vec = {
  x: number;
  y: number;
};

type PlayerSide = "left" | "right";
type MatchPhase = "setup" | "readyToShoot" | "ballInMotion" | "goalPause";

type ContactWorldState = {
  contactId: number;
  worldPosition: Vec;
};

type DefenderSlot = {
  side: PlayerSide;
  contactId: number;
  position: Vec;
  body: Matter.Body | null;
  occupied: boolean;
};

type SwipeContactState = {
  lastWorldPosition: Vec;
  lastTimestamp: number;
  hasLaunched: boolean;
};

type SimulatedContact = {
  contactId: number;
  position: Vec;
};

type Layout = {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  pixelScale: number;
  viewHalfWidth: number;
  viewHalfHeight: number;
  fieldBackgroundWidth: number;
  fieldBackgroundHeight: number;
  pitchHalfWidth: number;
  pitchHalfHeight: number;
  uniformScale: number;
  wallThickness: number;
  defenderRadius: number;
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
const FIELD_BACKGROUND_ASPECT = 1920 / 1080;
const GOAL_MOUTH_TOP_PIXEL_Y = 374;
const GOAL_MOUTH_BOTTOM_PIXEL_Y = 704;
const FIELD_BACKGROUND_PIXEL_HEIGHT = 1080;
const DEFENDERS_PER_SIDE = 8;
const OFF_BOARD_GOAL_CLEARANCE = 0.22;
const WALL_THICKNESS = 0.22;
const GOAL_DEPTH = 0.9;
const DEFENDER_RADIUS = 0.32;
const BALL_RADIUS = 0.2;
const BALL_SWIPE_CAPTURE_RADIUS = 0.55;
const MIN_SWIPE_TRAVEL_DISTANCE = 0.05;
const MIN_SWIPE_SPEED = 2.5;
const MAX_SWIPE_SPEED = 22;
const MIN_SHOT_IMPULSE = 2.4;
const MAX_SHOT_IMPULSE = 14.5;
const BALL_REST_VELOCITY = 0.35;
const BALL_REST_TIME = 0.1;
const GOAL_PAUSE_DURATION = 1.15;
const SCORE_DISPLAY_DURATION = 5;
const FIXED_STEP_MS = 1000 / 60;
const FIELD_IMAGE_URL = "assets/field_background.png";
const MATTER_SHOT_VELOCITY_SCALE = 0.035;

const FIELD_EDGE_COLOR = "#071f0d";
const BACKGROUND_COLOR = "#e5ebe7";
const LEFT_COLOR = "#38bdf8";
const RIGHT_COLOR = "#f6a638";
const BALL_COLOR = "#fbfbfa";
const SHADOW_COLOR = "rgba(0, 0, 0, 0.2)";

const canvas = getElement<HTMLCanvasElement>("game-canvas");
const ctx = get2dContext(canvas);
const scoreEl = getElement<HTMLElement>("score");
const statusEl = getElement<HTMLElement>("status");
const setupEl = getElement<HTMLElement>("setup");
const autoSetupButton = getElement<HTMLButtonElement>("auto-setup-button");
const resetButton = getElement<HTMLButtonElement>("reset-button");

const engine = Matter.Engine.create({ enableSleeping: false });
engine.gravity.x = 0;
engine.gravity.y = 0;

let layout = createLayout();
let ballBody: Matter.Body | null = null;
let ballInPlay = true;
let lastFrameTimestamp = performance.now();
let accumulatorMs = 0;
let phase: MatchPhase = "setup";
let currentTurn: PlayerSide = "left";
let lastScoringSide: PlayerSide = "left";
let leftScore = 0;
let rightScore = 0;
let ballStillTimer = 0;
let goalPauseTimer = 0;
let scoreDisplayTimer = 0;
let didPrepareInitialKickoff = false;
let didServeInitialKickoff = false;
let fieldImageLoaded = false;

const fieldImage = new Image();
fieldImage.onload = () => {
  fieldImageLoaded = true;
};
fieldImage.src = FIELD_IMAGE_URL;

const leftSlots: DefenderSlot[] = [];
const rightSlots: DefenderSlot[] = [];
const allSlots: DefenderSlot[] = [];
const wallBodies: Matter.Body[] = [];
const boardSwipeContacts = new Map<number, SwipeContactState>();
const latestBoardGlyphs = new Map<number, ContactWorldState>();
const simulatedContacts = new Map<number, SimulatedContact>();
const pointerSwipeContacts = new Map<number, SwipeContactState>();
const pointerDefenderDrags = new Map<number, number>();
const ballTrail: Vec[] = [];

let nextSimulatedContactId = 1000;

document.body.classList.toggle("board-device", Board.isOnDevice);
document.body.classList.toggle("browser-preview", !Board.isOnDevice);

createSlots();
resize();
wireControls();
wirePointerFallback();
wireBoard();
requestAnimationFrame(frame);

function wireControls(): void {
  window.addEventListener("resize", resize);
  autoSetupButton.addEventListener("click", autoSetupDefenders);
  resetButton.addEventListener("click", resetMatch);
}

function wireBoard(): void {
  if (!Board.isOnDevice) {
    return;
  }

  Board.pause.setContext({
    gameName: "Board Binho",
    offerSaveOption: false,
    customButtons: [{ id: "restart", title: "Restart", icon: "circulararrow" }],
  });
  Board.input.subscribe(handleBoardContacts);

  window.setInterval(() => {
    const result = Board.pause.pollResult();
    if (result?.action === "custom_button" && result.customButtonId === "restart") {
      resetMatch();
    }
  }, 500);
}

function handleBoardContacts(contacts: ReadonlyArray<BoardContact>): void {
  latestBoardGlyphs.clear();
  const fingerContacts: BoardContact[] = [];
  const now = performance.now() / 1000;

  for (const contact of contacts) {
    if (!isActiveContactPhase(contact.phase)) {
      continue;
    }

    if (contact.type === BoardContactType.Glyph) {
      latestBoardGlyphs.set(contact.contactId, {
        contactId: contact.contactId,
        worldPosition: screenToWorld({ x: contact.x, y: contact.y }),
      });
    } else {
      fingerContacts.push(contact);
    }
  }

  handleBoardFingerShotInput(fingerContacts, now);
}

function handleBoardFingerShotInput(fingers: ReadonlyArray<BoardContact>, now: number): void {
  if (phase === "setup" || phase === "goalPause") {
    pruneSwipeContactState(boardSwipeContacts, fingers.map((contact) => contact.contactId));
    return;
  }

  const seenFingerIds = new Set<number>();

  for (const contact of fingers) {
    seenFingerIds.add(contact.contactId);
    const worldPosition = screenToWorld({ x: contact.x, y: contact.y });
    const existing = boardSwipeContacts.get(contact.contactId);

    if (!existing || contact.phase === BoardContactPhase.Began) {
      boardSwipeContacts.set(contact.contactId, {
        lastWorldPosition: worldPosition,
        lastTimestamp: now,
        hasLaunched: false,
      });
      continue;
    }

    updateSwipeState(boardSwipeContacts, contact.contactId, existing, worldPosition, now);
  }

  pruneSwipeContactState(boardSwipeContacts, Array.from(seenFingerIds));
}

function wirePointerFallback(): void {
  canvas.addEventListener("pointerdown", (event) => {
    const worldPosition = pointerWorldPosition(event);

    if (!Board.isOnDevice && CanLaunchSwipe() && distance(worldPosition, getBallPosition()) <= layout.ballSwipeCaptureRadius) {
      canvas.setPointerCapture(event.pointerId);
      pointerSwipeContacts.set(event.pointerId, {
        lastWorldPosition: worldPosition,
        lastTimestamp: performance.now() / 1000,
        hasLaunched: false,
      });
      event.preventDefault();
      return;
    }

    if (!Board.isOnDevice && canPlaceBrowserDefender(worldPosition)) {
      const contactId = beginBrowserDefenderDrag(worldPosition);
      if (contactId >= 0) {
        canvas.setPointerCapture(event.pointerId);
        pointerDefenderDrags.set(event.pointerId, contactId);
        event.preventDefault();
      }
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    const worldPosition = pointerWorldPosition(event);
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
      pointerSwipeContacts,
      event.pointerId,
      swipe,
      worldPosition,
      performance.now() / 1000,
    );
    event.preventDefault();
  });

  const finishPointer = (event: PointerEvent): void => {
    pointerSwipeContacts.delete(event.pointerId);
    pointerDefenderDrags.delete(event.pointerId);
  };

  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
}

function updateSwipeState(
  contacts: Map<number, SwipeContactState>,
  contactId: number,
  swipeContact: SwipeContactState,
  worldPosition: Vec,
  now: number,
): void {
  if (swipeContact.hasLaunched || !CanLaunchSwipe()) {
    contacts.set(contactId, {
      ...swipeContact,
      lastWorldPosition: worldPosition,
      lastTimestamp: now,
    });
    return;
  }

  if (
    TryLaunchSwipe(
      swipeContact,
      worldPosition,
      Math.max(now - swipeContact.lastTimestamp, 1 / 240),
    )
  ) {
    contacts.set(contactId, {
      lastWorldPosition: worldPosition,
      lastTimestamp: now,
      hasLaunched: true,
    });
    return;
  }

  contacts.set(contactId, {
    ...swipeContact,
    lastWorldPosition: worldPosition,
    lastTimestamp: now,
  });
}

function frame(timestamp: number): void {
  const deltaMs = Math.min(timestamp - lastFrameTimestamp, 100);
  lastFrameTimestamp = timestamp;
  accumulatorMs += deltaMs;

  updateTimers(deltaMs / 1000);
  UpdateDefenderPlacements();
  UpdateMatchPhaseFromPlacements();

  while (accumulatorMs >= FIXED_STEP_MS) {
    fixedStep(FIXED_STEP_MS / 1000);
    accumulatorMs -= FIXED_STEP_MS;
  }

  render();
  requestAnimationFrame(frame);
}

function updateTimers(deltaSeconds: number): void {
  if (scoreDisplayTimer > 0) {
    scoreDisplayTimer = Math.max(0, scoreDisplayTimer - deltaSeconds);
  }

  if (phase !== "goalPause") {
    return;
  }

  goalPauseTimer += deltaSeconds;
  if (goalPauseTimer >= GOAL_PAUSE_DURATION) {
    goalPauseTimer = 0;
    ResetBallToCenter();
    currentTurn = lastScoringSide === "left" ? "right" : "left";
    phase = CanPlayWithCurrentDefenders() ? "readyToShoot" : "setup";
  }
}

function fixedStep(deltaSeconds: number): void {
  if (phase === "goalPause") {
    return;
  }

  if (phase !== "setup" && ballInPlay) {
    Matter.Engine.update(engine, FIXED_STEP_MS);
    constrainBallSpeed();
    updateBallTrail();
  }

  CheckForGoal();
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

  layout = createLayout(cssWidth, cssHeight, dpr);
  rebuildPhysicsWorld();
}

function createLayout(
  cssWidth = Math.max(1, window.innerWidth),
  cssHeight = Math.max(1, window.innerHeight),
  dpr = Math.max(1, window.devicePixelRatio || 1),
): Layout {
  const viewHalfHeight = 5.5;
  const viewHalfWidth = viewHalfHeight * (cssWidth / cssHeight);
  const screenWidth = viewHalfWidth * 2;
  const screenHeight = viewHalfHeight * 2;
  const screenAspect = screenWidth / screenHeight;
  const fieldBackgroundSize =
    screenAspect > FIELD_BACKGROUND_ASPECT
      ? { x: screenHeight * FIELD_BACKGROUND_ASPECT, y: screenHeight }
      : { x: screenWidth, y: screenWidth / FIELD_BACKGROUND_ASPECT };
  const fieldBackgroundHalfWidth = fieldBackgroundSize.x * 0.5;
  const fieldBackgroundHalfHeight = fieldBackgroundSize.y * 0.5;
  const goalDisplayHalfWidth =
    FIELD_WIDTH * 0.5 + GOAL_DEPTH + WALL_THICKNESS + OFF_BOARD_GOAL_CLEARANCE;
  const uniformScale =
    Math.min(fieldBackgroundHalfWidth / goalDisplayHalfWidth, fieldBackgroundHalfHeight / (FIELD_HEIGHT * 0.5)) *
    FIELD_SCREEN_FILL;
  const pixelScale = Math.min(cssWidth / screenWidth, cssHeight / screenHeight);
  const scale = (value: number): number => value * uniformScale;
  const goalMouthTopY = lerp(
    fieldBackgroundHalfHeight,
    -fieldBackgroundHalfHeight,
    GOAL_MOUTH_TOP_PIXEL_Y / FIELD_BACKGROUND_PIXEL_HEIGHT,
  );
  const goalMouthBottomY = lerp(
    fieldBackgroundHalfHeight,
    -fieldBackgroundHalfHeight,
    GOAL_MOUTH_BOTTOM_PIXEL_Y / FIELD_BACKGROUND_PIXEL_HEIGHT,
  );

  return {
    cssWidth,
    cssHeight,
    dpr,
    pixelScale,
    viewHalfWidth,
    viewHalfHeight,
    fieldBackgroundWidth: fieldBackgroundSize.x,
    fieldBackgroundHeight: fieldBackgroundSize.y,
    pitchHalfWidth: fieldBackgroundHalfWidth,
    pitchHalfHeight: fieldBackgroundHalfHeight,
    uniformScale,
    wallThickness: scale(WALL_THICKNESS),
    defenderRadius: scale(DEFENDER_RADIUS),
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

function rebuildPhysicsWorld(): void {
  Matter.Composite.clear(engine.world, false);
  wallBodies.length = 0;
  ballBody = null;

  buildWalls();
  ballBody = Matter.Bodies.circle(0, 0, layout.ballRadius, {
    label: "ball",
    restitution: 0.94,
    friction: 0.02,
    frictionStatic: 0,
    frictionAir: 0.018,
    density: 0.002,
  });
  Matter.Composite.add(engine.world, ballBody);

  for (const slot of allSlots) {
    slot.body = null;
    syncSlotBody(slot);
  }

  ResetBallToCenter();
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
  wallBodies.push(wall);
  Matter.Composite.add(engine.world, wall);
}

function createSlots(): void {
  for (let i = 0; i < DEFENDERS_PER_SIDE; i += 1) {
    leftSlots.push(createSlot("left"));
    rightSlots.push(createSlot("right"));
  }
}

function createSlot(side: PlayerSide): DefenderSlot {
  const slot: DefenderSlot = {
    side,
    contactId: -1,
    position: { x: 0, y: 0 },
    body: null,
    occupied: false,
  };
  allSlots.push(slot);
  return slot;
}

function UpdateDefenderPlacements(): void {
  const activeGlyphs = getActiveGlyphContacts();

  if (phase === "ballInMotion") {
    updateDefenderRemovalsDuringBallInMotion(activeGlyphs);
    return;
  }

  for (const slot of allSlots) {
    slot.contactId = -1;
  }

  AssignSlots(leftSlots, activeGlyphs, "left");
  AssignSlots(rightSlots, activeGlyphs, "right");

  for (const slot of allSlots) {
    setSlotOccupied(slot, slot.contactId >= 0);
  }
}

function getActiveGlyphContacts(): ContactWorldState[] {
  const contacts = Board.isOnDevice
    ? Array.from(latestBoardGlyphs.values())
    : Array.from(simulatedContacts.values()).map((contact) => ({
        contactId: contact.contactId,
        worldPosition: contact.position,
      }));

  return contacts
    .filter((contact) => IsContactOnSide(contact.worldPosition, "left") || IsContactOnSide(contact.worldPosition, "right"))
    .sort((left, right) => left.contactId - right.contactId);
}

function updateDefenderRemovalsDuringBallInMotion(activeGlyphs: ContactWorldState[]): void {
  const activeContactIds = new Set(activeGlyphs.map((contact) => contact.contactId));
  for (const slot of allSlots) {
    if (slot.contactId < 0 || activeContactIds.has(slot.contactId)) {
      continue;
    }

    slot.contactId = -1;
    setSlotOccupied(slot, false);
  }
}

function AssignSlots(slots: DefenderSlot[], contacts: ContactWorldState[], side: PlayerSide): void {
  let slotIndex = 0;
  for (const contact of contacts) {
    if (slotIndex >= slots.length) {
      return;
    }

    if (!IsContactOnSide(contact.worldPosition, side)) {
      continue;
    }

    const slot = slots[slotIndex];
    slot.contactId = contact.contactId;
    slot.position = contact.worldPosition;
    slotIndex += 1;
  }
}

function IsContactOnSide(position: Vec, side: PlayerSide): boolean {
  const minX = -layout.pitchHalfWidth + layout.defenderRadius;
  const maxX = layout.pitchHalfWidth - layout.defenderRadius;
  const minY = -layout.pitchHalfHeight + layout.defenderRadius;
  const maxY = layout.pitchHalfHeight - layout.defenderRadius;
  if (position.y < minY || position.y > maxY) {
    return false;
  }

  if (side === "left") {
    return position.x >= minX && position.x < 0;
  }

  return position.x <= maxX && position.x > 0;
}

function setSlotOccupied(slot: DefenderSlot, occupied: boolean): void {
  slot.occupied = occupied;
  syncSlotBody(slot);
}

function syncSlotBody(slot: DefenderSlot): void {
  if (!slot.occupied) {
    if (slot.body) {
      Matter.Composite.remove(engine.world, slot.body);
      slot.body = null;
    }
    return;
  }

  if (!slot.body) {
    slot.body = Matter.Bodies.circle(slot.position.x, slot.position.y, layout.defenderRadius, {
      label: "defender",
      isStatic: true,
      restitution: 0.94,
      friction: 0.05,
      frictionStatic: 0,
    });
    Matter.Composite.add(engine.world, slot.body);
    return;
  }

  Matter.Body.setPosition(slot.body, slot.position);
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
  if (phase === "setup" || phase === "goalPause") {
    return false;
  }

  if (!CanPlayWithCurrentDefenders() || !ballBody || !IsBallSlowEnoughForNextShot()) {
    return false;
  }

  TryCompleteShotTurnIfSettled();
  return phase === "readyToShoot";
}

function TryLaunchSwipe(
  swipeContact: SwipeContactState,
  currentWorldPosition: Vec,
  deltaTime: number,
): boolean {
  if (!CanLaunchSwipe() || !ballBody) {
    return false;
  }

  const swipeVector = subtract(currentWorldPosition, swipeContact.lastWorldPosition);
  const swipeDistance = magnitude(swipeVector);
  if (swipeDistance < layout.minSwipeTravelDistance) {
    return false;
  }

  if (
    distanceFromPointToSegment(
      getBallPosition(),
      swipeContact.lastWorldPosition,
      currentWorldPosition,
    ) > layout.ballSwipeCaptureRadius
  ) {
    return false;
  }

  const swipeSpeed = swipeDistance / Math.max(deltaTime, 1 / 240);
  if (swipeSpeed < layout.minSwipeSpeed) {
    return false;
  }

  const swipeStrength = inverseLerp(layout.minSwipeSpeed, layout.maxSwipeSpeed, swipeSpeed);
  const impulseMagnitude = lerp(layout.minShotImpulse, layout.maxShotImpulse, swipeStrength);
  LaunchShot(scaleVector(normalize(swipeVector), impulseMagnitude));
  return true;
}

function LaunchShot(impulse: Vec): void {
  if (!ballBody) {
    return;
  }

  didServeInitialKickoff = true;
  CancelActiveShot();
  ballInPlay = true;
  Matter.Body.setVelocity(ballBody, scaleVector(impulse, MATTER_SHOT_VELOCITY_SCALE));
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
  if (
    position.y > layout.goalMouthTopY - layout.uniformScale * 0.05 ||
    position.y < layout.goalMouthBottomY + layout.uniformScale * 0.05
  ) {
    return;
  }

  if (position.x <= -layout.goalScoreLineX) {
    RegisterGoal("right");
  } else if (position.x >= layout.goalScoreLineX) {
    RegisterGoal("left");
  }
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
  scoreDisplayTimer = SCORE_DISPLAY_DURATION;
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
  leftScore = 0;
  rightScore = 0;
  ballStillTimer = 0;
  goalPauseTimer = 0;
  scoreDisplayTimer = 0;
  didPrepareInitialKickoff = false;
  didServeInitialKickoff = false;
  currentTurn = "left";
  lastScoringSide = "left";
  phase = "setup";
  CancelActiveShot();
  StopBall();
  ResetBallToCenter();

  if (!Board.isOnDevice) {
    simulatedContacts.clear();
  }
}

function autoSetupDefenders(): void {
  if (Board.isOnDevice) {
    return;
  }

  simulatedContacts.clear();
  const leftXs = [-layout.pitchHalfWidth * 0.64, -layout.pitchHalfWidth * 0.34];
  const rightXs = [layout.pitchHalfWidth * 0.34, layout.pitchHalfWidth * 0.64];
  const ys = [-layout.pitchHalfHeight * 0.58, -layout.pitchHalfHeight * 0.22, layout.pitchHalfHeight * 0.22, layout.pitchHalfHeight * 0.58];

  for (const x of leftXs) {
    for (const y of ys) {
      addSimulatedDefender({ x, y });
    }
  }

  for (const x of rightXs) {
    for (const y of ys) {
      addSimulatedDefender({ x, y });
    }
  }
}

function canPlaceBrowserDefender(position: Vec): boolean {
  if (didServeInitialKickoff && phase !== "setup" && phase !== "readyToShoot") {
    return false;
  }

  return IsContactOnSide(position, "left") || IsContactOnSide(position, "right");
}

function beginBrowserDefenderDrag(position: Vec): number {
  const existing = findNearestSimulatedDefender(position);
  if (existing) {
    existing.position = clampDefenderPosition(position);
    return existing.contactId;
  }

  const side = position.x < 0 ? "left" : "right";
  const sideCount = Array.from(simulatedContacts.values()).filter((contact) =>
    IsContactOnSide(contact.position, side),
  ).length;
  if (sideCount >= DEFENDERS_PER_SIDE) {
    return -1;
  }

  return addSimulatedDefender(position);
}

function addSimulatedDefender(position: Vec): number {
  const contactId = nextSimulatedContactId;
  nextSimulatedContactId += 1;
  simulatedContacts.set(contactId, {
    contactId,
    position: clampDefenderPosition(position),
  });
  return contactId;
}

function moveBrowserDefender(contactId: number, position: Vec): void {
  const contact = simulatedContacts.get(contactId);
  if (!contact) {
    return;
  }

  contact.position = clampDefenderPosition(position);
}

function findNearestSimulatedDefender(position: Vec): SimulatedContact | null {
  let nearest: SimulatedContact | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const contact of simulatedContacts.values()) {
    const d = distance(contact.position, position);
    if (d < nearestDistance && d <= layout.defenderRadius * 2.1) {
      nearest = contact;
      nearestDistance = d;
    }
  }

  return nearest;
}

function clampDefenderPosition(position: Vec): Vec {
  const side: PlayerSide = position.x < 0 ? "left" : "right";
  const minX = -layout.pitchHalfWidth + layout.defenderRadius;
  const maxX = layout.pitchHalfWidth - layout.defenderRadius;
  const minY = -layout.pitchHalfHeight + layout.defenderRadius;
  const maxY = layout.pitchHalfHeight - layout.defenderRadius;
  const x = clamp(position.x, minX, maxX);

  return {
    x: side === "left" ? Math.min(x, -layout.defenderRadius) : Math.max(x, layout.defenderRadius),
    y: clamp(position.y, minY, maxY),
  };
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

function render(): void {
  ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, layout.cssWidth, layout.cssHeight);

  renderField();
  renderTrail();
  renderDefenders();
  renderBall();
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
  for (const slot of allSlots) {
    if (!slot.occupied) {
      continue;
    }

    const point = worldToScreen(slot.position);
    const radius = layout.defenderRadius * layout.pixelScale;
    drawDisc(point, radius * 1.16, SHADOW_COLOR, { x: radius * 0.15, y: radius * 0.2 }, 0.72);
    drawDisc(point, radius, slot.side === "left" ? LEFT_COLOR : RIGHT_COLOR);
    drawDisc(point, radius * 0.52, "rgba(255,255,255,0.9)");
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

function renderUi(): void {
  scoreEl.textContent = `Blue ${leftScore} - ${rightScore} Orange`;
  statusEl.textContent = getStatusMessage();
  setupEl.textContent = `Blue defenders: ${countOccupied(leftSlots)}/${leftSlots.length}    Orange defenders: ${countOccupied(rightSlots)}/${rightSlots.length}`;
  document.body.classList.toggle("show-score", scoreDisplayTimer > 0 || didServeInitialKickoff);
  document.body.classList.toggle("show-setup", shouldShowSetupInstructions());
}

function shouldShowSetupInstructions(): boolean {
  return !didServeInitialKickoff || phase === "setup";
}

function getStatusMessage(): string {
  if (!Board.isOnDevice && phase === "setup" && simulatedContacts.size === 0) {
    return "Browser preview. Place defenders or use auto setup.";
  }

  switch (phase) {
    case "setup":
      return `Place ${DEFENDERS_PER_SIDE} robot defenders anywhere on each team's half.`;
    case "readyToShoot":
      return `${getTurnLabel()} to shoot.`;
    case "ballInMotion":
      return "Ball in play.";
    case "goalPause":
      return `${lastScoringSide === "left" ? "Blue" : "Orange"} scores!`;
  }
}

function getTurnLabel(): string {
  return currentTurn === "left" ? "Blue" : "Orange";
}

function AllSlotsOccupied(): boolean {
  return countOccupied(leftSlots) === leftSlots.length && countOccupied(rightSlots) === rightSlots.length;
}

function CanPlayWithCurrentDefenders(): boolean {
  return didServeInitialKickoff || AllSlotsOccupied();
}

function countOccupied(slots: DefenderSlot[]): number {
  return slots.reduce((total, slot) => total + (slot.contactId >= 0 ? 1 : 0), 0);
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
  return screenToWorld({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
}

function isActiveContactPhase(phaseValue: BoardContactPhase): boolean {
  return (
    phaseValue !== BoardContactPhase.None &&
    phaseValue !== BoardContactPhase.Ended &&
    phaseValue !== BoardContactPhase.Canceled
  );
}

function pruneSwipeContactState(contacts: Map<number, SwipeContactState>, activeContactIds: number[]): void {
  const active = new Set(activeContactIds);
  for (const contactId of contacts.keys()) {
    if (!active.has(contactId)) {
      contacts.delete(contactId);
    }
  }
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
