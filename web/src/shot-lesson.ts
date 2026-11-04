import { byId } from "./screens";

type Point = { x: number; y: number };
const ball = { x: 0.5, y: 0.5 };

export class ShotLesson {
  private complete = false;
  private fingers = new Map<number, Point>();
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
      if (Math.hypot(point.x - ball.x, (point.y - ball.y) * 0.5625) < 0.055)
        this.fingers.set(id, point);
      return;
    }
    const start = this.fingers.get(id);
    if (!start || phase !== "up") return;
    this.fingers.delete(id);
    const dx = point.x - start.x, dy = point.y - start.y;
    if (dx > 0.03 && Math.abs(dy) * 0.5625 < dx * 0.8) {
      this.wonAt = this.elapsed;
      this.complete = true;
      this.fingers.clear();
    } else {
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
