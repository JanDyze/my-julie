import { IconName } from "./icons";

export type ItemCategory = "weapon" | "heal" | "boost" | "armor";

export interface WeaponStats {
  /** Damage per bullet, against 100 total health (5 hearts). */
  damage: number;
  rpm: number;
  /** How far a bullet travels before dying, in world units. */
  range: number;
  /** Bullet speed in world units per second. */
  speed: number;
  /** Random cone applied to each shot, in radians. */
  spread: number;
  mag: number;
  reload: number;
  /** Hold to keep firing. */
  auto: boolean;
  /** Bullets per trigger pull — the shotgun's whole identity. */
  pellets?: number;
  /** Explosion radius on impact, in world units. */
  blast?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  icon: IconName;
  weapon?: WeaponStats;
  /** 1 = common, 4 = airdrop-only */
  rarity: 1 | 2 | 3 | 4;
  blurb: string;
  heal?: number;
  boost?: number;
  armor?: number;
}

export const ITEMS: Record<string, ItemDef> = {
  pistol: {
    id: "pistol",
    name: "Pistol",
    category: "weapon",
    icon: "pistol",
    rarity: 1,
    blurb: "Short range, always useful.",
    weapon: {
      damage: 18,
      rpm: 360,
      range: 380,
      speed: 900,
      spread: 0.04,
      mag: 12,
      reload: 1.2,
      auto: false,
    },
  },
  small_rifle: {
    id: "small_rifle",
    name: "Small Rifle",
    category: "weapon",
    icon: "smg",
    rarity: 2,
    blurb: "Fast and loose up close.",
    weapon: {
      damage: 13,
      rpm: 720,
      range: 440,
      speed: 880,
      spread: 0.075,
      mag: 25,
      reload: 1.6,
      auto: true,
    },
  },
  shotgun: {
    id: "shotgun",
    name: "Shotgun",
    category: "weapon",
    icon: "shotgun",
    rarity: 2,
    blurb: "Six pellets. Get close.",
    weapon: {
      damage: 11,
      rpm: 70,
      range: 240,
      speed: 700,
      spread: 0.3,
      mag: 6,
      reload: 2.4,
      auto: false,
      pellets: 6,
    },
  },
  assault_rifle: {
    id: "assault_rifle",
    name: "Assault Rifle",
    category: "weapon",
    icon: "rifle",
    rarity: 3,
    blurb: "The all-rounder.",
    weapon: {
      damage: 24,
      rpm: 600,
      range: 640,
      speed: 1050,
      spread: 0.042,
      mag: 30,
      reload: 2.0,
      auto: true,
    },
  },
  sniper: {
    id: "sniper",
    name: "Sniper",
    category: "weapon",
    icon: "sniper",
    rarity: 3,
    blurb: "Reaches across the island.",
    weapon: {
      damage: 80,
      rpm: 45,
      range: 1050,
      speed: 1500,
      spread: 0.005,
      mag: 5,
      reload: 2.8,
      auto: false,
    },
  },
  bazooka: {
    id: "bazooka",
    name: "Bazooka",
    category: "weapon",
    icon: "bazooka",
    rarity: 4,
    blurb: "Slow rocket, big hole.",
    weapon: {
      damage: 70,
      rpm: 30,
      range: 700,
      speed: 480,
      spread: 0.01,
      mag: 1,
      reload: 3.2,
      auto: false,
      blast: 110,
    },
  },
  med_kit: {
    id: "med_kit",
    name: "Med Kit",
    category: "heal",
    icon: "medkit",
    rarity: 1,
    blurb: "Refills your hearts.",
    heal: 100,
  },
  energy_drink: {
    id: "energy_drink",
    name: "Energy Drink",
    category: "boost",
    icon: "drink",
    rarity: 1,
    blurb: "Refills stamina.",
    boost: 45,
  },
  helmet_1: {
    id: "helmet_1",
    name: "Helmet",
    category: "armor",
    icon: "helmet",
    rarity: 2,
    blurb: "Takes the edge off.",
    armor: 15,
  },
  helmet_2: {
    id: "helmet_2",
    name: "Reinforced Helmet",
    category: "armor",
    icon: "helmet",
    rarity: 3,
    blurb: "Solid head protection.",
    armor: 25,
  },
  vest_1: {
    id: "vest_1",
    name: "Vest",
    category: "armor",
    icon: "vest",
    rarity: 2,
    blurb: "Light body armor.",
    armor: 20,
  },
  vest_2: {
    id: "vest_2",
    name: "Heavy Vest",
    category: "armor",
    icon: "vest",
    rarity: 3,
    blurb: "Proper body armor.",
    armor: 30,
  },
  vest_3: {
    id: "vest_3",
    name: "Riot Vest",
    category: "armor",
    icon: "vest",
    rarity: 4,
    blurb: "Airdrop only. Very sturdy.",
    armor: 40,
  },
};

/** You can carry this many guns; a third has to replace one. */
export const MAX_GUNS = 2;

export const RARITY_COLORS: Record<number, string> = {
  1: "#9fb3a8",
  2: "#5fc9f8",
  3: "#c58cf6",
  4: "#ffb340",
};

export function isWeapon(itemId: string): boolean {
  return Boolean(ITEMS[itemId]?.weapon);
}

const GROUND_POOL = Object.values(ITEMS).filter((i) => i.rarity < 4);
const AIRDROP_POOL = Object.values(ITEMS).filter((i) => i.rarity >= 3);

const RARITY_WEIGHT: Record<number, number> = { 1: 52, 2: 30, 3: 18, 4: 0 };

function weightedPick(pool: ItemDef[], rand: () => number): ItemDef {
  const total = pool.reduce((sum, i) => sum + (RARITY_WEIGHT[i.rarity] ?? 1), 0);
  let roll = rand() * total;
  for (const item of pool) {
    roll -= RARITY_WEIGHT[item.rarity] ?? 1;
    if (roll <= 0) return item;
  }
  return pool[pool.length - 1];
}

export function rollGroundItem(rand: () => number): ItemDef {
  return weightedPick(GROUND_POOL, rand);
}

export function rollAirdropItem(rand: () => number): ItemDef {
  return AIRDROP_POOL[Math.floor(rand() * AIRDROP_POOL.length)];
}
