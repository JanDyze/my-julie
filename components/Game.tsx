"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameEngine, HudState } from "@/game/engine";
import { ITEMS, RARITY_COLORS } from "@/game/items";
import { NetClient, NetStatus, defaultServerUrl } from "@/game/net";
import { FlightPath, MatchState, ZoneState, randomFlightPath } from "@/game/shared";
import TouchControls from "./TouchControls";
import LetterReader from "./LetterReader";
import LetterFound from "./LetterFound";
import { LETTER_PIECES, TOTAL_PIECES } from "@/game/letter";
import CharacterPicker from "./CharacterPicker";
import Icon from "./Icon";
import { DEFAULT_SKIN, SkinId } from "@/game/characters";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const CONTROLS: [string, string][] = [
  ["WASD", "Run around"],
  ["Shift", "Sprint"],
  ["Click", "Fire (aim with mouse)"],
  ["R", "Reload"],
  ["—", "Items pick up automatically"],
  ["E", "Force pickup when bag is full"],
  ["Q", "Use a heal"],
  ["F", "Use a boost"],
  ["Esc", "Pause"],
];

const STATUS_LABEL: Record<NetStatus, string> = {
  connecting: "Connecting…",
  online: "Connected",
  offline: "Disconnected",
  error: "Can't reach the server",
};

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const netRef = useRef<NetClient | null>(null);
  const welcomeRef = useRef<{ taken: number[]; zone: ZoneState } | null>(null);
  const flightRef = useRef<{ flight: FlightPath; flightT: number } | null>(null);

  const [hud, setHud] = useState<HudState | null>(null);
  const [view, setView] = useState<"lobby" | "playing">("lobby");
  const [seed, setSeed] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [netStatus, setNetStatus] = useState<NetStatus | null>(null);
  const [match, setMatch] = useState<MatchState | null>(null);
  const [round, setRound] = useState(0);
  const [showHelp, setShowHelp] = useState(true);
  const [isTouch, setIsTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [skin, setSkin] = useState<SkinId>(DEFAULT_SKIN);
  const [muted, setMuted] = useState(false);
  const [foundPiece, setFoundPiece] = useState<{ id: number; seq: number } | null>(null);
  const seenSeq = useRef(0);

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const upright = window.matchMedia("(orientation: portrait)");
    const sync = () => {
      setIsTouch(coarse.matches);
      setPortrait(upright.matches);
    };
    sync();
    coarse.addEventListener("change", sync);
    upright.addEventListener("change", sync);
    return () => {
      coarse.removeEventListener("change", sync);
      upright.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    setName(localStorage.getItem("loot-island-name") ?? "");
    const saved = localStorage.getItem("loot-island-skin");
    if (saved) setSkin(saved as SkinId);
    setMuted(localStorage.getItem("loot-island-muted") === "1");
  }, []);

  useEffect(() => {
    localStorage.setItem("loot-island-skin", skin);
    engineRef.current?.setSkin(skin);
  }, [skin]);

  useEffect(() => {
    localStorage.setItem("loot-island-muted", muted ? "1" : "0");
    engineRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    if (view !== "playing" || seed === null) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    resize();

    const engine = new GameEngine(canvas, seed);
    engine.setSkin(skin);
    engine.setMuted(muted);
    engineRef.current = engine;
    if (netRef.current && welcomeRef.current) {
      engine.attachNet(netRef.current, welcomeRef.current.taken, welcomeRef.current.zone);
    }
    if (flightRef.current) {
      engine.beginDrop(flightRef.current.flight, flightRef.current.flightT);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const poll = window.setInterval(() => {
      const next = engine.getHudState();
      setHud(next);
      // Latch a newly found piece once, then freeze the world for the moment.
      if (next.letterEvent && next.letterEvent.seq > seenSeq.current) {
        seenSeq.current = next.letterEvent.seq;
        setFoundPiece(next.letterEvent);
        engine.setPaused(true);
      }
    }, 90);

    return () => {
      window.clearInterval(poll);
      observer.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, [round, seed, view]);

  useEffect(() => {
    return () => {
      netRef.current?.close();
      netRef.current = null;
    };
  }, []);

  const startSolo = () => {
    engineRef.current?.unlockAudio();
    flightRef.current = { flight: randomFlightPath(), flightT: 0 };
    setMatch(null);
    setSeed(Math.floor(Math.random() * 1e9));
    setView("playing");
  };

  const startOnline = () => {
    engineRef.current?.unlockAudio();
    const chosen = name.trim() || "Player";
    localStorage.setItem("loot-island-name", chosen);
    netRef.current?.close();
    netRef.current = new NetClient(defaultServerUrl(), chosen, skin, {
      onWelcome: (_serverSeed, _id, taken, zone) => {
        welcomeRef.current = { taken, zone };
      },
      onState: (players, zone, st) => engineRef.current?.applyNetState(players, zone, st),
      onTaken: (lootId, by) => engineRef.current?.applyTaken(lootId, by),
      onShot: (_from, shot) => engineRef.current?.addRemoteShot(shot),
      onHurt: (fromName, damage) => engineRef.current?.takeDamage(fromName, damage),
      onMatch: (m) => {
        setMatch(m);
        if (m.phase === "playing" && m.flight) {
          flightRef.current = { flight: m.flight, flightT: m.flightT };
          setSeed(m.seed);
          setView("playing");
        } else if (m.phase !== "playing") {
          setView("lobby");
        }
      },
      onNotice: (text) => engineRef.current?.notice(text),
      onStatus: setNetStatus,
    });
  };

  const leave = () => {
    netRef.current?.close();
    netRef.current = null;
    welcomeRef.current = null;
    setNetStatus(null);
    setMatch(null);
    setHud(null);
    setSeed(null);
    flightRef.current = null;
    setView("lobby");
    setShowHelp(true);
  };

  const togglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !engine.getHudState().paused;
    engine.setPaused(next);
    setHud(engine.getHudState());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && view === "playing") {
        setShowHelp(false);
        togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePause, view]);

  const restart = () => {
    setShowHelp(false);
    setHud(null);
    setRound((r) => r + 1);
  };

  const goFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen can be refused (iOS Safari); the game still plays windowed.
    }
    try {
      const orientation = window.screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      await orientation.lock?.("landscape");
    } catch {
      // Orientation lock is unavailable on iOS; the rotate prompt covers it.
    }
  }, []);

  const nearbyDef = hud?.nearby ? ITEMS[hud.nearby.itemId] : null;

  return (
    <div className="game-shell">
      <canvas ref={canvasRef} className="game-canvas" />

      {view === "lobby" && (
        <div className="overlay">
          <div className="overlay-card">
            <h2>Loot Island</h2>
            <p>Explore, loot everything, and stay inside the shrinking circle.</p>

            <CharacterPicker value={skin} onChange={setSkin} />

            <input
              className="name-input"
              value={name}
              maxLength={16}
              placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
            />

            {match ? (
              <>
                <div className="roster">
                  <span className="roster-title">In the lobby ({match.roster.length})</span>
                  <ul>
                    {match.roster.map((p) => (
                      <li key={p.id}>
                        <span className="roster-dot" />
                        {p.name}
                      </li>
                    ))}
                  </ul>
                </div>

                {match.phase === "countdown" ? (
                  <div className="countdown-block">
                    <span className="countdown-number">{Math.ceil(match.countdown)}</span>
                    <span className="countdown-caption">Plane taking off…</span>
                    <button
                      className="ghost"
                      onClick={() => netRef.current?.send({ t: "cancel" })}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="lobby-actions">
                    <button
                      className="primary"
                      onClick={() => netRef.current?.send({ t: "start" })}
                    >
                      Start match
                    </button>
                    <button className="ghost" onClick={leave}>
                      Leave
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="lobby-actions">
                <button className="primary" onClick={startOnline}>
                  Play together
                </button>
                <button className="ghost" onClick={startSolo}>
                  Play solo
                </button>
              </div>
            )}

            {netStatus && (
              <p className={`net-status ${netStatus}`}>
                {STATUS_LABEL[netStatus]}
                {netStatus === "error" && (
                  <span className="net-hint">
                    Start it with <code>npm run server</code>
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {hud && view === "playing" && (
        <>
          <button
            className="sound-toggle"
            onClick={() => setMuted((m) => !m)}
            title={muted ? "Sound off" : "Sound on"}
          >
            <Icon name="radio" size={15} />
            {muted && <span className="sound-slash" />}
          </button>

          <div className="hud-top">
            <div className="hud-chip">
              <span className="hud-chip-label">
                Zone {hud.phase}/{hud.totalPhases}
              </span>
              <span className={`hud-chip-value ${hud.zoneStatus === "shrinking" ? "danger" : ""}`}>
                {hud.zoneStatus === "final"
                  ? "Final circle"
                  : hud.zoneStatus === "shrinking"
                    ? `Closing ${formatClock(hud.zoneCountdown)}`
                    : `Next in ${formatClock(hud.zoneCountdown)}`}
              </span>
            </div>
            <div className="hud-chip">
              <span className="hud-chip-label">Location</span>
              <span className="hud-chip-value">{hud.location}</span>
            </div>
            <div className="hud-chip">
              <span className="hud-chip-label">Survived</span>
              <span className="hud-chip-value">{formatClock(hud.elapsed)}</span>
            </div>
            <div className="hud-chip">
              <span className="hud-chip-label">Looted</span>
              <span className="hud-chip-value">{hud.collected}</span>
            </div>
            <button
              className={`letter-tracker ${hud.letterComplete ? "complete" : ""}`}
              onClick={() => hud.letterComplete && setReaderOpen(true)}
            >
              <span className="hud-chip-label">Letter</span>
              <span className="letter-pips">
                {LETTER_PIECES.map((piece) => (
                  <span
                    key={piece.id}
                    className={`letter-pip ${hud.letterFound.includes(piece.id) ? "found" : ""}`}
                  />
                ))}
                <b>
                  {hud.letterFound.length}/{hud.letterTotal}
                </b>
              </span>
              {hud.letterComplete && <span className="letter-cta">Tap to read</span>}
            </button>

            {hud.online && (
              <div className="hud-chip">
                <span className="hud-chip-label">Squad</span>
                <span className="hud-chip-value">
                  {hud.squad.length === 0
                    ? "Alone"
                    : hud.squad.map((s) => s.name).join(", ")}
                </span>
              </div>
            )}
          </div>

          {hud.dropState === "plane" && (
            <div className="drop-banner">
              <span className="drop-title">Jump when you&apos;re ready</span>
              <span className="drop-sub">
                Doors close in {Math.ceil(hud.planeSecondsLeft)}s
                {!isTouch && " · press Space"}
              </span>
            </div>
          )}

          {hud.dropState === "falling" && (
            <div className="drop-banner">
              <span className="drop-title">Steer your landing</span>
              <span className="drop-sub">
                Altitude {Math.round(hud.altitude * 100)}m
              </span>
            </div>
          )}

          {hud.hidden && !hud.dead && hud.dropState === "ground" && (
            <div className="hidden-badge">Hidden in the bushes</div>
          )}

          {!hud.insideZone && !hud.dead && hud.dropState === "ground" && (
            <div className="zone-warning">Outside the safe zone — you&apos;re taking damage</div>
          )}

          <div className="toast-stack">
            {hud.toasts.map((toast) => (
              <div
                key={toast.id}
                className="toast"
                style={{ opacity: Math.min(1, toast.ttl / 0.5) }}
              >
                <Icon name={toast.icon} size={12} />
                <span>{toast.text}</span>
              </div>
            ))}
          </div>

          <div className="gun-slots">
              {Array.from({ length: 2 }, (_, i) => {
                const slot = hud.gunSlots[i];
                if (!slot) {
                  return (
                    <div key={i} className="gun-slot empty">
                      <span className="gun-slot-num">{i + 1}</span>
                      <span className="gun-slot-name">Empty</span>
                    </div>
                  );
                }
                return (
                  <button
                    key={slot.itemId}
                    className={`gun-slot ${slot.active ? "active" : ""}`}
                    onClick={() => engineRef.current?.equipItem(slot.itemId)}
                  >
                    <span className="gun-slot-num">{i + 1}</span>
                    <Icon name={slot.icon} size={20} />
                    <span className="gun-slot-name" style={{ color: RARITY_COLORS[slot.rarity] }}>
                      {slot.name}
                    </span>
                    {slot.active && hud.weapon && (
                      <span className="gun-slot-ammo">
                        {hud.weapon.reloading ? "reloading" : `${hud.weapon.mag}`}
                        <i>/ ∞</i>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

          <div className="hud-bottom">
            <div className="bars">
              <div className="hearts">
                {Array.from({ length: hud.maxHearts }, (_, i) => {
                  const fill = Math.max(0, Math.min(1, hud.hearts - i));
                  return (
                    <span key={i} className="heart">
                      <Icon name="heart" size={19} className="heart-empty" />
                      <span className="heart-clip" style={{ width: `${fill * 100}%` }}>
                        <Icon name="heart" size={19} className="heart-full" />
                      </span>
                    </span>
                  );
                })}
              </div>
              <div className="bar-row">
                <span className="bar-label">STA</span>
                <div className="bar">
                  <div className="bar-fill stamina" style={{ width: `${hud.stamina}%` }} />
                </div>
                <span className="bar-value">{Math.ceil(hud.stamina)}</span>
              </div>
              {hud.armor > 0 && (
                <div className="bar-row">
                  <span className="bar-label">ARM</span>
                  <div className="bar">
                    <div className="bar-fill armor" style={{ width: `${hud.armor}%` }} />
                  </div>
                  <span className="bar-value">{hud.armor}%</span>
                </div>
              )}
            </div>


            {nearbyDef && (
              <div className={`pickup-prompt ${hud.inventoryFull ? "blocked" : ""}`}>
                <kbd>E</kbd>
                <span className="pickup-icon"><Icon name={nearbyDef.icon} size={18} /></span>
                <span>
                  <strong style={{ color: RARITY_COLORS[nearbyDef.rarity] }}>
                    {nearbyDef.name}
                  </strong>
                  {hud.nearby && hud.nearby.qty > 1 ? ` ×${hud.nearby.qty}` : ""}
                  <em>
                    {hud.inventoryFull
                      ? "Bag full — drop something to take it"
                      : nearbyDef.blurb}
                  </em>
                </span>
              </div>
            )}
          </div>

          <div className={`kit ${isTouch && !invOpen ? "collapsed" : ""}`}>
            <button className="kit-head" onClick={() => isTouch && setInvOpen((o) => !o)}>
              <span>Kit</span>
              {isTouch && <span>{invOpen ? "▾" : "▸"}</span>}
            </button>

            <div className="kit-slots">
              {hud.equipment.map((slot) => (
                <span
                  key={slot.key}
                  className={`kit-slot ${slot.have ? "have" : ""}`}
                  title={slot.label}
                >
                  <Icon name={slot.icon} size={17} />
                  {slot.count > 1 && <b>{slot.count}</b>}
                </span>
              ))}
            </div>

            <div className="kit-list">
              {hud.inventory.length === 0 && (
                <p className="kit-empty">Walk over items to pick them up.</p>
              )}
              {hud.inventory.map(({ itemId, qty }) => {
                const def = ITEMS[itemId];
                const usable = Boolean(def.heal || def.boost);
                return (
                  <div key={itemId} className="kit-row">
                    <Icon name={def.icon} size={15} />
                    <span className="kit-name" style={{ color: RARITY_COLORS[def.rarity] }}>
                      {def.name}
                    </span>
                    {qty > 1 && <span className="kit-qty">{qty}</span>}
                    <span className="kit-actions">
                      {def.weapon && hud.weapon?.itemId !== itemId && (
                        <button onClick={() => engineRef.current?.equipItem(itemId)}>Equip</button>
                      )}
                      {usable && (
                        <button onClick={() => engineRef.current?.useItem(itemId)}>Use</button>
                      )}
                      <button onClick={() => engineRef.current?.dropItem(itemId)}>Drop</button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {isTouch && !hud.dead && !hud.paused && !showHelp && (
            <TouchControls
              onMove={(x, y) => engineRef.current?.setTouchMove(x, y)}
              onPickup={() => engineRef.current?.pickup()}
              onAim={(x, y) => engineRef.current?.setAimStick(x, y)}
              onReload={() => engineRef.current?.reload()}
              pickupLabel={nearbyDef ? nearbyDef.name : null}
              pickupBlocked={hud.inventoryFull}
              onHeal={() => engineRef.current?.useHeal()}
              medKits={
                hud.equipment.find((slot) => slot.key === "meds")?.count ?? 0
              }
              canJump={hud.dropState === "plane"}
              onJump={() => engineRef.current?.jump()}
              airborne={hud.dropState !== "ground"}
              ammo={
                hud.weapon
                  ? {
                      mag: hud.weapon.mag,
                      reserve: hud.weapon.reserve,
                      reloading: hud.weapon.reloading,
                    }
                  : null
              }
            />
          )}

          {showHelp && (
            <div className="overlay">
              <div className="overlay-card">
                <h2>Welcome to the drop zone</h2>
                <p>
                  Explore the island, run into houses, and grab everything you can carry. The blue
                  circle keeps shrinking — stay inside it.
                </p>
                {isTouch ? (
                  <div className="controls-grid">
                    <div className="control-row">
                      <kbd>&#9678;</kbd>
                      <span>Drag to run</span>
                    </div>
                    <div className="control-row">
                      <kbd>&#9678;</kbd>
                      <span>Push far to sprint</span>
                    </div>
                    <div className="control-row">
                      <kbd>H</kbd>
                      <span>Items pick up on contact</span>
                    </div>
                    <div className="control-row">
                      <kbd>K</kbd>
                      <span>Tap to open bag</span>
                    </div>
                  </div>
                ) : (
                  <div className="controls-grid">
                    {CONTROLS.map(([key, label]) => (
                      <div key={key} className="control-row">
                        <kbd>{key}</kbd>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className="primary"
                  onClick={() => {
                    setShowHelp(false);
                    // First in-game tap: the gesture browsers require for audio.
                    engineRef.current?.unlockAudio();
                    if (isTouch) void goFullscreen();
                  }}
                >
                  Let&apos;s go
                </button>
              </div>
            </div>
          )}

          {isTouch && portrait && (
            <div className="overlay rotate-gate">
              <div className="overlay-card">
                <div className="rotate-icon" />
                <h2>Turn your phone sideways</h2>
                <p>Loot Island plays in landscape. Rotate, then tap below for fullscreen.</p>
                <button className="primary" onClick={() => void goFullscreen()}>
                  Go fullscreen
                </button>
              </div>
            </div>
          )}

          {hud.paused && !hud.dead && !showHelp && (
            <div className="overlay">
              <div className="overlay-card">
                <h2>Paused</h2>
                <p>{hud.online ? "The island keeps going without you." : "Take your time."}</p>
                <button className="primary" onClick={togglePause}>
                  Resume
                </button>
              </div>
            </div>
          )}

          {foundPiece && (
            <LetterFound
              pieceId={foundPiece.id}
              found={hud.letterFound}
              onContinue={() => {
                setFoundPiece(null);
                engineRef.current?.setPaused(false);
              }}
              onRead={() => {
                setFoundPiece(null);
                setReaderOpen(true);
              }}
            />
          )}

          {readerOpen && (
            <LetterReader
              onClose={() => {
                setReaderOpen(false);
                engineRef.current?.setPaused(false);
              }}
            />
          )}

          {hud.dead && (
            <div className="overlay">
              <div className="overlay-card">
                <h2>You went down</h2>
                <p>
                  Back on your feet in <strong>{Math.ceil(hud.respawnIn)}</strong>&hellip;
                  <br />
                  You keep everything, including{" "}
                  <strong>
                    {hud.letterFound.length}/{hud.letterTotal}
                  </strong>{" "}
                  letter pieces.
                </p>
              </div>
            </div>
          )}

        </>
      )}
    </div>
  );
}
