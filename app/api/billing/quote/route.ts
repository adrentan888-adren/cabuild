import { NextResponse } from "next/server";
import { quoteBillingAction } from "@/lib/billing";
import { readDb } from "@/lib/store";
import { currentUser } from "@/lib/session";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json() as Record<string, unknown>;
  const db = await readDb();
  try {
    const quote = quoteBillingAction(db, { ...body, workspaceId: user.workspaceId });
    return NextResponse.json({ ok: true, quote });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not quote billing action." }, { status: 400 });
  }
}
