import { reset } from "@/lib/db";

export async function POST() {
  reset();
  return Response.json({ ok: true });
}
