/**
 * Icons as SVG path data on a 24×24 grid. React renders them in <svg>, and the
 * canvas renders the same strings via Path2D — one definition, both surfaces.
 */

export type IconName =
  | "medkit"
  | "vest"
  | "helmet"
  | "pistol"
  | "rifle"
  | "sniper"
  | "shotgun"
  | "smg"
  | "bazooka"
  | "scope"
  | "suppressor"
  | "grenade"
  | "smoke"
  | "letter"
  | "crate"
  | "plane"
  | "hand"
  | "reload"
  | "fire"
  | "target"
  | "burst"
  | "boot"
  | "heart"
  | "drink"
  | "block"
  | "radio";

export const ICONS: Record<IconName, string> = {
  // A first-aid case with a cross.
  medkit:
    "M3 7h18v13H3z M9 7V5h6v2 M10.5 11h3v2h2v3h-2v2h-3v-2h-2v-3h2z",
  vest: "M8 3l4 3 4-3 3 2v16H5V5z M12 6v14",
  helmet: "M4 14a8 8 0 0 1 16 0v3H4z M2 17h20v3H2z",
  pistol: "M3 8h12v5h-3l-1 3H8l1-3H3z M15 9h5v3h-5z",
  rifle: "M2 10h18v3H2z M6 13v3h3v-3 M14 8h3v2h-3z",
  sniper: "M2 11h20v2H2z M7 13v3h2v-3 M12 8h4v3h-4z M20 9h2v6h-2z",
  shotgun: "M2 9h17v3H2z M2 12h17v2H2z M6 14v3h3v-3",
  smg: "M3 9h13v4H3z M6 13v4h3v-4 M16 10h4v2h-4z M8 5h2v4H8z",
  bazooka: "M2 9h18v6H2z M20 8l3 4-3 4z M7 15v3h3v-3 M5 6h4v3H5z",
  scope: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M12 9v6 M9 12h6",
  suppressor: "M4 9h14v6H4z M18 10h3v4h-3z M7 6v3 M11 6v3",
  grenade: "M12 6a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M10 4h4v2h-4z M15 5l3-2",
  smoke: "M6 18a4 4 0 0 1 0-8 5 5 0 0 1 10 0 4 4 0 0 1 0 8z M9 4c1 1 1 2 0 3 M13 3c1 1 1 2 0 3",
  // Folded sheet of paper.
  letter: "M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 15h6 M9 18h4",
  crate: "M4 6h16v14H4z M4 11h16 M12 6v14",
  plane: "M2 13l20-6-6 12-3-4-4 2z",
  hand: "M8 20v-6l-2-3a1.5 1.5 0 0 1 2-2l1 2V5a1.5 1.5 0 0 1 3 0v5V4a1.5 1.5 0 0 1 3 0v6V6a1.5 1.5 0 0 1 3 0v9a5 5 0 0 1-5 5z",
  reload:
    "M20 12a8 8 0 1 1-3-6.2 M20 4v5h-5",
  fire: "M12 2c4 5 6 7 6 11a6 6 0 0 1-12 0c0-2 1-3 2-5 0 2 1 3 2 3s1-4 2-9z",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 11v2",
  burst: "M12 2l2 6 5-3-3 5 6 2-6 2 3 5-5-3-2 6-2-6-5 3 3-5-6-2 6-2-3-5 5 3z",
  boot: "M7 3h4v9l6 3v6H7z M7 15h10",
  heart: "M12 21C6 16 3 13 3 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 9 2.5C21 13 18 16 12 21z",
  drink: "M7 4h10l-1 16H8z M7 9h10",
  block: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M6 6l12 12",
  radio: "M5 10h11v8H5z M16 6l4-2v12l-4-2z M8 14h3",
};

export function iconPath(name: IconName): string {
  return ICONS[name];
}

const cache = new Map<IconName, Path2D>();

function path2dFor(name: IconName): Path2D {
  let p = cache.get(name);
  if (!p) {
    p = new Path2D(ICONS[name]);
    cache.set(name, p);
  }
  return p;
}

/**
 * Stroke an icon centred at (x, y) at `size` world units. Icons are drawn as
 * outlines so they stay legible against grass, buildings and water alike.
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  x: number,
  y: number,
  size: number,
  color: string,
  lineWidth = 1.9,
) {
  const p = path2dFor(name);
  const scale = size / 24;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(scale, scale);
  ctx.lineWidth = lineWidth / scale;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(12,16,18,0.85)";
  ctx.lineWidth = (lineWidth + 1.6) / scale;
  ctx.stroke(p);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth / scale;
  ctx.stroke(p);
  ctx.restore();
}
