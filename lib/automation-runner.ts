import { id, mutateDb } from "@/lib/store";
import type { Asset, AutomationRule, AutomationJob, PublishItem } from "@/lib/types";
import { nextScheduledRun } from "@/lib/automation-schedule";
import { generateContentPlanWithGemini, generateContentPlanWithGpt55, generateImage, generateSeedanceVideo, generateVeoVideo } from "@/lib/providers/kie";
import { appendPersonaContext, buildPersonaContext } from "@/lib/persona";
function normalizeIdeaText(value: string) {
  const stopWords = new Set(["the", "and", "or", "a", "an", "to", "for", "of", "in", "on", "with", "from", "by", "is", "are", "be", "this", "that", "it", "as", "at", "your", "you"]);
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9#]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function ideaSimilarity(a: string, b: string) {
  const left = new Set(normalizeIdeaText(a));
  const right = new Set(normalizeIdeaText(b));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  left.forEach((word) => {
    if (right.has(word)) overlap += 1;
  });
  return overlap / (left.size + right.size - overlap);
}

function sourceOverlapScore(sourceUrls: string[], candidate: string) {
  const normalized = sourceUrls.map((url) => url.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0 || !candidate) return 0;
  const lower = candidate.toLowerCase();
  return normalized.some((url) => lower.includes(url) || url.includes(lower)) ? 1 : 0;
}

type PreparedBrief = {title:string;prompt:string;caption:string;hashtags:string[]};

async function prepareAutomationBrief(workspaceId:string,rule:AutomationRule):Promise<PreparedBrief> {
 if(rule.contentType==="text"&&rule.model!=="gemini-3.5-flash")throw new Error("This text model is not supported for Automation. Edit the automation and select Gemini 3.5 Flash.");
 const context=await mutateDb(db=>({
  persona:buildPersonaContext(db.personaProfiles.find(item=>item.workspaceId===workspaceId)),
  niche:db.workspaces.find(item=>item.id===workspaceId)?.niche||"",
  recent:db.automationJobs.filter(item=>item.workspaceId===workspaceId&&item.status!=="failed").slice(-15).map(item=>({title:item.title,caption:item.caption})),
  research:rule.researchMode==="latest-research"?(db.competitorResults||[]).filter(item=>item.workspaceId===workspaceId).slice(-10).map(item=>({title:item.title,description:item.description,url:item.url})):[]
 }));
 const idea=[rule.instruction,`Goal: ${rule.goal}. Platforms: ${rule.platforms.join(", ")}. Aspect ratio: ${rule.aspectRatio}.`,
  rule.keywords.length?`Keywords: ${rule.keywords.join(", ")}`:"",
  rule.sourceUrls.length?`Reference URLs: ${rule.sourceUrls.join(", ")}`:"",
  rule.restrictions?`Restrictions: ${rule.restrictions}`:"",
  context.research.length?`Saved research context: ${JSON.stringify(context.research)}`:"",
  `Create one fresh, distinct angle. Do not reuse these recent content ideas: ${JSON.stringify(context.recent)}`,
  "Prepare only a brief and ready-to-use caption. Do not claim to have generated media or published it."
 ].filter(Boolean).join("\n");
 const plan=rule.contentType==="text"
  ? await generateContentPlanWithGemini({title:rule.name,url:"",platform:rule.platforms.join(", "),views:0,likes:0,comments:0,publishedAt:"",description:idea,niche:context.niche,personaContext:context.persona},`${idea}\nPersona: ${context.persona}\nReturn JSON with topic, videoPrompt (writing instructions), caption (the complete original post), and hashtags.`)
  : await generateContentPlanWithGpt55({idea,niche:context.niche,requestedFormat:rule.contentType,requestedDuration:rule.duration,requestedModel:rule.model,personaContext:context.persona});
 if(!plan||typeof plan.topic!=="string"||!plan.topic.trim()||typeof plan.videoPrompt!=="string"||!plan.videoPrompt.trim())throw new Error("The brief provider returned an incomplete draft. Try Run now again.");
 return {title:plan.topic.trim(),prompt:plan.videoPrompt.trim(),caption:String(plan.caption||plan.description||rule.instruction),hashtags:Array.isArray(plan.hashtags)?plan.hashtags.map(String):[]};
}

async function createScheduledDraft(workspaceId: string, rule: AutomationRule, brief:PreparedBrief) {
 const action = "runAutomationNow";
 return mutateDb(db => {
 const activity = (message: string) => db.activity.push({id:id("act"),workspaceId,message,createdAt:new Date().toISOString()});
      const now = new Date().toISOString();
      const {title,prompt,caption,hashtags}=brief;
      const candidateText = [title, prompt, caption].join("\n");
      const threshold = rule.duplicateProtection.similarityThreshold / 100;
      const cutoff = Date.now() - rule.duplicateProtection.topicWindowDays * 24 * 60 * 60 * 1000;
      const history = [
        ...(db.automationJobs || []).filter((item) => item.workspaceId === workspaceId && item.status === "ready-for-generation").map((item) => ({ id: item.id, title: item.title, text: [item.title, item.prompt, item.caption].join("\n"), url: "", createdAt: item.createdAt })),
        ...(db.publishQueue || []).filter((item) => item.workspaceId === workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.prompt, item.caption, (item.hashtags || []).join(" ")].join("\n"), url: item.sourceUrl || "", createdAt: item.createdAt })),
        ...(db.assets || []).filter((item) => item.workspaceId === workspaceId).map((item) => ({ id: item.id, title: item.title, text: [item.title, item.prompt].join("\n"), url: item.sourceUrl || "", createdAt: item.createdAt })),
      ].filter((item) => !item.createdAt || new Date(item.createdAt).getTime() >= cutoff);
      let best = { id: "", title: "", score: 0, reason: "No close duplicate found in recent history." };
      if (rule.duplicateProtection.mode !== "off") {
        for (const item of history) {
          const score = Math.max(sourceOverlapScore(rule.sourceUrls, item.url), ideaSimilarity(candidateText, item.text));
          if (score > best.score) best = { id: item.id, title: item.title, score, reason: score >= 1 ? "Exact source URL already exists in recent history." : "Most similar recent topic found." };
        }
      }
      const duplicate = rule.duplicateProtection.mode !== "off" && best.score >= threshold;
      const job: AutomationJob = {
        id: id("job"),
        workspaceId,
        automationRuleId: rule.id,
        ruleSnapshot: structuredClone(rule),
        scheduledFor: now,
        status: duplicate ? "skipped-duplicate" : "ready-for-generation",
        title,
        prompt,
        caption,
        hashtags,
        briefPrepared:true,
        duplicateCheck: {
          mode: rule.duplicateProtection.mode,
          checkedAt: now,
          matchedItemId: best.id || undefined,
          matchedTitle: best.title || undefined,
          similarityScore: best.score,
          reason: duplicate ? `${best.reason} Skipped because score ${Math.round(best.score * 100)}% is above ${rule.duplicateProtection.similarityThreshold}%.` : best.reason,
          attempts: 1
        },
        createdAt: now,
        updatedAt: now
      };
      db.automationJobs.push(job);
      rule.lastRunAt = now;
      rule.nextRunAt = nextScheduledRun(rule);
      rule.updatedAt = now;
      const current=db.automationRules.find(item=>item.id===rule.id&&item.workspaceId===workspaceId);if(current){current.lastRunAt=now;current.nextRunAt=nextScheduledRun(current);current.updatedAt=now;}
      db.debugLogs ||= [];
      db.debugLogs.push({
        id: id("log"),
        workspaceId,
        action,
        label: "Automation duplicate check",
        status: duplicate ? "info" : "success",
        provider: "system",
        prompt,
        details: {
          ruleId: rule.id,
          ruleName: rule.name,
          duplicateMode: rule.duplicateProtection.mode,
          threshold: rule.duplicateProtection.similarityThreshold,
          bestMatch: best,
          jobStatus: job.status
        },
        createdAt: now
      });
      activity(duplicate ? `Automation skipped duplicate idea for "${rule.name}".` : `Automation draft job ready for "${rule.name}".`);
      return job;
 });
}

export async function runScheduledAutomation(workspaceId: string, ruleId: string, dueOnly = false) {
 const rule = await mutateDb(db => {
  const row = db.automationRules.find(item => item.id === ruleId && item.workspaceId === workspaceId);
  if (!row) throw new Error("Automation not found.");
  if (row.runningUntil && Date.parse(row.runningUntil) > Date.now()) throw new Error("This automation is already running.");
  if (dueOnly && (row.status !== "active" || (row.nextRunAt && Date.parse(row.nextRunAt) > Date.now()))) return null;
  row.runningUntil = new Date(Date.now() + 30 * 60000).toISOString();
  return structuredClone(row);
 });
 if (!rule) return null;
 const results: AutomationJob[] = [];
 try {
  for (let index = 0; index < Math.min(5, rule.quantityPerRun); index++) {
   const brief = await prepareAutomationBrief(workspaceId,rule);
   const job = await createScheduledDraft(workspaceId, rule,brief);
   results.push(job);
   if (job.status === "ready-for-generation" && rule.approvalMode !== "draft-only") await generateAutomationDraft(workspaceId, job.id);
  }
  await mutateDb(db => { const row=db.automationRules.find(item=>item.id===ruleId&&item.workspaceId===workspaceId);if(row)row.lastError=""; });
  return results;
 } catch (error) {
  await mutateDb(db => { const row=db.automationRules.find(item=>item.id===ruleId&&item.workspaceId===workspaceId);if(row){row.lastError=error instanceof Error?error.message:"Automation failed";row.nextRunAt=nextScheduledRun(row);} });
  throw error;
 } finally {
  await mutateDb(db => { const row = db.automationRules.find(item => item.id === ruleId && item.workspaceId === workspaceId); if (row) row.runningUntil = undefined; });
 }
}

export async function generateAutomationDraft(workspaceId: string, jobId: string) {
 const prepared = await mutateDb(db => {
  const job = db.automationJobs.find(item => item.id === jobId && item.workspaceId === workspaceId);
  if (!job || job.status !== "ready-for-generation") throw new Error("This draft is not available for generation.");
  if (job.assetId) return { existing: true as const };
  const currentRule = db.automationRules.find(item => item.id === job.automationRuleId && item.workspaceId === workspaceId);
  const rule = currentRule && (job.ruleSnapshot || currentRule);
  if (!rule) throw new Error("Automation not found.");
  const now = new Date().toISOString();
  const kind = rule.contentType.includes("video") ? "video" : rule.contentType === "text" ? "text" : "image";
  const persona = db.personaProfiles.find(item => item.workspaceId === workspaceId);
  const prompt = appendPersonaContext(job.prompt, buildPersonaContext(persona));
  const settings = { automationRuleId: rule.id, automationJobId: job.id, approvalMode: rule.approvalMode, aspectRatio: rule.aspectRatio, duration: rule.model === "veo-fast" ? 8 : rule.duration || 8, inputPrompt: rule.instruction };
  const asset: Asset = { id:id("ast"), workspaceId, briefId:"automation", title:job.title, type:kind, status:"rendering", progress:10, provider:kind === "text" ? "local" : "kie", createdAt:now, generationModel:rule.model, generationSettings:settings, prompt, assetReferences:rule.referenceAssets || [] };
  db.assets.push(asset);
  const items = rule.platforms.map(platform => {
   const item: PublishItem = { id:id("pub"), workspaceId, assetId:asset.id, title:job.title, platform, status:"generating", scheduledAt:now, createdAt:now, caption:job.caption, hashtags:job.hashtags, generationType:kind, generationModel:rule.model, generationSettings:settings, prompt, assetReferences:asset.assetReferences, approvalStatus:rule.approvalMode === "generate-and-wait" || rule.approvalMode === "draft-only" ? "pending" : undefined };
   db.publishQueue.push(item);return item;
  });
  job.assetId=asset.id;job.publishItemIds=items.map(item=>item.id);job.updatedAt=now;
  return { existing:false as const, asset, rule, job:structuredClone(job) };
 });
 if (prepared.existing) return { alreadyStarted:true };
 const { asset, rule, job:preparedJob } = prepared;
 try {
  const brief=preparedJob.briefPrepared?preparedJob:await prepareAutomationBrief(workspaceId,rule);
  const {prompt,caption,title,hashtags}=brief;
  asset.prompt=prompt;asset.title=title;
  await mutateDb(db=>{
   const row=db.assets.find(item=>item.id===asset.id&&item.workspaceId===workspaceId)!;row.prompt=prompt;row.title=title;
   const job=db.automationJobs.find(item=>item.id===jobId&&item.workspaceId===workspaceId);if(job){job.title=title;job.prompt=prompt;job.caption=caption;job.hashtags=hashtags;job.updatedAt=new Date().toISOString();}
   if(asset.type==="text"){row.status="ready";row.progress=100;row.assetUrl="data:text/plain;charset=utf-8,"+encodeURIComponent(caption+"\n\n"+hashtags.join(" "));asset.assetUrl=row.assetUrl;}
   db.publishQueue.filter(item=>item.assetId===asset.id&&item.workspaceId===workspaceId).forEach(item=>{item.prompt=prompt;item.title=title;item.caption=caption;item.hashtags=hashtags;if(asset.type==="text"){item.status=rule.approvalMode==="auto-schedule"?"scheduled":"done";item.assetUrl=row.assetUrl;}});
  });
  if(asset.type==="text")return asset;
  const options = { aspectRatio:rule.aspectRatio, references:rule.referenceAssets || [], duration:rule.model === "veo-fast" ? 8 : rule.duration || 8 };
  const taskId = asset.type === "image" ? await generateImage(asset.prompt || asset.title,{...options,model:rule.model}) : rule.model === "seedance-2.0" ? await generateSeedanceVideo(asset.prompt || asset.title,options) : await generateVeoVideo(asset.prompt || asset.title,options);
  return await mutateDb(db=>{
   const row=db.assets.find(item=>item.id===asset.id&&item.workspaceId===workspaceId)!;row.status="rendering";row.progress=35;row.providerTaskId=taskId;
   db.publishQueue.filter(item=>item.assetId===asset.id&&item.workspaceId===workspaceId).forEach(item=>{item.status="generating";item.providerRequestId=taskId});
   return row;
  });
 } catch(error) {
  const message=error instanceof Error?error.message:"Generation failed";
  await mutateDb(db=>{
   const row=db.assets.find(item=>item.id===asset.id&&item.workspaceId===workspaceId);if(row){row.status="failed";row.error=message;}
   db.publishQueue.filter(item=>item.assetId===asset.id&&item.workspaceId===workspaceId).forEach(item=>{item.status="failed";item.error=message});
  });
  throw error;
 }
}
