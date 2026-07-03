import type { PersonaMediaAsset, PersonaProfile } from "./types";

type PersonaInput = Partial<PersonaProfile> & Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function list(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  return fallback;
}

function mediaAssets(value: unknown): PersonaMediaAsset[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const role = text(record.role);
      const url = text(record.url);
      const fileName = text(record.fileName);
      if (!["product photo", "avatar/persona", "logo", "audio"].includes(role) || !url || !fileName) return [];
      return [{
        id: text(record.id) || `media_${index}_${Date.now()}`,
        role: role as PersonaMediaAsset["role"],
        label: text(record.label) || fileName,
        fileName,
        url,
        storageKey: text(record.storageKey),
        contentType: text(record.contentType),
        createdAt: text(record.createdAt) || new Date().toISOString()
      }];
    });
}

function toneLabel(value: unknown, low: string, middle: string, high: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  if (numeric <= 2) return low;
  if (numeric >= 4) return high;
  return middle;
}

function legacyVoiceStyle(input: PersonaInput) {
  return [
    toneLabel(input.toneFormalCasual, "formal", "balanced", "friendly"),
    toneLabel(input.toneSeriousHumorous, "serious", "practical", "slightly humorous"),
    toneLabel(input.toneReservedBold, "measured", "clear", "bold")
  ].filter(Boolean).join(", ");
}

function legacyAudienceInsight(input: PersonaInput) {
  const painPoint = text(input.painPoint);
  const fear = text(input.audienceFear);
  const aspiration = text(input.audienceAspiration);
  return [
    painPoint,
    fear ? `Fear: ${fear}` : "",
    aspiration ? `Aspiration: ${aspiration}` : ""
  ].filter(Boolean).join(" ");
}

export function normalizePersonaProfile(workspaceId: string, input: PersonaInput = {}): PersonaProfile {
  const sourceUrls = (input.sourceUrls || {}) as Record<string, unknown>;
  return {
    workspaceId,
    displayName: text(input.displayName) || text(input.preferredName) || text(input.fullName) || "Sean Tan",
    role: text(input.role) || text(input.jobTitle) || "CEO",
    company: text(input.company),
    companyOneLiner: text(input.companyOneLiner),
    primaryAudience: text(input.primaryAudience),
    audienceInsight: text(input.audienceInsight) || legacyAudienceInsight(input),
    contentLanguage: text(input.contentLanguage) || "English only",
    voiceStyle: text(input.voiceStyle) || legacyVoiceStyle(input) || "Practical, direct, founder-led, opinionated without hype.",
    naturalPhrases: list(input.naturalPhrases, ["Here's the thing"]),
    bannedVocabulary: list(input.bannedVocabulary, ["synergy", "disruptive"]),
    approvedTopics: list(input.approvedTopics, ["AI automation"]),
    offLimitsTopics: list(input.offLimitsTopics),
    strongOpinions: text(input.strongOpinions),
    writingSamples: list(input.writingSamples).slice(0, 3),
    sourceUrls: {
      linkedin: text(sourceUrls.linkedin),
      website: text(sourceUrls.website),
      instagram: text(sourceUrls.instagram),
      facebook: text(sourceUrls.facebook),
      x: text(sourceUrls.x)
    },
    mediaAssets: mediaAssets(input.mediaAssets),
    updatedAt: text(input.updatedAt) || new Date().toISOString()
  };
}

function sentence(parts: string[]) {
  return parts.filter(Boolean).join(" ").trim();
}

function line(label: string, value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length ? `${label}: ${value.join(", ")}.` : "";
  return value?.trim() ? `${label}: ${value.trim()}` : "";
}

export function buildPersonaContext(persona?: PersonaProfile | null) {
  if (!persona) return "";
  const identityParts = [
    persona.displayName ? `You are writing for ${persona.displayName}` : "",
    persona.role ? `, ${persona.role}` : "",
    persona.company ? ` at ${persona.company}` : ""
  ];
  const identity = sentence([identityParts.join(""), persona.companyOneLiner]);
  const samples = persona.writingSamples?.filter(Boolean).length
    ? `Reference samples:\n${persona.writingSamples.filter(Boolean).map((sample) => `- ${sample}`).join("\n")}`
    : "";
  return [
    identity,
    sentence([
      persona.primaryAudience ? `Audience: ${persona.primaryAudience}.` : "",
      persona.audienceInsight ? `Their reality: ${persona.audienceInsight}.` : ""
    ]),
    line("Voice & tone", persona.voiceStyle),
    line("Language", persona.contentLanguage),
    line("Natural phrases to use", persona.naturalPhrases),
    line("Banned vocabulary", persona.bannedVocabulary),
    line("Approved topics", persona.approvedTopics),
    line("Off-limits topics", persona.offLimitsTopics),
    persona.strongOpinions ? `Strong opinions to lean into: ${persona.strongOpinions}` : "",
    samples
  ].filter(Boolean).join("\n");
}

export function appendPersonaContext(prompt: string, personaContext: string) {
  const cleanPrompt = prompt.trim();
  const cleanContext = personaContext.trim();
  if (!cleanContext || cleanPrompt.includes("Persona context:")) return cleanPrompt;
  return `${cleanPrompt}\n\nPersona context:\n${cleanContext}`;
}
