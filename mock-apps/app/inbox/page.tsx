import Link from "next/link";
import { connection } from "next/server";
import { db, day } from "@/lib/db";

export default async function Inbox() {
  await connection();
  const { emails } = db();
  return (
    <div className="inbox">
      <header className="inbox-bar"><b>Inbox</b> · support@kalyegoods.example</header>
      <ul className="mail-list">
        {emails.map((e) => (
          <li key={e.id} className={e.reply ? "read" : "unread"}>
            <Link href={`/inbox/${e.id}`}>
              <span className="from">{e.fromName}</span>
              <span className="subject">{e.subject}</span>
              {e.attachment && <span className="clip" title="Has attachment">📎</span>}
              {e.reply && <span className="tag">Replied</span>}
              <span className="date">{day(e.receivedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
