import Link from "next/link";
import { connection } from "next/server";
import { db, day } from "@/lib/db";

const LABEL = { delivered: "Delivered", in_transit: "In transit", lost: "Lost" } as const;

export default async function Tracking({ params }: PageProps<"/courier/[tracking]">) {
  await connection();
  const { tracking } = await params;
  const tn = decodeURIComponent(tracking);
  const s = db().shipments.find((x) => x.tracking === tn);
  return (
    <div className="courier">
      <header className="courier-bar">BILIS EXPRESS</header>
      <main>
        <p><Link href="/courier">← Track another parcel</Link></p>
        {!s ? <p>No parcel found for <b>{tn}</b>.</p> : (
          <>
            <h1>{s.tracking}</h1>
            <p className={`status ${s.status}`}>Status: <b>{LABEL[s.status]}</b></p>
            <ol className="events">
              {s.events.map((ev) => <li key={ev.at}><span>{day(ev.at)}</span> {ev.text}</li>)}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}
