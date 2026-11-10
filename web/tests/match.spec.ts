import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { BoardContactPhase as Phase, BoardContactType as Type } from "@board.fun/web-sdk";

function contact(id: number, g: number, x: number, y: number, t = Type.Glyph, p = Phase.Began, o = 0) {
  return { id, g, x, y, t, p, o, touched: 0 };
}

const supportLineup = [
  contact(21, 3, 90, 420), contact(22, 4, 500, 850),
  contact(25, 7, 1830, 420), contact(26, 8, 1420, 850),
];
const lineup = [
  contact(11, 1, 320, 300), contact(12, 2, 650, 300),
  contact(15, 5, 1270, 300), contact(16, 6, 1600, 300),
  ...supportLineup,
];

async function openGame(page: Page, board = false, { observeTouch = false } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem("flick-soccer:tutorial-groups", JSON.stringify([
      JSON.stringify(["browser-blue", "browser-orange"]), JSON.stringify(["test-blue", "test-orange"]),
    ]));
  });
  // The test host implements just the native wire interface. The actual
  // vendored SDK must translate frames and remove Ended/Canceled contacts.
  if (board) {
    await page.addInitScript((observeTouch) => {
      Object.assign(window, {
        BoardSDK: {
          setPauseContext() {},
          getPlayers() { return JSON.stringify([
            { playerId:"test-blue", sessionId:1, name:"Blue", type:"profile", avatarId:"0" },
            { playerId:"test-orange", sessionId:2, name:"Orange", type:"profile", avatarId:"0" },
          ]); },
          quit() { document.documentElement.dataset.quit = "true"; },
        },
        boardTouch: { postMessage() {} },
      });
      if (observeTouch) {
        // Studio's boot probe returns a stable dispatcher from its getter.
        // That dispatcher calls the latest listener supplied to its setter.
        const channel = window.boardTouch!;
        let listener: typeof channel.onmessage;
        let frames = 0;
        const dispatch = (event: MessageEvent) => {
          document.documentElement.dataset.hostFrames = String(++frames);
          listener?.call(channel, event);
        };
        Object.defineProperty(channel, "onmessage", {
          configurable: true,
          get: () => listener && dispatch,
          set: (next) => { listener = next; },
        });
        channel.postMessage = () => queueMicrotask(() => {
          channel.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ c: [] }) }));
        });
      }
    }, observeTouch);
  }
  // Explicit steps make short flicks, ball travel, and goal pauses repeatable.
  await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T12:00:01Z"));
  await page.goto("/");
  await page.locator("#home-play").click();
  await page.locator("#mode-play").click();
  if (!board) {
    await page.getByRole("button", { name: "Add player" }).click();
    await page.locator("#preview-choices").getByRole("button", { name: "Orange", exact: true }).click();
  }
  await page.locator("#continue").click();
  await page.clock.runFor(32);
  await expect(page.locator("#blue-value")).toHaveText("0/4");
}

async function frame(page: Page, ...events: ReturnType<typeof contact>[]) {
  await page.evaluate((c) => {
    window.boardTouch!.onmessage!(new MessageEvent("message", { data: JSON.stringify({ c }) }));
  }, events);
  await page.clock.runFor(16);
}

async function binaryFrame(page: Page, ...events: ReturnType<typeof contact>[]) {
  await page.evaluate((contacts) => {
    const buffer = new ArrayBuffer(12 + contacts.length * 36);
    const view = new DataView(buffer);
    view.setInt32(8, contacts.length, true);
    contacts.forEach(({ id, x, y, o, t, p, g }, index) => {
      const offset = 12 + index * 36;
      view.setInt32(offset, id, true);
      view.setFloat32(offset + 4, x, true);
      view.setFloat32(offset + 8, y, true);
      view.setFloat32(offset + 12, o, true);
      view.setInt32(offset + 16, t, true);
      view.setInt32(offset + 20, p, true);
      view.setInt32(offset + 24, g, true);
    });
    window.boardTouch!.onmessage!(new MessageEvent("message", { data: buffer }));
  }, events);
  await page.clock.runFor(16);
}

async function flickOnBoard(page: Page) {
  await frame(page, contact(90, 0, 960, 540, Type.Finger));
  await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Moved));
  await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Ended));
  await expect(page.locator("#blue-prompt")).toHaveText("Ball in play");
}

async function restartBoardMatch(page: Page) {
  await page.evaluate(() => window.__board!.onPauseResult(JSON.stringify({ action: "CUSTOM_ACTION", customButtonId: "restart" })));
}

test("the shipped touch model matches the Sports v0.1.0 catalog", () => {
  const file = readFileSync(new URL("../public/model.tflite", import.meta.url));
  expect(createHash("sha256").update(file).digest("hex"))
    .toBe("4d75343e149b72f8410cad10f518c64791634ae6e6932880088a34c164026ad9");
});

test("a browser shot survives a resize, scores once and gives Orange the kickoff", async ({ page }) => {
  await openGame(page);
  await page.getByRole("button", { name: "Auto setup" }).click({ force: true });
  await page.clock.runFor(32);
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");

  await page.mouse.move(480, 270);
  await page.mouse.down();
  await page.clock.runFor(16);
  await page.mouse.move(565, 270);
  await page.mouse.up();
  await page.clock.runFor(48);
  await page.setViewportSize({ width: 720, height: 960 });
  await page.clock.runFor(160);
  await expect(page.locator("#blue-prompt")).toHaveText("Ball in play");
  await page.clock.runFor(450);
  await expect(page.locator("#blue-value")).toHaveText("1");
  await expect(page.locator("#blue-prompt")).toHaveText("Goal!");
  await page.clock.runFor(1300);
  await expect(page.locator("#orange-prompt")).toHaveText("Flick the ball");

  await page.getByRole("button", { name: "Reset" }).click({ force: true });
  await page.clock.runFor(32);
  await expect(page.locator("#blue-value")).toHaveText("0/4");
  await expect(page.locator("#orange-value")).toHaveText("0/4");
});

test("eight Board blockers enable kickoff without circle markers, and hands do not count", async ({ page }) => {
  await openGame(page, true);
  await expect(page.getByRole("button", { name: "Auto setup" })).toBeHidden();
  const canvasPixels = () => page.locator("#game-canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  const emptyPitch = await canvasPixels();
  await frame(page, ...lineup.slice(1),
    contact(40, 1, 320, 300, Type.Blob), contact(41, 9, 330, 300), contact(42, 1, 960, 540));
  await expect(page.locator("#blue-value")).toHaveText("3/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
  // The extra hockey player has its own contactId, even though its glyph is already in play.
  await frame(page, contact(11, 2, 320, 300));
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  expect(await canvasPixels() === emptyPitch).toBe(true);
  await page.clock.runFor(650);
  expect(await canvasPixels() === emptyPitch).toBe(true);
  await frame(page, contact(90, 0, 960, 540, Type.Finger));
  await frame(page, contact(90, 0, 1080, 540, Type.Finger, Phase.Moved),
    contact(11, 2, 320, 300, Type.Glyph, Phase.Ended));
  await expect(page.locator("#blue-value")).toHaveText("3/4");
  await expect(page.locator("#blue-prompt")).toContainText("Place");
});

test("manual browser placement caps each half at four and keeps dragged pieces on their side", async ({ page }) => {
  await openGame(page);
  for (const [x, y] of [[145, 150], [315, 390], [45, 210], [240, 450], [240, 270]]) {
    await page.mouse.click(x, y);
  }
  await page.clock.runFor(32);
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#orange-value")).toHaveText("0/4");
  await page.mouse.move(145, 150);
  await page.mouse.down();
  await page.mouse.move(700, 150);
  await page.mouse.up();
  for (const [x, y] of [[635, 150], [815, 390], [915, 210], [710, 450]]) {
    await page.mouse.click(x, y);
  }
  await page.clock.runFor(32);
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
});

for (const side of ["left", "right"] as const) {
  test(`the ${side} goal box allows one blocker and rejects a second even during a flick or table flip`, async ({ page }) => {
    await openGame(page, true);
    await frame(page, ...lineup);
    const team = side === "left" ? "blue" : "orange";
    const otherTeam = side === "left" ? "orange" : "blue";
    const first = side === "left" ? supportLineup[0] : supportLineup[2];
    const second = side === "left" ? lineup[1] : lineup[3];
    const x = side === "left" ? 90 : 1830;
    await frame(page, { ...first, x: side === "left" ? 400 : 1520, y: 620, p: Phase.Moved });
    await expect(page.locator(`#${team}-value`)).toHaveText("4/4");
    await expect(page.locator(`#${team}-prompt`)).toHaveText("Place 1 piece in your goal box.");
    await frame(page, contact(90, 0, 960, 540, Type.Finger));
    await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Ended));
    await expect(page.locator(`#${team}-prompt`)).toHaveText("Place 1 piece in your goal box.");
    await frame(page, { ...first, x, y: 460, p: Phase.Moved });
    await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");

    await frame(page, contact(90, 0, 960, 540, Type.Finger));
    await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Moved),
      { ...second, x, y: 620, p: Phase.Moved });
    await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Ended));
    await expect(page.locator(`#${team}-value`)).toHaveText("4/4");
    await expect(page.locator(`#${team}-prompt`)).toHaveText("Only 1 piece in your goal box. Move extras outside.");
    await expect(page.locator(`#${otherTeam}-prompt`)).toHaveText("Team ready");

    await page.locator("#flip").click();
    await page.clock.runFor(32);
    await expect(page.locator(`#${otherTeam}-prompt`)).toContainText("Only 1 piece");
    await frame(page, { ...second, x: side === "left" ? 400 : 1520, y: 620, p: Phase.Moved });
    await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
    await flickOnBoard(page);
  });
}

test("goal-box placement uses the touched, rotated base and counts pieces straddling the line", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup.filter(({ id }) => id !== 12), contact(12, 5, 210, 620, Type.Glyph, Phase.Began, 90));
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  const rotate = (touched: number) => frame(page, { ...contact(12, 5, 210, 620, Type.Glyph, Phase.Moved, 0), touched });
  await rotate(0);
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await rotate(1);
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#blue-prompt")).toContainText("Only 1 piece");
  await frame(page, contact(12, 5, 320, 620, Type.Glyph, Phase.Moved));
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
});

test("goal-box limits include the painted top and bottom lines, not the larger penalty area", async ({ page }) => {
  await openGame(page, true);
  // Both copies sit in the penalty area, but only the lower one overlaps the
  // small goal box. The other base initially clears its top line by half a pixel.
  await frame(page, ...lineup.filter(({ id }) => id !== 12), contact(21, 3, 90, 540, Type.Glyph, Phase.Moved), contact(12, 1, 90, 312));
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await frame(page, contact(12, 1, 90, 313, Type.Glyph, Phase.Moved));
  await expect(page.locator("#blue-prompt")).toContainText("Only 1 piece");
  await frame(page, contact(12, 1, 90, 767, Type.Glyph, Phase.Moved));
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await frame(page, contact(12, 1, 90, 766, Type.Glyph, Phase.Moved));
  await expect(page.locator("#blue-prompt")).toContainText("Only 1 piece");
});

test("browser setup permits free placement and dragging while enforcing the goal-box limit", async ({ page }) => {
  await openGame(page);
  await expect(page.locator("#blue-prompt")).toContainText("anywhere on your half");
  await expect(page.locator("#blue-prompt")).toContainText("Keep 1 in the goal box");
  for (const [x, y] of [[45, 230], [45, 310], [245, 420], [145, 150], [635, 150], [815, 390], [915, 210], [710, 450]]) {
    await page.mouse.click(x, y);
  }
  await page.clock.runFor(32);
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
  await expect(page.locator("#blue-prompt")).toContainText("Only 1 piece");
  await page.mouse.move(480, 270);
  await page.mouse.down();
  await page.clock.runFor(16);
  await page.mouse.move(565, 270);
  await page.mouse.up();
  await page.clock.runFor(32);
  await expect(page.locator("#blue-prompt")).toContainText("Only 1 piece");

  const drag = async (fromX: number, fromY: number, x: number, y: number) => {
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(x, y);
    await page.mouse.up();
    await page.clock.runFor(32);
  };
  await drag(45, 310, 315, 390);
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await drag(315, 390, 45, 310);
  await expect(page.locator("#blue-prompt")).toContainText("Only 1 piece");
  await drag(45, 310, 315, 390);
  await drag(45, 230, 245, 250);
  await expect(page.locator("#blue-prompt")).toHaveText("Place 1 piece in your goal box.");
  await drag(245, 250, 45, 230);
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await expect(page.locator("#blue-value")).toHaveText("4/4");
});

test("browser blockers cannot be dragged or rotated during play or between goals", async ({ page }) => {
  await openGame(page);
  for (const [x, y] of [[145, 150], [315, 390], [695, 270], [815, 390], [45, 210], [240, 450], [915, 210], [710, 450]]) {
    await page.mouse.click(x, y);
  }
  await page.clock.runFor(32);
  const blockerPixels = () => page.locator("#game-canvas").evaluate((canvas) =>
    Array.from((canvas as HTMLCanvasElement).getContext("2d")!.getImageData(650, 215, 100, 110).data).join(","));
  const originalBlocker = await blockerPixels();
  const shoot = async () => {
    await page.mouse.move(480, 270);
    await page.mouse.down();
    await page.clock.runFor(16);
    await page.mouse.move(565, 270);
    await page.mouse.up();
  };
  const tryMovingBlocker = async () => {
    await page.mouse.move(695, 270);
    await page.keyboard.press("r");
    await page.mouse.down();
    await page.mouse.move(695, 140);
    await page.mouse.up();
  };
  await shoot();
  await tryMovingBlocker();
  await page.clock.runFor(2600);
  await expect(page.locator("#orange-value")).toHaveText("1");
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await expect(page.locator("#auto-setup-button")).toBeDisabled();
  expect(await blockerPixels() === originalBlocker).toBe(true);
  await tryMovingBlocker();
  await page.clock.runFor(32);
  expect(await blockerPixels() === originalBlocker).toBe(true);
  await shoot();
  await page.clock.runFor(32);
  await expect(page.locator("#blue-prompt")).toHaveText("Ball in play");
  await page.locator("#reset-button").click({ force: true });
  await page.clock.runFor(32);
  await expect(page.locator("#auto-setup-button")).toBeEnabled();
  await expect(page.locator("#blue-value")).toHaveText("0/4");
});

test("an observed two-frame flick scores while a hand or canceled touch does not", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await frame(page, contact(50, 0, 960, 540, Type.Blob));
  await frame(page, contact(50, 0, 1070, 540, Type.Blob, Phase.Moved));
  await frame(page, contact(50, 0, 1190, 540, Type.Blob, Phase.Moved));
  await frame(page, contact(51, 0, 960, 540, Type.Finger));
  await frame(page, contact(51, 0, 1070, 540, Type.Finger, Phase.Moved));
  await frame(page, contact(51, 0, 1100, 540, Type.Finger, Phase.Canceled));
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await flickOnBoard(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.clock.runFor(1500);
  await expect(page.locator("#blue-prompt")).toHaveText("Ball in play");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page, ...lineup);
  await page.clock.runFor(650);
  await expect(page.locator("#blue-value")).toHaveText("1");
  await page.clock.runFor(1250);
  await expect(page.locator("#orange-prompt")).toHaveText("Flick the ball");

  await restartBoardMatch(page);
  await frame(page, ...lineup);
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await page.evaluate(() => window.__board!.onPauseResult(JSON.stringify({ action: "EXIT_GAME_UNSAVED" })));
  await expect(page.locator("html")).toHaveAttribute("data-quit", "true");
});

test("binary Board frames distinguish an armed cancellation from a release", async ({ page }) => {
  await openGame(page, true);
  await binaryFrame(page, ...lineup);
  for (const terminal of [Phase.Canceled, Phase.Ended]) {
    await binaryFrame(page, contact(90, 0, 960, 540, Type.Finger));
    await binaryFrame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Moved));
    await binaryFrame(page, contact(90, 0, 1070, 540, Type.Finger, terminal));
    await expect(page.locator("#blue-prompt")).toHaveText(terminal === Phase.Canceled ? "Flick the ball" : "Ball in play");
  }
});

for (const [transport, send] of [["JSON", frame], ["binary", binaryFrame]] as const) {
  test(`Studio's observed touch channel boots and delivers ${transport} frames once`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openGame(page, true, { observeTouch: true });
    expect(errors).toEqual([]);
    await expect(page.locator("html")).toHaveAttribute("data-host-frames", "1");

    await send(page);
    await send(page);
    await send(page, ...lineup);
    await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
    for (const terminal of [Phase.Canceled, Phase.Ended]) {
      await send(page, contact(90, 0, 960, 540, Type.Finger));
      await send(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Moved));
      await send(page, contact(90, 0, 1070, 540, Type.Finger, terminal));
      await expect(page.locator("#blue-prompt"))
        .toHaveText(terminal === Phase.Canceled ? "Flick the ball" : "Ball in play");
    }
    await expect(page.locator("html")).toHaveAttribute("data-host-frames", "10");
    await page.clock.runFor(700);
    await expect(page.locator("#blue-value")).toHaveText("1");
    expect(errors).toEqual([]);
  });
}

for (const [transport, send] of [["JSON", frame], ["binary", binaryFrame]] as const) {
  test(`${transport} preserves a final move coalesced with release and discards it on cancellation`, async ({ page }) => {
    await openGame(page, true);
    await send(page, ...lineup);
    for (const terminal of [Phase.Canceled, Phase.Ended]) {
      await send(page, contact(90, 0, 960, 540, Type.Finger));
      await send(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Moved),
        contact(90, 0, 1070, 540, Type.Finger, terminal));
      await expect(page.locator("#blue-prompt")).toHaveText(terminal === Phase.Ended ? "Ball in play" : "Flick the ball");
    }
  });

  test(`${transport} keeps the origin of a flick whose first move shares its start packet`, async ({ page }) => {
    await openGame(page, true);
    await send(page, ...lineup);
    await send(page, contact(90, 0, 960, 540, Type.Finger), contact(90, 0, 1050, 540, Type.Finger, Phase.Moved));
    await send(page, contact(90, 0, 1080, 540, Type.Finger, Phase.Moved), contact(90, 0, 1080, 540, Type.Finger, Phase.Ended));
    await page.clock.runFor(700);
    await expect(page.locator("#blue-value")).toHaveText("1");
  });

  test(`${transport} uses the final release position for a short flick`, async ({ page }) => {
    await openGame(page, true);
    await send(page, ...lineup);
    for (const terminal of [Phase.Canceled, Phase.Ended]) {
      await send(page, contact(90, 0, 960, 540, Type.Finger));
      await send(page, contact(90, 0, 970, 540, Type.Finger, Phase.Moved));
      await send(page, contact(90, 0, 1070, 540, Type.Finger, terminal));
      await expect(page.locator("#blue-prompt")).toHaveText(terminal === Phase.Ended ? "Ball in play" : "Flick the ball");
    }
  });
}

test("a complete batched flick honors its own terminal phase", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  for (const terminal of [Phase.Canceled, Phase.Ended]) {
    await frame(page, contact(90, 0, 960, 540, Type.Finger), contact(90, 0, 1080, 540, Type.Finger, Phase.Moved),
      contact(90, 0, 1080, 540, Type.Finger, terminal));
    await expect(page.locator("#blue-prompt")).toHaveText(terminal === Phase.Ended ? "Ball in play" : "Flick the ball");
  }
});

for (const resumeVia of ["menu result", "restored sensor input"]) {
  test(`native surface cancellation freezes a shot without blur until ${resumeVia}`, async ({ page }) => {
    await openGame(page, true);
    await frame(page, ...lineup);
    await flickOnBoard(page);
    await frame(page, ...lineup.map((piece) => ({ ...piece, p: Phase.Canceled })));
    await page.clock.runFor(1500);
    await expect(page.locator("#blue-prompt")).toHaveText("Ball in play");
    await expect(page.locator("#blue-value")).toHaveText("0");
    if (resumeVia === "menu result") {
      await page.evaluate(() => window.__board!.onPauseResult(JSON.stringify({ action: "RESUME" })));
    } else {
      await frame(page, ...lineup);
    }
    await page.clock.runFor(850);
    await expect(page.locator("#blue-value")).toHaveText("1");
  });
}

test("native cancellation in successive frames pauses when the final contact cancels", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await flickOnBoard(page);
  await frame(page, ...lineup.slice(0, -1).map((piece) => ({ ...piece, p: Phase.Canceled })),
    { ...lineup[lineup.length - 1], p: Phase.Stationary });
  await frame(page, { ...lineup[lineup.length - 1], p: Phase.Canceled });
  await page.clock.runFor(850);
  await expect(page.locator("#blue-prompt")).toHaveText("Ball in play");
  await expect(page.locator("#blue-value")).toHaveText("0");
  await page.evaluate(() => window.__board!.onPauseResult(JSON.stringify({ action: "RESUME" })));
  await page.clock.runFor(850);
  await expect(page.locator("#blue-value")).toHaveText("1");
});

test("continuing live play separates unrelated sensor cancellations", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await flickOnBoard(page);
  await frame(page, ...lineup.slice(0, -1).map((piece) => ({ ...piece, p: Phase.Canceled })));
  await frame(page, { ...lineup[lineup.length - 1], x: 1590, p: Phase.Moved });
  await frame(page, { ...lineup[lineup.length - 1], p: Phase.Canceled });
  await page.clock.runFor(850);
  await expect(page.locator("#blue-value")).toHaveText("1");
});

test("a delayed release after a sensor interruption cannot finish an old swipe", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await frame(page, contact(90, 0, 960, 540, Type.Finger));
  await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Moved));
  await page.clock.runFor(900);
  await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Ended));
  await page.evaluate(() => window.__board!.onPauseResult(JSON.stringify({ action: "RESUME" })));
  await page.clock.runFor(700);
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await flickOnBoard(page);
});

test("a focus change preserves stationary defenders when the tracker keeps their IDs", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await frame(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page);
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await frame(page, { ...lineup[3], p: Phase.Stationary });
  await expect(page.locator("#orange-value")).toHaveText("4/4");
  await flickOnBoard(page);
});

test("a trailing stationary sample from the old tracker cannot mask a post-focus restart", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await frame(page, { ...lineup[0], p: Phase.Stationary });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page, ...lineup.slice(1).map((piece) => ({ ...piece, id: piece.id + 100 })));
  await frame(page);
  await expect(page.locator("#blue-value")).toHaveText("3/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
});

test("a finger reclassified through a blob cannot reuse an earlier swipe origin", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await frame(page, contact(90, 0, 960, 540, Type.Finger));
  await frame(page, contact(90, 0, 1100, 540, Type.Blob, Phase.Moved),
    contact(90, 0, 1100, 540, Type.Finger, Phase.Moved));
  await frame(page, contact(90, 0, 1100, 540, Type.Finger, Phase.Ended));
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await flickOnBoard(page);
});

test("one recycled ID and an extra copy leave the rest of a stationary lineup in place", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved));
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page, { ...lineup[0], p: Phase.Ended }, lineup[0]);
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
  await frame(page, contact(55, 5, 1100, 400));
  await flickOnBoard(page);
  await page.clock.runFor(1400);
  await expect(page.locator("#orange-value")).toHaveText("1");
});

test("a new tracker can reuse the other team's contact IDs during a paused shot", async ({ page }) => {
  await openGame(page, true);
  const pieces = lineup.map((piece) => piece.id === 15 ? { ...piece, x: 1390, y: 540 } : piece);
  await frame(page, ...pieces);
  await flickOnBoard(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const ids = [15, 112, 11, 116, 121, 122, 125, 126];
  await frame(page, ...pieces.map((piece, index) => ({ ...piece, id: ids[index] })));
  await page.clock.runFor(1500);
  await expect(page.locator("#orange-value")).toHaveText("1");
});

for (const separateFrames of [false, true]) {
  test(`a confirmed goalie keeps its slot when a fifth piece arrives in ${separateFrames ? "a prior" : "the same"} frame`, async ({ page }) => {
    await openGame(page, true);
    const goalie = contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved);
    await frame(page, ...lineup, goalie);
    await flickOnBoard(page);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const extra = contact(55, 5, 1390, 245);
    const confirmed = { ...goalie, p: Phase.Stationary };
    if (separateFrames) {
      await frame(page, extra);
      await frame(page, confirmed);
    } else {
      await frame(page, extra, confirmed);
    }
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.clock.runFor(1500);
    await expect(page.locator("#orange-value")).toHaveText("1");
  });
}

for (const beforeBlur of [false, true]) {
  test(`blockers stay fixed after system cancellations ${beforeBlur ? "before" : "after"} blur`, async ({ page }) => {
    await openGame(page, true);
    await frame(page, ...lineup);
    await flickOnBoard(page);
    const cancelSurface = () => frame(page, ...lineup.map((piece) => ({ ...piece, p: Phase.Canceled })));
    if (beforeBlur) await cancelSurface();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (!beforeBlur) await cancelSurface();
    await page.clock.runFor(1100);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const fresh = lineup.map((piece) => ({ ...piece, id: piece.id + 100 }));
    await frame(page, ...fresh.map((piece) => piece.g === 5 ? { ...piece, x: 1390, y: 540 } : piece));
    await page.clock.runFor(1500);
    await expect(page.locator("#blue-value")).toHaveText("1");
    await expect(page.locator("#orange-value")).toHaveText("0");
  });
}

for (const newIds of [false, true]) {
  test(`an extra copy cannot displace the confirmed post-pause lineup with ${newIds ? "new" : "unchanged"} IDs`, async ({ page }) => {
    await openGame(page, true);
    const pieces = lineup.map((piece) => piece.g === 5 ? { ...piece, x: 1390, y: 540 } : piece);
    await frame(page, ...pieces);
    await flickOnBoard(page);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await frame(page, ...pieces.map((piece) => newIds
      ? { ...piece, id: piece.id + 100 }
      : { ...piece, p: Phase.Stationary }));
    await frame(page, contact(55, 5, 1390, 245));
    await page.clock.runFor(1500);
    await expect(page.locator("#orange-value")).toHaveText("1");
  });
}

test("late tracker IDs replace cached poses after the physics grace period", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  for (let i = 0; i < 22; i++) await frame(page);
  await frame(page, ...lineup.slice(1).map((piece) => ({ ...piece, id: piece.id + 100 })));
  await expect(page.locator("#blue-value")).toHaveText("3/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
});

test("independent ID handoffs during play preserve unrelated stationary defenders", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  for (const piece of lineup.slice(0, 2)) {
    await frame(page, { ...piece, id: piece.id + 100 });
    await frame(page, { ...piece, p: Phase.Ended });
    await page.clock.fastForward(10_000);
  }
  // Several simultaneous handoffs without a menu boundary are local as well.
  const remaining = lineup.slice(2);
  await frame(page, ...remaining.map((piece) => ({ ...piece, id: piece.id + 100 })));
  await frame(page, ...remaining.map((piece) => ({ ...piece, p: Phase.Ended })));
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
  await flickOnBoard(page);
});

test("a menu result can confirm a tracker restart after the new IDs have already arrived", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await page.clock.fastForward(1800);
  await frame(page, ...lineup.slice(1).map((piece, index) => ({
    ...piece, id: piece.id + 100, y: index < 1 ? piece.y : piece.y + (piece.y < 540 ? 140 : -140),
  })));
  await frame(page);
  await page.evaluate(() => window.__board!.onPauseResult(JSON.stringify({ action: "RESUME" })));
  await page.clock.runFor(32);
  await expect(page.locator("#blue-value")).toHaveText("3/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
  await frame(page);
  await expect(page.locator("#blue-value")).toHaveText("3/4");
});

for (const samePoses of [0, 1]) {
  test(`seven returning blockers with ${samePoses} unchanged poses leave the lifted slot empty`, async ({ page }) => {
    await openGame(page, true);
    await frame(page, ...lineup);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await frame(page, ...lineup.slice(1).map((piece, index) => ({
      ...piece, id: piece.id + 100, y: index < samePoses ? piece.y : piece.y + (piece.y < 540 ? 140 : -140),
    })));
    await frame(page);
    await expect(page.locator("#blue-value")).toHaveText("3/4");
    await expect(page.locator("#orange-value")).toHaveText("4/4");
  });
}

for (const switchHalves of [false, true]) {
  test(`a partial lineup relocated ${switchHalves ? "across midfield" : "on its halves"} still needs two more pieces`, async ({ page }) => {
    await openGame(page, true);
    const partial = lineup.filter((_, index) => index !== 0 && index !== 2);
    await frame(page, ...partial);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await frame(page, ...partial.map((piece) => ({
      ...piece, id: piece.id + 100, x: switchHalves ? 1920 - piece.x : piece.x,
      y: piece.y + (piece.y < 540 ? 110 : -110),
    })));
    await frame(page);
    await expect(page.locator("#blue-value")).toHaveText("3/4");
    await expect(page.locator("#orange-value")).toHaveText("3/4");
    await expect(page.locator("#blue-prompt")).toContainText("Place");
  });
}

for (const missing of ["straddling midfield", "lifted during pause"]) {
  test(`a relocated lineup with two pieces ${missing} stays at three per half`, async ({ page }) => {
    await openGame(page, true);
    const partial = lineup.filter((piece) => piece.g !== 1 && piece.g !== 5);
    const straddling = [contact(11, 1, 960, 300), contact(15, 5, 960, 780)];
    const returning = missing === "straddling midfield" ? [...partial, ...straddling] : partial;
    await frame(page, ...(missing === "straddling midfield" ? returning : lineup));
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await frame(page, ...returning.map((piece) => ({ ...piece, id: piece.id + 100, y: piece.y + (piece.y < 540 ? 110 : -110) })));
    await frame(page);
    await expect(page.locator("#blue-value")).toHaveText("3/4");
    await expect(page.locator("#orange-value")).toHaveText("3/4");
  });
}

for (const { cross, delay } of [{ cross: false, delay: 0 }, { cross: true, delay: 0 }, { cross: false, delay: 500 }, { cross: true, delay: 500 }]) {
  test(`a staggered restart cannot enable kickoff with cross-half movement ${cross} and delay ${delay}ms`, async ({ page }) => {
    await openGame(page, true);
    const partial = lineup.filter((piece) => piece.g !== 1 && piece.g !== 5);
    await frame(page, ...partial);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    if (delay) await page.clock.runFor(delay);
    const fresh = partial.map((piece) => ({
      ...piece, id: piece.id + 100, x: cross ? 1920 - piece.x : piece.x, y: piece.y + (piece.y < 540 ? 110 : -110),
    }));
    await frame(page, fresh[0]);
    await expect(page.locator("#blue-value")).toHaveText(cross ? "2/4" : "3/4");
    await expect(page.locator("#orange-value")).toHaveText(cross ? "4/4" : "3/4");
    await frame(page, contact(90, 0, 960, 540, Type.Finger));
    await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Ended));
    await frame(page, fresh[1]);
    await expect(page.locator("#blue-value")).toHaveText("3/4");
    await expect(page.locator("#orange-value")).toHaveText("3/4");
    await expect(page.locator("#blue-prompt")).toContainText("Place");
  });
}

test("additional copies fill vacant slots after the original IDs are confirmed", async ({ page }) => {
  await openGame(page, true);
  const partial = lineup.filter((piece) => piece.g !== 1 && piece.g !== 5);
  await frame(page, ...partial);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page, ...partial.map((piece) => ({ ...piece, p: Phase.Stationary })));
  await frame(page, contact(105, 2, 410, 540), contact(106, 6, 1450, 540));
  await page.clock.runFor(1100);
  await frame(page);
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
});

test("a whole team changing IDs keeps the other stationary team's slots", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const blue = lineup.filter(({ x }) => x < 960);
  await frame(page, ...blue.map((piece) => ({ ...piece, id: piece.id + 100, y: piece.y + (piece.y < 540 ? 110 : -110) })));
  await expect(page.locator("#orange-value")).toHaveText("4/4");
  await frame(page, ...blue.map((piece) => ({ ...piece, p: Phase.Ended })));
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
});

for (const duplicateTypes of [false, true]) {
  test(`a menu result between batches keeps the partial lineup when duplicate types are ${duplicateTypes}`, async ({ page }) => {
    await openGame(page, true);
    const partial = lineup.filter((piece) => piece.g !== 1 && piece.g !== 5).map((piece) => ({
      ...piece, g: duplicateTypes ? 2 : piece.g,
    }));
    await frame(page, ...partial);
    const fresh = partial.map((piece) => ({ ...piece, id: piece.id + 100, y: piece.y + (piece.y < 540 ? 110 : -110) }));
    await frame(page, fresh[0]);
    await page.evaluate(() => window.__board!.onPauseResult(JSON.stringify({ action: "RESUME" })));
    await frame(page);
    await expect(page.locator("#blue-value")).toHaveText("3/4");
    await expect(page.locator("#orange-value")).toHaveText("3/4");
    await frame(page, contact(90, 0, 960, 540, Type.Finger));
    await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Ended));
    await frame(page, fresh[1]);
    await expect(page.locator("#blue-value")).toHaveText("3/4");
    await expect(page.locator("#orange-value")).toHaveText("3/4");
  });
}

test("ambiguous duplicates after focus cannot open a kickoff window", async ({ page }) => {
  await openGame(page, true);
  const partial = lineup.filter((piece) => piece.g !== 1 && piece.g !== 5).map((piece) => ({
    ...piece, g: 2,
  }));
  await frame(page, ...partial);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const fresh = partial.map((piece) => ({ ...piece, id: piece.id + 100, y: piece.y + (piece.y < 540 ? 110 : -110) }));
  await frame(page, fresh[0]);
  await expect(page.locator("#blue-value")).toHaveText("3/4");
  await expect(page.locator("#orange-value")).toHaveText("3/4");
  await frame(page, fresh[1]);
  await expect(page.locator("#blue-value")).toHaveText("3/4");
  await expect(page.locator("#orange-value")).toHaveText("3/4");
});

for (const menuBetweenBatches of [false, true]) {
  test(`reusing another defender's ID keeps kickoff closed with menu-between-batches ${menuBetweenBatches}`, async ({ page }) => {
    await openGame(page, true);
    const partial = lineup.filter((piece) => piece.g !== 1 && piece.g !== 5);
    await frame(page, ...partial);
    if (!menuBetweenBatches) {
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    }
    const ids = [16, 12];
    const fresh = partial.map((piece, i) => ({ ...piece, id: ids[i] ?? piece.id + 100, y: piece.y + (piece.y < 540 ? 110 : -110) }));
    await frame(page, fresh[0]);
    if (menuBetweenBatches) await page.evaluate(() => window.__board!.onPauseResult(JSON.stringify({ action: "RESUME" })));
    await frame(page);
    await expect(page.locator("#blue-prompt")).toContainText("Place");
    await frame(page, contact(90, 0, 960, 540, Type.Finger));
    await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Ended));
    await frame(page, fresh[1]);
    await expect(page.locator("#blue-value")).toHaveText("3/4");
    await expect(page.locator("#orange-value")).toHaveText("3/4");
  });
}

test("a fifth copy can fill a later vacancy on a previously full side", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page, contact(105, 2, 410, 540));
  await frame(page, { ...lineup[0], p: Phase.Ended });
  await page.clock.runFor(1100);
  await frame(page);
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
});

test("repeated handoffs of one base cannot fill an empty defender slot", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup.slice(1));
  for (const id of [112, 212]) {
    await frame(page, { ...lineup[1], id });
    await expect(page.locator("#blue-value")).toHaveText("3/4");
  }
  await frame(page, { ...lineup[1], id: 212, x: 370, p: Phase.Moved });
  await expect(page.locator("#blue-value")).toHaveText("3/4");
  await frame(page, lineup[0]);
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
});

test("a tracked goalie keeps its slot ahead of a waiting fifth contact during an ID handoff", async ({ page }) => {
  await openGame(page, true);
  const goalie = { ...lineup[2], x: 1390, y: 540 };
  await frame(page, ...lineup, { ...goalie, p: Phase.Moved });
  await frame(page, { ...lineup[3], id: 55, x: 1390, y: 245 });
  await frame(page, { ...goalie, id: 115 });
  await flickOnBoard(page);
  await page.clock.runFor(1400);
  await expect(page.locator("#orange-value")).toHaveText("1");
});

test("a positional handoff keeps the goalie's slot through a temporary glyph change during a shot", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved));
  await flickOnBoard(page);
  await frame(page, contact(45, 6, 1390, 540));
  await frame(page, contact(45, 5, 1390, 540, Type.Glyph, Phase.Moved));
  await page.clock.runFor(1400);
  await expect(page.locator("#orange-value")).toHaveText("1");
});

test("an ID renewed at its own base cannot take another goalie's collider", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved));
  await flickOnBoard(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page, contact(16, 5, 1600, 300));
  await frame(page, contact(16, 6, 1600, 300, Type.Glyph, Phase.Moved));
  await page.clock.runFor(1500);
  await expect(page.locator("#orange-value")).toHaveText("1");
  await expect(page.locator("#blue-value")).toHaveText("0");
});

test("one of two same-type defenders moving on its own ID preserves the stationary goalie", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved),
    contact(16, 5, 1600, 300, Type.Glyph, Phase.Moved));
  await flickOnBoard(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page, contact(16, 5, 1450, 300));
  await page.clock.runFor(1500);
  await expect(page.locator("#orange-value")).toHaveText("1");
  await expect(page.locator("#blue-value")).toHaveText("0");
});

for (const coalesced of [false, true]) {
  test(`a lifted defender's ID cannot admit a distant goalie mid-shot with coalesced events ${coalesced}`, async ({ page }) => {
    await openGame(page, true);
    await frame(page, ...lineup);
    await flickOnBoard(page);
    const lift = { ...lineup[2], p: Phase.Ended };
    const replacement = contact(15, 5, 1390, 540);
    if (coalesced) await frame(page, lift, replacement);
    else {
      await frame(page, lift);
      await frame(page, replacement);
    }
    await page.clock.runFor(1500);
    await expect(page.locator("#blue-value")).toHaveText("1");
    await expect(page.locator("#orange-value")).toHaveText("0");
  });
}

for (const fullLineup of [false, true]) {
  test(`a changed tracker ID cannot relocate a blocker with full return ${fullLineup}`, async ({ page }) => {
    await openGame(page, true);
    await frame(page, ...lineup);
    await flickOnBoard(page);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await frame(page, contact(16, 5, 1390, 540));
    const rest = fullLineup ? lineup.filter((piece) => piece.g !== 5) : [lineup[3]];
    await frame(page, ...rest.map((piece) => ({ ...piece, id: piece.id + 100 })));
    await page.clock.runFor(1500);
    await expect(page.locator("#orange-value")).toHaveText("0");
    await expect(page.locator("#blue-value")).toHaveText("1");
  });
}

test("one reclassified arrival cannot displace two paused defenders", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page, { ...lineup[0], id: 45, g: 2 });
  await frame(page, { ...lineup[0], id: 45, p: Phase.Moved });
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
});

test("a stale hand from a previous tracker cannot prevent native suspension", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, contact(80, 0, 1000, 850, Type.Blob));
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const fresh = lineup.map((piece) => ({ ...piece, id: piece.id + 100 }));
  await frame(page, ...fresh);
  await flickOnBoard(page);
  await frame(page, ...fresh.map((piece) => ({ ...piece, p: Phase.Canceled })));
  await page.clock.runFor(850);
  await expect(page.locator("#blue-prompt")).toHaveText("Ball in play");
  await expect(page.locator("#blue-value")).toHaveText("0");
});

test("a release is applied before the same packet reuses the finger ID", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await frame(page, contact(90, 0, 960, 540, Type.Finger));
  await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Moved));
  await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Ended), contact(90, 0, 400, 290, Type.Finger));
  await page.clock.runFor(700);
  await expect(page.locator("#blue-value")).toHaveText("1");
});

test("a continuing tracker keeps other defenders through a later group of local handoffs", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page, { ...lineup[0], x: 325, p: Phase.Moved });
  await page.clock.fastForward(1500);
  const moved = lineup.slice(1);
  await frame(page, ...moved.map((piece) => ({ ...piece, id: piece.id + 100 })));
  await frame(page, ...moved.map((piece) => ({ ...piece, p: Phase.Ended })));
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await expect(page.locator("#orange-value")).toHaveText("4/4");
});

test("a waiting fifth copy cannot become a goalie when the incumbent lifts during a paused shot", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, contact(55, 5, 1390, 540));
  await flickOnBoard(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await frame(page, { ...lineup[2], p: Phase.Ended });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page);
  await page.clock.runFor(1100);
  await expect(page.locator("#blue-value")).toHaveText("1");
});

test("a one-pixel final move cannot discard a qualified release", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await frame(page, contact(90, 0, 960, 540, Type.Finger));
  await page.clock.runFor(16);
  await frame(page, contact(90, 0, 1070, 540, Type.Finger, Phase.Moved));
  await page.clock.runFor(16);
  await frame(page, contact(90, 0, 1071, 540, Type.Finger, Phase.Moved), contact(90, 0, 1071, 540, Type.Finger, Phase.Ended));
  await page.clock.runFor(700);
  await expect(page.locator("#blue-value")).toHaveText("1");
});

test("a late tracker update cannot move a blocker into a resumed shot", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await flickOnBoard(page);
  await page.clock.runFor(86);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page);
  const fresh = lineup.map((piece) => ({ ...piece, id: piece.id + 100 }));
  await frame(page, ...fresh.filter((_, index) => index !== 2));
  await page.clock.runFor(140);
  await frame(page, { ...fresh[2], x: 1390, y: 540 });
  await page.clock.runFor(1300);
  await expect(page.locator("#orange-value")).toHaveText("0");
  await expect(page.locator("#blue-value")).toHaveText("1");
});

test("a blocker stays fixed when its contact ends during a paused shot", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved));
  await flickOnBoard(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await frame(page, contact(15, 5, 1390, 540, Type.Glyph, Phase.Ended));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(1500);
  await expect(page.locator("#blue-value")).toHaveText("0");
  await expect(page.locator("#orange-value")).toHaveText("1");
});

for (const leaveHalf of [false, true]) {
  test(`a blocker stays fixed when its glyph changes during a shot with leaving-half ${leaveHalf}`, async ({ page }) => {
    await openGame(page, true);
    await frame(page, ...lineup, contact(15, 6, 1390, 540, Type.Glyph, Phase.Moved));
    await flickOnBoard(page);
    if (leaveHalf) await frame(page, contact(15, 6, 1390, 10, Type.Glyph, Phase.Moved));
    await frame(page, contact(15, 5, leaveHalf ? 1520 : 1390, 540, Type.Glyph, Phase.Moved));
    await page.clock.runFor(1500);
    await expect(page.locator("#orange-value")).toHaveText("1");
    await expect(page.locator("#blue-value")).toHaveText("0");
  });
}

test("reclassification cannot move a blocker into a shot", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await flickOnBoard(page);
  await frame(page, contact(15, 0, 1340, 440, Type.Blob, Phase.Moved));
  await frame(page, contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved));
  await page.clock.runFor(1400);
  await expect(page.locator("#orange-value")).toHaveText("0");
  await expect(page.locator("#blue-value")).toHaveText("1");
});

test("a goalie can be recognized again while its previous ID tracks the hand", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved));
  await flickOnBoard(page);
  await frame(page, contact(15, 0, 1390, 540, Type.Blob, Phase.Moved));
  await frame(page, contact(15, 0, 1390, 670, Type.Blob, Phase.Moved), contact(45, 5, 1390, 540));
  await page.clock.runFor(1400);
  await expect(page.locator("#orange-value")).toHaveText("1");
});

test("the goal banner and cheer pause and resume with the match", async ({ page }) => {
  await page.addInitScript(() => {
    // Expose the game's detached Audio element so the test reads real media state.
    window.Audio = new Proxy(window.Audio, {
      construct(target, args) {
        const audio = Reflect.construct(target, args) as HTMLAudioElement;
        document.body.append(audio);
        return audio;
      },
    });
  });
  await openGame(page, true);
  await page.mouse.click(10, 10);
  await frame(page, ...lineup);
  await flickOnBoard(page);
  await page.clock.runFor(550);
  const audio = page.locator('audio[src$="crowd-cheer.mp3"]');
  await expect(audio).toHaveJSProperty("paused", false);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(audio).toHaveJSProperty("paused", true);
  await expect(page.locator("#goal-banner")).toHaveCSS("animation-play-state", "paused");
  await page.clock.runFor(2000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#blue-prompt")).toHaveText("Goal!");
  await expect(page.locator("#goal-banner")).toHaveCSS("animation-play-state", "running");
  await expect(audio).toHaveJSProperty("paused", false);
});

test("the hockey base can clear the kickoff ball with its front notch", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup.slice(1), contact(11, 2, 885, 540));
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await frame(page, contact(11, 2, 892, 540, Type.Glyph, Phase.Moved));
  await expect(page.locator("#blue-value")).toHaveText("3/4");
});

test("movement and touch cannot change a blocker after kickoff", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved));
  await flickOnBoard(page);
  await frame(page, { ...contact(15, 5, 1390, 280, Type.Glyph, Phase.Moved, 90), touched: 1 });
  await page.clock.runFor(1400);
  await expect(page.locator("#orange-prompt")).toHaveText("Goal!");
  await expect(page.locator("#blue-value")).toHaveText("0");
});

test("a blocker's setup angle determines rebounds and stays fixed after kickoff", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, { ...contact(15, 5, 1390, 456, Type.Glyph, Phase.Moved, 270), touched: 1 });
  await flickOnBoard(page);
  await frame(page, { ...contact(15, 5, 1390, 456, Type.Glyph, Phase.Moved, 0), touched: 1 });
  await page.clock.runFor(800);
  await expect(page.locator("#blue-value")).toHaveText("0");
  await restartBoardMatch(page);
  await frame(page, ...lineup, { ...contact(15, 5, 1390, 456, Type.Glyph, Phase.Moved, 0), touched: 1 });
  await flickOnBoard(page);
  await frame(page, { ...contact(15, 5, 1390, 456, Type.Glyph, Phase.Moved, 270), touched: 1 });
  await page.clock.runFor(800);
  await expect(page.locator("#blue-value")).toHaveText("1");
});

test("a defender redetected under a new ID after pause still blocks the same shot", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved));
  await flickOnBoard(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await frame(page, contact(15, 5, 1390, 540, Type.Glyph, Phase.Ended));
  await page.clock.runFor(1800);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page);
  await frame(page, contact(45, 5, 1390, 540));
  await page.clock.runFor(1400);
  await expect(page.locator("#orange-prompt")).toHaveText("Goal!");
});

for (const timing of ["before focus", "after focus", "without a focus event"]) {
  test(`fresh Board IDs replace cached stationary defenders ${timing}`, async ({ page }) => {
    await openGame(page, true);
    await frame(page, ...lineup, contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved));
    if (timing !== "without a focus event") {
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    }
    await page.clock.runFor(1800);
    const resume = () => page.evaluate(() => window.__board!.onPauseResult(JSON.stringify({ action: "RESUME" })));
    if (timing === "after focus") await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    if (timing !== "before focus") await resume();

    // The tracker restarts without Ended events. One Blue piece was lifted,
    // and the goalie moved out of the shot and now reuses another piece's ID.
    const fresh = lineup.map((piece, index) => ({ ...piece, id: index }));
    fresh[2] = contact(11, 5, 1390, 280);
    await frame(page, ...fresh.slice(1));
    await frame(page);
    if (timing === "before focus") {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await resume();
    }
    await page.clock.runFor(32);
    await expect(page.locator("#blue-value")).toHaveText("3/4");
    await expect(page.locator("#orange-value")).toHaveText("4/4");
    await frame(page, fresh[0]);
    await flickOnBoard(page);
    await page.clock.runFor(650);
    await expect(page.locator("#blue-prompt")).toHaveText("Goal!");
  });
}

test("a blocker remains fixed through lost tracking and a long pause", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup, contact(15, 5, 1390, 540, Type.Glyph, Phase.Moved));
  await flickOnBoard(page);
  await frame(page, contact(15, 5, 1390, 540, Type.Glyph, Phase.Ended));
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.clock.runFor(1800);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await frame(page, contact(45, 5, 1390, 540));
  await page.clock.runFor(1400);
  await expect(page.locator("#orange-prompt")).toHaveText("Goal!");
});

test("a blocker cannot move into the shot during a pause", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  await flickOnBoard(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await frame(page, contact(45, 5, 1390, 540));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(1400);
  await expect(page.locator("#blue-value")).toHaveText("1");
  await expect(page.locator("#orange-value")).toHaveText("0");
});

for (const when of ["before focus", "after focus"]) {
  test(`a goalie relocated ${when} during pre-kickoff recovery blocks from its new ID`, async ({ page }) => {
    await openGame(page, true);
    await frame(page, ...lineup);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
    if (when === "after focus") await focus();
    await frame(page, contact(45, 5, 1390, 540));
    if (when === "before focus") await focus();
    await flickOnBoard(page);
    await page.clock.runFor(1400);
    await expect(page.locator("#orange-value")).toHaveText("1");
  });
}

test("placement checks the rotated tennis base at midfield, the rail and the kickoff spot", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup.filter(({ id }) => id !== 12), contact(14, 5, 880, 300, Type.Glyph, Phase.Began, 90));
  const count = page.locator("#blue-value");
  await expect(count).toHaveText("4/4");
  const move = (x: number, y: number, angle: number) =>
    frame(page, { ...contact(14, 5, x, y, Type.Glyph, Phase.Moved, angle), touched: 1 });
  await move(880, 300, 180);
  await expect(count).toHaveText("3/4");
  await move(320, 70, 0);
  await expect(count).toHaveText("4/4");
  await move(320, 70, 90);
  await expect(count).toHaveText("3/4");
  await move(878, 540, 90);
  await expect(count).toHaveText("4/4");
  await move(896, 540, 90);
  await expect(count).toHaveText("3/4");
});

test("19px and 21px opening movements both preserve the peak of a 130px Board flick", async ({ page }) => {
  await openGame(page, true);
  for (const firstMove of [19, 21]) {
    await restartBoardMatch(page);
    await frame(page, ...lineup);
    await frame(page, contact(90, 0, 960, 540, Type.Finger));
    await frame(page, contact(90, 0, 960 + firstMove, 540, Type.Finger, Phase.Moved));
    await frame(page, contact(90, 0, 1090, 540, Type.Finger, Phase.Moved));
    await frame(page, contact(90, 0, 1090, 540, Type.Finger, Phase.Ended));
    await page.clock.runFor(500);
    await expect(page.locator("#blue-prompt")).toHaveText("Goal!");
  }
});

test("a faster release completes the same shot on either side of the arming threshold", async ({ page }) => {
  await openGame(page, true);
  for (const firstMove of [19, 21]) {
    await restartBoardMatch(page);
    await frame(page, ...lineup);
    await frame(page, contact(90, 0, 960, 540, Type.Finger));
    await page.clock.runFor(16);
    await frame(page, contact(90, 0, 960 + firstMove, 540, Type.Finger, Phase.Moved));
    await frame(page, contact(90, 0, 1090, 540, Type.Finger, Phase.Ended));
    await page.clock.runFor(500);
    await expect(page.locator("#blue-prompt")).toHaveText("Goal!");
  }
});

test("the ball remains visible when a kickoff stops under Orange's turn prompt", async ({ page }) => {
  await openGame(page, true);
  await frame(page, ...lineup);
  const angle = 75 * Math.PI / 180;
  const x = 960 + 110 * Math.cos(angle);
  const y = 540 + 110 * Math.sin(angle);
  await frame(page, contact(90, 0, 960, 540, Type.Finger));
  await frame(page, contact(90, 0, x, y, Type.Finger, Phase.Moved));
  await frame(page, contact(90, 0, x, y, Type.Finger, Phase.Ended));
  await page.clock.runFor(6000);
  await expect(page.locator("#orange-prompt")).toHaveText("Flick the ball");
  // Locate the rendered ball so this overlap check does not depend on the
  // rebound path of a particular lineup of blockers.
  const ball = await page.locator("#game-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let x = 0, y = 0, count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== 251 || pixels[i + 1] !== 251 || pixels[i + 2] !== 250) continue;
      x += (i / 4) % canvas.width;
      y += Math.floor(i / 4 / canvas.width);
      count++;
    }
    return { x: x / count, y: y / count, count };
  });
  expect(ball.count).toBeGreaterThan(0);
  await page.addStyleTag({ content: `.board-device #orange-seat {
    left: ${ball.x - 12}px; top: ${ball.y - 12}px; right: auto; bottom: auto; transform: none;
  }` });
  await page.clock.runFor(250);
  const panel = page.locator("#orange-seat");
  expect(await panel.evaluate((seat) => Number(getComputedStyle(seat).opacity))).toBeLessThan(0.3);
  await expect(page.locator("#blue-seat")).toHaveCSS("opacity", "1");
  await restartBoardMatch(page);
  await frame(page, ...lineup);
  await expect(panel).toHaveCSS("opacity", "1");
});

for (const reversed of [false, true]) {
  test(`two touching bumpers rebound the ball with contact order ${reversed ? "reversed" : "forward"}`, async ({ page }) => {
    await openGame(page, true);
    const pair = [contact(15, 1, 1340, 480), contact(16, 1, 1340, 600)];
    if (reversed) pair.reverse();
    await frame(page, ...lineup.slice(0, 2), ...supportLineup, ...pair);
    await flickOnBoard(page);
    await page.clock.runFor(1100);
    await expect(page.locator("#orange-prompt")).toHaveText("Goal!");
    await expect(page.locator("#blue-value")).toHaveText("0");
  });
}
