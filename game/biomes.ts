import { WORLD_SIZE } from "./shared";

export type Biome = "meadow" | "forest" | "desert" | "beach";

export interface BiomePatch {
  kind: Biome;
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface BiomeMap {
  /** Everything south of this line is sand. */
  beachLine: number;
  patches: BiomePatch[];
}

export const BIOME_GROUND: Record<Biome, { base: string; speck: string[] }> = {
  meadow: { base: "#4f7d43", speck: ["#548646", "#48733d", "#5b8f4c", "#436b39"] },
  forest: { base: "#3a6136", speck: ["#33582f", "#40693b", "#2e4f2a", "#456f3f"] },
  desert: { base: "#cbab6e", speck: ["#d7b878", "#c0a065", "#e0c489", "#b89a5f"] },
  beach: { base: "#e3d0a2", speck: ["#ece0bb", "#d8c290", "#f2e8cb", "#cdb783"] },
};

/**
 * Biomes are a handful of overlapping ellipses plus a southern beach band.
 * Cheap to evaluate per prop, and cheap to paint as layered fills.
 */
export function makeBiomeMap(rand: () => number): BiomeMap {
  const size = WORLD_SIZE;
  const patches: BiomePatch[] = [];

  // One big desert on the eastern side.
  patches.push({
    kind: "desert",
    x: size * (0.74 + rand() * 0.08),
    y: size * (0.3 + rand() * 0.4),
    rx: size * (0.22 + rand() * 0.06),
    ry: size * (0.26 + rand() * 0.08),
  });

  // Two or three woods in the west and north.
  const woods = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < woods; i++) {
    patches.push({
      kind: "forest",
      x: size * (0.1 + rand() * 0.4),
      y: size * (0.08 + rand() * 0.8),
      rx: size * (0.1 + rand() * 0.09),
      ry: size * (0.1 + rand() * 0.09),
    });
  }

  return { beachLine: size * (0.87 + rand() * 0.04), patches };
}

export function biomeAt(map: BiomeMap, x: number, y: number): Biome {
  if (y > map.beachLine) return "beach";
  for (const p of map.patches) {
    const dx = (x - p.x) / p.rx;
    const dy = (y - p.y) / p.ry;
    if (dx * dx + dy * dy <= 1) return p.kind;
  }
  return "meadow";
}
