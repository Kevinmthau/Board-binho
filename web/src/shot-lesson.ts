import { byId } from "./screens";

type Point = { x: number; y: number };
type PracticeSwipe = { last: Point; origin?: Point };
const ball = { x: 0.5, y: 0.5 };
const aspect = 0.5625;

function ballContact(from: Point, to: Point): Point | undefined {
  const dx = to.x - from.x, dy = (to.y - from.y) * aspect;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1,
    ((ball.x - from.x) * dx + (ball.y - from.y) * aspect * dy) / lengthSquared,
  )) : 0;
  const closest = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  return Math.hypot(closest.x - ball.x, (closest.y - ball.y) * aspect) < 0.055 ? closest : undefined;
}

export class ShotLesson {
  private complete = false;
  private fingers = new Map<number, PracticeSwipe>();
  private elapsed = 0;
  private retry = false;
  private wonAt = 0;

  constructor(private done: () => void) {
    this.coach();
  }

  cancelFingers() {
    this.fingers.clear();
  }

  finger(id: number, point: Point, phase: "down" | "move" | "up" | "cancel") {
    if (phase === "cancel") {
      this.fingers.delete(id);
      return;
    }
    if (this.complete) return;
    if (phase === "down") {
      this.fingers.set(id, { last: point, origin: ballContact(point, point) });
      return;
    }
    const swipe = this.fingers.get(id);
    if (!swipe) return;
    // A finger can start beside the ball and sweep through it. Test each
    // segment so sparse sensor frames work without accepting a path around it.
    swipe.origin ??= ballContact(swipe.last, point);
    swipe.last = point;
    if (phase === "up") this.fingers.delete(id);
    const dx = point.x - (swipe.origin?.x ?? point.x), dy = point.y - (swipe.origin?.y ?? point.y);
    // Respond during the gesture, as match shots do; lifting is not required.
    if (dx > 0.03 && Math.abs(dy) * aspect < dx * 0.8) {
      this.wonAt = this.elapsed;
      this.complete = true;
      this.fingers.clear();
    } else if (phase === "up") {
      this.retry = true;
    }
    this.coach();
  }

  tick(ms: number) {
    this.elapsed += ms;
    if (this.complete && this.elapsed - this.wonAt > 850) this.done();
  }

  private coach() {
    byId("coach-count").textContent = this.complete ? "Practice complete" : "Swipe practice";
    byId("coach-line").textContent = this.complete
      ? "Now take turns. Keep the blockers in place."
      : this.retry
        ? "Try again. Swipe the ball toward the right goal."
        : "Swipe the ball toward the right goal";
  }

  draw(c: CanvasRenderingContext2D, width: number, height: number) {
    const pulse = (Math.sin(this.elapsed / 200) + 1) / 2;
    const x = ball.x * width, y = ball.y * height;
    const r = Math.max(22, height * 0.073);
    c.save();
    c.fillStyle = "rgba(1,28,26,.45)";
    c.fillRect(0, 0, width, height);
    const distance = this.complete
      ? Math.min(1, (this.elapsed - this.wonAt) / 520) * width * 0.45
      : 0;
    c.fillStyle = "#fff2d1";
    c.beginPath();
    c.arc(x + distance, y, r * 0.24, 0, 2 * Math.PI);
    c.fill();
    if (!this.complete) {
      const tip = x + r * (1.8 + pulse * 0.35);
      c.strokeStyle = "#ffaf70";
      c.lineWidth = Math.max(3, height * 0.006);
      c.beginPath();
      c.moveTo(x + r * 0.5, y);
      c.lineTo(tip, y);
      c.moveTo(tip - r * 0.3, y - r * 0.25);
      c.lineTo(tip, y);
      c.lineTo(tip - r * 0.3, y + r * 0.25);
      c.stroke();
    }
    c.restore();
  }
}
