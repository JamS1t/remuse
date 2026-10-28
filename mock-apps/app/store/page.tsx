import Link from "next/link";
import { db, day, peso } from "@/lib/db";

const STATUS = { paid: "Paid", refunded: "Refunded", replacement_sent: "Replacement sent" } as const;

export default async function Orders({ searchParams }: PageProps<"/store">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const needle = query.toLowerCase();
  const { orders, storeLayout } = db();
  const shown = query
    ? orders.filter((o) => [o.id, o.customerName, o.customerEmail].some((f) => f.toLowerCase().includes(needle)))
    : orders;

  if (storeLayout === "v2") {
    return (
      <>
        <form className="store2-search" role="search">
          <input name="q" defaultValue={query} placeholder="Find an order (KG-…, name, email)" aria-label="Find an order" />
          <button type="submit">Find</button>
        </form>
        <div className="cards">
          {shown.map((o) => (
            <Link key={o.id} href={`/store/orders/${o.id}`} className="card">
              <div className="card-id">{o.id}</div>
              <div>{o.customerName}</div>
              <div className="muted">{o.items[0].name}</div>
              <div className="card-foot">
                <span>{peso(o.total)}</span>
                <span className={`pill ${o.status}`}>{STATUS[o.status]}</span>
              </div>
            </Link>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Orders</h1>
      <form className="search">
        <input name="q" defaultValue={query} placeholder="Search order number, customer or email" aria-label="Search orders" />
        <button type="submit">Search</button>
      </form>
      <table className="orders">
        <thead>
          <tr><th>Order</th><th>Date</th><th>Customer</th><th>Item</th><th>Total</th><th>Status</th></tr>
        </thead>
        <tbody>
          {shown.map((o) => (
            <tr key={o.id}>
              <td><Link href={`/store/orders/${o.id}`}>{o.id}</Link></td>
              <td>{day(o.placedAt)}</td>
              <td>{o.customerName}</td>
              <td>{o.items[0].name}</td>
              <td>{peso(o.total)}</td>
              <td>{STATUS[o.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="muted">No orders match “{query}”.</p>}
    </>
  );
}
