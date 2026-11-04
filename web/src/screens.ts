import { Board, BoardPlayerType, type BoardPlayer } from "@board.fun/web-sdk";
import { drawPitchArt } from "./pitch-art";
import {
  GOAL_TARGETS,
  MODE_NAME,
  STANDARD_TARGET,
  readLocal,
  writeLocal,
} from "./match-settings";

type Screen =
  | "home"
  | "modes"
  | "players"
  | "rules"
  | "help"
  | "match"
  | "results";
type Actions = {
  start: (tutorial: boolean) => void;
  flip: () => void;
  changed: () => void;
};
const menus: Screen[] = [
  "home",
  "modes",
  "players",
  "rules",
  "help",
  "results",
];
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
function button(id: string) {
  return byId<HTMLButtonElement>(id);
}
function makeButton(text: string, action: () => void) {
  const el = document.createElement("button");
  el.textContent = text;
  el.onclick = action;
  return el;
}

export class MatchScreens {
  screen: Screen = "home";
  target = Number(readLocal("goals", STANDARD_TARGET));
  players: BoardPlayer[] = [];
  private helpPage = 0;
  private helpFrom: Screen = "home";
  private forceTutorial = false;
  private pickerBusy = false;
  private group = "";
  private lastRoster = "";
  private previewEdit: number | undefined;
  private readonly previewPlayers: BoardPlayer[] = [
    {
      playerId: "browser-blue",
      sessionId: 1,
      name: "Blue",
      type: BoardPlayerType.Profile,
      avatarId: "0",
    },
  ];

  constructor(private actions: Actions) {
    if (!GOAL_TARGETS.some((n) => n === this.target))
      this.target = STANDARD_TARGET;
    for (const label of document.querySelectorAll<HTMLElement>(
      "[data-mode-name]",
    ))
      label.textContent = MODE_NAME;
    drawPitchArt(byId<HTMLCanvasElement>("home-art"));
    button("home-play").onclick = () => this.go("modes");
    button("home-help").onclick = () => this.help("home");
    const choose = () => this.choose(false);
    button("mode-play").onclick = choose;
    byId("mode-card").onclick = (event) => {
      if (!(event.target as HTMLElement).closest("button")) choose();
    };
    byId("mode-card").onkeydown = (event) => {
      if (
        event.target === event.currentTarget &&
        (event.key === "Enter" || event.key === " ")
      ) {
        event.preventDefault();
        choose();
      }
    };
    button("mode-help").onclick = () => {
      byId("mode-rules").replaceChildren(
        ...this.rules().map((rule) => {
          const li = document.createElement("li");
          li.textContent = rule;
          return li;
        }),
      );
      byId<HTMLDialogElement>("mode-dialog").showModal();
    };
    button("mode-close").onclick = () =>
      byId<HTMLDialogElement>("mode-dialog").close();
    button("play-tutorial").onclick = () => {
      byId<HTMLDialogElement>("mode-dialog").close();
      this.choose(true);
    };
    byId<HTMLDialogElement>("mode-dialog").onclick = (event) => {
      const rect = byId("mode-dialog").getBoundingClientRect();
      if (
        event.target === event.currentTarget &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      )
        byId<HTMLDialogElement>("mode-dialog").close();
    };
    document.querySelectorAll<HTMLButtonElement>("[data-back]").forEach((b) => {
      b.onclick = () => this.go(b.dataset.back as Screen);
    });
    button("continue").onclick = () => this.start();
    button("house-rules").onclick = () => this.go("rules");
    button("reset-rules").onclick = () => this.setTarget(STANDARD_TARGET);
    for (const n of GOAL_TARGETS)
      byId("rule-options").append(
        makeButton(String(n), () => this.setTarget(n)),
      );
    this.setTarget(this.target);
    button("help-back").onclick = () => this.go(this.helpFrom);
    button("help-prev").onclick = () => {
      this.helpPage--;
      this.lesson();
    };
    button("help-next").onclick = () => {
      if (this.helpPage === this.lessons().length - 1) this.go(this.helpFrom);
      else {
        this.helpPage++;
        this.lesson();
      }
    };
    button("help-play").onclick = () => this.go("modes");
    button("again").onclick = () => {
      this.forceTutorial = false;
      this.start();
    };
    button("flip").onclick = actions.flip;
    button("preview-menu").onclick = () => {
      byId<HTMLDialogElement>("preview-pause").showModal();
      actions.changed();
    };
    byId<HTMLDialogElement>("preview-pause").onclose = actions.changed;
    document.querySelectorAll<HTMLButtonElement>("[data-menu]").forEach((b) => {
      b.onclick = () => {
        byId<HTMLDialogElement>("preview-pause").close();
        this.menu(b.dataset.menu!);
      };
    });
    button("picker-close").onclick = () =>
      byId<HTMLDialogElement>("preview-picker").close();
    byId<HTMLDialogElement>("preview-picker").onclose = () =>
      this.refreshRoster(true);
    window.addEventListener("focus", () => {
      if (this.screen === "players") this.refreshRoster();
    });
    this.go("home");
  }

  get playing() {
    return (
      this.screen === "match" && !byId<HTMLDialogElement>("preview-pause").open
    );
  }
  get names() {
    return [this.players[0]?.name ?? "Blue", this.players[1]?.name ?? "Orange"];
  }
  go(screen: Screen) {
    this.screen = screen;
    for (const id of menus) byId(id).hidden = id !== screen;
    byId("match-surface").hidden = screen !== "match";
    byId("flip").hidden = screen !== "match";
    if (screen === "players") this.refreshRoster(true);
    if (screen === "modes")
      byId("mode-card").setAttribute("aria-description", this.rules()[3]);
    this.actions.changed();
  }
  private choose(force: boolean) {
    this.forceTutorial = force;
    this.go("players");
  }

  private setTarget(n: number) {
    this.target = n;
    writeLocal("goals", n);
    for (const b of byId("rule-options").querySelectorAll("button"))
      b.setAttribute("aria-pressed", String(b.textContent === String(n)));
    byId("standard-rule").textContent =
      "Standard rules · First to " + STANDARD_TARGET;
    byId("match-target").textContent = "First to " + n;
    byId("mode-card")
      .querySelector(".mode-art")
      ?.setAttribute("data-target", "First to " + n);
  }
  private refreshRoster(force = false) {
    if (this.screen !== "players") return;
    try {
      this.players = Board.isOnDevice
        ? Board.session.getPlayers()
        : [...this.previewPlayers];
    } catch {
      this.players = [];
    }
    const key = JSON.stringify(this.players);
    if (!force && key === this.lastRoster) return;
    this.lastRoster = key;
    const roster = byId("roster");
    roster.replaceChildren();
    for (const [index, player] of this.players.slice(0, 2).entries()) {
      const tile = document.createElement("div");
      tile.className = "player-tile";
      const avatar = makeButton(
        player.name.slice(0, 1),
        () => void this.pick(player.sessionId),
      );
      avatar.className = "avatar";
      avatar.setAttribute("aria-label", "Change " + player.name);
      const badge = document.createElement("span");
      badge.className = "pencil";
      badge.textContent = "✎";
      avatar.append(badge);
      if (Board.isOnDevice) {
        void Board.avatar
          .forPlayer(player)
          .then((src) => {
            if (!avatar.isConnected || !src.startsWith("data:image/")) return;
            const img = new Image();
            img.src = src;
            img.alt = "";
            avatar.replaceChildren(img, badge);
          })
          .catch(() => {});
      }
      const label = document.createElement("strong");
      label.textContent = player.name;
      const team = document.createElement("small");
      team.textContent = index ? "Orange ▲" : "Blue ●";
      tile.append(avatar, label, team);
      roster.append(tile);
    }
    if (this.players.length < 2) {
      const add = makeButton("+", () => void this.pick());
      add.className = "avatar";
      add.setAttribute("aria-label", "Add player");
      const tile = document.createElement("div");
      tile.className = "player-tile";
      const label = document.createElement("strong");
      label.textContent = "Add player";
      tile.append(add, label);
      roster.append(tile);
    }
    const hasAI = this.players
      .slice(0, 2)
      .some((p) => p.type === BoardPlayerType.AI);
    button("continue").disabled =
      this.players.length < 2 || hasAI || this.pickerBusy;
    byId("roster-status").textContent = hasAI
      ? "Choose two human players."
      : this.players.length < 2
        ? "Add a second player to kick off."
        : this.players.length > 2
          ? "The first two players take the field."
          : "";
  }

  private async pick(sessionId?: number) {
    if (this.pickerBusy) return;
    if (!Board.isOnDevice) {
      this.previewEdit = sessionId;
      const existing = this.previewPlayers.find(
        (p) => p.sessionId === sessionId,
      );
      const choices = ["Blue", "Orange", "Alex", "Sam"].filter(
        (name) =>
          !this.previewPlayers.some((p) => p.name === name && p !== existing),
      );
      byId("preview-choices").replaceChildren(
        ...choices.map((name) =>
          makeButton(name, () => {
            const at = this.previewPlayers.findIndex(
              (p) => p.sessionId === this.previewEdit,
            );
            const record = {
              name,
              playerId: "browser-" + name.toLowerCase(),
              sessionId: sessionId ?? 2,
              type: BoardPlayerType.Profile,
              avatarId: "0",
            };
            if (at === -1) this.previewPlayers.push(record);
            else this.previewPlayers[at] = record;
            byId<HTMLDialogElement>("preview-picker").close();
          }),
        ),
      );
      byId<HTMLDialogElement>("preview-picker").showModal();
      return;
    }
    this.pickerBusy = true;
    button("continue").disabled = true;
    let failed = false;
    try {
      if (sessionId === undefined) await Board.session.presentAddPlayer([]);
      else await Board.session.presentReplacePlayer(sessionId, []);
    } catch {
      failed = true;
    } finally {
      this.pickerBusy = false;
      this.refreshRoster(true);
    }
    if (failed)
      byId("roster-status").textContent =
        "The picker is unavailable. Tap the player to try again.";
  }
  refreshIfWaiting() {
    if (this.screen === "players" && !this.pickerBusy) this.refreshRoster();
  }
  private start() {
    if (this.players.length < 2) return;
    this.group = JSON.stringify(
      this.players
        .slice(0, 2)
        .filter((p) => p.type === BoardPlayerType.Profile)
        .map((p) => p.playerId)
        .sort(),
    );
    const tutorial =
      this.forceTutorial ||
      !readLocal<string[]>("tutorial-groups", []).includes(this.group);
    this.forceTutorial = false;
    this.go("match");
    this.actions.start(tutorial);
  }
  tutorialComplete() {
    const done = new Set(readLocal<string[]>("tutorial-groups", []));
    done.add(this.group);
    writeLocal("tutorial-groups", [...done]);
  }
  private rules() {
    return [
      "Blue and Orange defend opposite goals with four Sports Pieces each.",
      "Take turns flicking the ball. Slide and turn your defenders on your own half.",
      "A goal scores one point. The team that conceded takes the next kickoff.",
      "First to " +
        this.target +
        " goals wins. Change the target in House Rules.",
    ];
  }
  private lessons() {
    const rules = this.rules();
    return [
      [
        "place",
        "Set your defense",
        rules[0] + " Use any Sports Pieces. Keep the ball and midfield clear.",
      ],
      [
        "slide",
        "Cover the goal",
        "Slide defenders on your half to block a shot. Newly added defenders wait until the ball stops.",
      ],
      [
        "turn",
        "Change the angle",
        "Touch and turn a Piece. A shot rebounds from the shape and direction of its base.",
      ],
      [
        "flick",
        "Flick to shoot",
        "Blue kicks off. Start on the ball and flick toward the other goal. When it stops, the other player shoots.",
      ],
      ["score", "Win the match", rules[2] + " " + rules[3]],
    ];
  }
  help(from: Screen) {
    this.helpFrom = from;
    this.helpPage = 0;
    this.lesson();
    this.go("help");
  }
  private lesson() {
    const lessons = this.lessons(),
      [demo, title, text] = lessons[this.helpPage];
    byId("lesson-number").textContent =
      MODE_NAME + " · " + (this.helpPage + 1) + " / " + lessons.length;
    byId("lesson-title").textContent = title;
    byId("lesson-text").textContent = text;
    byId("lesson-clip").dataset.demo = demo;
    byId<HTMLImageElement>("clip-piece").src =
      demo === "turn" ? "./piece-art/5.png" : "./piece-art/4.png";
    byId("lesson-dots").textContent = lessons
      .map((_, i) => (i === this.helpPage ? "●" : "○"))
      .join("");
    button("help-prev").disabled = !this.helpPage;
    button("help-next").textContent =
      this.helpPage === lessons.length - 1 ? "Done" : "Next";
    button("help-play").hidden = this.helpFrom === "match";
  }
  menu(id: string) {
    if (id === "modes") this.go("modes");
    if (id === "restart" && this.screen === "match")
      this.actions.start(document.body.classList.contains("tutorial"));
    if (id === "help") this.help(this.screen === "match" ? "match" : "home");
  }
  results(blue: number, orange: number) {
    const [left, right] = this.names;
    byId("winner").textContent = (blue > orange ? left : right) + " wins!";
    byId("result-score").textContent =
      left + "  " + blue + "  –  " + orange + "  " + right;
    byId("result-target").textContent = "First to " + this.target + " goals";
    this.go("results");
  }
}
