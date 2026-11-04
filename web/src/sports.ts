import Matter from "matter-js";
import decomp from "poly-decomp";
import footprints from "../public/piece-footprints.json";

export const BOARD_WIDTH = 1920;
export const BOARD_HEIGHT = 1080;
export const FIELD_WORLD_HEIGHT = 11;
const WORLD_UNITS_PER_MM = 3.6 * FIELD_WORLD_HEIGHT / BOARD_HEIGHT;
Matter.Common.setDecomp(decomp);

export type SportsPiece = {
  glyphId: number;
  radius: number;
  vertices: Matter.Vector[];
};

export const sportsPieces = new Map<number, SportsPiece>();
for (const [id, shape] of Object.entries(footprints.pieces)) {
  // Sports faces along local -Y. At sensor angle zero it faces world +X.
  const outline = shape.outlineMm.map(([x, y]) => ({
    x: -y * WORLD_UNITS_PER_MM,
    y: x * WORLD_UNITS_PER_MM,
  }));
  const glyphId = Number(id);
  sportsPieces.set(glyphId, {
    glyphId,
    radius: shape.radiusMm * WORLD_UNITS_PER_MM,
    vertices: outline,
  });
}

export function createSportsBumper(piece: SportsPiece): Matter.Body {
  const centre = Matter.Vertices.centre(piece.vertices);
  // Preserve the notches in the traced base. Matter's default minimum part
  // area is larger than a whole piece at this world scale.
  const body = Matter.Bodies.fromVertices(centre.x, centre.y, [piece.vertices.slice()], {
    label: "defender",
    slop: 0.001,
    friction: 0.05,
    frictionStatic: 0,
  }, false, 0, 0, 0);
  Matter.Body.setStatic(body, true);
  // Rotate around the sensor origin, which may be offset from the centroid.
  Matter.Body.setCentre(body, { x: 0, y: 0 });
  return body;
}
