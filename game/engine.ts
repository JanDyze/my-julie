import { ITEMS, MAX_GUNS, RARITY_COLORS, rollAirdropItem } from "./items";
import {
  Building,
  LootDrop,
  Rect,
  World,
  generateWorld,
  isInWater,
  mulberry32,
} from "./world";
import { NetClient } from "./net";
import { IconName, drawIcon } from "./icons";
import { SkinId, drawCharacter } from "./characters";
import { BIOME_GROUND, Biome, biomeAt } from "./biomes";
import { AudioEngine, EARSHOT, SoundName } from "./audio";
import { circleHitsRect, segmentHitsCircle, segmentHitsRect } from "./geometry";
import { Snapshot, pruneSnapshots, sampleSnapshots } from "./interpolate";
import {
  LETTER_PIECES,
  TOTAL_PIECES,
  loadFoundPieces,
  saveFoundPieces,
} from "./letter";
import {
  FlightPath,
  MatchState,
  NetPlayer,
  PLANE_DURATION,
  PLANE_SPEED,
  ZONE_PHASES,
  ZoneState,
} from "./shared";

const BASE_CAPACITY = 14;
const PLAYER_RADIUS = 15;
const WALK_SPEED = 200;
const SPRINT_SPEED = 330;
const WATER_SPEED = 115;
const PICKUP_RANGE = 52;
const AUTO_PICKUP_RANGE = 34;
const LETTER_PICKUP_RANGE = 40;
/** Items stay hidden until you're this close, so looting means exploring. */
const ITEM_REVEAL_RANGE = 230;
/** Inside a bush you stay hidden until someone is this close. */
const BUSH_REVEAL_RANGE = 90;
const CONSUMABLE_LIMIT = 5;
export const MAX_HP = 100;
export const HEARTS = 5;
const RESPAWN_SECONDS = 4;
const STAMINA_MAX = 100;

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining travel distance in world units. */
  life: number;
  damage: number;
  /** Only our own bullets deal damage; remote ones are tracers. */
  mine: boolean;
  /** Explosion radius on impact, for the bazooka. */
  blast?: number;
}

interface RemotePlayer {
  id: string;
  name: string;
  skin: string;
  /** Interpolated position actually drawn this frame. */
  x: number;
  y: number;
  angle: number;
  hp: number;
  alive: boolean;
  buffer: Snapshot[];
}

/**
 * Render remote players this far in the past. Anything less and a late packet
 * leaves nothing to interpolate toward, which is what causes visible dashing.
 */
const INTERP_DELAY = 0.1;



export interface InventoryEntry {
  itemId: string;
  qty: number;
}

export interface Toast {
  id: number;
  icon: IconName;
  text: string;
  color: string;
  /** Seconds remaining before it fades out. */
  ttl: number;
}

const TOAST_TTL = 2.2;
const MAX_TOASTS = 3;

export type DropState = "plane" | "falling" | "ground";

export interface HudState {
  hp: number;
  hearts: number;
  maxHearts: number;
  respawnIn: number;
  deaths: number;
  stamina: number;
  armor: number;
  inventory: InventoryEntry[];
  gunSlots: { itemId: string; name: string; icon: IconName; rarity: number; active: boolean }[];
  nearby: { itemId: string; qty: number } | null;
  inventoryFull: boolean;
  phase: number;
  totalPhases: number;
  zoneStatus: "waiting" | "shrinking" | "final";
  zoneCountdown: number;
  insideZone: boolean;
  elapsed: number;
  collected: number;
  location: string;
  toasts: Toast[];
  dead: boolean;
  paused: boolean;
  airdropActive: boolean;
  online: boolean;
  hidden: boolean;
  indoors: boolean;
  biome: Biome;
  equipment: {
    key: string;
    label: string;
    icon: IconName;
    have: boolean;
    count: number;
  }[];
  letterFound: number[];
  letterEvent: { id: number; seq: number } | null;
  letterTotal: number;
  letterComplete: boolean;
  dropState: DropState;
  altitude: number;
  planeSecondsLeft: number;
  squad: { id: string; name: string; hp: number; alive: boolean }[];
  weapon: {
    itemId: string;
    name: string;
    icon: IconName;
    rarity: number;
    mag: number;
    magSize: number;
    reserve: number;
    reloading: boolean;
    reloadProgress: number;
  } | null;
  weapons: string[];
}

export class GameEngine {
  private ctx: CanvasRenderingContext2D;
  private world: World;
  private rand = mulberry32(Date.now() & 0xffff);
  private raf = 0;
  private lastFrame = 0;
  private detached: Array<() => void> = [];
  private groundPatterns = new Map<Biome, CanvasPattern | null>();

  private keys = new Set<string>();
  private aim = { x: 0, y: 0 };
  private camera = { x: 0, y: 0 };
  /** Canvas pixels per world unit — smaller screens show a tighter slice of world. */
  private viewScale = 1;
  private touch = { x: 0, y: 0, active: false };
  private aimMode: "pointer" | "motion" | "stick" = "pointer";
  private aimStick = { x: 0, y: 0, active: false };

  private player = { x: 0, y: 0, angle: 0, hp: 100, stamina: STAMINA_MAX, bob: 0 };
  private inventory = new Map<string, number>();
  private collected = 0;
  private elapsed = 0;
  private dead = false;
  private respawnTimer = 0;
  private deaths = 0;
  private paused = false;

  private zone = { x: 0, y: 0, r: 0, targetX: 0, targetY: 0, targetR: 0 };
  private phase = 0;
  private phaseTimer = ZONE_PHASES[0].wait;
  private shrinking = false;

  private airdrop: { x: number; y: number; fall: number; landed: boolean } | null = null;
  private airdropTimer = 55;

  private toasts: Toast[] = [];
  private nextToastId = 1;

  private skin: SkinId = "girl";
  private letterFound = new Set<number>(loadFoundPieces());
  /** Bumped whenever a piece is picked up, so the UI can show a modal once. */
  private letterEventSeq = 0;
  private letterEventId: number | null = null;
  private loadedMags = new Map<string, number>();
  private dropState: DropState = "ground";
  private altitude = 0;
  private flight: FlightPath | null = null;
  private flightT = 0;
  private bullets: Bullet[] = [];
  private audio = new AudioEngine();
  /** Nearby noises marked on the minimap so you can hear where people are. */
  private pings: { x: number; y: number; kind: "shot" | "step"; life: number }[] = [];
  private stepTimer = 0;
  private remoteSteps = new Map<string, number>();
  private blasts: { x: number; y: number; r: number; life: number }[] = [];
  private equipped: string | null = null;
  private mag = 0;
  private fireCooldown = 0;
  private reloadTimer = 0;
  private firing = false;
  private muzzle = 0;
  private hitFlash = 0;
  /** Building the player is standing in this frame, or null. */
  private occupied: Building | null = null;

  private net: NetClient | null = null;
  private remotes = new Map<string, RemotePlayer>();
  /** Loot ids already claimed from the server, so we don't spam requests. */
  private requested = new Set<number>();
  private posTimer = 0;
  /** serverTime - localTime, smoothed; maps packets onto our render clock. */
  private clockOffset: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    seed = Math.floor(Math.random() * 1e9),
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available in this browser");
    this.ctx = ctx;
    this.world = generateWorld(seed);
    for (const biome of ["meadow", "forest", "desert", "beach"] as Biome[]) {
      this.groundPatterns.set(biome, this.buildGroundPattern(biome));
    }

    this.spawnPlayer();
    this.zone = {
      x: this.world.size / 2,
      y: this.world.size / 2,
      r: this.world.size * 0.72,
      targetX: this.world.size / 2,
      targetY: this.world.size / 2,
      targetR: this.world.size * 0.72,
    };

    this.bindInput();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.detached.forEach((off) => off());
    this.detached = [];
  }

  /** Browsers only allow audio to start from a gesture, so this is explicit. */
  unlockAudio() {
    this.audio.unlock();
  }

  setMuted(muted: boolean) {
    this.audio.setMuted(muted);
  }

  get muted(): boolean {
    return this.audio.isMuted;
  }

  /**
   * Play a world sound: quieter with distance, panned by which side it's on,
   * and silent past the cue's earshot.
   */
  private sound(name: SoundName, x?: number, y?: number) {
    if (x === undefined || y === undefined) {
      this.audio.play(name, 1, 0);
      return;
    }
    const dx = x - this.player.x;
    const dy = y - this.player.y;
    const distance = Math.hypot(dx, dy);
    const reach = EARSHOT[name];
    if (distance > reach) return;
    // Fade out toward the edge of earshot rather than cutting off.
    const volume = Math.pow(1 - distance / reach, 1.6);
    const pan = Math.max(-1, Math.min(1, dx / (reach * 0.4)));
    this.audio.play(name, volume, pan);
  }

  private ping(x: number, y: number, kind: "shot" | "step") {
    const reach = kind === "shot" ? 1200 : 330;
    if (Math.hypot(x - this.player.x, y - this.player.y) > reach) return;
    this.pings.push({ x, y, kind, life: kind === "shot" ? 2.2 : 1.1 });
    if (this.pings.length > 40) this.pings.shift();
  }

  setSkin(skin: SkinId) {
    this.skin = skin;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  /** Analogue stick input from touch controls; x/y are in -1..1. */
  setTouchMove(x: number, y: number) {
    this.touch.x = x;
    this.touch.y = y;
    this.touch.active = x !== 0 || y !== 0;
    if (this.touch.active && !this.aimStick.active) this.aimMode = "motion";
  }

  /**
   * Right stick: dragging both aims and fires, so one thumb gesture does what
   * a mouse does with movement plus a click.
   */
  setAimStick(x: number, y: number) {
    const magnitude = Math.hypot(x, y);
    this.aimStick.x = x;
    this.aimStick.y = y;
    this.aimStick.active = magnitude > 0.001;
    if (this.aimStick.active) {
      this.aimMode = "stick";
      this.player.angle = Math.atan2(y, x);
      this.firing = magnitude > 0.4;
    } else {
      this.firing = false;
    }
  }

  pickup() {
    this.tryPickup();
  }

  // --- visibility ----------------------------------------------------------

  /**
   * True when nothing solid sits between two points. Trees and rocks block
   * sight; bushes and walls-with-doorways behave like their drawn shape, so
   * hiding behind cover genuinely hides you from the other player.
   */
  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return true;

    for (const wall of this.world.walls) {
      if (segmentHitsRect(x1, y1, x2, y2, wall)) return false;
    }
    for (const prop of this.world.props) {
      if (prop.kind === "bush") continue;
      if (segmentHitsCircle(x1, y1, x2, y2, prop.x, prop.y, prop.visual * 0.8)) return false;
    }
    return true;
  }

  /** The building containing this point, or null when outdoors. */
  private buildingAt(x: number, y: number): Building | null {
    for (const b of this.world.buildings) {
      if (x > b.rect.x && x < b.rect.x + b.rect.w && y > b.rect.y && y < b.rect.y + b.rect.h) {
        return b;
      }
    }
    return null;
  }

  /** True while standing inside a bush, which conceals you from a distance. */
  private inBush(x: number, y: number): boolean {
    return this.world.props.some(
      (p) => p.kind === "bush" && Math.hypot(p.x - x, p.y - y) < p.visual * 0.85,
    );
  }

  private canSee(r: RemotePlayer): boolean {
    // Anyone still in the air is visible to everyone; that's the point of a drop.
    if (this.dropState !== "ground") return true;

    const distance = Math.hypot(r.x - this.player.x, r.y - this.player.y);
    // A bush hides you unless someone is almost on top of you.
    if (distance > BUSH_REVEAL_RANGE && this.inBush(r.x, r.y)) return false;

    // Roofs are opaque: someone indoors is invisible unless you're in there too.
    const theirs = this.buildingAt(r.x, r.y);
    if (theirs && theirs !== this.buildingAt(this.player.x, this.player.y)) return false;

    return this.hasLineOfSight(this.player.x, this.player.y, r.x, r.y);
  }

  // --- the drop ------------------------------------------------------------

  /** Put the player on the plane for the start of a match. */
  beginDrop(flight: FlightPath, flightT = 0) {
    this.flight = flight;
    this.flightT = flightT;
    this.dropState = "plane";
    this.altitude = 1;
    const pos = this.planePosition();
    this.player.x = pos.x;
    this.player.y = pos.y;
  }

  private planePosition() {
    if (!this.flight) return { x: this.player.x, y: this.player.y };
    return {
      x: this.flight.x + Math.cos(this.flight.angle) * PLANE_SPEED * this.flightT,
      y: this.flight.y + Math.sin(this.flight.angle) * PLANE_SPEED * this.flightT,
    };
  }

  jump() {
    if (this.dropState !== "plane") return;
    this.dropState = "falling";
    this.altitude = 1;
    this.toast("plane", "Jumped!", "#5fc9f8");
  }

  private updateDrop(dt: number) {
    if (this.dropState === "ground") return;
    this.flightT += dt;

    if (this.dropState === "plane") {
      const pos = this.planePosition();
      this.player.x = pos.x;
      this.player.y = pos.y;
      // Don't let anyone ride the plane off the map.
      if (this.flightT > PLANE_DURATION) this.jump();
      return;
    }

    // Falling: fast freefall, then the chute slows the last stretch.
    const parachuting = this.altitude < 0.55;
    this.altitude = Math.max(0, this.altitude - (parachuting ? 0.16 : 0.34) * dt);

    let dx = 0;
    let dy = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) dy -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dy += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) dx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx += 1;
    if (dx === 0 && dy === 0 && this.touch.active) {
      dx = this.touch.x;
      dy = this.touch.y;
    }
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      const glide = (parachuting ? 150 : 240) * dt;
      this.player.x += (dx / len) * glide;
      this.player.y += (dy / len) * glide;
      this.player.angle = Math.atan2(dy, dx);
    }

    const margin = PLAYER_RADIUS + 4;
    this.player.x = Math.max(margin, Math.min(this.world.size - margin, this.player.x));
    this.player.y = Math.max(margin, Math.min(this.world.size - margin, this.player.y));

    if (this.altitude <= 0) {
      this.dropState = "ground";
      // Never land inside a wall.
      let guard = 0;
      while (this.collides(this.player.x, this.player.y) && guard < 200) {
        guard++;
        this.player.x += (Math.random() - 0.5) * 30;
        this.player.y += (Math.random() - 0.5) * 30;
      }
      this.toast("boot", "Landed", "#8fe3a1");
    }
  }

  // --- combat --------------------------------------------------------------

  private get weapon() {
    return this.equipped ? ITEMS[this.equipped].weapon ?? null : null;
  }

  /** Equip on pickup when we have nothing, or when the new gun is rarer. */
  private considerEquip(itemId: string) {
    const def = ITEMS[itemId];
    if (!def.weapon) return;
    const current = this.equipped ? ITEMS[this.equipped] : null;
    if (current && current.rarity >= def.rarity) return;
    this.equipItem(itemId);
  }

  equipItem(itemId: string) {
    const def = ITEMS[itemId];
    if (!def?.weapon || !this.inventory.has(itemId)) return;
    if (this.equipped) this.loadedMags.set(this.equipped, this.mag);
    this.equipped = itemId;
    this.mag = this.loadedMags.get(itemId) ?? 0;
    this.reloadTimer = 0;
    this.toast(def.icon, `Equipped ${def.name}`, RARITY_COLORS[def.rarity]);
    if (this.mag === 0) this.reload();
  }

  setFiring(firing: boolean) {
    this.firing = firing;
  }

  reload() {
    const weapon = this.weapon;
    if (!weapon || this.reloadTimer > 0 || this.mag >= weapon.mag) return;
    this.reloadTimer = weapon.reload;
    this.sound("reload", this.player.x, this.player.y);
  }

  /** Ammo is unlimited by design; reloading is just the pause, not a resource. */
  private finishReload() {
    const weapon = this.weapon;
    if (!weapon) return;
    this.mag = weapon.mag;
    if (this.equipped) this.loadedMags.set(this.equipped, this.mag);
  }

  private tryFire(dt: number) {
    this.fireCooldown -= dt;
    this.muzzle = Math.max(0, this.muzzle - dt);

    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloadTimer = 0;
        this.finishReload();
      }
      return;
    }

    const weapon = this.weapon;
    if (!weapon || !this.firing || this.fireCooldown > 0) return;

    if (this.mag <= 0) {
      this.reload();
      return;
    }

    // No auto-aim: the barrel points exactly where the player aimed it.
    const base = this.player.angle;
    this.mag--;
    if (this.equipped) this.loadedMags.set(this.equipped, this.mag);
    this.fireCooldown = 60 / weapon.rpm;
    this.muzzle = 0.06;
    if (!weapon.auto) this.firing = false;

    const muzzleDistance = PLAYER_RADIUS + 6;
    const pellets = weapon.pellets ?? 1;
    for (let i = 0; i < pellets; i++) {
      const angle = base + (Math.random() - 0.5) * weapon.spread * 2;
      const bullet: Bullet = {
        x: this.player.x + Math.cos(angle) * muzzleDistance,
        y: this.player.y + Math.sin(angle) * muzzleDistance,
        vx: Math.cos(angle) * weapon.speed,
        vy: Math.sin(angle) * weapon.speed,
        life: weapon.range,
        damage: weapon.damage,
        mine: true,
        blast: weapon.blast,
      };
      this.bullets.push(bullet);
      this.net?.send({
        t: "shot",
        shot: { x: bullet.x, y: bullet.y, angle, speed: weapon.speed, range: weapon.range },
      });
    }

    if (this.equipped) this.sound(this.equipped as SoundName, this.player.x, this.player.y);
    this.ping(this.player.x, this.player.y, "shot");
  }

  private updateBullets(dt: number) {
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    for (const b of this.bullets) {
      const step = Math.hypot(b.vx, b.vy) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= step;
      if (b.life <= 0) continue;

      // Walls stop everything.
      if (this.world.walls.some((w) => circleHitsRect(b.x, b.y, 2, w))) {
        b.life = 0;
        if (b.mine && b.blast) this.explode(b.x, b.y, b.blast, b.damage);
        continue;
      }
      if (
        this.world.props.some(
          (p) => p.kind === "rock" && Math.hypot(p.x - b.x, p.y - b.y) < p.r,
        )
      ) {
        b.life = 0;
        continue;
      }

      if (!b.mine) continue;
      for (const r of this.remotes.values()) {
        if (!r.alive) continue;
        if (Math.hypot(r.x - b.x, r.y - b.y) > PLAYER_RADIUS) continue;
        b.life = 0;
        this.net?.send({ t: "hit", target: r.id, damage: b.damage });
        this.toast("target", `Hit ${r.name}`, "#ffd166");
        break;
      }
      if (b.life <= 0 && b.blast) this.explode(b.x, b.y, b.blast, b.damage);
    }

    this.bullets = this.bullets.filter((b) => b.life > 0);

    for (const blast of this.blasts) blast.life -= dt;
    this.blasts = this.blasts.filter((b) => b.life > 0);

    for (const ping of this.pings) ping.life -= dt;
    this.pings = this.pings.filter((p) => p.life > 0);
  }

  /** Someone else's bullet landed on us; the shooter did the detection. */
  takeDamage(fromName: string, damage: number) {
    if (this.dead) return;
    const reduced = damage * (1 - this.armor / 100);
    this.player.hp -= reduced;
    this.hitFlash = 0.35;
    this.toast("burst", `${fromName} hit you`, "#ff8a80");
    this.sound("hurt");
    if (this.player.hp <= 0) this.die();
  }

  private die() {
    if (this.dead) return;
    this.player.hp = 0;
    this.dead = true;
    this.deaths += 1;
    this.respawnTimer = RESPAWN_SECONDS;
    this.firing = false;
    this.sound("die");
    this.net?.send({ t: "died" });
  }

  /** Death is a setback, not the end: you keep your kit and your letter. */
  private respawn() {
    this.dead = false;
    this.respawnTimer = 0;
    this.player.hp = MAX_HP;
    this.player.stamina = STAMINA_MAX;
    this.bullets = [];
    this.reloadTimer = 0;

    // Come back inside the circle so you aren't instantly dying again.
    for (let i = 0; i < 400; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * this.zone.r * 0.8;
      const x = this.zone.x + Math.cos(angle) * dist;
      const y = this.zone.y + Math.sin(angle) * dist;
      const margin = PLAYER_RADIUS + 40;
      if (x < margin || y < margin || x > this.world.size - margin || y > this.world.size - margin) {
        continue;
      }
      if (this.collides(x, y) || isInWater(this.world, x, y)) continue;
      this.player.x = x;
      this.player.y = y;
      break;
    }
    this.sound("respawn");
    this.toast("heart", "Respawned", "#8fe3a1");
  }

  /** Rocket impact: falls off with distance, and can catch several people. */
  private explode(x: number, y: number, radius: number, damage: number) {
    this.blasts.push({ x, y, r: radius, life: 0.45 });
    this.sound("explosion", x, y);
    this.ping(x, y, "shot");
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      const d = Math.hypot(r.x - x, r.y - y);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      this.net?.send({ t: "hit", target: r.id, damage: Math.round(damage * falloff) });
    }
  }

  addRemoteShot(shot: { x: number; y: number; angle: number; speed: number; range: number }) {
    // Guess the weapon from how far the round carries, for a plausible report.
    const name: SoundName =
      shot.range > 900 ? "sniper" : shot.range > 550 ? "assault_rifle" : shot.range > 300 ? "pistol" : "shotgun";
    this.sound(name, shot.x, shot.y);
    this.ping(shot.x, shot.y, "shot");
    this.bullets.push({
      x: shot.x,
      y: shot.y,
      vx: Math.cos(shot.angle) * shot.speed,
      vy: Math.sin(shot.angle) * shot.speed,
      life: shot.range,
      damage: 0,
      mine: false,
    });
  }

  // --- multiplayer ---------------------------------------------------------

  /** Hand the engine a live connection; the server then owns loot and the zone. */
  attachNet(net: NetClient, alreadyTaken: number[], zone: ZoneState) {
    this.net = net;
    for (const lootId of alreadyTaken) this.requested.add(lootId);
    this.world.loot = this.world.loot.filter((l) => !this.requested.has(l.id));
    this.applyZone(zone);
  }

  private applyZone(zone: ZoneState) {
    this.zone.x = zone.x;
    this.zone.y = zone.y;
    this.zone.r = zone.r;
    this.zone.targetX = zone.targetX;
    this.zone.targetY = zone.targetY;
    this.zone.targetR = zone.targetR;
    this.phase = zone.phase;
    this.shrinking = zone.shrinking;
    this.phaseTimer = zone.countdown;
  }

  applyNetState(players: NetPlayer[], zone: ZoneState, serverTime: number) {
    this.applyZone(zone);

    const localNow = performance.now() / 1000;
    const rawOffset = serverTime - localNow;
    if (this.clockOffset === null) this.clockOffset = rawOffset;
    else this.clockOffset += (rawOffset - this.clockOffset) * 0.05;

    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === this.net?.playerId) continue;
      seen.add(p.id);
      const existing = this.remotes.get(p.id);
      if (existing) {
        existing.hp = p.hp;
        existing.alive = p.alive;
        existing.name = p.name;
        existing.skin = p.skin;
        const newest = existing.buffer[existing.buffer.length - 1];
        // Ignore stale or duplicate packets that arrived out of order.
        if (!newest || serverTime > newest.t) {
          existing.buffer.push({ t: serverTime, x: p.x, y: p.y, angle: p.angle });
        }
      } else {
        this.remotes.set(p.id, {
          id: p.id,
          name: p.name,
          skin: p.skin,
          x: p.x,
          y: p.y,
          angle: p.angle,
          hp: p.hp,
          alive: p.alive,
          buffer: [{ t: serverTime, x: p.x, y: p.y, angle: p.angle }],
        });
      }
    }
    for (const id of [...this.remotes.keys()]) {
      if (!seen.has(id)) this.remotes.delete(id);
    }
  }

  /**
   * Draw each remote at where they were INTERP_DELAY ago, linearly between the
   * two snapshots straddling that moment. Constant velocity between packets is
   * what makes running look continuous rather than stepped.
   */
  private interpolateRemotes() {
    if (this.clockOffset === null) return;
    const renderTime = performance.now() / 1000 + this.clockOffset - INTERP_DELAY;

    for (const r of this.remotes.values()) {
      pruneSnapshots(r.buffer, renderTime);
      const sample = sampleSnapshots(r.buffer, renderTime);
      if (!sample) continue;
      const moved = Math.hypot(sample.x - r.x, sample.y - r.y);
      r.x = sample.x;
      r.y = sample.y;
      r.angle = sample.angle;

      // Footsteps give away someone you cannot see — including through walls.
      if (r.alive && moved > 0.4) {
        const travelled = (this.remoteSteps.get(r.id) ?? 0) + moved;
        if (travelled >= 42) {
          this.remoteSteps.set(r.id, 0);
          this.sound("footstep", r.x, r.y);
          this.ping(r.x, r.y, "step");
        } else {
          this.remoteSteps.set(r.id, travelled);
        }
      }
    }
  }

  /** Server ruled on a loot claim: ours to take, or gone for good. */
  applyTaken(lootId: number, by: string) {
    const drop = this.world.loot.find((l) => l.id === lootId);
    if (!drop) {
      this.requested.add(lootId);
      return;
    }
    if (by && by === this.net?.playerId) {
      this.collect(drop);
    } else {
      this.world.loot = this.world.loot.filter((l) => l.id !== lootId);
    }
    this.requested.add(lootId);
  }

  notice(text: string) {
    this.toast("radio", text, "#5fc9f8");
  }

  get isOnline(): boolean {
    return this.net !== null;
  }

  // --- setup ---------------------------------------------------------------

  private spawnPlayer() {
    const town = this.world.towns[Math.floor(this.rand() * this.world.towns.length)];
    for (let i = 0; i < 300; i++) {
      const angle = this.rand() * Math.PI * 2;
      const dist = town.r * (0.4 + this.rand() * 0.8);
      const x = town.x + Math.cos(angle) * dist;
      const y = town.y + Math.sin(angle) * dist;
      if (x < 60 || y < 60 || x > this.world.size - 60 || y > this.world.size - 60) continue;
      if (this.collides(x, y)) continue;
      if (isInWater(this.world, x, y)) continue;
      this.player.x = x;
      this.player.y = y;
      return;
    }
    this.player.x = town.x;
    this.player.y = town.y;
  }

  private buildGroundPattern(biome: Biome): CanvasPattern | null {
    const tile = document.createElement("canvas");
    tile.width = 128;
    tile.height = 128;
    const tctx = tile.getContext("2d");
    if (!tctx) return null;
    const palette = BIOME_GROUND[biome];
    tctx.fillStyle = palette.base;
    tctx.fillRect(0, 0, 128, 128);
    const rand = mulberry32(7);
    for (let i = 0; i < 260; i++) {
      tctx.fillStyle = palette.speck[Math.floor(rand() * palette.speck.length)];
      const w = 3 + rand() * 9;
      tctx.fillRect(rand() * 128, rand() * 128, w, 2 + rand() * 4);
    }
    return this.ctx.createPattern(tile, "repeat");
  }

  private bindInput() {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d", "shift", " ", "e"].includes(key) || key.startsWith("arrow")) {
        e.preventDefault();
      }
      this.keys.add(key);
      if (key === "e") this.tryPickup();
      if (key === "q") this.useBest("heal");
      if (key === "f") this.useBest("boost");
      if (key === "r") this.reload();
      if (key === "1" || key === "2") {
        const gun = this.guns()[key === "1" ? 0 : 1];
        if (gun) this.equipItem(gun);
      }
      if (key === " ") {
        if (this.dropState === "plane") this.jump();
        else this.firing = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      this.keys.delete(key);
      if (key === " ") this.firing = false;
    };
    const onBlur = () => {
      this.keys.clear();
      this.firing = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      this.aim.x = e.clientX - rect.left;
      this.aim.y = e.clientY - rect.top;
      this.aimMode = "pointer";
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) this.firing = true;
    };
    const onMouseUp = () => {
      this.firing = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    this.canvas.addEventListener("mousemove", onMouseMove);
    this.canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    this.detached.push(
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("blur", onBlur),
      () => this.canvas.removeEventListener("mousemove", onMouseMove),
      () => this.canvas.removeEventListener("mousedown", onMouseDown),
      () => window.removeEventListener("mouseup", onMouseUp),
    );
  }

  // --- inventory -----------------------------------------------------------

  private gunCount(): number {
    return this.guns().length;
  }

  guns(): string[] {
    return [...this.inventory.keys()].filter((id) => ITEMS[id].weapon);
  }

  get armor(): number {
    let total = 0;
    for (const itemId of this.inventory.keys()) {
      total += ITEMS[itemId].armor ?? 0;
    }
    return Math.min(total, 70);
  }

  private toast(icon: IconName, text: string, color: string) {
    this.toasts.unshift({ id: this.nextToastId++, icon, text, color, ttl: TOAST_TTL });
    this.toasts = this.toasts.slice(0, MAX_TOASTS);
  }

  private ageToasts(dt: number) {
    if (!this.toasts.length) return;
    for (const t of this.toasts) t.ttl -= dt;
    this.toasts = this.toasts.filter((t) => t.ttl > 0);
  }

  private nearestLoot(): LootDrop | null {
    let best: LootDrop | null = null;
    let bestDist = PICKUP_RANGE;
    for (const drop of this.world.loot) {
      const d = Math.hypot(drop.x - this.player.x, drop.y - this.player.y);
      if (d < bestDist) {
        bestDist = d;
        best = drop;
      }
    }
    return best;
  }

  private armorSlot(itemId: string): "helmet" | "vest" | null {
    const def = ITEMS[itemId];
    if (def.category !== "armor") return null;
    return def.icon === "helmet" ? "helmet" : "vest";
  }

  private heldInSlot(slot: "helmet" | "vest"): string | undefined {
    return [...this.inventory.keys()].find((id) => this.armorSlot(id) === slot);
  }

  /** Can this item be taken at all? Keeps auto-pickup from spamming. */
  private wouldFit(drop: LootDrop): boolean {
    const def = ITEMS[drop.itemId];
    if (!def) return false;

    if (def.weapon) {
      if (this.inventory.has(def.id)) return false;
      return this.gunCount() < MAX_GUNS;
    }

    const slot = this.armorSlot(def.id);
    if (slot) {
      const current = this.heldInSlot(slot);
      // Only bother with a strict upgrade.
      return !current || (def.armor ?? 0) > (ITEMS[current].armor ?? 0);
    }

    return (this.inventory.get(def.id) ?? 0) < CONSUMABLE_LIMIT;
  }

  private collect(drop: LootDrop): boolean {
    const def = ITEMS[drop.itemId];
    if (!def || !this.wouldFit(drop)) return false;

    if (def.weapon) {
      this.inventory.set(def.id, 1);
      // Guns are found loaded.
      this.loadedMags.set(def.id, def.weapon.mag);
      if (!this.equipped) this.equipItem(def.id);
    } else {
      const slot = this.armorSlot(def.id);
      if (slot) {
        const current = this.heldInSlot(slot);
        if (current) this.inventory.delete(current);
        this.inventory.set(def.id, 1);
      } else {
        this.inventory.set(def.id, (this.inventory.get(def.id) ?? 0) + 1);
      }
    }

    this.collected += 1;
    this.sound("pickup");
    this.world.loot = this.world.loot.filter((l) => l.id !== drop.id);
    this.toast(def.icon, def.name, RARITY_COLORS[def.rarity]);
    return true;
  }

  /** Online, claims go to the server; offline we just take it. */
  private claim(drop: LootDrop): boolean {
    if (!this.net) return this.collect(drop);
    if (this.requested.has(drop.id) || !this.wouldFit(drop)) return false;
    this.requested.add(drop.id);
    this.net.send({ t: "take", lootId: drop.id });
    return true;
  }

  /** Walk-over pickup. Stays silent when nothing fits so it can't spam toasts. */
  private autoPickup() {
    for (const drop of this.world.loot) {
      const d = Math.hypot(drop.x - this.player.x, drop.y - this.player.y);
      if (d > AUTO_PICKUP_RANGE) continue;
      if (this.claim(drop)) return;
    }
  }

  /**
   * Letter pieces are deliberately NOT server-claimed loot: each player finds
   * their own five, so one player can't take another's, and progress persists.
   */
  private collectLetterPieces() {
    for (const spot of this.world.letterSpots) {
      if (this.letterFound.has(spot.pieceId)) continue;
      const d = Math.hypot(spot.x - this.player.x, spot.y - this.player.y);
      if (d > LETTER_PICKUP_RANGE) continue;
      this.letterFound.add(spot.pieceId);
      saveFoundPieces([...this.letterFound]);
      this.sound("letter");
      this.letterEventId = spot.pieceId;
      this.letterEventSeq += 1;
      return;
    }
  }

  private tryPickup() {
    if (this.dead || this.paused) return;
    const drop = this.nearestLoot();
    if (!drop) return;
    const def = ITEMS[drop.itemId];
    if (!def) return;

    if (this.claim(drop)) return;

    // Both gun slots full: pressing pickup swaps out the equipped one.
    if (def.weapon && this.gunCount() >= MAX_GUNS && this.equipped) {
      this.dropItem(this.equipped);
      if (!this.claim(drop)) this.toast("block", "Couldn't swap", "#ff8080");
      return;
    }

    this.toast("block", `Can't take ${def.name}`, "#ff8080");
  }

  useItem(itemId: string) {
    if (this.dead || this.paused) return;
    const def = ITEMS[itemId];
    const held = this.inventory.get(itemId) ?? 0;
    if (!def || held <= 0) return;

    if (def.heal) {
      if (this.player.hp >= MAX_HP) {
        this.toast("heart", "Hearts are full", "#8fe3a1");
        return;
      }
      this.player.hp = Math.min(MAX_HP, this.player.hp + def.heal);
    } else if (def.boost) {
      if (this.player.stamina >= STAMINA_MAX) {
        this.toast("drink", "Stamina is full", "#8fe3a1");
        return;
      }
      this.player.stamina = Math.min(STAMINA_MAX, this.player.stamina + def.boost);
    } else {
      return;
    }

    this.setQty(itemId, held - 1);
    this.toast(def.icon, `Used ${def.name}`, RARITY_COLORS[def.rarity]);
  }

  dropItem(itemId: string) {
    if (this.dead) return;
    const def = ITEMS[itemId];
    if (!def || !this.inventory.has(itemId)) return;

    this.setQty(itemId, 0);
    if (this.equipped === itemId) {
      this.equipped = null;
      this.mag = 0;
      this.reloadTimer = 0;
      const other = this.guns()[0];
      if (other) this.equipItem(other);
    }

    this.world.loot.push({
      id: this.world.nextLootId++,
      x: this.player.x + (this.rand() - 0.5) * 40,
      y: this.player.y + (this.rand() - 0.5) * 40,
      itemId,
      qty: 1,
      airdrop: false,
    });
    this.toast("crate", `Dropped ${def.name}`, "#c9d6cf");
  }

  /** Use the best available med kit; wired to the touch heal button and Q. */
  useHeal() {
    this.useBest("heal");
  }

  useBoost() {
    this.useBest("boost");
  }

  /** Cycle to the other carried gun. */
  swapGun() {
    const guns = this.guns();
    if (guns.length < 2) return;
    const current = this.equipped ?? guns[0];
    this.equipItem(guns[(guns.indexOf(current) + 1) % guns.length]);
  }

  private useBest(category: "heal" | "boost") {
    const found = [...this.inventory.keys()].find((id) => ITEMS[id].category === category);
    if (!found) {
      this.toast("block", `No ${category === "heal" ? "med kits" : "boosts"}`, "#ff8080");
      return;
    }
    this.useItem(found);
  }

  private setQty(itemId: string, qty: number) {
    if (qty <= 0) this.inventory.delete(itemId);
    else this.inventory.set(itemId, qty);
  }

  // --- simulation ----------------------------------------------------------

  private collides(x: number, y: number): boolean {
    for (const wall of this.world.walls) {
      if (circleHitsRect(x, y, PLAYER_RADIUS, wall)) return true;
    }
    for (const prop of this.world.props) {
      if (prop.kind === "bush") continue;
      if (Math.hypot(prop.x - x, prop.y - y) < prop.r + PLAYER_RADIUS) return true;
    }
    return false;
  }

  private move(dt: number) {
    let dx = 0;
    let dy = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) dy -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dy += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) dx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx += 1;

    // Touch stick wins when the keyboard is idle; pushing it far means sprint.
    let stickPush = 0;
    if (dx === 0 && dy === 0 && this.touch.active) {
      dx = this.touch.x;
      dy = this.touch.y;
      stickPush = Math.min(1, Math.hypot(dx, dy));
    }

    const moving = dx !== 0 || dy !== 0;
    const wantsSprint =
      moving && this.player.stamina > 1 && (this.keys.has("shift") || stickPush > 0.85);

    if (wantsSprint) {
      this.player.stamina = Math.max(0, this.player.stamina - 24 * dt);
    } else {
      this.player.stamina = Math.min(STAMINA_MAX, this.player.stamina + (moving ? 7 : 15) * dt);
    }

    if (moving) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      const inWater = isInWater(this.world, this.player.x, this.player.y);
      const speed = inWater ? WATER_SPEED : wantsSprint ? SPRINT_SPEED : WALK_SPEED;
      const step = speed * dt;

      // Resolve axes separately so sliding along a wall feels smooth.
      const nx = this.player.x + dx * step;
      if (!this.collides(nx, this.player.y)) this.player.x = nx;
      const ny = this.player.y + dy * step;
      if (!this.collides(this.player.x, ny)) this.player.y = ny;

      this.player.bob += step * 0.05;

      // Footfalls timed to travel, not to wall-clock, so sprinting sounds faster.
      this.stepTimer -= step;
      if (this.stepTimer <= 0) {
        this.stepTimer = 42;
        this.sound("footstep", this.player.x, this.player.y);
      }
    }

    const margin = PLAYER_RADIUS + 4;
    this.player.x = Math.max(margin, Math.min(this.world.size - margin, this.player.x));
    this.player.y = Math.max(margin, Math.min(this.world.size - margin, this.player.y));

    if (this.aimStick.active) {
      this.player.angle = Math.atan2(this.aimStick.y, this.aimStick.x);
    } else if (this.aimMode === "motion") {
      if (moving) this.player.angle = Math.atan2(dy, dx);
    } else {
      this.player.angle = Math.atan2(
        this.aim.y / this.viewScale - (this.player.y - this.camera.y),
        this.aim.x / this.viewScale - (this.player.x - this.camera.x),
      );
    }
  }

  private updateZone(dt: number) {
    // Online the server owns the circle; we only apply its damage locally.
    if (!this.net) this.advanceZone(dt);

    const phase = ZONE_PHASES[Math.min(this.phase, ZONE_PHASES.length - 1)];
    const distance = Math.hypot(this.player.x - this.zone.x, this.player.y - this.zone.y);
    if (distance > this.zone.r) {
      const dps = phase.dps * (1 - this.armor / 100);
      this.player.hp -= dps * dt;
      if (this.player.hp <= 0) this.die();
    }
  }

  private advanceZone(dt: number) {
    const phase = ZONE_PHASES[Math.min(this.phase, ZONE_PHASES.length - 1)];
    this.phaseTimer -= dt;

    if (this.phaseTimer <= 0) {
      if (!this.shrinking && this.phase < ZONE_PHASES.length) {
        // Pick the next circle somewhere inside the current one.
        const maxOffset = Math.max(0, this.zone.r - this.world.size * phase.factor);
        const angle = this.rand() * Math.PI * 2;
        const dist = this.rand() * maxOffset;
        this.zone.targetX = this.zone.x + Math.cos(angle) * dist;
        this.zone.targetY = this.zone.y + Math.sin(angle) * dist;
        this.zone.targetR = this.world.size * phase.factor;
        this.shrinking = true;
        this.phaseTimer = phase.shrink;
        this.toast("target", `Zone ${this.phase + 1} is closing`, "#5fc9f8");
        this.sound("zone");
      } else if (this.shrinking) {
        this.zone.x = this.zone.targetX;
        this.zone.y = this.zone.targetY;
        this.zone.r = this.zone.targetR;
        this.shrinking = false;
        this.phase = Math.min(this.phase + 1, ZONE_PHASES.length);
        this.phaseTimer = ZONE_PHASES[Math.min(this.phase, ZONE_PHASES.length - 1)].wait;
      }
    }

    if (this.shrinking) {
      const total = phase.shrink;
      const t = 1 - Math.max(0, this.phaseTimer) / total;
      this.zone.r += (this.zone.targetR - this.zone.r) * Math.min(1, t * dt * 4 + dt * 0.6);
      this.zone.x += (this.zone.targetX - this.zone.x) * Math.min(1, dt * 0.8);
      this.zone.y += (this.zone.targetY - this.zone.y) * Math.min(1, dt * 0.8);
    }
  }

  private updateAirdrop(dt: number) {
    // Airdrops mint loot ids locally, which would desync players. Solo only for now.
    if (this.net) return;
    if (this.airdrop) {
      if (!this.airdrop.landed) {
        this.airdrop.fall -= dt;
        if (this.airdrop.fall <= 0) {
          this.airdrop.landed = true;
          const count = 2 + Math.floor(this.rand() * 2);
          for (let i = 0; i < count; i++) {
            const def = rollAirdropItem(this.rand);
            this.world.loot.push({
              id: this.world.nextLootId++,
              x: this.airdrop.x + (this.rand() - 0.5) * 60,
              y: this.airdrop.y + (this.rand() - 0.5) * 60,
              itemId: def.id,
              qty: 1,
              airdrop: true,
            });
          }
          this.toast("crate", "Airdrop landed — check the red smoke", "#ffb340");
        }
      }
      return;
    }

    this.airdropTimer -= dt;
    if (this.airdropTimer > 0) return;
    this.airdropTimer = 70 + this.rand() * 40;
    const angle = this.rand() * Math.PI * 2;
    const dist = this.rand() * this.zone.r * 0.7;
    this.airdrop = {
      x: this.zone.x + Math.cos(angle) * dist,
      y: this.zone.y + Math.sin(angle) * dist,
      fall: 9,
      landed: false,
    };
    this.toast("plane", "Airdrop incoming", "#ffb340");
    this.sound("plane");
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.ageToasts(dt);
    if (this.dead && !this.paused) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
    }
    if (!this.paused && !this.dead) {
      this.elapsed += dt;
      if (this.dropState === "ground") {
        this.move(dt);
        this.autoPickup();
        this.collectLetterPieces();
        this.updateZone(dt);
        this.updateAirdrop(dt);
        this.tryFire(dt);
      } else {
        this.updateDrop(dt);
      }
    }
    this.updateBullets(dt);

    if (this.net) {
      this.posTimer -= dt;
      if (this.posTimer <= 0) {
        this.posTimer = 1 / 30;
        this.net.send({
          t: "pos",
          x: this.player.x,
          y: this.player.y,
          angle: this.player.angle,
          hp: this.player.hp,
          collected: this.collected,
        });
      }
      this.interpolateRemotes();
    }

    this.occupied = this.buildingAt(this.player.x, this.player.y);
    this.updateCamera();
    this.render();
  };

  private updateCamera() {
    const { width, height } = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const cssH = height / dpr;
    // Phones get a tighter slice of world so the player and loot stay readable.
    const worldHeight = Math.max(340, Math.min(950, cssH * 0.95));
    this.viewScale = cssH / worldHeight;

    const viewW = width / dpr / this.viewScale;
    const viewH = worldHeight;
    const targetX = this.player.x - viewW / 2;
    const targetY = this.player.y - viewH / 2;
    this.camera.x += (targetX - this.camera.x) * 0.16;
    this.camera.y += (targetY - this.camera.y) * 0.16;
    this.camera.x = Math.max(-40, Math.min(this.world.size - viewW + 40, this.camera.x));
    this.camera.y = Math.max(-40, Math.min(this.world.size - viewH + 40, this.camera.y));
  }

  // --- rendering -----------------------------------------------------------

  private render() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const screenW = this.canvas.width / dpr;
    const screenH = this.canvas.height / dpr;
    const viewW = screenW / this.viewScale;
    const viewH = screenH / this.viewScale;

    ctx.save();
    const unit = dpr * this.viewScale;
    ctx.setTransform(unit, 0, 0, unit, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);

    const cx = Math.round(this.camera.x);
    const cy = Math.round(this.camera.y);
    ctx.translate(-cx, -cy);

    const view: Rect = { x: cx - 80, y: cy - 80, w: viewW + 160, h: viewH + 160 };
    const visible = (x: number, y: number, pad = 60) =>
      x > view.x - pad && x < view.x + view.w + pad && y > view.y - pad && y < view.y + view.h + pad;

    this.drawGround(ctx, view);

    // Out-of-bounds beyond the island edge
    ctx.fillStyle = "#20303a";
    if (view.x < 0) ctx.fillRect(view.x, view.y, -view.x, view.h);
    if (view.y < 0) ctx.fillRect(view.x, view.y, view.w, -view.y);
    if (view.x + view.w > this.world.size) {
      ctx.fillRect(this.world.size, view.y, view.x + view.w - this.world.size, view.h);
    }
    if (view.y + view.h > this.world.size) {
      ctx.fillRect(view.x, this.world.size, view.w, view.y + view.h - this.world.size);
    }

    // Water
    for (const pond of this.world.water) {
      if (!visible(pond.x, pond.y, pond.r + 40)) continue;
      const grad = ctx.createRadialGradient(pond.x, pond.y, pond.r * 0.2, pond.x, pond.y, pond.r);
      grad.addColorStop(0, "#2f6f8f");
      grad.addColorStop(1, "#3f8caa");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pond.x, pond.y, pond.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Roads
    ctx.fillStyle = "#8b8474";
    for (const road of this.world.roads) {
      ctx.fillRect(road.x, road.y, road.w, road.h);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([18, 22]);
    for (const road of this.world.roads) {
      ctx.beginPath();
      if (road.w > road.h) {
        ctx.moveTo(road.x, road.y + road.h / 2);
        ctx.lineTo(road.x + road.w, road.y + road.h / 2);
      } else {
        ctx.moveTo(road.x + road.w / 2, road.y);
        ctx.lineTo(road.x + road.w / 2, road.y + road.h);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Timber piers reaching over the water.
    for (const pier of this.world.piers) {
      if (!visible(pier.x, pier.y, Math.max(pier.w, pier.h))) continue;
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(pier.x + 4, pier.y + 6, pier.w, pier.h);
      ctx.fillStyle = "#8a6a44";
      ctx.fillRect(pier.x, pier.y, pier.w, pier.h);
      ctx.strokeStyle = "rgba(60,40,24,0.5)";
      ctx.lineWidth = 1.5;
      for (let y = pier.y; y < pier.y + pier.h; y += 16) {
        ctx.beginPath();
        ctx.moveTo(pier.x, y);
        ctx.lineTo(pier.x + pier.w, y);
        ctx.stroke();
      }
    }

    // Building floors
    for (const b of this.world.buildings) {
      if (!visible(b.rect.x, b.rect.y, Math.max(b.rect.w, b.rect.h))) continue;
      this.drawFloor(b);
    }

    this.drawLandmarks(ctx, visible);

    // Place labels
    ctx.font = "700 21px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const town of this.world.towns) {
      if (!visible(town.x, town.y, town.r)) continue;
      const ly = town.y - town.r * 0.55;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillText(town.name, town.x, ly + 2);
      ctx.fillStyle = "rgba(255,255,255,0.62)";
      ctx.fillText(town.name, town.x, ly);
    }
    ctx.textAlign = "start";

    // Loot — the item itself lying on the ground, no container.
    const near = this.nearestLoot();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const drop of this.world.loot) {
      if (!visible(drop.x, drop.y, 30)) continue;
      const range = Math.hypot(drop.x - this.player.x, drop.y - this.player.y);
      if (range > ITEM_REVEAL_RANGE) continue;
      // What's indoors stays secret until you walk in.
      const holding = this.buildingAt(drop.x, drop.y);
      if (holding && holding !== this.occupied) continue;
      // Fade in over the last stretch rather than popping into existence.
      const reveal = Math.min(1, (ITEM_REVEAL_RANGE - range) / 70);
      const def = ITEMS[drop.itemId];
      const color = RARITY_COLORS[def.rarity];
      const blocked = near?.id === drop.id;
      const float = Math.sin(this.elapsed * 2.2 + drop.id) * 1.8;
      ctx.globalAlpha = reveal;

      const glow = ctx.createRadialGradient(drop.x, drop.y, 2, drop.x, drop.y, 19);
      glow.addColorStop(0, `${color}66`);
      glow.addColorStop(1, `${color}00`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, 19, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.ellipse(drop.x, drop.y + 8, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      drawIcon(ctx, def.icon, drop.x, drop.y + float, 22, color);

      if (drop.airdrop) {
        ctx.strokeStyle = "#ffb340";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(drop.x, drop.y, 22, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Standing over it: say what it is, and why you can't have it.
      if (range < PICKUP_RANGE) {
        const canTake = this.wouldFit(drop);
        const reason = canTake
          ? null
          : def.weapon
            ? this.inventory.has(def.id)
              ? "already carried"
              : "both gun slots full"
            : def.category === "armor"
              ? "yours is better"
              : "you're carrying enough";
        this.drawNameTag(ctx, drop.x, drop.y - 26, def.name, reason, color);
      }

      // Only ring items that auto-pickup refused, so the ring means "act on me".
      if (blocked) {
        ctx.strokeStyle = "#ff8a80";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.arc(drop.x, drop.y, 25, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    this.drawLetterSpots(ctx, visible);

    // Props
    for (const prop of this.world.props) {
      if (!visible(prop.x, prop.y, prop.visual + 10)) continue;
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.ellipse(prop.x + 4, prop.y + 6, prop.visual * 0.85, prop.visual * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      if (prop.kind === "rock") {
        ctx.fillStyle = "#8d9298";
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, prop.visual, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#a8adb3";
        ctx.beginPath();
        ctx.arc(prop.x - prop.visual * 0.25, prop.y - prop.visual * 0.25, prop.visual * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.kind === "bush") {
        // Lighter, rounder and see-through-ish: cover you can stand inside.
        ctx.fillStyle = "#41823d";
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, prop.visual, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(150,215,140,0.35)";
        ctx.beginPath();
        ctx.arc(prop.x - prop.visual * 0.25, prop.y - prop.visual * 0.25, prop.visual * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.kind === "cactus") {
        ctx.fillStyle = "#4b8b4a";
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, prop.visual * 0.52, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = prop.visual * 0.34;
        ctx.strokeStyle = "#4b8b4a";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(prop.x - prop.visual * 0.7, prop.y - prop.visual * 0.1);
        ctx.lineTo(prop.x - prop.visual * 0.7, prop.y - prop.visual * 0.6);
        ctx.moveTo(prop.x + prop.visual * 0.7, prop.y + prop.visual * 0.1);
        ctx.lineTo(prop.x + prop.visual * 0.7, prop.y - prop.visual * 0.4);
        ctx.stroke();
        ctx.fillStyle = "#5d9e5b";
        ctx.beginPath();
        ctx.arc(prop.x - prop.visual * 0.15, prop.y - prop.visual * 0.15, prop.visual * 0.28, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.kind === "palm") {
        ctx.fillStyle = "#8a6a3c";
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, prop.visual * 0.2, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + prop.x * 0.01;
          ctx.fillStyle = i % 2 ? "#2f7a45" : "#3a8f52";
          ctx.beginPath();
          ctx.ellipse(
            prop.x + Math.cos(a) * prop.visual * 0.52,
            prop.y + Math.sin(a) * prop.visual * 0.52,
            prop.visual * 0.46,
            prop.visual * 0.2,
            a,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      } else {
        const dark = prop.kind === "pine" ? "#1f5230" : "#26643a";
        const light = prop.kind === "pine" ? "#2c6d3f" : "#358a4c";
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, prop.visual, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(prop.x - prop.visual * 0.22, prop.y - prop.visual * 0.28, prop.visual * 0.62, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Roofs hide the contents of any building the player has not entered.
    for (const b of this.world.buildings) {
      if (b === this.occupied) continue;
      if (!visible(b.rect.x, b.rect.y, Math.max(b.rect.w, b.rect.h))) continue;
      this.drawRoof(b);
    }

    // Building walls on top, so the player reads as being inside
    for (const b of this.world.buildings) {
      if (!visible(b.rect.x, b.rect.y, Math.max(b.rect.w, b.rect.h))) continue;
      this.drawWalls(b);
    }

    this.drawAirdrop(ctx);
    this.drawPlane(ctx);
    if (this.occupied) {
      // Indoors is dim: a pool of light around you, dark toward the corners.
      const b = this.occupied.rect;
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.clip();
      const lamp = ctx.createRadialGradient(
        this.player.x,
        this.player.y,
        20,
        this.player.x,
        this.player.y,
        190,
      );
      lamp.addColorStop(0, "rgba(8,10,14,0)");
      lamp.addColorStop(0.55, "rgba(8,10,14,0.45)");
      lamp.addColorStop(1, "rgba(6,8,12,0.82)");
      ctx.fillStyle = lamp;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }

    this.drawAimGuide(ctx);
    this.drawBullets(ctx);
    this.drawBlasts(ctx);
    this.drawRemotes(ctx);
    this.drawPlayer(ctx);
    this.drawZone(ctx, view);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.hitFlash > 0) {
      const edge = ctx.createRadialGradient(
        screenW / 2,
        screenH / 2,
        Math.min(screenW, screenH) * 0.3,
        screenW / 2,
        screenH / 2,
        Math.max(screenW, screenH) * 0.7,
      );
      edge.addColorStop(0, "rgba(200,40,40,0)");
      edge.addColorStop(1, `rgba(200,40,40,${0.55 * (this.hitFlash / 0.35)})`);
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, screenW, screenH);
    }
    this.drawMinimap(ctx, screenW, screenH, viewW, viewH);
    ctx.restore();
  }

  private drawGround(ctx: CanvasRenderingContext2D, view: Rect) {
    const paint = (biome: Biome) => {
      const pattern = this.groundPatterns.get(biome);
      ctx.fillStyle = pattern ?? BIOME_GROUND[biome].base;
      return pattern;
    };

    paint("meadow");
    ctx.fillRect(view.x, view.y, view.w, view.h);

    // Soft-edged patches for woods and dunes.
    for (const patch of this.world.biomes.patches) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(patch.x, patch.y, patch.rx, patch.ry, 0, 0, Math.PI * 2);
      ctx.clip();
      paint(patch.kind);
      ctx.fillRect(view.x, view.y, view.w, view.h);
      ctx.restore();
    }

    // Beach band along the south shore, with a wavy edge.
    const line = this.world.biomes.beachLine;
    if (view.y + view.h > line - 60) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(view.x, this.world.size + 40);
      ctx.lineTo(view.x, line);
      const step = 90;
      for (let x = view.x; x < view.x + view.w + step; x += step) {
        ctx.lineTo(x, line + Math.sin(x * 0.004) * 26);
      }
      ctx.lineTo(view.x + view.w, this.world.size + 40);
      ctx.closePath();
      ctx.clip();
      paint("beach");
      ctx.fillRect(view.x, line - 80, view.w, view.h);
      ctx.restore();

      // Sea beyond the sand.
      ctx.fillStyle = "#2f6f8f";
      ctx.fillRect(view.x, this.world.size, view.w, Math.max(0, view.y + view.h - this.world.size));
    }
  }

  private drawFloor(b: Building) {
    const ctx = this.ctx;
    const floors = ["#6d5b4b", "#7a6553", "#63544a", "#7d6a58"];
    ctx.fillStyle = floors[b.palette];
    ctx.fillRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 1;
    for (let x = b.rect.x + 24; x < b.rect.x + b.rect.w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, b.rect.y);
      ctx.lineTo(x, b.rect.y + b.rect.h);
      ctx.stroke();
    }
  }

  private drawRoof(b: Building) {
    const ctx = this.ctx;
    const roofs = ["#4a4038", "#544940", "#43392f", "#584c40"];
    const { x, y, w, h } = b.rect;

    ctx.fillStyle = roofs[b.palette];
    ctx.fillRect(x, y, w, h);

    // Shingle lines so a roof reads as a roof rather than a hole in the map.
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1;
    for (let ly = y + 14; ly < y + h; ly += 14) {
      ctx.beginPath();
      ctx.moveTo(x, ly);
      ctx.lineTo(x + w, ly);
      ctx.stroke();
    }
    // A ridge along the long axis.
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (w > h) {
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
    } else {
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2, y + h);
    }
    ctx.stroke();
  }

  private drawWalls(b: Building) {
    const ctx = this.ctx;
    const walls = ["#c9bda8", "#b9a894", "#d3c7b2", "#a89684"];
    for (const wall of b.walls) {
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(wall.x + 3, wall.y + 5, wall.w, wall.h);
      ctx.fillStyle = walls[b.palette];
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(wall.x, wall.y, wall.w, 3);
    }
  }

  private drawAirdrop(ctx: CanvasRenderingContext2D) {
    if (!this.airdrop) return;
    const { x, y, fall, landed } = this.airdrop;

    if (!landed) {
      const t = Math.max(0, fall) / 9;
      const crateY = y - t * 420;
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, crateY - 26, 20, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = "#c9552f";
      ctx.fillRect(x - 12, crateY - 12, 24, 24);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(x, crateY + 14);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    ctx.fillStyle = "#8a3b22";
    ctx.fillRect(x - 18, y - 14, 36, 28);
    ctx.fillStyle = "#c9552f";
    ctx.fillRect(x - 18, y - 14, 36, 8);
    for (let i = 0; i < 5; i++) {
      const t = (this.elapsed * 0.6 + i * 0.2) % 1;
      ctx.fillStyle = `rgba(214,74,44,${0.32 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(x + Math.sin(i * 2 + this.elapsed) * 18, y - t * 150, 22 + t * 46, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Each place gets a recognisable mark you can spot from the air. */
  private drawLandmarks(
    ctx: CanvasRenderingContext2D,
    visible: (x: number, y: number, pad?: number) => boolean,
  ) {
    for (const mark of this.world.landmarks) {
      if (!visible(mark.x, mark.y, mark.r + 30)) continue;
      const { x, y, r } = mark;

      if (mark.kind === "hospital") {
        ctx.fillStyle = "#f4f7f8";
        ctx.fillRect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4);
        ctx.fillStyle = "#d94f4f";
        ctx.fillRect(x - r * 0.14, y - r * 0.5, r * 0.28, r);
        ctx.fillRect(x - r * 0.5, y - r * 0.14, r, r * 0.28);
      } else if (mark.kind === "cafe") {
        // Striped awning and a couple of parasols.
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = i % 2 ? "#f6efe4" : "#d9748c";
          ctx.fillRect(x - r * 0.75 + (i * r * 1.5) / 5, y - r * 0.6, (r * 1.5) / 5, r * 0.5);
        }
        for (const ox of [-r * 0.5, r * 0.5]) {
          ctx.fillStyle = "#e0a24a";
          ctx.beginPath();
          ctx.arc(x + ox, y + r * 0.45, r * 0.24, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (mark.kind === "lighthouse") {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.arc(x + 5, y + 6, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 ? "#e8464a" : "#f7f3ec";
          ctx.beginPath();
          ctx.arc(x, y, r * (0.5 - i * 0.11), 0, Math.PI * 2);
          ctx.fill();
        }
        // Sweeping beam.
        const sweep = this.elapsed * 0.9;
        const beam = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 4);
        beam.addColorStop(0, "rgba(255,240,180,0.35)");
        beam.addColorStop(1, "rgba(255,240,180,0)");
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r * 4, sweep - 0.22, sweep + 0.22);
        ctx.closePath();
        ctx.fill();
      } else if (mark.kind === "docks") {
        ctx.fillStyle = "#6d5b4b";
        ctx.fillRect(x - r * 0.8, y - r * 0.4, r * 1.6, r * 0.8);
        ctx.fillStyle = "#c9552f";
        ctx.fillRect(x - r * 0.6, y - r * 0.22, r * 0.5, r * 0.44);
        ctx.fillStyle = "#3f7a8f";
        ctx.fillRect(x + r * 0.1, y - r * 0.22, r * 0.5, r * 0.44);
      } else if (mark.kind === "oasis") {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          ctx.fillStyle = "#2f7a45";
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r * 1.6, r * 0.3, r * 0.14, a, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  /** Small dark pill with a label, used for the item you're standing over. */
  private drawNameTag(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    title: string,
    subtitle: string | null,
    color: string,
  ) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif";
    const titleWidth = ctx.measureText(title).width;
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    const subWidth = subtitle ? ctx.measureText(subtitle).width : 0;
    const w = Math.max(titleWidth, subWidth) + 18;
    const h = subtitle ? 34 : 22;

    ctx.fillStyle = "rgba(12,17,20,0.82)";
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = subtitle ? "rgba(255,138,128,0.75)" : color;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(title, x, subtitle ? y - 7 : y);
    if (subtitle) {
      ctx.fillStyle = "#ff9a90";
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(subtitle, x, y + 8);
    }
    ctx.restore();
  }

  private drawLetterSpots(
    ctx: CanvasRenderingContext2D,
    visible: (x: number, y: number, pad?: number) => boolean,
  ) {
    for (const spot of this.world.letterSpots) {
      if (this.letterFound.has(spot.pieceId)) continue;
      if (!visible(spot.x, spot.y, 40)) continue;

      const range = Math.hypot(spot.x - this.player.x, spot.y - this.player.y);
      // Letter pieces carry further than loot — they're the whole objective.
      if (range > ITEM_REVEAL_RANGE * 1.8) continue;
      const holdingSpot = this.buildingAt(spot.x, spot.y);
      if (holdingSpot && holdingSpot !== this.occupied) continue;
      const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 2.4);
      const float = Math.sin(this.elapsed * 1.6 + spot.pieceId) * 2.2;

      const glow = ctx.createRadialGradient(spot.x, spot.y, 2, spot.x, spot.y, 34 + pulse * 8);
      glow.addColorStop(0, "rgba(255,170,205,0.55)");
      glow.addColorStop(1, "rgba(255,170,205,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, 34 + pulse * 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(spot.x, spot.y + 10, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // A folded sheet of paper, drawn rather than an emoji.
      const py = spot.y + float;
      ctx.save();
      ctx.translate(spot.x, py);
      ctx.rotate(Math.sin(this.elapsed + spot.pieceId) * 0.08);
      ctx.fillStyle = "#fff6f8";
      ctx.beginPath();
      ctx.moveTo(-8, -11);
      ctx.lineTo(4, -11);
      ctx.lineTo(9, -6);
      ctx.lineTo(9, 11);
      ctx.lineTo(-8, 11);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffd9e4";
      ctx.beginPath();
      ctx.moveTo(4, -11);
      ctx.lineTo(9, -6);
      ctx.lineTo(4, -6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#e88aa8";
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-5, -3 + i * 4);
        ctx.lineTo(6, -3 + i * 4);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawPlane(ctx: CanvasRenderingContext2D) {
    if (!this.flight || this.dropState === "ground" || this.flightT > PLANE_DURATION + 6) return;
    const pos = this.planePosition();

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(this.flight.angle);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(6, 14, 40, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d7dee2";
    ctx.beginPath();
    ctx.moveTo(46, 0);
    ctx.lineTo(-24, 13);
    ctx.lineTo(-34, 0);
    ctx.lineTo(-24, -13);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#aeb8bd";
    ctx.fillRect(-4, -34, 12, 68);
    ctx.restore();
  }

  private drawParachutist(ctx: CanvasRenderingContext2D) {
    const { x, y } = this.player;
    const lift = this.altitude * 60;
    const parachuting = this.altitude < 0.55;

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y, 12 * (1 - this.altitude * 0.5), 6 * (1 - this.altitude * 0.5), 0, 0, Math.PI * 2);
    ctx.fill();

    const py = y - lift;
    if (parachuting) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(x, py - 22, 20, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 18, py - 22);
      ctx.lineTo(x, py - 4);
      ctx.lineTo(x + 18, py - 22);
      ctx.stroke();
    }

    drawCharacter(ctx, this.skin, x, py, this.player.angle, PLAYER_RADIUS * 0.8);
  }

  /**
   * Dashed guide showing where the shot will actually go, stopping at the
   * first wall, plus the spread cone so the shotgun reads differently.
   */
  private drawAimGuide(ctx: CanvasRenderingContext2D) {
    const weapon = this.weapon;
    if (!weapon || this.dropState !== "ground" || this.dead) return;

    const { x, y, angle } = this.player;
    const start = PLAYER_RADIUS + 6;

    /** Distance until the ray meets a wall or a rock. */
    const rayLength = (a: number): number => {
      const max = weapon.range;
      const step = 12;
      for (let d = start; d < max; d += step) {
        const px = x + Math.cos(a) * d;
        const py = y + Math.sin(a) * d;
        if (this.world.walls.some((w) => circleHitsRect(px, py, 2, w))) return d;
        if (
          this.world.props.some(
            (p) => p.kind === "rock" && Math.hypot(p.x - px, p.y - py) < p.r,
          )
        ) {
          return d;
        }
      }
      return max;
    };

    const centre = rayLength(angle);

    ctx.save();
    ctx.setLineDash([11, 9]);
    ctx.lineCap = "butt";
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.mag > 0 ? "rgba(255,240,180,0.75)" : "rgba(255,140,130,0.6)";
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * start, y + Math.sin(angle) * start);
    ctx.lineTo(x + Math.cos(angle) * centre, y + Math.sin(angle) * centre);
    ctx.stroke();

    // Spread edges: wide for the shotgun, almost invisible for the sniper.
    if (weapon.spread > 0.02) {
      ctx.setLineDash([6, 10]);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "rgba(255,240,180,0.32)";
      for (const side of [-1, 1]) {
        const a = angle + side * weapon.spread;
        const len = rayLength(a);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * start, y + Math.sin(a) * start);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
    }

    ctx.setLineDash([]);
    // A tick at maximum reach, so range is legible rather than guessed.
    if (centre >= weapon.range - 1) {
      const ex = x + Math.cos(angle) * centre;
      const ey = y + Math.sin(angle) * centre;
      ctx.strokeStyle = "rgba(255,240,180,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ex, ey, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBlasts(ctx: CanvasRenderingContext2D) {
    for (const blast of this.blasts) {
      const t = 1 - blast.life / 0.45;
      const r = blast.r * (0.35 + t * 0.65);
      const grad = ctx.createRadialGradient(blast.x, blast.y, r * 0.2, blast.x, blast.y, r);
      grad.addColorStop(0, `rgba(255,220,140,${0.75 * (1 - t)})`);
      grad.addColorStop(0.6, `rgba(240,120,50,${0.55 * (1 - t)})`);
      grad.addColorStop(1, "rgba(120,40,20,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(blast.x, blast.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBullets(ctx: CanvasRenderingContext2D) {
    for (const b of this.bullets) {
      const speed = Math.hypot(b.vx, b.vy) || 1;
      // Draw a short tracer behind the round so fast bullets stay visible.
      const tail = 14;
      const tx = b.x - (b.vx / speed) * tail;
      const ty = b.y - (b.vy / speed) * tail;
      ctx.strokeStyle = b.mine ? "rgba(255,235,140,0.9)" : "rgba(255,170,150,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.fillStyle = "#fff6c9";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawRemotes(ctx: CanvasRenderingContext2D) {
    for (const r of this.remotes.values()) {
      if (!this.canSee(r)) continue;
      ctx.globalAlpha = r.alive ? 1 : 0.4;

      drawCharacter(ctx, r.skin, r.x, r.y, r.angle, PLAYER_RADIUS);

      ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(r.name, r.x, r.y - PLAYER_RADIUS - 9);
      ctx.fillStyle = r.alive ? "#ffd7ea" : "#9aa5a0";
      ctx.fillText(r.name, r.x, r.y - PLAYER_RADIUS - 10);
      ctx.textAlign = "start";

      if (r.alive) {
        const w = 30;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(r.x - w / 2, r.y - PLAYER_RADIUS - 7, w, 3);
        ctx.fillStyle = "#6fdc8c";
        ctx.fillRect(r.x - w / 2, r.y - PLAYER_RADIUS - 7, (w * Math.max(0, r.hp)) / 100, 3);
      }

      ctx.globalAlpha = 1;
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    if (this.dropState !== "ground") {
      this.drawParachutist(ctx);
      return;
    }
    const { x, y, angle } = this.player;
    const wobble = Math.sin(this.player.bob) * 1.4;

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 7, PLAYER_RADIUS * 0.95, PLAYER_RADIUS * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Facing wedge
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, 120, angle - 0.42, angle + 0.42);
    ctx.closePath();
    ctx.fill();

    drawCharacter(ctx, this.skin, x, y + wobble, angle, PLAYER_RADIUS);

    if (this.muzzle > 0) {
      ctx.save();
      ctx.translate(x, y + wobble);
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(255,220,120,0.95)";
      ctx.beginPath();
      ctx.arc(PLAYER_RADIUS * 1.25, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (this.inventory.has("backpack_3") || this.inventory.has("backpack_2") || this.inventory.has("backpack_1")) {
      ctx.fillStyle = "#6b5a3e";
      ctx.beginPath();
      ctx.arc(x - Math.cos(angle) * 11, y - Math.sin(angle) * 11 + wobble, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawZone(ctx: CanvasRenderingContext2D, view: Rect) {
    // Tint everything outside the safe circle.
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.x, view.y, view.w, view.h);
    ctx.arc(this.zone.x, this.zone.y, this.zone.r, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(60,140,220,0.22)";
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(120,200,255,0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(this.zone.x, this.zone.y, this.zone.r, 0, Math.PI * 2);
    ctx.stroke();

    if (this.shrinking) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 14]);
      ctx.beginPath();
      ctx.arc(this.zone.targetX, this.zone.targetY, this.zone.targetR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawMinimap(
    ctx: CanvasRenderingContext2D,
    screenW: number,
    screenH: number,
    viewW: number,
    viewH: number,
  ) {
    const size = Math.max(92, Math.min(210, Math.min(screenW, screenH) * 0.28));
    const pad = 12;
    const ox = screenW - size - pad;
    const oy = pad;
    const scale = size / this.world.size;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(ox, oy, size, size, 10);
    ctx.clip();

    ctx.fillStyle = BIOME_GROUND.meadow.base;
    ctx.fillRect(ox, oy, size, size);

    for (const patch of this.world.biomes.patches) {
      ctx.fillStyle = BIOME_GROUND[patch.kind].base;
      ctx.beginPath();
      ctx.ellipse(
        ox + patch.x * scale,
        oy + patch.y * scale,
        patch.rx * scale,
        patch.ry * scale,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    ctx.fillStyle = BIOME_GROUND.beach.base;
    ctx.fillRect(
      ox,
      oy + this.world.biomes.beachLine * scale,
      size,
      size - this.world.biomes.beachLine * scale,
    );

    ctx.fillStyle = "#3f8caa";
    for (const pond of this.world.water) {
      ctx.beginPath();
      ctx.arc(ox + pond.x * scale, oy + pond.y * scale, pond.r * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(180,172,150,0.85)";
    for (const road of this.world.roads) {
      ctx.fillRect(ox + road.x * scale, oy + road.y * scale, Math.max(1, road.w * scale), Math.max(1, road.h * scale));
    }

    ctx.fillStyle = "#8a6a44";
    for (const pier of this.world.piers) {
      ctx.fillRect(
        ox + pier.x * scale,
        oy + pier.y * scale,
        Math.max(1, pier.w * scale),
        Math.max(1, pier.h * scale),
      );
    }

    ctx.fillStyle = "rgba(240,235,225,0.9)";
    for (const b of this.world.buildings) {
      ctx.fillRect(
        ox + b.rect.x * scale,
        oy + b.rect.y * scale,
        Math.max(1.5, b.rect.w * scale),
        Math.max(1.5, b.rect.h * scale),
      );
    }

    // Place names, so the map reads like a map.
    ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const town of this.world.towns) {
      const lx = ox + town.x * scale;
      const ly = oy + town.y * scale;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(town.name, lx, ly + 1);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(town.name, lx, ly);
    }
    ctx.textAlign = "start";

    // Tint only the area outside the safe circle.
    ctx.beginPath();
    ctx.rect(ox, oy, size, size);
    ctx.arc(ox + this.zone.x * scale, oy + this.zone.y * scale, this.zone.r * scale, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(60,140,220,0.35)";
    ctx.fill();

    ctx.strokeStyle = "rgba(120,200,255,0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ox + this.zone.x * scale, oy + this.zone.y * scale, this.zone.r * scale, 0, Math.PI * 2);
    ctx.stroke();

    if (this.shrinking) {
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(ox + this.zone.targetX * scale, oy + this.zone.targetY * scale, this.zone.targetR * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.airdrop) {
      ctx.fillStyle = "#ff6b3d";
      ctx.beginPath();
      ctx.arc(ox + this.airdrop.x * scale, oy + this.airdrop.y * scale, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Viewport rectangle
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + this.camera.x * scale, oy + this.camera.y * scale, viewW * scale, viewH * scale);

    for (const r of this.remotes.values()) {
      if (!this.canSee(r)) continue;
      ctx.fillStyle = r.alive ? "#ff7ab8" : "#7d8a85";
      ctx.beginPath();
      ctx.arc(ox + r.x * scale, oy + r.y * scale, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Noise markers: expanding rings where shots and footsteps were heard.
    for (const ping of this.pings) {
      const maxLife = ping.kind === "shot" ? 2.2 : 1.1;
      const t = 1 - ping.life / maxLife;
      const radius = (ping.kind === "shot" ? 9 : 5) * (0.3 + t);
      ctx.strokeStyle =
        ping.kind === "shot"
          ? `rgba(255,190,90,${(1 - t) * 0.95})`
          : `rgba(255,255,255,${(1 - t) * 0.6})`;
      ctx.lineWidth = ping.kind === "shot" ? 1.8 : 1.2;
      ctx.beginPath();
      ctx.arc(ox + ping.x * scale, oy + ping.y * scale, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const spot of this.world.letterSpots) {
      if (this.letterFound.has(spot.pieceId)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 2.4);
      ctx.fillStyle = `rgba(255,150,195,${0.55 + pulse * 0.45})`;
      ctx.beginPath();
      ctx.arc(ox + spot.x * scale, oy + spot.y * scale, 3 + pulse * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#ffe066";
    ctx.beginPath();
    ctx.arc(ox + this.player.x * scale, oy + this.player.y * scale, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(ox, oy, size, size, 10);
    ctx.stroke();
  }

  // --- HUD -----------------------------------------------------------------

  /** Compact "what do I have" strip: gun, helmet, vest, meds. */
  private equipmentSlots() {
    const helmet = [...this.inventory.keys()].find((id) => ITEMS[id].category === "armor" && ITEMS[id].icon === "helmet");
    const vest = [...this.inventory.keys()].find((id) => ITEMS[id].category === "armor" && ITEMS[id].icon === "vest");
    const meds = this.inventory.get("med_kit") ?? 0;
    const boost = [...this.inventory.entries()]
      .filter(([id]) => ITEMS[id].category === "boost")
      .reduce((sum, [, qty]) => sum + qty, 0);

    return [
      {
        key: "weapon",
        label: this.equipped ? ITEMS[this.equipped].name : "No weapon",
        icon: (this.equipped ? ITEMS[this.equipped].icon : "pistol") as IconName,
        have: this.equipped !== null,
        count: 1,
      },
      {
        key: "helmet",
        label: helmet ? ITEMS[helmet].name : "No helmet",
        icon: "helmet" as IconName,
        have: Boolean(helmet),
        count: 1,
      },
      {
        key: "vest",
        label: vest ? ITEMS[vest].name : "No vest",
        icon: "vest" as IconName,
        have: Boolean(vest),
        count: 1,
      },
      {
        key: "meds",
        label: `${meds} med kit${meds === 1 ? "" : "s"}`,
        icon: "medkit" as IconName,
        have: meds > 0,
        count: meds,
      },
      {
        key: "boost",
        label: `${boost} boost${boost === 1 ? "" : "s"}`,
        icon: "drink" as IconName,
        have: boost > 0,
        count: boost,
      },
    ];
  }

  private currentLocation(): string {
    for (const town of this.world.towns) {
      if (Math.hypot(town.x - this.player.x, town.y - this.player.y) < town.r) return town.name;
    }
    if (isInWater(this.world, this.player.x, this.player.y)) return "In the water";
    const biome = biomeAt(this.world.biomes, this.player.x, this.player.y);
    if (biome === "desert") return "The Dunes";
    if (biome === "beach") return "The Shore";
    if (biome === "forest") return "Pinewood";
    return "Open fields";
  }

  getHudState(): HudState {
    const near = this.nearestLoot();
    const nearbyFits = near ? this.wouldFit(near) : true;

    return {
      hp: this.player.hp,
      hearts: (this.player.hp / MAX_HP) * HEARTS,
      maxHearts: HEARTS,
      respawnIn: Math.max(0, this.respawnTimer),
      deaths: this.deaths,
      stamina: this.player.stamina,
      armor: this.armor,
      gunSlots: this.guns().map((id) => ({
        itemId: id,
        name: ITEMS[id].name,
        icon: ITEMS[id].icon,
        rarity: ITEMS[id].rarity,
        active: this.equipped === id,
      })),
      inventory: [...this.inventory.entries()]
        .map(([itemId, qty]) => ({ itemId, qty }))
        .sort((a, b) => ITEMS[a.itemId].category.localeCompare(ITEMS[b.itemId].category)),
      nearby: near ? { itemId: near.itemId, qty: near.qty } : null,
      inventoryFull: !nearbyFits,
      phase: Math.min(this.phase + 1, ZONE_PHASES.length),
      totalPhases: ZONE_PHASES.length,
      zoneStatus:
        this.phase >= ZONE_PHASES.length ? "final" : this.shrinking ? "shrinking" : "waiting",
      zoneCountdown: Math.max(0, this.phaseTimer),
      insideZone:
        Math.hypot(this.player.x - this.zone.x, this.player.y - this.zone.y) <= this.zone.r,
      elapsed: this.elapsed,
      collected: this.collected,
      location: this.currentLocation(),
      toasts: this.toasts,
      dead: this.dead,
      paused: this.paused,
      airdropActive: this.airdrop !== null,
      online: this.net !== null,
      hidden: this.dropState === "ground" && this.inBush(this.player.x, this.player.y),
      indoors: this.occupied !== null,
      biome: biomeAt(this.world.biomes, this.player.x, this.player.y),
      equipment: this.equipmentSlots(),
      letterFound: [...this.letterFound].sort((a, b) => a - b),
      letterEvent:
        this.letterEventId === null
          ? null
          : { id: this.letterEventId, seq: this.letterEventSeq },
      letterTotal: TOTAL_PIECES,
      letterComplete: this.letterFound.size >= TOTAL_PIECES,
      dropState: this.dropState,
      altitude: this.altitude,
      planeSecondsLeft: Math.max(0, PLANE_DURATION - this.flightT),
      weapon: this.equipped
        ? {
            itemId: this.equipped,
            name: ITEMS[this.equipped].name,
            icon: ITEMS[this.equipped].icon,
            rarity: ITEMS[this.equipped].rarity,
            mag: this.mag,
            magSize: this.weapon?.mag ?? 0,
            reserve: Number.POSITIVE_INFINITY,
            reloading: this.reloadTimer > 0,
            reloadProgress:
              this.reloadTimer > 0 && this.weapon
                ? 1 - this.reloadTimer / this.weapon.reload
                : 0,
          }
        : null,
      weapons: [...this.inventory.keys()].filter((id) => ITEMS[id].weapon),
      squad: [...this.remotes.values()].map((r) => ({
        id: r.id,
        name: r.name,
        hp: r.hp,
        alive: r.alive,
      })),
    };
  }
}
