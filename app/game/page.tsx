import Link from "next/link";
import Game from "@/components/Game";

export default function GamePage() {
  return (
    <main className="game-page">
      <Link href="/" className="game-exit">
        ← Back
      </Link>
      <Game />
    </main>
  );
}
