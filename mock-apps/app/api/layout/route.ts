import { db } from "@/lib/db";

// POST /api/layout?v=v2 flips the store admin to the redesigned layout mid-run.
export async function POST(req: Request) {
  const v = new URL(req.url).searchParams.get("v");
  if (v !== "v1" && v !== "v2") return Response.json({ error: "v must be v1 or v2" }, { status: 400 });
  db().storeLayout = v;
  return Response.json({ storeLayout: v });
}
