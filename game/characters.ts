/**
 * Top-down characters, drawn with canvas primitives so the lobby picker and
 * the game render from one source. Each draw faces +x; the caller rotates.
 */

export type SkinId = "girl" | "boy" | "penguin" | "shark";

export interface Character {
  id: SkinId;
  name: string;
  blurb: string;
  draw: (ctx: CanvasRenderingContext2D, r: number) => void;
}

function shadowUnder(ctx: CanvasRenderingContext2D, r: number) {
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(2, 4, r * 0.95, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
}

function girl(ctx: CanvasRenderingContext2D, r: number) {
  // Long hair spread behind the shoulders.
  ctx.fillStyle = "#5a3524";
  ctx.beginPath();
  ctx.ellipse(-r * 0.15, 0, r * 1.02, r * 0.98, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ponytail trailing backwards.
  ctx.fillStyle = "#4a2a1c";
  ctx.beginPath();
  ctx.ellipse(-r * 1.05, 0, r * 0.42, r * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  // Shoulders.
  ctx.fillStyle = "#e56b8a";
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, 0, r * 0.82, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Face.
  ctx.fillStyle = "#f2c3a7";
  ctx.beginPath();
  ctx.arc(r * 0.16, 0, r * 0.6, 0, Math.PI * 2);
  ctx.fill();

  // Fringe across the forehead.
  ctx.fillStyle = "#5a3524";
  ctx.beginPath();
  ctx.arc(r * 0.16, 0, r * 0.6, Math.PI * 0.62, Math.PI * 1.38);
  ctx.fill();
}

function boy(ctx: CanvasRenderingContext2D, r: number) {
  ctx.fillStyle = "#3c6f9c";
  ctx.beginPath();
  ctx.ellipse(-r * 0.08, 0, r * 0.9, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f2c3a7";
  ctx.beginPath();
  ctx.arc(r * 0.14, 0, r * 0.62, 0, Math.PI * 2);
  ctx.fill();

  // Short cropped hair.
  ctx.fillStyle = "#2e2018";
  ctx.beginPath();
  ctx.arc(r * 0.06, 0, r * 0.63, Math.PI * 0.52, Math.PI * 1.48);
  ctx.fill();
}

function penguin(ctx: CanvasRenderingContext2D, r: number) {
  // Flippers.
  ctx.fillStyle = "#1d2530";
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, -r * 0.85, r * 0.5, r * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, r * 0.85, r * 0.5, r * 0.22, 0.5, 0, Math.PI * 2);
  ctx.fill();

  // Black back.
  ctx.fillStyle = "#23303d";
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.95, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  // White belly.
  ctx.fillStyle = "#f6f2ea";
  ctx.beginPath();
  ctx.ellipse(r * 0.2, 0, r * 0.6, r * 0.58, 0, 0, Math.PI * 2);
  ctx.fill();

  // Beak.
  ctx.fillStyle = "#f0a03c";
  ctx.beginPath();
  ctx.moveTo(r * 1.12, 0);
  ctx.lineTo(r * 0.62, -r * 0.2);
  ctx.lineTo(r * 0.62, r * 0.2);
  ctx.closePath();
  ctx.fill();

  // Eyes.
  ctx.fillStyle = "#141a20";
  ctx.beginPath();
  ctx.arc(r * 0.52, -r * 0.32, r * 0.11, 0, Math.PI * 2);
  ctx.arc(r * 0.52, r * 0.32, r * 0.11, 0, Math.PI * 2);
  ctx.fill();
}

function shark(ctx: CanvasRenderingContext2D, r: number) {
  // Tail fin.
  ctx.fillStyle = "#5b7893";
  ctx.beginPath();
  ctx.moveTo(-r * 0.85, 0);
  ctx.lineTo(-r * 1.5, -r * 0.55);
  ctx.lineTo(-r * 1.18, 0);
  ctx.lineTo(-r * 1.5, r * 0.55);
  ctx.closePath();
  ctx.fill();

  // Side fins.
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.4);
  ctx.lineTo(r * 0.1, -r * 1.0);
  ctx.lineTo(r * 0.45, -r * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, r * 0.4);
  ctx.lineTo(r * 0.1, r * 1.0);
  ctx.lineTo(r * 0.45, r * 0.35);
  ctx.closePath();
  ctx.fill();

  // Body.
  ctx.fillStyle = "#7593ad";
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.05, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();

  // Dorsal fin down the spine.
  ctx.fillStyle = "#4f6c86";
  ctx.beginPath();
  ctx.moveTo(-r * 0.1, 0);
  ctx.lineTo(r * 0.3, -r * 0.12);
  ctx.lineTo(r * 0.3, r * 0.12);
  ctx.closePath();
  ctx.fill();

  // Snout and grin.
  ctx.fillStyle = "#8aa6bd";
  ctx.beginPath();
  ctx.ellipse(r * 0.72, 0, r * 0.38, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f6f2ea";
  ctx.lineWidth = Math.max(1, r * 0.11);
  ctx.beginPath();
  ctx.arc(r * 0.88, 0, r * 0.22, Math.PI * 0.55, Math.PI * 1.45);
  ctx.stroke();

  ctx.fillStyle = "#141a20";
  ctx.beginPath();
  ctx.arc(r * 0.5, -r * 0.28, r * 0.1, 0, Math.PI * 2);
  ctx.arc(r * 0.5, r * 0.28, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

export const CHARACTERS: Character[] = [
  { id: "girl", name: "Girl", blurb: "Ponytail, no nonsense", draw: girl },
  { id: "boy", name: "Boy", blurb: "Blue jacket", draw: boy },
  { id: "penguin", name: "Penguin", blurb: "Small, round, determined", draw: penguin },
  { id: "shark", name: "Shark", blurb: "Should not be on land", draw: shark },
];

export const DEFAULT_SKIN: SkinId = "girl";

export function characterFor(id: string | undefined): Character {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/** Draw a character with its drop shadow, facing `angle`. */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  skin: string | undefined,
  x: number,
  y: number,
  angle: number,
  r: number,
) {
  const character = characterFor(skin);
  ctx.save();
  ctx.translate(x, y);
  shadowUnder(ctx, r);
  ctx.rotate(angle);
  character.draw(ctx, r);
  ctx.restore();
}
