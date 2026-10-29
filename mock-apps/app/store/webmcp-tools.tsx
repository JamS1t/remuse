"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { refundOrder, replaceOrder } from "@/lib/actions";

// The store admin offers its two actions to AI agents as WebMCP tools (Chrome's early-preview API:
// navigator.modelContext, document.modelContext in newer builds). Agents call these instead of clicking.
export function WebMcpTools() {
  const router = useRouter();
  useEffect(() => {
    const mc = (document as any).modelContext ?? (navigator as any).modelContext;
    if (!mc?.registerTool) return;
    const schema = {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Order number, e.g. KG-10403" },
        reason: { type: "string", description: "Internal note saved with the order" },
      },
      required: ["order_id"],
    };
    const act = (fn: (f: FormData) => Promise<void>, verb: string) => async ({ order_id, reason }: { order_id: string; reason?: string }) => {
      const f = new FormData();
      f.set("orderId", order_id);
      f.set("reason", reason ?? "");
      await fn(f);
      router.refresh();
      return { content: [{ type: "text", text: `${verb} ${order_id}` }] };
    };
    mc.registerTool({ name: "refund_order", description: "Refund a paid order in full.", inputSchema: schema, execute: act(refundOrder, "Refunded") });
    mc.registerTool({ name: "replace_order", description: "Ship a replacement for a paid order at no charge.", inputSchema: schema, execute: act(replaceOrder, "Replacement sent for") });
    return () => { mc.unregisterTool?.("refund_order"); mc.unregisterTool?.("replace_order"); };
  }, [router]);
  return null;
}
