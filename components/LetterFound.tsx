"use client";

import { LETTER_PIECES, TOTAL_PIECES } from "@/game/letter";

interface Props {
  pieceId: number;
  found: number[];
  onContinue: () => void;
  onRead: () => void;
}

export default function LetterFound({ pieceId, found, onContinue, onRead }: Props) {
  const piece = LETTER_PIECES.find((p) => p.id === pieceId);
  const complete = found.length >= TOTAL_PIECES;

  return (
    <div className="found-overlay" onClick={complete ? undefined : onContinue}>
      <div className="found-card">
        <svg viewBox="0 0 40 52" className="found-paper" aria-hidden="true">
          <path
            d="M4 2h22l10 10v38H4z"
            fill="#fff8f9"
            stroke="#e0607e"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M26 2v10h10" fill="none" stroke="#e0607e" strokeWidth="2" />
          <path
            d="M11 22h18M11 30h18M11 38h11"
            fill="none"
            stroke="#f0a8bd"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>

        <h2>{complete ? "That's all five" : "You found a piece"}</h2>
        <p className="found-hint">{piece?.hint ?? "A piece of the letter"}</p>

        <div className="found-pips">
          {LETTER_PIECES.map((p) => (
            <span key={p.id} className={`found-pip ${found.includes(p.id) ? "on" : ""}`} />
          ))}
        </div>
        <p className="found-count">
          {found.length} of {TOTAL_PIECES} collected
        </p>

        {complete ? (
          <button className="primary" onClick={onRead}>
            Read the letter
          </button>
        ) : (
          <p className="found-tap">Tap to continue</p>
        )}
      </div>
    </div>
  );
}
