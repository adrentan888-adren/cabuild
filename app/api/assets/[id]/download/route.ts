import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { readDb } from "@/lib/store";

function filename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "generated-video";
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await readDb();
  const asset = db.assets.find((item) => item.id === params.id && item.workspaceId === user.workspaceId);
  if (!asset?.assetUrl) return NextResponse.json({ error: "Asset file is not ready" }, { status: 404 });

  const name = `${filename(asset.title)}.${asset.type === "video" || asset.type === "ugc" ? "mp4" : asset.type === "text" ? "txt" : "bin"}`;
  if (asset.assetUrl.startsWith("data:")) {
    const [meta, payload] = asset.assetUrl.split(",", 2);
    const mime = meta.match(/^data:([^;]+)/)?.[1] || "application/octet-stream";
    const body = decodeURIComponent(payload || "");
    return new Response(body, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${name}"`
      }
    });
  }

  const response = await fetch(asset.assetUrl);
  if (!response.ok || !response.body) return NextResponse.json({ error: "Could not fetch generated asset" }, { status: 502 });

  return new Response(response.body, {
    headers: {
      "Content-Type": asset.type === "video" || asset.type === "ugc" ? "video/mp4" : response.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`
    }
  });
}
