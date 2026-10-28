// Run: node lib/check-seed.ts
// Applies the spoken rules from the demo to the seed and checks each email's expected outcome.
import assert from "node:assert/strict";
import { buildSeed } from "./seed.ts";

const DAY = 86_400_000;
const now = Date.now();
const { emails, orders, shipments, expected } = buildSeed(now);
assert.equal(emails.length, 15);

for (const e of emails) {
  const orderId = e.body.match(/KG-\d+/)?.[0];
  const o = orders.find((x) => x.id === orderId);
  assert.ok(o, `${e.id}: order not found in body`);
  const ship = shipments.find((s) => s.tracking === o.tracking)!;
  const days = (now - Date.parse(o.placedAt)) / DAY;
  const damage = !!e.attachment && !e.attachment.includes("intact");

  // Rule order from the Task Spec: lost, then over 30 days, then damage, else refund.
  const ruled = ship.status === "lost" ? "lost_refund" : days > 30 ? "decline" : damage ? "replace" : "refund";
  if (expected[e.id] === "ask") {
    assert.match(e.subject + e.body, /wrong/i, `${e.id}: ask case should be a wrong-item email`);
  } else {
    assert.equal(ruled, expected[e.id], `${e.id}: rules say ${ruled}, seed expects ${expected[e.id]}`);
  }
}
console.log("seed ok:", Object.values(expected).reduce<Record<string, number>>((m, v) => ((m[v] = (m[v] ?? 0) + 1), m), {}));
