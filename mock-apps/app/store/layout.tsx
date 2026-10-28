import Link from "next/link";
import { connection } from "next/server";
import { db } from "@/lib/db";

// v1: dark sidebar. v2: redesigned top bar. Same data, different markup and labels.
export default async function StoreLayout({ children }: LayoutProps<"/store">) {
  await connection();
  const v2 = db().storeLayout === "v2";
  return v2 ? (
    <div className="store2">
      <nav className="store2-top">
        <span className="brand">KALYE GOODS · Seller Hub</span>
        <Link href="/store">Order list</Link>
      </nav>
      <main>{children}</main>
    </div>
  ) : (
    <div className="store">
      <aside className="store-side">
        <div className="brand">Kalye Goods</div>
        <Link href="/store">Orders</Link>
        <span className="disabled">Products</span>
        <span className="disabled">Customers</span>
      </aside>
      <main className="store-main">{children}</main>
    </div>
  );
}
