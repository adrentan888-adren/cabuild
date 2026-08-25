import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const allowedMediaHosts = ["aiquickdraw.com", "kie.ai"];

const isAllowedHost = (hostname: string) =>
  allowedMediaHosts.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );

async function fetchApprovedMedia(initialUrl: URL) {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    if (currentUrl.protocol !== "https:" || !isAllowedHost(currentUrl.hostname)) {
      throw new Error("unapproved_host");
    }
    const response = await fetch(currentUrl, { redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    currentUrl = new URL(location, currentUrl);
  }
  throw new Error("too_many_redirects");
}

export async function GET(request: NextRequest) {
  if (!await currentUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "A media URL is required." }, { status: 400 });
  }

  let mediaUrl: URL;
  try {
    mediaUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "The media URL is invalid." }, { status: 400 });
  }
  if (mediaUrl.protocol !== "https:" || !isAllowedHost(mediaUrl.hostname)) {
    return NextResponse.json(
      { error: "This media host is not approved for episode assembly." },
      { status: 403 },
    );
  }

  try {
    const upstream = await fetchApprovedMedia(mediaUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `The generated clip returned HTTP ${upstream.status}.` },
        { status: 502 },
      );
    }
    const contentType = upstream.headers.get("content-type") || "video/mp4";
    if (!contentType.startsWith("video/") && contentType !== "application/octet-stream") {
      return NextResponse.json(
        { error: "The generated clip URL did not return video data." },
        { status: 502 },
      );
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "The generated clip could not be downloaded for assembly." },
      { status: 502 },
    );
  }
}
