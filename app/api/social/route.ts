import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { id, mutateDb } from "@/lib/store";
import type { Asset, Platform, PublishItem } from "@/lib/types";
import { fetchTrendSignals } from "@/lib/providers/apify";
import { generateVeoVideo, getVeoVideo } from "@/lib/providers/kie";
import { publishTextPost, publishVideoPost } from "@/lib/providers/uploadPost";

async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return unauthorized();
  }
  const body = await req.json();
  const action = body.action as string;
  const workspaceId = user.workspaceId;

  if (action === "refreshTrends") {
    try {
      const dbResult = await mutateDb(async (db) => {
        const workspace = db.workspaces.find((item) => item.id === workspaceId);
        const signals = await fetchTrendSignals(workspace?.niche || "SME AI automation");
        const created = signals.map((signal, index) => {
          const score = 78 + Math.min(12, index * 2);
          const opp = {
            id: id("opp"),
            workspaceId,
            topic: signal.title,
            platform: "LinkedIn" as Platform,
            format: "Text post",
            gapScore: score,
            trendVelocity: 16,
            competitorGap: 15,
            nicheRelevance: 17,
            engagementPotential: 15,
            platformFit: 15,
            status: "new" as const
          };
          db.opportunities.push(opp);
          return opp;
        });
        db.activity.push({ id: id("act"), workspaceId, message: `Apify refreshed ${created.length} trend signals.`, createdAt: new Date().toISOString() });
        return created;
      });
      return NextResponse.json(dbResult);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Apify refresh failed" }, { status: 502 });
    }
  }

  if (action === "pollAsset") {
    try {
      const updated = await mutateDb(async (db) => {
        const asset = db.assets.find((item) => item.id === body.id && item.workspaceId === workspaceId);
        if (!asset?.providerTaskId) throw new Error("Asset has no provider task to poll.");
        const status = await getVeoVideo(asset.providerTaskId);
        if (status.successFlag === 1 && status.assetUrl) {
          asset.status = "ready";
          asset.progress = 100;
          asset.assetUrl = status.assetUrl;
          asset.error = "";
          db.activity.push({ id: id("act"), workspaceId, message: `Kie video ready for "${asset.title}".`, createdAt: new Date().toISOString() });
        } else if (status.successFlag === 2 || status.successFlag === 3) {
          asset.status = "failed";
          asset.error = status.error || "Kie generation failed.";
        } else {
          asset.status = "rendering";
          asset.progress = Math.max(asset.progress, 45);
        }
        return asset;
      });
      return NextResponse.json(updated);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Kie poll failed" }, { status: 502 });
    }
  }

  if (action === "publishNow") {
    try {
      const snapshot = await mutateDb((db) => {
        const item = db.publishQueue.find((queue) => queue.id === body.id && queue.workspaceId === workspaceId);
        if (!item) throw new Error("Publish queue item not found.");
        return { item, asset: db.assets.find((asset) => asset.id === item.assetId && asset.workspaceId === workspaceId) };
      });
      const result = snapshot.asset?.assetUrl
        ? await publishVideoPost({
            title: snapshot.item.title,
            description: snapshot.asset?.prompt,
            platform: snapshot.item.platform,
            videoUrl: snapshot.asset.assetUrl
          })
        : await publishTextPost({
            title: snapshot.item.title,
            description: snapshot.asset?.prompt,
            platform: snapshot.item.platform
          });
      const updated = await mutateDb((db) => {
        const item = db.publishQueue.find((queue) => queue.id === body.id && queue.workspaceId === workspaceId);
        if (!item) return snapshot.item;
        item.status = "published";
        item.provider = "upload-post";
        item.providerRequestId = result.request_id;
        item.error = "";
        db.activity.push({ id: id("act"), workspaceId, message: `Upload-Post accepted "${item.title}".`, createdAt: new Date().toISOString() });
        return item;
      });
      return NextResponse.json(updated);
    } catch (error) {
      const updated = await mutateDb((db) => {
        const item = db.publishQueue.find((queue) => queue.id === body.id && queue.workspaceId === workspaceId);
        if (!item) return null;
        item.status = "failed";
        item.provider = "upload-post";
        item.error = error instanceof Error ? error.message : "Upload-Post publish failed";
        db.activity.push({ id: id("act"), workspaceId, message: `Upload-Post failed: ${item.error}`, createdAt: new Date().toISOString() });
        return item;
      });
      return NextResponse.json(updated || { error: "Publish failed" }, { status: 502 });
    }
  }

  const data = await mutateDb((db) => {
    const activity = (message: string) => db.activity.push({ id: id("act"), workspaceId, message, createdAt: new Date().toISOString() });

    if (action === "addCompetitor") {
      const item = { id: id("cmp"), workspaceId, platform: body.platform as Platform, handle: body.handle as string, cadence: body.cadence || "weekly", lastScraped: new Date().toISOString() };
      db.competitors.push(item);
      activity(`Added ${item.handle} to ${item.platform} competitor monitoring.`);
      return item;
    }

    if (action === "dismissOpportunity") {
      const item = db.opportunities.find((opp) => opp.id === body.id && opp.workspaceId === workspaceId);
      if (item) item.status = "dismissed";
      activity("Opportunity dismissed.");
      return item;
    }

    if (action === "generateOpportunity") {
      const opp = db.opportunities.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!opp) return null;
      opp.status = "briefed";
      const brief = {
        id: id("brf"),
        workspaceId,
        opportunityId: opp.id,
        topic: opp.topic,
        format: opp.format,
        platforms: [opp.platform],
        hooks: [
          `The smartest ${db.workspaces.find((ws) => ws.id === workspaceId)?.niche || "teams"} are already acting on this.`,
          `This is the gap your competitors are leaving open.`,
          `Most brands will notice this trend too late.`
        ],
        outline: ["State the market shift", "Show the competitor gap", "Give a concrete example", "Close with a practical CTA"],
        caption: `A high-priority content gap is opening around ${opp.topic.toLowerCase()}. This post is designed to explain it before the market gets crowded.`,
        hashtags: ["#ContentStrategy", "#SocialMedia", "#AI"],
        optimalTime: "Thu 10:00 AM",
        expectedPerformance: `${(opp.gapScore / 20).toFixed(1)}-${(opp.gapScore / 16).toFixed(1)}% engagement`,
        status: "new" as const
      };
      db.briefs.push(brief);
      const ws = db.workspaces.find((item) => item.id === workspaceId);
      if (ws) ws.credits = Math.max(0, ws.credits - 1);
      activity(`Generated brief for "${opp.topic}".`);
      return brief;
    }

    if (action === "approveBrief") {
      const brief = db.briefs.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (brief) brief.status = "approved";
      activity("Brief approved for production.");
      return brief;
    }

    if (action === "renderAsset") {
      const brief = db.briefs.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!brief) return null;
      brief.status = "production";
      const type: Asset["type"] = brief.format.toLowerCase().includes("video") ? "video" : brief.format.toLowerCase().includes("carousel") ? "carousel" : "image";
      const prompt = `${brief.topic}. ${brief.outline.join(". ")} Style: authentic vertical social video for ${brief.platforms.join(", ")}.`;
      const asset: Asset = { id: id("ast"), workspaceId, briefId: brief.id, title: brief.topic, type, status: type === "video" ? "queued" : "ready", progress: type === "video" ? 10 : 100, createdAt: new Date().toISOString(), provider: type === "video" ? "kie" : "local", prompt };
      db.assets.push(asset);
      const ws = db.workspaces.find((item) => item.id === workspaceId);
      if (ws) ws.credits = Math.max(0, ws.credits - (type === "video" ? 8 : type === "carousel" ? 3 : 1));
      activity(type === "video" ? "Queued Kie video generation from approved brief." : `Rendered ${type} asset from approved brief.`);
      return asset;
    }

    if (action === "scheduleAsset") {
      const asset = db.assets.find((item) => item.id === body.id && item.workspaceId === workspaceId);
      if (!asset) return null;
      const item: PublishItem = { id: id("pub"), workspaceId, assetId: asset.id, title: asset.title, platform: body.platform as Platform, scheduledAt: body.scheduledAt || new Date(Date.now() + 86400000).toISOString(), status: "scheduled" };
      db.publishQueue.push(item);
      activity(`Scheduled "${asset.title}" for ${item.platform}.`);
      return item;
    }

    if (action === "updateBrandKit") {
      const kit = db.brandKits.find((item) => item.workspaceId === workspaceId);
      if (kit) Object.assign(kit, body.brandKit);
      activity("Brand kit updated.");
      return kit;
    }

    if (action === "generateUgc") {
      const product = String(body.product || "UGC video");
      const sellingPoints = String(body.sellingPoints || "");
      const style = String(body.style || "Talking Head");
      const prompt = `${style} UGC vertical social video for ${product}. Selling points: ${sellingPoints}. Natural creator tone, clear captions, product benefit demonstration.`;
      const asset = { id: id("ast"), workspaceId, briefId: "ugc", title: product, type: "ugc" as const, status: "queued" as const, progress: 10, createdAt: new Date().toISOString(), provider: "kie" as const, prompt };
      db.assets.push(asset);
      const ws = db.workspaces.find((item) => item.id === workspaceId);
      if (ws) ws.credits = Math.max(0, ws.credits - (body.duration === "60" ? 25 : 15));
      activity(`Queued UGC video generation for ${asset.title}.`);
      return asset;
    }

    return null;
  });

  if (!data) return NextResponse.json({ error: "Action failed" }, { status: 400 });

  if ((action === "renderAsset" || action === "generateUgc") && (data as Asset).provider === "kie") {
    try {
      const taskId = await generateVeoVideo((data as Asset).prompt || (data as Asset).title);
      const updated = await mutateDb((db) => {
        const asset = db.assets.find((item) => item.id === (data as Asset).id && item.workspaceId === workspaceId);
        if (!asset) return data;
        asset.status = "rendering";
        asset.progress = 35;
        asset.providerTaskId = taskId;
        db.activity.push({ id: id("act"), workspaceId, message: `Kie task started: ${taskId}`, createdAt: new Date().toISOString() });
        return asset;
      });
      return NextResponse.json(updated);
    } catch (error) {
      const updated = await mutateDb((db) => {
        const asset = db.assets.find((item) => item.id === (data as Asset).id && item.workspaceId === workspaceId);
        if (!asset) return data;
        asset.status = "failed";
        asset.error = error instanceof Error ? error.message : "Kie generation failed";
        return asset;
      });
      return NextResponse.json(updated, { status: 502 });
    }
  }

  return NextResponse.json(data);
}
