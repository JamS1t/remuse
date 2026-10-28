// All people, products, the store ("Kalye Goods") and the courier ("Bilis Express") are made up.

export type Email = {
  id: string;
  fromName: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
  attachment?: string; // path under /public
  reply?: { body: string; at: string };
};

export type Order = {
  id: string;
  customerName: string;
  customerEmail: string;
  placedAt: string;
  items: { name: string; qty: number; price: number }[];
  total: number;
  tracking: string;
  status: "paid" | "refunded" | "replacement_sent";
  refund?: { amount: number; reason: string; at: string };
  replacement?: { reason: string; at: string };
};

export type Shipment = {
  tracking: string;
  status: "delivered" | "in_transit" | "lost";
  events: { at: string; text: string }[];
};

// The correct outcome per email. Never rendered; used to score runs.
export type Expected = "replace" | "refund" | "lost_refund" | "decline" | "ask";

type Row = {
  name: string;
  email: string;
  product: string;
  price: number;
  orderDaysAgo: number;
  emailDaysAfter: number;
  ship: Shipment["status"];
  photo?: string;
  subject: string;
  body: string; // {order} is replaced with the order number
  expected: Expected;
};

const rows: Row[] = [
  // Hero: the one recorded by hand.
  { name: "Maria Santos", email: "maria.santos@example.com", product: "Stoneware coffee mug", price: 450, orderDaysAgo: 6, emailDaysAfter: 4, ship: "delivered", photo: "mug-cracked.svg",
    subject: "Mug arrived cracked", body: "Hi,\n\nMy order {order} came yesterday and the mug has a big crack down the side. Photo attached. Can you help?\n\nThanks,\nMaria", expected: "replace" },
  { name: "Paolo Reyes", email: "paolo.reyes@example.com", product: "Glass flower vase", price: 890, orderDaysAgo: 10, emailDaysAfter: 3, ship: "delivered", photo: "vase-broken.svg",
    subject: "Broken vase", body: "Hello, the vase from order {order} was in pieces when I opened the box. See the picture. I'd still like the vase.\n\nPaolo", expected: "replace" },
  { name: "Angela Cruz", email: "angela.cruz@example.com", product: "Brass desk lamp", price: 1650, orderDaysAgo: 3, emailDaysAfter: 2, ship: "delivered", photo: "lamp-dented.svg",
    subject: "Lamp base is dented", body: "Good day. Order {order}: the lamp base has a deep dent and it wobbles. Picture attached.\n\nRegards,\nAngela Cruz", expected: "replace" },
  { name: "Miguel Tan", email: "miguel.tan@example.com", product: "Round wall clock", price: 1200, orderDaysAgo: 18, emailDaysAfter: 2, ship: "delivered", photo: "clock-cracked.svg",
    subject: "Clock glass cracked in delivery", body: "Hi team, the wall clock (order {order}) arrived with the front glass cracked. Photo below.\n\nMiguel", expected: "replace" },
  { name: "Bea Villanueva", email: "bea.villanueva@example.com", product: "Wireless earbuds", price: 2490, orderDaysAgo: 12, emailDaysAfter: 3, ship: "delivered",
    subject: "Refund request", body: "Hi, the earbuds from order {order} don't fit my ears at all. They work fine, but I'd like my money back please.\n\nBea", expected: "refund" },
  { name: "Carlo Mendoza", email: "carlo.mendoza@example.com", product: "Canvas tote bag", price: 650, orderDaysAgo: 7, emailDaysAfter: 2, ship: "delivered", photo: "tote-intact.svg",
    subject: "Changed my mind", body: "Hello. I ordered the tote ({order}) but changed my mind. It's unused, picture attached. Can I get a refund?\n\nCarlo", expected: "refund" },
  { name: "Jasmine Lim", email: "jasmine.lim@example.com", product: "Linen throw pillow", price: 780, orderDaysAgo: 20, emailDaysAfter: 4, ship: "delivered",
    subject: "Color is different from the website", body: "Hi, the pillow from {order} is much darker than the photo on your site. I'd prefer a refund.\n\nThanks,\nJasmine", expected: "refund" },
  { name: "Rafael Garcia", email: "rafael.garcia@example.com", product: "Steel water bottle", price: 990, orderDaysAgo: 25, emailDaysAfter: 3, ship: "delivered",
    subject: "Return and refund", body: "Hi, I got the same bottle as a gift so I don't need order {order}. Please refund me.\n\nRafael", expected: "refund" },
  { name: "Liza Ramos", email: "liza.ramos@example.com", product: "Ceramic plant pot", price: 560, orderDaysAgo: 14, emailDaysAfter: 10, ship: "lost",
    subject: "Package never arrived", body: "Hello, it's been two weeks and order {order} still hasn't arrived. What happened?\n\nLiza", expected: "lost_refund" },
  { name: "Daniel Aquino", email: "daniel.aquino@example.com", product: "Bluetooth speaker", price: 1890, orderDaysAgo: 9, emailDaysAfter: 7, ship: "lost",
    subject: "Where is my order?", body: "Hi, tracking for {order} hasn't moved in days. Is my speaker lost?\n\nDaniel", expected: "lost_refund" },
  { name: "Nicole Torres", email: "nicole.torres@example.com", product: "Bamboo cutting board", price: 720, orderDaysAgo: 21, emailDaysAfter: 12, ship: "lost",
    subject: "Still waiting", body: "Good afternoon. I'm still waiting for order {order}. Please check.\n\nNicole Torres", expected: "lost_refund" },
  { name: "Joshua Bautista", email: "joshua.bautista@example.com", product: "Dotted notebook set", price: 540, orderDaysAgo: 45, emailDaysAfter: 1, ship: "delivered",
    subject: "Refund please", body: "Hi, I never used the notebooks from order {order}. Can I get a refund?\n\nJoshua", expected: "decline" },
  { name: "Kristine Flores", email: "kristine.flores@example.com", product: "Clear phone case", price: 390, orderDaysAgo: 40, emailDaysAfter: 1, ship: "delivered", photo: "case-scratched.svg",
    subject: "Phone case is scratched", body: "Hi, my phone case from {order} is badly scratched, see photo. I want a new one.\n\nKristine", expected: "decline" },
  // Outside the spoken rules: the wrong item was shipped. Showrun should stop and ask on the first one.
  { name: "Mark dela Cruz", email: "mark.delacruz@example.com", product: "Over-ear headphones", price: 3200, orderDaysAgo: 5, emailDaysAfter: 1, ship: "delivered",
    subject: "WRONG ITEM. Again??", body: "I ordered HEADPHONES. Order {order}. You sent me a PLANT POT. This is ridiculous. Fix this today or I'm posting about it everywhere.\n\nMark", expected: "ask" },
  { name: "Trisha Navarro", email: "trisha.navarro@example.com", product: "Manual coffee grinder", price: 1450, orderDaysAgo: 8, emailDaysAfter: 2, ship: "delivered",
    subject: "Received the wrong product", body: "Hi, I ordered a coffee grinder ({order}) but the box had a picture frame inside. Can you send the right item?\n\nTrisha", expected: "ask" },
];

const DAY = 86_400_000;

export function buildSeed(now = Date.now()) {
  const emails: Email[] = [];
  const orders: Order[] = [];
  const shipments: Shipment[] = [];
  const expected: Record<string, Expected> = {};

  rows.forEach((r, i) => {
    const n = i + 1;
    const orderId = `KG-${10400 + n}`;
    const tracking = `BX${(782000 + n * 137).toString()}PH`;
    const emailId = `m${String(n).padStart(3, "0")}`;
    const placed = now - r.orderDaysAgo * DAY;
    const emailAt = Math.min(placed + r.emailDaysAfter * DAY, now - 3_600_000);

    orders.push({
      id: orderId, customerName: r.name, customerEmail: r.email,
      placedAt: new Date(placed).toISOString(),
      items: [{ name: r.product, qty: 1, price: r.price }],
      total: r.price + 120, // flat shipping fee
      tracking, status: "paid",
    });

    const events = [
      { at: new Date(placed + 0.2 * DAY).toISOString(), text: "Picked up from seller" },
      { at: new Date(placed + 1 * DAY).toISOString(), text: "Arrived at Pasig hub" },
    ];
    if (r.ship === "delivered") events.push({ at: new Date(placed + 2 * DAY).toISOString(), text: "Delivered, received by recipient" });
    if (r.ship === "lost") events.push({ at: new Date(placed + 3 * DAY).toISOString(), text: "Parcel reported lost in transit. Claim opened." });
    shipments.push({ tracking, status: r.ship, events: events.reverse() });

    emails.push({
      id: emailId, fromName: r.name, from: r.email, subject: r.subject,
      body: r.body.replaceAll("{order}", orderId),
      receivedAt: new Date(emailAt).toISOString(),
      attachment: r.photo ? `/attachments/${r.photo}` : undefined,
    });
    expected[emailId] = r.expected;
  });

  emails.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return { emails, orders, shipments, expected };
}
