import { ITEMS, rollGroundItem } from "./items";
import { WORLD_SIZE } from "./shared";
import { Biome, BiomeMap, biomeAt, makeBiomeMap } from "./biomes";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Disc {
  x: number;
  y: number;
  r: number;
}

export type PropKind = "tree" | "pine" | "rock" | "bush" | "cactus" | "palm" | "crate";

export interface Prop extends Disc {
  kind: PropKind;
  /** Drawn radius, larger than the collision radius for leafy things. */
  visual: number;
}

export interface Building {
  rect: Rect;
  walls: Rect[];
  palette: number;
}

export type PlaceKind =
  | "village"
  | "cafe"
  | "hospital"
  | "docks"
  | "lighthouse"
  | "oasis";

export interface Town {
  name: string;
  kind: PlaceKind;
  x: number;
  y: number;
  r: number;
}

/** A drawn feature that makes a place recognisable from the air. */
export interface Landmark {
  kind: PlaceKind;
  x: number;
  y: number;
  r: number;
}

export interface LootDrop {
  id: number;
  x: number;
  y: number;
  itemId: string;
  qty: number;
  airdrop: boolean;
}

/** A piece of the letter lying somewhere on the island. */
export interface LetterSpot {
  pieceId: number;
  x: number;
  y: number;
  /** Name of the place it's hidden, shown once found. */
  place: string;
}

export interface World {
  size: number;
  towns: Town[];
  buildings: Building[];
  walls: Rect[];
  props: Prop[];
  roads: Rect[];
  water: Disc[];
  loot: LootDrop[];
  nextLootId: number;
  letterSpots: LetterSpot[];
  biomes: BiomeMap;
  landmarks: Landmark[];
  piers: Rect[];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PlaceTemplate {
  name: string;
  kind: PlaceKind;
  /** Rough building count. */
  buildings: number;
  /** Item ids this place is generous with. */
  bias: string[];
}

const PLACE_TEMPLATES: PlaceTemplate[] = [
  { name: "Julie's Villa", kind: "village", buildings: 9, bias: [] },
  { name: "St. Mercy Hospital", kind: "hospital", buildings: 5, bias: ["med_kit", "vest_2", "helmet_2"] },
  { name: "Boba Cafe", kind: "cafe", buildings: 4, bias: ["energy_drink", "painkiller", "med_kit"] },
  { name: "Sunflower Farm", kind: "village", buildings: 8, bias: [] },
  { name: "Salt Docks", kind: "docks", buildings: 5, bias: ["rifle", "sniper", "vest_2"] },
  { name: "Old Lighthouse", kind: "lighthouse", buildings: 3, bias: ["sniper", "scope_4x"] },
  { name: "Dune Oasis", kind: "oasis", buildings: 3, bias: ["awm", "vest_3", "med_kit"] },
];

const WALL_THICKNESS = 12;
const DOOR_WIDTH = 52;

function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

function makeBuilding(rect: Rect, rand: () => number): Building {
  const t = WALL_THICKNESS;
  const walls: Rect[] = [];
  const doorSide = Math.floor(rand() * 4);

  // Each side is one solid wall, except the door side which is split around a gap.
  const sides: Rect[] = [
    { x: rect.x, y: rect.y, w: rect.w, h: t },
    { x: rect.x, y: rect.y + rect.h - t, w: rect.w, h: t },
    { x: rect.x, y: rect.y, w: t, h: rect.h },
    { x: rect.x + rect.w - t, y: rect.y, w: t, h: rect.h },
  ];

  sides.forEach((side, i) => {
    if (i !== doorSide) {
      walls.push(side);
      return;
    }
    const horizontal = side.w > side.h;
    const span = horizontal ? side.w : side.h;
    const gapStart = t + rand() * Math.max(1, span - 2 * t - DOOR_WIDTH);
    if (horizontal) {
      walls.push({ ...side, w: gapStart });
      walls.push({
        ...side,
        x: side.x + gapStart + DOOR_WIDTH,
        w: span - gapStart - DOOR_WIDTH,
      });
    } else {
      walls.push({ ...side, h: gapStart });
      walls.push({
        ...side,
        y: side.y + gapStart + DOOR_WIDTH,
        h: span - gapStart - DOOR_WIDTH,
      });
    }
  });

  // Interior divider for the bigger houses, so rooms feel like rooms.
  if (rect.w > 200 && rect.h > 160 && rand() < 0.6) {
    const cut = rect.x + rect.w * (0.35 + rand() * 0.3);
    const gapY = rect.y + rect.h * (0.3 + rand() * 0.4);
    walls.push({ x: cut, y: rect.y + t, w: t, h: gapY - rect.y - t });
    walls.push({
      x: cut,
      y: gapY + DOOR_WIDTH,
      w: t,
      h: rect.y + rect.h - gapY - DOOR_WIDTH - t,
    });
  }

  return {
    rect,
    walls: walls.filter((w) => w.w > 1 && w.h > 1),
    palette: Math.floor(rand() * 4),
  };
}

function scatterLoot(
  world: World,
  x: number,
  y: number,
  count: number,
  rand: () => number,
  spread: number,
  bias: string[] = [],
) {
  for (let i = 0; i < count; i++) {
    const biased = bias.length > 0 && rand() < 0.5 ? ITEMS[bias[Math.floor(rand() * bias.length)]] : null;
    const def = biased ?? rollGroundItem(rand);
    const dx = x + (rand() - 0.5) * spread;
    const dy = y + (rand() - 0.5) * spread;
    world.loot.push({
      id: world.nextLootId++,
      x: dx,
      y: dy,
      itemId: def.id,
      qty: 1,
      airdrop: false,
    });
  }
}

export function generateWorld(seed: number): World {
  const rand = mulberry32(seed);
  const size = WORLD_SIZE;
  const world: World = {
    size,
    towns: [],
    buildings: [],
    walls: [],
    props: [],
    roads: [],
    water: [],
    loot: [],
    nextLootId: 1,
    letterSpots: [],
    biomes: makeBiomeMap(rand),
    landmarks: [],
    piers: [],
  };

  // Places are positioned by the biome they belong in rather than on a blind
  // grid: the docks and lighthouse need shoreline, the oasis needs desert.
  const templates = new Map(PLACE_TEMPLATES.map((t) => [t.name, t]));
  const beach = world.biomes.beachLine;
  const desertPatch = world.biomes.patches.find((p) => p.kind === "desert");

  const addPlace = (name: string, x: number, y: number, r: number) => {
    const template = templates.get(name);
    if (!template) return;
    world.towns.push({
      name,
      kind: template.kind,
      x: Math.max(260, Math.min(size - 260, x)),
      y: Math.max(260, Math.min(size - 260, y)),
      r,
    });
  };

  // Shoreline pair, kept well apart along the sand.
  const shoreY = beach + (size - beach) * 0.42;
  addPlace("Salt Docks", size * (0.18 + rand() * 0.12), shoreY, 300);
  addPlace("Old Lighthouse", size * (0.68 + rand() * 0.16), shoreY, 250);

  // Oasis sits in the dunes.
  if (desertPatch) {
    addPlace(
      "Dune Oasis",
      desertPatch.x + (rand() - 0.5) * desertPatch.rx * 0.5,
      desertPatch.y + (rand() - 0.5) * desertPatch.ry * 0.5,
      290,
    );
  }

  // The inland four spread across the green half, avoiding the dunes.
  const inland = ["Julie's Villa", "St. Mercy Hospital", "Boba Cafe", "Sunflower Farm"];
  const slots: [number, number][] = [
    [0.2, 0.2],
    [0.52, 0.16],
    [0.22, 0.58],
    [0.5, 0.62],
  ];
  inland.forEach((name, i) => {
    const [fx, fy] = slots[i];
    addPlace(
      name,
      size * (fx + (rand() - 0.5) * 0.08),
      size * (fy + (rand() - 0.5) * 0.08),
      320 + rand() * 120,
    );
  });

  // Roads follow the places: a coast road, plus lanes through the inland pairs.
  const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const inlandPlaces = world.towns.filter((t) => t.y < beach - 200);
  const north = inlandPlaces.filter((t) => t.y < size * 0.42);
  const south = inlandPlaces.filter((t) => t.y >= size * 0.42);
  if (north.length) world.roads.push({ x: 0, y: average(north.map((t) => t.y)) - 26, w: size, h: 52 });
  if (south.length) world.roads.push({ x: 0, y: average(south.map((t) => t.y)) - 26, w: size, h: 52 });
  world.roads.push({ x: 0, y: shoreY - 130, w: size, h: 46 });
  for (const t of world.towns.filter((p) => p.kind !== "oasis").slice(0, 4)) {
    world.roads.push({ x: t.x - 26, y: 0, w: 52, h: size });
  }

  for (const town of world.towns) {
    const template = templates.get(town.name);
    const bias = template?.bias ?? [];
    const target = template?.buildings ?? 8;
    let attempts = 0;
    let placed = 0;
    while (placed < target && attempts < 600) {
      attempts++;
      const w = 130 + rand() * 150;
      const h = 110 + rand() * 130;
      const angle = rand() * Math.PI * 2;
      const dist = rand() * town.r;
      const rect: Rect = {
        x: town.x + Math.cos(angle) * dist - w / 2,
        y: town.y + Math.sin(angle) * dist - h / 2,
        w,
        h,
      };
      if (rect.x < 80 || rect.y < 80) continue;
      if (rect.x + rect.w > size - 80 || rect.y + rect.h > size - 80) continue;
      if (world.buildings.some((b) => rectsOverlap(rect, b.rect, 34))) continue;
      // Keep the roads drivable.
      if (world.roads.some((r) => rectsOverlap(rect, r, 8))) continue;

      const building = makeBuilding(rect, rand);
      world.buildings.push(building);
      placed++;

      scatterLoot(
        world,
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
        1 + Math.floor(rand() * 3),
        rand,
        Math.min(rect.w, rect.h) * 0.55,
        bias,
      );
    }

    scatterLoot(world, town.x, town.y, 4 + Math.floor(rand() * 5), rand, town.r * 1.5, bias);
    world.landmarks.push({ kind: town.kind, x: town.x, y: town.y, r: 46 });

    // Docks reach out over the water on timber piers.
    if (town.kind === "docks") {
      const count = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < count; i++) {
        const px = town.x - 120 + i * 110 + rand() * 30;
        world.piers.push({ x: px, y: town.y + 60, w: 34, h: 180 + rand() * 120 });
      }
    }
  }

  world.walls = world.buildings.flatMap((b) => b.walls);

  for (let i = 0; i < 3; i++) {
    world.water.push({
      x: 300 + rand() * (size - 600),
      y: 300 + rand() * (world.biomes.beachLine - 600),
      r: 150 + rand() * 190,
    });
  }

  // The oasis gets a pool, which is the whole reason to go there.
  const oasis = world.towns.find((t) => t.kind === "oasis");
  if (oasis) world.water.push({ x: oasis.x, y: oasis.y, r: 110 });

  const blocked = (x: number, y: number, r: number) =>
    world.walls.some((w) => rectsOverlap({ x: x - r, y: y - r, w: r * 2, h: r * 2 }, w)) ||
    world.roads.some((rd) => rectsOverlap({ x: x - r, y: y - r, w: r * 2, h: r * 2 }, rd)) ||
    world.water.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r);

  const BIOME_PROPS: Record<Biome, PropKind[]> = {
    meadow: ["tree", "bush", "bush", "rock"],
    forest: ["pine", "pine", "tree", "bush", "bush"],
    desert: ["cactus", "cactus", "rock", "rock"],
    beach: ["palm", "palm", "rock", "bush"],
  };
  // Deserts read as open ground, woods as dense cover.
  const BIOME_DENSITY: Record<Biome, number> = {
    meadow: 1,
    forest: 2.1,
    desert: 0.32,
    beach: 0.55,
  };

  let guard = 0;
  while (world.props.length < 520 && guard < 14000) {
    guard++;
    const x = 40 + rand() * (size - 80);
    const y = 40 + rand() * (size - 80);
    const biome = biomeAt(world.biomes, x, y);
    if (rand() > BIOME_DENSITY[biome] / 2.1) continue;

    const choices = BIOME_PROPS[biome];
    const kind = choices[Math.floor(rand() * choices.length)];
    const r =
      kind === "rock"
        ? 14 + rand() * 16
        : kind === "bush"
          ? 14 + rand() * 10
          : kind === "cactus"
            ? 11 + rand() * 7
            : 15 + rand() * 10;
    if (blocked(x, y, r + 6)) continue;
    // Thin out cover inside places so streets stay walkable.
    const inTown = world.towns.some((t) => Math.hypot(t.x - x, t.y - y) < t.r);
    if (inTown && rand() < 0.85) continue;

    world.props.push({
      x,
      y,
      // Bushes are walk-through hiding spots, so they barely collide.
      r: kind === "bush" ? r * 0.25 : kind === "palm" ? r * 0.55 : r,
      visual: kind === "bush" ? r * 1.6 : r * (kind === "rock" ? 1.1 : kind === "cactus" ? 1.3 : 2.1),
      kind,
    });
  }

  // Field loot, so wandering between towns still pays off.
  let fieldGuard = 0;
  let fieldPlaced = 0;
  while (fieldPlaced < 90 && fieldGuard < 3000) {
    fieldGuard++;
    const x = 100 + rand() * (size - 200);
    const y = 100 + rand() * (size - 200);
    if (blocked(x, y, 20)) continue;
    scatterLoot(world, x, y, 1, rand, 0);
    fieldPlaced++;
  }

  // One letter piece per town, so the five are always far apart.
  const townOrder = [...world.towns];
  for (let i = 0; i < 5 && i < townOrder.length; i++) {
    const town = townOrder[i];
    let placed = false;
    for (let attempt = 0; attempt < 400 && !placed; attempt++) {
      const angle = rand() * Math.PI * 2;
      const dist = town.r * (0.25 + rand() * 0.7);
      const x = town.x + Math.cos(angle) * dist;
      const y = town.y + Math.sin(angle) * dist;
      if (x < 100 || y < 100 || x > size - 100 || y > size - 100) continue;
      if (world.water.some((w) => Math.hypot(w.x - x, w.y - y) < w.r + 30)) continue;
      if (world.walls.some((w) => rectsOverlap({ x: x - 18, y: y - 18, w: 36, h: 36 }, w))) continue;
      if (world.props.some((pr) => pr.kind !== "bush" && Math.hypot(pr.x - x, pr.y - y) < pr.r + 24)) {
        continue;
      }
      world.letterSpots.push({ pieceId: i + 1, x, y, place: town.name });
      placed = true;
    }
    if (!placed) {
      world.letterSpots.push({ pieceId: i + 1, x: town.x, y: town.y, place: town.name });
    }
  }

  return world;
}

export function isInWater(world: World, x: number, y: number): boolean {
  return world.water.some((p) => Math.hypot(p.x - x, p.y - y) < p.r);
}
