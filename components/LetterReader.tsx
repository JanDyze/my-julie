"use client";

import { LETTER_PIECES, LETTER_SIGNOFF, LETTER_TITLE } from "@/game/letter";

export default function LetterReader({ onClose }: { onClose: () => void }) {
  return (
    <div className="letter-overlay">
      <article className="letter-sheet">
        <header className="letter-head">
          <svg viewBox="0 0 48 32" className="letter-seal" aria-hidden="true">
            <path
              d="M4 6h40v20H4z"
              fill="#fff"
              stroke="#e0607e"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M4 6l20 13L44 6" fill="none" stroke="#e0607e" strokeWidth="1.5" />
          </svg>
          <h1>{LETTER_TITLE}</h1>
        </header>

        <div className="letter-body">
          {LETTER_PIECES.map((piece) => (
            <p key={piece.id}>{piece.text}</p>
          ))}
        </div>

        <footer className="letter-foot">
          <span>{LETTER_SIGNOFF}</span>
        </footer>

        <button className="primary" onClick={onClose}>
          Close
        </button>
      </article>
    </div>
  );
}
