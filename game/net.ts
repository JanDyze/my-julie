import {
  ClientMessage,
  DEFAULT_PORT,
  MatchState,
  NetPlayer,
  ServerMessage,
  ShotEvent,
  ZoneState,
} from "./shared";

export interface NetHandlers {
  onWelcome: (seed: number, id: string, taken: number[], zone: ZoneState) => void;
  onState: (players: NetPlayer[], zone: ZoneState, serverTime: number) => void;
  onMatch: (match: MatchState) => void;
  onTaken: (lootId: number, by: string) => void;
  onShot: (from: string, shot: ShotEvent) => void;
  onHurt: (fromName: string, damage: number) => void;
  onNotice: (text: string) => void;
  onStatus: (status: NetStatus) => void;
}

export type NetStatus = "connecting" | "online" | "offline" | "error";

export function defaultServerUrl(): string {
  // A deployed site must point at a hosted wss:// server; an https page cannot
  // open a plain ws:// connection.
  const configured = process.env.NEXT_PUBLIC_GAME_SERVER;
  if (configured) return configured;

  if (typeof window === "undefined") return `ws://localhost:${DEFAULT_PORT}`;
  // Local dev: same host the page came from, so a phone on the LAN finds it.
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.hostname}:${DEFAULT_PORT}`;
}

/** True when multiplayer has somewhere to connect to. */
export function multiplayerConfigured(): boolean {
  if (process.env.NEXT_PUBLIC_GAME_SERVER) return true;
  // On a deployed https origin with no server configured, only solo works.
  if (typeof window === "undefined") return false;
  return window.location.protocol !== "https:";
}

export class NetClient {
  private socket: WebSocket | null = null;
  private closed = false;
  readonly name: string;
  playerId = "";

  constructor(
    private url: string,
    name: string,
    private skin: string,
    private handlers: NetHandlers,
  ) {
    this.name = name;
    this.connect();
  }

  private connect() {
    this.handlers.onStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.handlers.onStatus("error");
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.handlers.onStatus("online");
      this.send({ t: "join", name: this.name, skin: this.skin });
    };

    socket.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      switch (msg.t) {
        case "welcome":
          this.playerId = msg.id;
          this.handlers.onWelcome(msg.seed, msg.id, msg.taken, msg.zone);
          this.handlers.onMatch(msg.match);
          break;
        case "match":
          this.handlers.onMatch(msg.match);
          break;
        case "state":
          this.handlers.onState(msg.players, msg.zone, msg.st);
          break;
        case "taken":
          this.handlers.onTaken(msg.lootId, msg.by);
          break;
        case "denied":
          this.handlers.onTaken(msg.lootId, "");
          break;
        case "shot":
          this.handlers.onShot(msg.from, msg.shot);
          break;
        case "hurt":
          this.handlers.onHurt(msg.fromName, msg.damage);
          break;
        case "killed":
          this.handlers.onNotice(`${msg.name} was eliminated`);
          break;
        case "joined":
          this.handlers.onNotice(`${msg.name} dropped in`);
          break;
        case "left":
          this.handlers.onNotice(`${msg.name} left`);
          break;
      }
    };

    socket.onclose = () => {
      if (this.closed) return;
      this.handlers.onStatus("offline");
    };

    socket.onerror = () => {
      if (!this.closed) this.handlers.onStatus("error");
    };
  }

  send(msg: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  close() {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }
}
