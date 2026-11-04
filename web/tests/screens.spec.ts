import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  BoardContactPhase as Phase,
  BoardContactType as Type,
} from "@board.fun/web-sdk";

const profiles = [
  {
    playerId: "test-blue",
    sessionId: 1,
    name: "Ada",
    type: "profile",
    avatarId: "0",
  },
  {
    playerId: "test-orange",
    sessionId: 2,
    name: "Ben",
    type: "profile",
    avatarId: "1",
  },
];
const piece = (
  id: number,
  g: number,
  x: number,
  y: number,
  p = Phase.Began,
  o = 0,
  touched = 0,
) => ({ id, g, x, y, p, o, touched, t: Type.Glyph });
const finger = (x: number, y: number, p: Phase) => ({
  ...piece(90, 0, x, y, p),
  t: Type.Finger,
});
const lineup = [
  piece(11, 1, 320, 300),
  piece(12, 2, 650, 300),
  piece(13, 3, 320, 780),
  piece(14, 4, 650, 780),
  piece(15, 5, 1270, 300),
  piece(16, 6, 1600, 300),
  piece(17, 7, 1270, 780),
  piece(18, 8, 1600, 780),
];

async function packet(page: Page, ...c: ReturnType<typeof piece>[]) {
  await page.evaluate(
    (events) =>
      window.boardTouch!.onmessage!(
        new MessageEvent("message", { data: JSON.stringify({ c: events }) }),
      ),
    c,
  );
  await page.clock.runFor(16);
}
async function host(page: Page, taught = false, count = 2) {
  await page.addInitScript(
    ({ roster, taught }) => {
      let serial = 1;
      const list = [...roster];
      const respond = (value: unknown) => {
        const id = "test-request-" + serial++;
        queueMicrotask(() =>
          window.__board!.resolve(id, JSON.stringify(value)),
        );
        return id;
      };
      Object.assign(window, {
        BoardSDK: {
          setPauseContext(value: string) {
            document.documentElement.dataset.pause = value;
          },
          getPlayers() {
            return JSON.stringify(list);
          },
          presentAddPlayerSelector(types: unknown) {
            document.documentElement.dataset.picker = JSON.stringify(types);
            list.push({
              playerId: "test-orange",
              sessionId: 2,
              name: "Ben",
              type: "profile",
              avatarId: "1",
            });
            return respond(true);
          },
          presentReplacePlayerSelector(id: number, types: unknown) {
            document.documentElement.dataset.replace = JSON.stringify([
              id,
              types,
            ]);
            const p = list.find((p) => p.sessionId === id);
            if (p) {
              p.name = "Chris";
              p.playerId = "test-chris";
            }
            return respond(true);
          },
          quit() {
            document.documentElement.dataset.quit = "true";
          },
        },
        boardTouch: { postMessage() {} },
      });
      if (taught)
        localStorage.setItem(
          "flick-soccer:tutorial-groups",
          JSON.stringify([JSON.stringify(["test-blue", "test-orange"])]),
        );
    },
    { roster: profiles.slice(0, count), taught },
  );
  await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T12:00:01Z"));
  await page.goto("/");
  await page.clock.runFor(32);
}
async function choose(page: Page) {
  await page.locator("#home-play").click();
  await page.locator("#mode-play").click();
}
async function shoot(page: Page) {
  await packet(page, finger(960, 540, Phase.Began));
  await packet(page, finger(1070, 540, Phase.Moved));
  await packet(page, finger(1070, 540, Phase.Ended));
}

test("home, OS player picker, and remembered house rules lead to a competitive match", async ({
  page,
}) => {
  await host(page, true, 1);
  await expect(
    page.getByRole("heading", { name: "FLICK SOCCER" }),
  ).toBeVisible();
  await choose(page);
  await expect(page.locator("#continue")).toBeDisabled();
  await page.getByRole("button", { name: "Add player" }).click();
  await expect(page.locator("#continue")).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("data-picker", "[]");
  await page.getByRole("button", { name: "Change Ben" }).click();
  await expect(page.locator("#roster")).toContainText("Chris");
  await page.locator("#house-rules").click();
  await page
    .locator("#rule-options")
    .getByRole("button", { name: "5", exact: true })
    .click();
  await page
    .locator("#rules")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await expect(page.locator("#players")).not.toContainText("First to");
  await page.locator("#continue").click();
  await expect(page.locator("#match-target")).toHaveText("First to 5");
  await expect(page.locator("#coach")).toBeVisible();
  await page.reload();
  await choose(page);
  await page.locator("#house-rules").click();
  await expect(
    page
      .locator("#rule-options")
      .getByRole("button", { name: "5", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("the real Piece tutorial waits, rebases touch, retries, and remembers the group", async ({
  page,
}) => {
  await host(page);
  await choose(page);
  await page.locator("#continue").click();
  await page.clock.runFor(3000);
  await expect(page.locator("#coach-count")).toHaveText("Step 1 of 4");
  await packet(page, piece(71, 4, 1600, 800));
  await expect(page.locator("#coach-count")).toHaveText("Step 1 of 4");
  await packet(page, piece(51, 4, 518, 680));
  await expect(page.locator("#coach-count")).toHaveText("Step 2 of 4");
  await packet(page, piece(51, 4, 691, 389, Phase.Moved));
  await expect(page.locator("#coach-count")).toHaveText("Step 3 of 4");
  await packet(page, piece(51, 4, 691, 389, Phase.Moved, 90, 0));
  await expect(page.locator("#coach-count")).toHaveText("Step 3 of 4");
  await packet(page, piece(51, 4, 691, 389, Phase.Moved, 90, 1));
  await expect(page.locator("#coach-count")).toHaveText("Step 3 of 4");
  await packet(page, piece(51, 4, 691, 389, Phase.Moved, 125, 1));
  await expect(page.locator("#coach-count")).toHaveText("Step 4 of 4");
  await packet(page, finger(960, 540, Phase.Began));
  await packet(page, finger(820, 540, Phase.Ended));
  await expect(page.locator("#coach-line")).toContainText("Try again");
  await shoot(page);
  await page.clock.runFor(1000);
  await expect(page.locator("#coach")).toBeHidden();
  await expect(page.locator("#blue-value")).toHaveText("1/4");
  const groups = await page.evaluate(() =>
    localStorage.getItem("flick-soccer:tutorial-groups"),
  );
  expect(groups).toContain("test-blue");
  await page.reload();
  await choose(page);
  await page.locator("#continue").click();
  await expect(page.locator("#coach")).toBeHidden();
});

test("PLAY TUTORIAL repeats a completed lesson and lifting its Piece restores the first task", async ({
  page,
}) => {
  await host(page, true);
  await page.locator("#home-play").click();
  await page.locator("#mode-help").click();
  await page.locator("#play-tutorial").click();
  await page.locator("#continue").click();
  await expect(page.locator("#coach")).toBeVisible();
  await packet(page, piece(51, 4, 518, 680));
  await packet(page, piece(51, 4, 691, 389, Phase.Moved));
  await packet(page, piece(51, 4, 691, 389, Phase.Ended));
  await expect(page.locator("#coach-count")).toHaveText("Step 1 of 4");
});

test("winning reaches results once and replay resets the match", async ({
  page,
}) => {
  await host(page, true);
  await choose(page);
  await page.locator("#house-rules").click();
  await page
    .locator("#rule-options")
    .getByRole("button", { name: "1", exact: true })
    .click();
  await page
    .locator("#rules")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await page.locator("#continue").click();
  await packet(page, ...lineup);
  await shoot(page);
  await page.clock.runFor(2100);
  await expect(page.locator("#winner")).toHaveText("Ada wins!");
  await expect(page.locator("#result-score")).toHaveText("Ada  1  –  0  Ben");
  await page.clock.runFor(2000);
  await expect(page.locator("#result-score")).toContainText("1  –  0");
  await page.locator("#again").click();
  await page.clock.runFor(32);
  await expect(page.locator("#blue-value")).toHaveText("4/4");
});

test("How to Play opened from the Board menu freezes and resumes the same shot", async ({
  page,
}) => {
  await host(page, true);
  await choose(page);
  await page.locator("#continue").click();
  await packet(page, ...lineup);
  await shoot(page);
  await page.evaluate(() =>
    window.__board!.onPauseResult(
      JSON.stringify({ action: "CUSTOM_ACTION", customButtonId: "help" }),
    ),
  );
  await expect(page.locator("#help")).toBeVisible();
  await page.clock.runFor(3000);
  await expect(page.locator("#blue-value")).toHaveText("0");
  await page.locator("#help-back").click();
  await page.clock.runFor(650);
  await expect(page.locator("#blue-value")).toHaveText("1");
});

test("Board finger taps navigate menus without launching a shot", async ({
  page,
}) => {
  await host(page, true);
  const tap = async (selector: string) => {
    const b = await page.locator(selector).boundingBox();
    expect(b).not.toBeNull();
    const x = (b!.x + b!.width / 2) * 2,
      y = (b!.y + b!.height / 2) * 2;
    await packet(page, finger(x, y, Phase.Began));
    await packet(page, finger(x, y, Phase.Ended));
  };
  await tap("#home-play");
  await expect(page.locator("#modes")).toBeVisible();
  await tap("#mode-play");
  await expect(page.locator("#players")).toBeVisible();
  await tap("#continue");
  await packet(page, ...lineup);
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await tap("#flip");
  await expect(page.locator("#flip")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#blue-prompt")).toHaveText("Flick the ball");
  await packet(page, finger(960, 540, Phase.Began));
  await packet(page, finger(850, 540, Phase.Moved));
  await packet(page, finger(850, 540, Phase.Ended));
  await page.clock.runFor(650);
  await expect(page.locator("#blue-value")).toHaveText("1");
});

test("a goalie returning after a long How to Play visit preserves the paused shot", async ({
  page,
}) => {
  await host(page, true);
  await choose(page);
  await page.locator("#continue").click();
  await packet(page, ...lineup);
  await shoot(page);
  await page.evaluate(() =>
    window.__board!.onPauseResult(
      JSON.stringify({ action: "CUSTOM_ACTION", customButtonId: "help" }),
    ),
  );
  await page.clock.runFor(4000);
  await packet(page, piece(55, 5, 1390, 540));
  await page.locator("#help-back").click();
  await page.clock.runFor(1500);
  await expect(page.locator("#orange-value")).toHaveText("1");
  await expect(page.locator("#blue-value")).toHaveText("0");
});

test("untouched rotation drift cannot alter the defender base", async ({
  page,
}) => {
  await host(page, true);
  await choose(page);
  await page.locator("#continue").click();
  await packet(
    page,
    ...lineup.slice(0, 3),
    piece(14, 5, 880, 300, Phase.Began, 90),
  );
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await packet(page, piece(14, 5, 880, 300, Phase.Moved, 180, 0));
  await expect(page.locator("#blue-value")).toHaveText("4/4");
  await packet(page, piece(14, 5, 880, 300, Phase.Moved, 180, 1));
  await expect(page.locator("#blue-value")).toHaveText("3/4");
});

test("lifecycle pagehide pauses play and the Board menu uses standard icons", async ({
  page,
}) => {
  await host(page, true);
  await choose(page);
  await page.locator("#continue").click();
  await packet(page, ...lineup);
  await shoot(page);
  const menu = JSON.parse(
    (await page.locator("html").getAttribute("data-pause"))!,
  );
  expect(menu.customButtons.map((b: { icon: string }) => b.icon)).toEqual([
    "circular_arrow",
    "left_arrow",
    "question_mark",
  ]);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  await page.clock.runFor(2000);
  await expect(page.locator("#blue-value")).toHaveText("0");
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow")),
  );
  await page.clock.runFor(950);
  await expect(page.locator("#blue-value")).toHaveText("1");
});

test("all help pages animate one action and restart on the first page", async ({
  page,
}) => {
  await host(page, true);
  await page.locator("#home-help").click();
  for (const demo of ["place", "slide", "turn", "flick", "score"]) {
    await expect(page.locator("#lesson-clip")).toHaveAttribute(
      "data-demo",
      demo,
    );
    await page.locator("#help-next").click();
  }
  await expect(page.locator("#home")).toBeVisible();
  await page.locator("#home-help").click();
  await expect(page.locator("#lesson-clip")).toHaveAttribute(
    "data-demo",
    "place",
  );
});

test("the production game reaches results with the browser offline and every asset served from the build", async ({
  page,
  baseURL,
}) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().setOffline(true);
  const types: Record<string, string> = {
    html: "text/html",
    js: "text/javascript",
    css: "text/css",
    png: "image/png",
    woff2: "font/woff2",
    ogg: "audio/ogg",
    mp3: "audio/mpeg",
  };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL) {
      external.push(url.origin);
      await route.abort();
      return;
    }
    const path = url.pathname.slice(1) || "index.html";
    const body = readFileSync(new URL("../dist/" + path, import.meta.url));
    await route.fulfill({
      body,
      contentType: types[path.split(".").pop()!] ?? "application/octet-stream",
    });
  });
  await host(page, true);
  await choose(page);
  await page.locator("#house-rules").click();
  await page
    .locator("#rule-options")
    .getByRole("button", { name: "1", exact: true })
    .click();
  await page
    .locator("#rules")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await page.locator("#continue").click();
  await packet(page, ...lineup);
  await shoot(page);
  await page.clock.runFor(2100);
  await expect(page.locator("#winner")).toHaveText("Ada wins!");
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("the browser tutorial can be completed with placement, dragging, R, and a flick", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T12:00:01Z"));
  await page.goto("/");
  await choose(page);
  await page.getByRole("button", { name: "Add player" }).click();
  await page
    .locator("#preview-choices")
    .getByRole("button", { name: "Orange", exact: true })
    .click();
  await page.locator("#continue").click();
  await page.clock.runFor(32);
  await page.mouse.click(960 * 0.27, 540 * 0.63);
  await page.mouse.move(960 * 0.27, 540 * 0.63);
  await page.mouse.down();
  await page.mouse.move(960 * 0.36, 540 * 0.36);
  await page.mouse.up();
  await expect(page.locator("#coach-count")).toHaveText("Step 3 of 4");
  await page.keyboard.press("r");
  await expect(page.locator("#coach-count")).toHaveText("Step 4 of 4");
  await page.mouse.move(480, 270);
  await page.mouse.down();
  await page.mouse.move(560, 270);
  await page.mouse.up();
  await page.clock.runFor(1000);
  await expect(page.locator("#coach")).toBeHidden();
});

test("a flipped physical goalie blocks at its position on the glass", async ({
  page,
}) => {
  await host(page, true);
  await choose(page);
  await page.locator("#continue").click();
  await packet(page, ...lineup, piece(15, 5, 1390, 540, Phase.Moved));
  await page.locator("#flip").click();
  await shoot(page);
  await page.clock.runFor(1500);
  await expect(page.locator("#blue-value")).toHaveText("1");
  await expect(page.locator("#orange-value")).toHaveText("0");
});

test("flipping after a tracker restart keeps retired contact IDs retired", async ({
  page,
}) => {
  await host(page, true);
  await choose(page);
  await page.locator("#continue").click();
  await packet(page, ...lineup);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const fresh = lineup.map((p) => ({ ...p, id: p.id + 100 }));
  await packet(page, ...fresh);
  await page.locator("#flip").click();
  await packet(page, { ...fresh[0], p: Phase.Ended });
  await expect(page.locator("#orange-value")).toHaveText("3/4");
  await expect(page.locator("#blue-value")).toHaveText("4/4");
});
