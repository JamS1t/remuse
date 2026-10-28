import Link from "next/link";
import { notFound } from "next/navigation";
import { db, day, peso } from "@/lib/db";
import { refundOrder, replaceOrder } from "@/lib/actions";

export default async function OrderPage({ params }: PageProps<"/store/orders/[id]">) {
  const { id } = await params;
  const { orders, storeLayout } = db();
  const o = orders.find((x) => x.id === id);
  if (!o) notFound();

  const done =
    o.refund ? `Refunded ${peso(o.refund.amount)} on ${day(o.refund.at)}: ${o.refund.reason}`
    : o.replacement ? `Replacement sent on ${day(o.replacement.at)}: ${o.replacement.reason}`
    : null;

  const items = o.items.map((i) => (
    <li key={i.name}>{i.qty} × {i.name} · {peso(i.price)}</li>
  ));

  if (storeLayout === "v2") {
    // Redesign: actions on top, different labels, one shared note field.
    return (
      <div className="detail2">
        {done ? <p className="banner">{done}</p> : (
          <div className="resolve">
            <span>Resolve this order</span>
            <form>
              <input type="hidden" name="orderId" value={o.id} />
              <input name="reason" placeholder="Internal note" aria-label="Internal note" />
              <button formAction={replaceOrder} className="ghost">Ship a new one</button>
              <button formAction={refundOrder} className="danger">Issue refund ({peso(o.total)})</button>
            </form>
          </div>
        )}
        <h1>{o.id}</h1>
        <dl className="grid2">
          <dt>Ordered on</dt><dd>{day(o.placedAt)}</dd>
          <dt>Buyer</dt><dd>{o.customerName} · {o.customerEmail}</dd>
          <dt>Courier ref</dt><dd>{o.tracking}</dd>
          <dt>Amount paid</dt><dd>{peso(o.total)}</dd>
        </dl>
        <ul>{items}</ul>
      </div>
    );
  }

  return (
    <>
      <p><Link href="/store">← Orders</Link></p>
      <h1>Order {o.id}</h1>
      <table className="kv">
        <tbody>
          <tr><th>Order date</th><td>{day(o.placedAt)}</td></tr>
          <tr><th>Customer</th><td>{o.customerName}</td></tr>
          <tr><th>Email</th><td>{o.customerEmail}</td></tr>
          <tr><th>Tracking number</th><td>{o.tracking}</td></tr>
          <tr><th>Total</th><td>{peso(o.total)}</td></tr>
        </tbody>
      </table>
      <h2>Items</h2>
      <ul>{items}</ul>
      <h2>Actions</h2>
      {done ? <p className="banner">{done}</p> : (
        <div className="actions">
          <form action={refundOrder}>
            <input type="hidden" name="orderId" value={o.id} />
            <input name="reason" placeholder="Refund reason" aria-label="Refund reason" />
            <button type="submit">Refund</button>
          </form>
          <form action={replaceOrder}>
            <input type="hidden" name="orderId" value={o.id} />
            <input name="reason" placeholder="Replacement reason" aria-label="Replacement reason" />
            <button type="submit">Replace</button>
          </form>
        </div>
      )}
    </>
  );
}
