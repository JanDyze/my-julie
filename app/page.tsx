import Link from "next/link";
import Icon from "@/components/Icon";

export default function Home() {
  return (
    <main className="hub">
      <p className="hub-hello">Made for you</p>
      <h1>Hi Julie</h1>
      <p className="hub-sub">
        This is your own little app. Right now there&apos;s an island to explore and loot — more
        rooms will get built in here over time.
      </p>

      <div className="card-grid">
        <Link href="/game" className="card">
          <span className="card-emoji"><Icon name="plane" size={30} /></span>
          <h2>Loot Island</h2>
          <p>
            Drop onto a 2D island, run through houses, grab everything you can carry, and outrun the
            shrinking circle.
          </p>
          <span className="badge">Play now</span>
        </Link>

      </div>

    </main>
  );
}
