import { NextResponse } from "next/server";

const allowedHosts = [
  "cdninstagram.com",
  "fbcdn.net"
];

function allowedUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = allowedUrl(searchParams.get("url") || "");
  if (!target) return NextResponse.json({ error: "Unsupported media URL" }, { status: 400 });

  const upstream = await fetch(target.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
    },
    cache: "no-store"
  });
  if (!upstream.ok) return NextResponse.json({ error: `Media fetch failed with HTTP ${upstream.status}` }, { status: 502 });

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  if (!contentType.startsWith("image/")) return NextResponse.json({ error: "Unsupported media type" }, { status: 415 });

  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600"
    }
  });
}
