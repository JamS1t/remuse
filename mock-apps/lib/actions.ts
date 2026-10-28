"use server";

import { revalidatePath } from "next/cache";
import { db, log } from "./db";

// Mock apps on localhost: no auth on purpose. Never deploy these publicly.

export async function sendReply(formData: FormData) {
  const email = db().emails.find((e) => e.id === formData.get("emailId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!email || !body) return;
  email.reply = { body, at: new Date().toISOString() };
  log("inbox", "send_reply", `${email.id} to ${email.from}`);
  revalidatePath("/", "layout");
}

export async function refundOrder(formData: FormData) {
  const order = db().orders.find((o) => o.id === formData.get("orderId"));
  if (!order || order.status !== "paid") return;
  const reason = String(formData.get("reason") ?? "").trim() || "No reason given";
  order.status = "refunded";
  order.refund = { amount: order.total, reason, at: new Date().toISOString() };
  log("store", "refund", `${order.id} ${order.total} (${reason})`);
  revalidatePath("/", "layout");
}

export async function replaceOrder(formData: FormData) {
  const order = db().orders.find((o) => o.id === formData.get("orderId"));
  if (!order || order.status !== "paid") return;
  const reason = String(formData.get("reason") ?? "").trim() || "No reason given";
  order.status = "replacement_sent";
  order.replacement = { reason, at: new Date().toISOString() };
  log("store", "replace", `${order.id} (${reason})`);
  revalidatePath("/", "layout");
}
