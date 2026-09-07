import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  COUNTDOWN_SECONDS,
  ClientMessage,
  DEFAULT_PORT,
  FlightPath,
  MatchPhase,
  MatchState,
  NetPlayer,
  ServerMessage,
  WORLD_SIZE,
  randomFlightPath,
  ZONE_PHASES,
  ZoneState,
} from "../game/shared";

const TICK_HZ = 30;
// Render (and most hosts) inject PORT; locally we fall back to our own.
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const HOST = process.env.HOST ?? "0.0.0.0";

interface Session {
  socket: WebSocket;
  player: NetPlayer;
  joined: boolean;
}

const sessions = new Map<string, Session>();

/** One match: a shared map seed, the loot already claimed, and the circle. */
let seed = Math.floor(Math.random() * 1e9);
let taken = new Set<number>();
let phase = 0;
let shrinking = false;
let phaseTimer = ZONE_PHASES[0].wait;
let zone: ZoneState = {
  x: WORLD_SIZE / 2,
  y: WORLD_SIZE / 2,
  r: WORLD_SIZE * 0.72,
  targetX: WORLD_SIZE / 2,
  targetY: WORLD_SIZE / 2,
  targetR: WORLD_SIZE * 0.72,
  phase: 0,
  shrinking: false,
  countdown: phaseTimer,
};

let matchPhase: MatchPhase = "lobby";
let countdown = 0;
let flight: FlightPath | null = null;
let flightT = 0;

function matchState(): MatchState {
  return {
    phase: matchPhase,
    countdown,
    roster: [...sessions.values()]
      .filter((s) => s.joined)
      .map((s) => ({ id: s.player.id, name: s.player.name })),
    flight,
    flightT,
    seed,
  };
}

function beginMatch() {
  seed = Math.floor(Math.random() * 1e9);
  taken = new Set();
  phase = 0;
  shrinking = false;
  phaseTimer = ZONE_PHASES[0].wait;
  zone = {
    x: WORLD_SIZE / 2,
    y: WORLD_SIZE / 2,
    r: WORLD_SIZE * 0.72,
    targetX: WORLD_SIZE / 2,
    targetY: WORLD_SIZE / 2,
    targetR: WORLD_SIZE * 0.72,
    phase: 0,
    shrinking: false,
    countdown: phaseTimer,
  };
  flight = randomFlightPath();
  flightT = 0;
  matchPhase = "playing";
  for (const s of sessions.values()) {
    s.player.alive = true;
    s.player.hp = 100;
    s.player.collected = 0;
  }
  console.log(`[match] started, seed ${seed}`);
  broadcast({ t: "match", match: matchState() });
}

function resetMatch() {
  seed = Math.floor(Math.random() * 1e9);
  taken = new Set();
  phase = 0;
  shrinking = false;
  phaseTimer = ZONE_PHASES[0].wait;
  matchPhase = "lobby";
  countdown = 0;
  flight = null;
  flightT = 0;
  zone = {
    x: WORLD_SIZE / 2,
    y: WORLD_SIZE / 2,
    r: WORLD_SIZE * 0.72,
    targetX: WORLD_SIZE / 2,
    targetY: WORLD_SIZE / 2,
    targetR: WORLD_SIZE * 0.72,
    phase: 0,
    shrinking: false,
    countdown: phaseTimer,
  };
  console.log(`[match] reset, new seed ${seed}`);
}

function send(socket: WebSocket, msg: ServerMessage) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMessage, except?: string) {
  for (const [id, session] of sessions) {
    if (id === except || !session.joined) continue;
    send(session.socket, msg);
  }
}

function updateZone(dt: number) {
  const current = ZONE_PHASES[Math.min(phase, ZONE_PHASES.length - 1)];
  phaseTimer -= dt;

  if (phaseTimer <= 0) {
    if (!shrinking && phase < ZONE_PHASES.length) {
      const maxOffset = Math.max(0, zone.r - WORLD_SIZE * current.factor);
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * maxOffset;
      zone.targetX = zone.x + Math.cos(angle) * dist;
      zone.targetY = zone.y + Math.sin(angle) * dist;
      zone.targetR = WORLD_SIZE * current.factor;
      shrinking = true;
      phaseTimer = current.shrink;
    } else if (shrinking) {
      zone.x = zone.targetX;
      zone.y = zone.targetY;
      zone.r = zone.targetR;
      shrinking = false;
      phase = Math.min(phase + 1, ZONE_PHASES.length);
      phaseTimer = ZONE_PHASES[Math.min(phase, ZONE_PHASES.length - 1)].wait;
    }
  }

  if (shrinking) {
    zone.r += (zone.targetR - zone.r) * Math.min(1, dt * 0.9);
    zone.x += (zone.targetX - zone.x) * Math.min(1, dt * 0.8);
    zone.y += (zone.targetY - zone.y) * Math.min(1, dt * 0.8);
  }

  zone.phase = phase;
  zone.shrinking = shrinking;
  zone.countdown = Math.max(0, phaseTimer);
}

/**
 * A plain HTTP server sits in front so hosts can detect the open port and so
 * there's a URL to hit that wakes the service from an idle spin-down.
 */
const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        phase: matchPhase,
        players: [...sessions.values()].filter((s) => s.joined).length,
        seed,
      }),
    );
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Loot Island game server. Connect over WebSocket.\n");
});

const wss = new WebSocketServer({ server: http });

wss.on("connection", (socket) => {
  const id = Math.random().toString(36).slice(2, 10);
  const session: Session = {
    socket,
    joined: false,
    player: {
      id,
      name: "Player",
      skin: "girl",
      x: WORLD_SIZE / 2,
      y: WORLD_SIZE / 2,
      angle: 0,
      hp: 100,
      alive: true,
      collected: 0,
    },
  };
  sessions.set(id, session);

  socket.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.t) {
      case "join": {
        session.player.name = String(msg.name ?? "Player").slice(0, 16) || "Player";
        session.player.skin = String(msg.skin ?? "girl").slice(0, 12);
        session.joined = true;
        send(socket, { t: "welcome", id, seed, taken: [...taken], zone, match: matchState() });
        broadcast({ t: "joined", name: session.player.name }, id);
        broadcast({ t: "match", match: matchState() });
        console.log(`[join] ${session.player.name} (${sessions.size} connected)`);
        break;
      }
      case "pos": {
        session.player.x = msg.x;
        session.player.y = msg.y;
        session.player.angle = msg.angle;
        session.player.hp = msg.hp;
        session.player.collected = msg.collected;
        break;
      }
      case "take": {
        // First claim wins; everyone else is told the item is gone.
        if (taken.has(msg.lootId)) {
          send(socket, { t: "denied", lootId: msg.lootId });
          return;
        }
        taken.add(msg.lootId);
        // broadcast already reaches the claimer, so don't also send directly.
        broadcast({ t: "taken", lootId: msg.lootId, by: id });
        break;
      }
      case "shot": {
        // Visual only — damage is settled by the "hit" message below.
        broadcast({ t: "shot", from: id, shot: msg.shot }, id);
        break;
      }
      case "hit": {
        // Shooters do their own hit detection; the victim applies the damage.
        const victim = sessions.get(msg.target);
        if (!victim || !victim.joined || !victim.player.alive) return;
        send(victim.socket, {
          t: "hurt",
          from: id,
          fromName: session.player.name,
          damage: msg.damage,
        });
        break;
      }
      case "start": {
        if (matchPhase !== "lobby") return;
        matchPhase = "countdown";
        countdown = COUNTDOWN_SECONDS;
        broadcast({ t: "match", match: matchState() });
        break;
      }
      case "cancel": {
        if (matchPhase !== "countdown") return;
        matchPhase = "lobby";
        countdown = 0;
        broadcast({ t: "match", match: matchState() });
        break;
      }
      case "died": {
        session.player.alive = false;
        broadcast({ t: "killed", name: session.player.name, by: "" });
        break;
      }
    }
  });

  const drop = () => {
    const name = session.player.name;
    sessions.delete(id);
    broadcast({ t: "left", id, name });
    broadcast({ t: "match", match: matchState() });
    console.log(`[left] ${name} (${sessions.size} connected)`);
    // Nobody left: start a fresh island for the next pair.
    if (sessions.size === 0) resetMatch();
  };

  socket.on("close", drop);
  socket.on("error", drop);
});

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;

  if (matchPhase === "countdown") {
    countdown = Math.max(0, countdown - dt);
    if (countdown <= 0) beginMatch();
  }

  if (matchPhase === "playing") {
    flightT += dt;
    updateZone(dt);
  }

  const players = [...sessions.values()].filter((s) => s.joined).map((s) => s.player);
  // Stamp with the server clock so clients interpolate on a uniform
  // timeline; arrival times are jittery and distort the interval.
  broadcast({ t: "state", players, zone, st: now / 1000 });

  // The roster is bulky, so only stream match state while the clock is visibly
  // ticking; otherwise it goes out on change only.
  if (matchPhase === "countdown") broadcast({ t: "match", match: matchState() });
}, 1000 / TICK_HZ);

http.listen(PORT, HOST, () => {
  console.log(`Loot Island server listening on ${HOST}:${PORT} (seed ${seed})`);
});
