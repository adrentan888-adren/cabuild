import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json({ ok: true, service: "product-video-studio-staging" });
}
