import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { createUploadPostConnectionUrl } from "@/lib/providers/uploadPost";

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await createUploadPostConnectionUrl());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Connection URL failed" }, { status: 502 });
  }
}
