import { BoardContactPhase } from "@board.fun/web-sdk";
import type { BoardFrameChanges } from "./board-input";
import { BOARD_HEIGHT, BOARD_WIDTH } from "./sports";

type Point = { x: number; y: number };
const pressed = new Map<
  number,
  { button: HTMLElement; start: Point; last: Point; moved: boolean }
>();
let lastSdkClick: (Point & { at: number }) | undefined;
let lastBrowserClick: (Point & { at: number }) | undefined;
function recent(click: typeof lastSdkClick, p: Point) {
  return (
    click &&
    performance.now() - click.at < 400 &&
    Math.hypot(click.x - p.x, click.y - p.y) < 22
  );
}
export function wireNativeClicks() {
  // Some hosts send both a Board finger and a DOM click for the same tap.
  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted || event.detail === 0) return;
      const p = { x: event.clientX, y: event.clientY };
      if (recent(lastSdkClick, p)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      lastBrowserClick = { ...p, at: performance.now() };
    },
    true,
  );
}
function css(p: Point): Point {
  return {
    x: (p.x * innerWidth) / BOARD_WIDTH,
    y: (p.y * innerHeight) / BOARD_HEIGHT,
  };
}
function buttonAt(p: Point) {
  const element = document.elementFromPoint(p.x, p.y);
  const button = element?.closest<HTMLElement>(
    "button:not(:disabled), #mode-card",
  );
  if (button) return button;
  const dialog =
    document.querySelector<HTMLDialogElement>("#mode-dialog[open]");
  if (dialog && element === dialog) {
    const r = dialog.getBoundingClientRect();
    if (p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom)
      return dialog;
  }
}
export function routeBoardControls(changes: BoardFrameChanges) {
  const used = new Set<number>();
  for (const [id, change] of changes) {
    for (const trace of change.fingerTraces ?? []) {
      if (trace.began) {
        pressed.delete(id);
        const first = trace.points[0];
        if (first) {
          const p = css(first),
            button = buttonAt(p);
          if (button)
            pressed.set(id, { button, start: p, last: p, moved: false });
        }
      }
      const tap = pressed.get(id);
      if (!tap) continue;
      used.add(id);
      for (const raw of trace.points) {
        tap.last = css(raw);
        if (
          Math.hypot(tap.last.x - tap.start.x, tap.last.y - tap.start.y) >
          innerHeight * 0.035
        )
          tap.moved = true;
      }
      if (trace.terminal !== undefined) {
        pressed.delete(id);
        const p =
          trace.releasePosition &&
          (trace.releasePosition.x || trace.releasePosition.y)
            ? css(trace.releasePosition)
            : tap.last;
        if (
          trace.terminal === BoardContactPhase.Ended &&
          !tap.moved &&
          tap.button === buttonAt(p) &&
          !recent(lastBrowserClick, p)
        ) {
          lastSdkClick = { ...p, at: performance.now() };
          tap.button.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              clientX: p.x,
              clientY: p.y,
            }),
          );
        }
      }
    }
    if (change.terminated) pressed.delete(id);
  }
  return used;
}
export function cancelBoardControls() {
  pressed.clear();
}
