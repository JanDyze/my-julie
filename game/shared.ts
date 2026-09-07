/**
 * Types and constants shared by the browser client and the multiplayer server.
 * Must stay free of DOM and Node imports so both runtimes can load it.
 */

export const WORLD_SIZE = 3600;
export const DEFAULT_PORT = 3112;

export interface ZonePhase {
  wait: number;
  shrink: number;
  /** Fraction of the map size the circle ends at. */
  factor: number;
  dps: number;
}

export const ZONE_PHASES: ZonePhase[] = [
  { wait: 50, shrink: 40, factor: 0.62, dps: 1.2 },
  { wait: 40, shrink: 35, factor: 0.42, dps: 2.5 },
  { wait: 34, shrink: 30, factor: 0.27, dps: 4 },
  { wait: 28, shrink: 26, factor: 0.15, dps: 7 },
  { wait: 24, shrink: 22, factor: 0.06, dps: 11 },
];

export interface ZoneState {
  x: number;
  y: number;
  r: number;
  targetX: number;
  targetY: number;
  targetR: number;
  phase: number;
  shrinking: boolean;
  countdown: number;
}

export interface NetPlayer {
  id: string;
  name: string;
  skin: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  alive: boolean;
  collected: number;
}

export type MatchPhase = "lobby" | "countdown" | "playing";

export const COUNTDOWN_SECONDS = 10;
export const PLANE_SPEED = 250;
/** Seconds after the doors open before stragglers are pushed out. */
export const PLANE_DURATION = 22;

/** The cargo plane's run across the island, identical for every client. */
export interface FlightPath {
  x: number;
  y: number;
  angle: number;
}

/** The plane's run, generated identically wherever it's needed. */
export function randomFlightPath(rand: () => number = Math.random): FlightPath {
  const angle = rand() * Math.PI * 2;
  const half = WORLD_SIZE / 2;
  const radius = WORLD_SIZE * 0.78;
  return {
    x: half - Math.cos(angle) * radius,
    y: half - Math.sin(angle) * radius,
    angle,
  };
}

export interface RosterEntry {
  id: string;
  name: string;
}

/** A fired round, sent purely so other clients can draw the tracer. */
export interface ShotEvent {
  x: number;
  y: number;
  angle: number;
  speed: number;
  range: number;
}

export type ClientMessage =
  | { t: "join"; name: string; skin: string }
  | { t: "pos"; x: number; y: number; angle: number; hp: number; collected: number }
  | { t: "take"; lootId: number }
  | { t: "shot"; shot: ShotEvent }
  | { t: "hit"; target: string; damage: number }
  | { t: "start" }
  | { t: "cancel" }
  | { t: "died" };

export interface MatchState {
  phase: MatchPhase;
  /** Seconds left on the pre-game countdown. */
  countdown: number;
  roster: RosterEntry[];
  flight: FlightPath | null;
  /** Seconds since the plane entered the map. */
  flightT: number;
  seed: number;
}

export type ServerMessage =
  | { t: "welcome"; id: string; seed: number; taken: number[]; zone: ZoneState; match: MatchState }
  | { t: "match"; match: MatchState }
  | { t: "state"; players: NetPlayer[]; zone: ZoneState; st: number }
  | { t: "taken"; lootId: number; by: string }
  | { t: "denied"; lootId: number }
  | { t: "shot"; from: string; shot: ShotEvent }
  | { t: "hurt"; from: string; fromName: string; damage: number }
  | { t: "killed"; name: string; by: string }
  | { t: "joined"; name: string }
  | { t: "left"; id: string; name: string };
