"use client";

import { useRef, useState } from "react";
import Icon from "./Icon";

const STICK_RADIUS = 54;

interface Props {
  onMove: (x: number, y: number) => void;
  onPickup: () => void;
  onAim: (x: number, y: number) => void;
  onReload: () => void;
  onHeal: () => void;
  medKits: number;
  pickupLabel: string | null;
  pickupBlocked: boolean;
  canJump: boolean;
  onJump: () => void;
  airborne: boolean;
  ammo: { mag: number; reserve: number; reloading: boolean } | null;
}

function Stick({
  className,
  hint,
  onVector,
}: {
  className: string;
  hint: string;
  onVector: (x: number, y: number) => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const track = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, STICK_RADIUS);
    const nx = dist > 0 ? (dx / dist) * clamped : 0;
    const ny = dist > 0 ? (dy / dist) * clamped : 0;
    setKnob({ x: nx, y: ny });
    onVector(nx / STICK_RADIUS, ny / STICK_RADIUS);
  };

  const release = () => {
    pointerId.current = null;
    setKnob({ x: 0, y: 0 });
    onVector(0, 0);
  };

  const pushed = Math.hypot(knob.x, knob.y) / STICK_RADIUS;

  return (
    <div
      ref={baseRef}
      className={`${className} ${pushed > 0.85 ? "sprinting" : ""}`}
      onPointerDown={(e) => {
        pointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        track(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (pointerId.current !== e.pointerId) return;
        track(e.clientX, e.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className="stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      <span className="stick-hint">{pushed > 0.85 ? hint : ""}</span>
    </div>
  );
}

export default function TouchControls({
  onMove,
  onPickup,
  onAim,
  onReload,
  onHeal,
  medKits,
  pickupLabel,
  pickupBlocked,
  canJump,
  onJump,
  airborne,
  ammo,
}: Props) {
  const empty = ammo !== null && ammo.mag === 0;

  return (
    <div className="touch-layer">
      <Stick className="stick-base" hint="SPRINT" onVector={onMove} />

      {!airborne && (
        <Stick
          className={`stick-base aim-stick ${empty ? "empty" : ""}`}
          hint="FIRE"
          onVector={onAim}
        />
      )}

      {airborne ? (
        <div className="action-cluster">
          {canJump && (
            <button
              className="jump-button"
              onPointerDown={(e) => {
                e.preventDefault();
                onJump();
              }}
            >
              <span className="jump-glyph" aria-hidden="true" />
              <span className="fire-label">JUMP</span>
            </button>
          )}
        </div>
      ) : (
        <div className="action-cluster">
        <button
          className={`mini-button ${pickupLabel ? "ready" : ""} ${pickupBlocked ? "blocked" : ""}`}
          onPointerDown={(e) => {
            e.preventDefault();
            onPickup();
          }}
        >
          <span className="mini-icon"><Icon name="hand" size={19} /></span>
          <span className="mini-label">{pickupLabel ? "Grab" : "—"}</span>
        </button>

        <button
          className="mini-button"
          onPointerDown={(e) => {
            e.preventDefault();
            onReload();
          }}
        >
          <span className="mini-icon"><Icon name="reload" size={19} /></span>
          <span className="mini-label">Reload</span>
        </button>

        <button
          className={`mini-button heal ${medKits > 0 ? "ready" : ""}`}
          onPointerDown={(e) => {
            e.preventDefault();
            onHeal();
          }}
        >
          <span className="mini-icon"><Icon name="medkit" size={19} /></span>
          <span className="mini-label">Heal</span>
          {medKits > 0 && <b className="mini-badge">{medKits}</b>}
        </button>

        </div>
      )}
    </div>
  );
}
