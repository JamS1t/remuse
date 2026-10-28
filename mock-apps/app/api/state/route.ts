import { db } from "@/lib/db";

// Full mock state, including the expected outcome per email. For scoring runs, not for the agent.
export async function GET() {
  return Response.json(db());
}
