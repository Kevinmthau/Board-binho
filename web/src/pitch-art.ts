// Both compositions share the game's inks. The home layout reserves the left
// third for controls. The card moves the shot across the lower half of the print.
export function drawPitchArt(canvas: HTMLCanvasElement, card = false): void {
  const c = canvas.getContext("2d")!;
  const w = canvas.width,
    h = canvas.height;
  c.save();
  c.scale(w / 1600, h / 900);
  c.fillStyle = "#073c32";
  c.fillRect(0, 0, 1600, 900);
  c.save();
  c.beginPath();
  c.moveTo(card ? 700 : 760, 0);
  c.lineTo(1600, 0);
  c.lineTo(1600, 900);
  c.lineTo(card ? 100 : 670, 900);
  c.closePath();
  c.clip();
  c.fillStyle = "#126649";
  c.fillRect(0, 0, 1600, 900);
  c.strokeStyle = "#207953";
  c.lineWidth = 95;
  for (let x = 110; x < 2300; x += 230) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x - 330, 900);
    c.stroke();
  }
  c.strokeStyle = "#a1bd7d";
  c.lineWidth = 6;
  c.beginPath();
  c.ellipse(1520, 75, 335, 95, -0.12, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.moveTo(1250, 0);
  c.lineTo(1175, 140);
  c.lineTo(1650, 72);
  c.stroke();
  c.beginPath();
  c.moveTo(730, 900);
  c.lineTo(1600, 725);
  c.stroke();
  c.restore();
  const bx = card ? 1240 : 1245,
    by = card ? 622 : 540,
    r = card ? 165 : 185;
  for (const [offset, ink] of [
    [46, "#213e81"],
    [19, "#3586c0"],
    [-8, "#f38b45"],
    [-26, "#ffd18a"],
  ] as const) {
    c.beginPath();
    c.moveTo(card ? 65 : 665, card ? 900 : 808);
    c.bezierCurveTo(
      815,
      790 + offset,
      958,
      420 + offset,
      bx + 15,
      by - 22 + offset,
    );
    c.bezierCurveTo(
      938,
      480 + offset,
      962,
      875 + offset,
      card ? 24 : 681,
      card ? 920 : 832,
    );
    c.fillStyle = ink;
    c.fill();
  }
  c.save();
  c.translate(bx, by);
  c.rotate(-0.27);
  c.fillStyle = "#043830";
  c.beginPath();
  c.ellipse(28, r * 0.95, r * 1.09, 22, 0.2, 0, 2 * Math.PI);
  c.fill();
  c.beginPath();
  c.arc(0, 0, r, 0, 2 * Math.PI);
  c.fillStyle = "#f5e5bc";
  c.fill();
  c.clip();
  c.strokeStyle = "#687462";
  c.lineWidth = 3;
  const pentagon = (x: number, y: number, radius: number, angle: number) => {
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = angle + (i * 2 * Math.PI) / 5;
      const px = x + radius * Math.cos(a),
        py = y + radius * Math.sin(a);
      if (i) c.lineTo(px, py);
      else c.moveTo(px, py);
    }
    c.closePath();
    c.fillStyle = "#112f32";
    c.fill();
  };
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    c.beginPath();
    c.moveTo(Math.cos(a) * r * 0.37, Math.sin(a) * r * 0.37);
    c.lineTo(Math.cos(a) * r * 0.76, Math.sin(a) * r * 0.76);
    c.stroke();
    pentagon(
      Math.cos(a) * r * 0.97,
      Math.sin(a) * r * 0.97,
      r * 0.27,
      a + Math.PI,
    );
  }
  pentagon(0, 0, r * 0.37, -Math.PI / 2);
  c.restore();
  // Painted table markers, distinct from the photographic Sports Piece renders.
  for (const [x, y, size, ink] of [
    [1318, 155, 29, "#ef904e"],
    [1010, 270, 38, "#62b9e6"],
  ] as const) {
    c.fillStyle = "#073b35";
    c.beginPath();
    c.ellipse(x + 8, y + 20, size * 1.25, size * 0.44, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = ink;
    c.beginPath();
    c.ellipse(x, y + 12, size * 1.16, size * 0.43, 0, 0, Math.PI * 2);
    c.fill();
    c.fillRect(x - size * 0.2, y - size * 0.6, size * 0.4, size * 0.95);
    c.beginPath();
    c.arc(x, y - size * 0.78, size * 0.36, 0, Math.PI * 2);
    c.fill();
  }
  if (card) {
    c.fillStyle = "#ffeaba";
    c.textBaseline = "alphabetic";
    c.textAlign = "left";
    c.font = '180px "Board Game Font"';
    c.fillText("FLICK", 80, 306);
    c.font = '175px "Board Game Font"';
    c.fillText("SOCCER", 76, 490);
  }
  c.restore();
}
