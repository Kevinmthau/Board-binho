import { byId } from "./screens";

type Point = { x: number; y: number };
export type LessonPiece = Point & {
  id: number;
  angle: number;
  glyph: number;
  touchStarted?: boolean;
};
const place = { x: 0.27, y: 0.63 },
  slide = { x: 0.36, y: 0.36 },
  ball = { x: 0.5, y: 0.5 };
const near = (a: Point, b: Point, radius: number) =>
  Math.hypot(a.x - b.x, (a.y - b.y) * 0.5625) < radius;

export class PieceLesson {
  step = 0;
  private owner?: number;
  private piece?: LessonPiece;
  private baseAngle = 0;
  private fingers = new Map<number, Point>();
  private elapsed = 0;
  private retry = false;
  private wonAt = 0;
  constructor(
    private device: boolean,
    private done: () => void,
  ) {
    this.coach();
  }
  cancelFingers() {
    this.fingers.clear();
  }
  contacts(pieces: LessonPiece[]) {
    if (this.step === 4) return;
    if (this.owner !== undefined) {
      this.piece = pieces.find((p) => p.id === this.owner && p.x < 0.5);
      if (!this.piece) {
        this.owner = undefined;
        this.change(0);
      }
    }
    if (this.step === 0) {
      const p = pieces.find((p) => near(p, place, 0.07));
      if (p) {
        this.owner = p.id;
        this.piece = p;
        this.change(1);
      }
      return;
    }
    const p = this.piece!;
    if (this.step === 2 && p.touchStarted) this.baseAngle = p.angle;
    if (this.step >= 2 && !near(p, slide, 0.09)) {
      this.change(1);
      return;
    }
    if (this.step === 1 && near(p, slide, 0.065)) {
      this.baseAngle = p.angle;
      this.change(2);
    }
    if (
      this.step === 2 &&
      Math.abs(
        Math.atan2(
          Math.sin(p.angle - this.baseAngle),
          Math.cos(p.angle - this.baseAngle),
        ),
      ) >=
        Math.PI / 8
    )
      this.change(3);
  }
  finger(id: number, point: Point, phase: "down" | "move" | "up" | "cancel") {
    if (phase === "cancel") {
      this.fingers.delete(id);
      return;
    }
    if (this.step !== 3) return;
    if (phase === "down") {
      if (near(point, ball, 0.055)) this.fingers.set(id, point);
      return;
    }
    const start = this.fingers.get(id);
    if (!start) return;
    const dx = point.x - start.x,
      dy = point.y - start.y;
    if (phase === "up") {
      this.fingers.delete(id);
      if (dx > 0.03 && Math.abs(dy) * 0.5625 < dx * 0.8) {
        this.wonAt = this.elapsed;
        this.change(4);
      } else {
        this.retry = true;
        this.coach();
      }
    }
  }
  tick(ms: number) {
    this.elapsed += ms;
    if (this.step === 4 && this.elapsed - this.wonAt > 850) this.done();
  }
  private change(step: number) {
    this.step = step;
    this.retry = false;
    this.fingers.clear();
    this.coach();
  }
  private coach() {
    byId("coach-count").textContent =
      this.step === 4
        ? "Practice complete"
        : "Step " + (this.step + 1) + " of 4";
    byId("coach-line").textContent = [
      "Place one Sports Piece in the blue ring",
      "Slide the same Piece into the next ring",
      this.device
        ? "Touch and turn your Piece"
        : "Hover over your Piece and press R to turn it",
      this.retry
        ? "Try again. Flick the ball toward the right goal."
        : "Flick the ball toward the right goal",
      "You got it!",
    ][this.step];
    byId("coach-dots").textContent = [0, 1, 2, 3]
      .map((i) => (i <= this.step ? "●" : "○"))
      .join("");
  }
  draw(
    c: CanvasRenderingContext2D,
    width: number,
    height: number,
    image?: HTMLImageElement,
  ) {
    const t = this.elapsed / 1000,
      pulse = (Math.sin(t * 5) + 1) / 2;
    const target = this.step === 0 ? place : this.step < 3 ? slide : ball;
    const x = target.x * width,
      y = target.y * height,
      r = Math.max(22, height * 0.073);
    c.save();
    c.beginPath();
    c.rect(0, 0, width, height);
    c.arc(x, y, r * 1.55, 0, Math.PI * 2, true);
    if (this.step === 1 && this.piece && !near(this.piece, target, 0.1))
      c.arc(
        this.piece.x * width,
        this.piece.y * height,
        r,
        0,
        Math.PI * 2,
        true,
      );
    c.fillStyle = "rgba(1,28,26,.63)";
    c.fill("evenodd");
    c.strokeStyle = this.step === 0 ? "#63cfff" : "#ffe7a1";
    c.lineWidth = Math.max(3, height * 0.006);
    c.beginPath();
    c.arc(x, y, r * (1 + pulse * 0.1), 0, Math.PI * 2);
    c.stroke();
    if (this.step === 0 && image?.naturalWidth) {
      c.globalAlpha = 0.65 + 0.2 * pulse;
      const h = r * 1.6,
        w = (h * image.naturalWidth) / image.naturalHeight;
      c.drawImage(image, x - w / 2, y - h / 2 - pulse * r * 0.22, w, h);
      c.globalAlpha = 1;
    } else if (this.step < 3 && this.piece) {
      c.font = "bold " + Math.round(height * 0.066) + "px system-ui";
      c.textAlign = "center";
      c.fillStyle = "#ffe7a1";
      c.fillText(
        this.step === 2 ? "⟳" : "➜",
        this.piece.x * width + r * 0.9 + pulse * 6,
        this.piece.y * height - r * 0.5,
      );
    } else if (this.step >= 3) {
      const distance =
        this.step === 4
          ? Math.min(1, (this.elapsed - this.wonAt) / 520) * width * 0.45
          : 0;
      c.fillStyle = "#fff2d1";
      c.beginPath();
      c.arc(x + distance, y, r * 0.24, 0, 2 * Math.PI);
      c.fill();
      c.strokeStyle = "#ffaf70";
      c.beginPath();
      c.moveTo(x + r * 0.4, y);
      c.lineTo(x + r * (1.4 + pulse * 0.35), y);
      c.stroke();
    }
    c.restore();
  }
}
