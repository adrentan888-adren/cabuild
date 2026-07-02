import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    surface: process.env.APP_SURFACE || "combined"
  });
}
