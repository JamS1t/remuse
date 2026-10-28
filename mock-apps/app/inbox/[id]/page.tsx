import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db, day } from "@/lib/db";
import { sendReply } from "@/lib/actions";

export default async function EmailPage({ params }: PageProps<"/inbox/[id]">) {
  await connection();
  const { id } = await params;
  const e = db().emails.find((x) => x.id === id);
  if (!e) notFound();
  return (
    <div className="inbox">
      <header className="inbox-bar"><Link href="/inbox">← Inbox</Link></header>
      <article className="mail">
        <h1>{e.subject}</h1>
        <p className="meta">From <b>{e.fromName}</b> &lt;{e.from}&gt; · {day(e.receivedAt)}</p>
        <div className="mail-body">{e.body}</div>
        {e.attachment && (
          <figure className="attachment">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={e.attachment} alt="Customer photo attachment" width={400} height={300} />
            <figcaption>{e.attachment.split("/").pop()}</figcaption>
          </figure>
        )}
      </article>
      <section className="reply">
        {e.reply ? (
          <>
            <h2>Your reply · {day(e.reply.at)}</h2>
            <div className="mail-body">{e.reply.body}</div>
          </>
        ) : (
          <form action={sendReply}>
            <input type="hidden" name="emailId" value={e.id} />
            <label htmlFor="reply-body">Reply to {e.fromName}</label>
            <textarea id="reply-body" name="body" rows={6} required />
            <button type="submit">Send reply</button>
          </form>
        )}
      </section>
    </div>
  );
}
