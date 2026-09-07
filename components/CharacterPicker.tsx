"use client";

import { useEffect, useRef } from "react";
import { CHARACTERS, SkinId, characterFor } from "@/game/characters";

function Preview({ skin }: { skin: SkinId }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 54;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    // Face down-screen so the picker reads like a portrait.
    ctx.rotate(Math.PI / 2);
    characterFor(skin).draw(ctx, 17);
    ctx.restore();
  }, [skin]);

  return <canvas ref={ref} className="skin-preview" style={{ width: 54, height: 54 }} />;
}

interface Props {
  value: SkinId;
  onChange: (skin: SkinId) => void;
}

export default function CharacterPicker({ value, onChange }: Props) {
  return (
    <div className="skin-picker">
      <span className="roster-title">Choose your character</span>
      <div className="skin-grid">
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            className={`skin-option ${value === c.id ? "selected" : ""}`}
            onClick={() => onChange(c.id)}
            aria-pressed={value === c.id}
          >
            <Preview skin={c.id} />
            <span className="skin-name">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
