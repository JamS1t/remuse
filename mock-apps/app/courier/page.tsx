import { redirect } from "next/navigation";

export default async function Courier({ searchParams }: PageProps<"/courier">) {
  const { tn } = await searchParams;
  if (typeof tn === "string" && tn.trim()) redirect(`/courier/${encodeURIComponent(tn.trim().toUpperCase())}`);
  return (
    <div className="courier">
      <header className="courier-bar">BILIS EXPRESS</header>
      <main>
        <h1>Track your parcel</h1>
        <form className="track">
          <input name="tn" placeholder="Tracking number, e.g. BX782137PH" aria-label="Tracking number" />
          <button type="submit">Track</button>
        </form>
      </main>
    </div>
  );
}
