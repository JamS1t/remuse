import Link from "next/link";

export default function Home() {
  return (
    <main className="home">
      <h1>Showrun mock apps</h1>
      <p>Three fake apps for the demo. All data is made up and lives in memory.</p>
      <ul>
        <li><Link href="/inbox">Inbox</Link>: customer emails</li>
        <li><Link href="/store">Kalye Goods admin</Link>: orders, refunds, replacements</li>
        <li><Link href="/courier">Bilis Express tracker</Link>: delivery status</li>
      </ul>
      <p className="muted">
        Reset: <code>POST /api/reset</code> · Redesign the store: <code>POST /api/layout?v=v2</code> ·
        State: <code>GET /api/state</code>
      </p>
    </main>
  );
}
