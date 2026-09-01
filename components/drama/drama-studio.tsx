"use client";

import Image from "next/image";
import Link from "next/link";
import AppSidebar from "@/components/drama/app-sidebar";
import WorkspaceModeSwitcher from "@/components/workspace-mode-switcher";
import {
  configureDramaStorageOwner,
  createLibraryAssetId,
  dramaStorageKey,
  LibraryAsset,
  markLibraryAssetUsed,
  readAssetLibrary,
  readDeletedAssetIds,
  REUSABLE_ASSET_STORAGE_KEY,
  writeAssetLibrary,
} from "@/lib/drama/asset-library";
import { useKieCredits } from "@/lib/drama/use-kie-credits";
import type { PersonaMediaAsset } from "@/lib/types";
import {
  configureCombinedEpisodeOwner,
  readCombinedEpisodes,
  saveCombinedEpisode,
} from "@/lib/drama/combined-episode-library";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Clock3,
  Copy,
  Download,
  Film,
  FolderKanban,
  Gauge,
  ImageIcon,
  Info,
  KeyRound,
  Layers3,
  LockKeyhole,
  Menu,
  PencilLine,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Square,
  X,
  Zap,
} from "lucide-react";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

type Asset = {
  id: string;
  name: string;
  type: "Character" | "Venue" | "Object";
  detail: string;
  visualPrompt?: string;
  crop: string;
  selected: boolean;
  status: "planned" | "generating" | "ready";
  taskId?: string;
  resultUrl?: string;
  progress?: number;
  error?: string;
  libraryAssetName?: string;
  libraryAssetId?: string;
};

type Scene = {
  id: string;
  episode: number;
  title: string;
  duration: number;
  prompt: string;
  provider: string;
  safety: "Clear" | "Review";
  selected: boolean;
  status: "draft" | "queued" | "generating" | "ready" | "rerouted";
  taskId?: string;
  resultUrl?: string;
};

type EpisodeOutline = {
  number: number;
  title: string;
  summary: string;
};

type CharacterProfile = {
  name: string;
  role: string;
  appearance: string;
  personality: string;
  arc: string;
};

type ProductionSnapshot = {
  completed: number[];
  title: string;
  roughStory: string;
  generatedBrief: string;
  episodes: number;
  episodeLength: number;
  style: string;
  language: string;
  aspectRatio: string;
  pacing: string;
  audience: string;
  rating: string;
  tone: string[];
  storyline: string;
  episodePlan: EpisodeOutline[];
  characters: CharacterProfile[];
  assets: Asset[];
  scenes: Scene[];
  autoFallback: boolean;
  assembled: boolean;
  episodeDrafts: number;
};

type WorkflowRecord = {
  id: string;
  stage: number;
  name: string;
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
  snapshot: ProductionSnapshot;
};

type WorkflowLibrary = {
  records: WorkflowRecord[];
  selectedIds: Record<number, string>;
};

type CredentialPrompt = {
  provider: "kie";
  title: string;
  message: string;
};

type KieDiagnostic = Record<string, unknown>;

type FailureLogEntry = {
  id: string;
  timestamp: string;
  operation: string;
  item: string;
  model: string;
  taskId?: string;
  message: string;
  diagnostic?: KieDiagnostic;
};

type DiagnosticError = Error & {
  diagnostic?: KieDiagnostic;
};

type WorkspaceView = "library" | "create" | "edit";
type ChatModelId = "gemini-3-pro" | "gemini-2.5-flash";
type ImageModelId = "gpt-image-2" | "seedream-4.5" | "qwen2-image";
type VideoModelId = "kling-3.0" | "kling-v3-turbo" | "seedance-2.0";

const GENERATION_PREFERENCES_STORAGE_KEY =
  "drama-studio:generation-preferences-v1";

const chatModelOptions = [
  { value: "gemini-3-pro", label: "Gemini 3 Pro · Best quality" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash · Faster" },
] as const;

const imageModelOptions = [
  { value: "gpt-image-2", label: "GPT Image 2 · Cinematic detail" },
  { value: "seedream-4.5", label: "Seedream 4.5 · Photorealistic" },
  { value: "qwen2-image", label: "Qwen2 Image · Fast alternative" },
] as const;

const videoModelOptions = [
  { value: "kling-3.0", label: "Kling 3.0 · Quality + sound" },
  { value: "kling-v3-turbo", label: "Kling V3 Turbo · Faster 720p" },
  { value: "seedance-2.0", label: "Seedance 2.0 · 15s + sound" },
] as const;

const referenceRoleOptions = [
  { role: "product photo", label: "Product photo", accept: "image/*" },
  { role: "avatar/persona", label: "Avatar / persona", accept: "image/*" },
  { role: "logo", label: "Logo", accept: "image/*" },
  { role: "audio", label: "Audio", accept: "audio/*" },
] as const;

const modelLabel = (
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string,
) => options.find((option) => option.value === value)?.label.split(" · ")[0] ?? value;

const VIDEO_PROMPT_SAFE_LIMIT = 2350;

type CreditPreviewState = Pick<
  ReturnType<typeof useKieCredits>,
  "credits" | "status"
>;

const CreditPreviewContext = createContext<CreditPreviewState | null>(null);

const chatCreditEstimate: Record<ChatModelId, number> = {
  "gemini-3-pro": 15,
  "gemini-2.5-flash": 6,
};

const imageCreditEstimate: Record<ImageModelId, number> = {
  "gpt-image-2": 30,
  "seedream-4.5": 30,
  "qwen2-image": 20,
};

function estimateVideoCredits(
  model: VideoModelId,
  duration: number,
  mode: "std" | "pro" | "4K",
) {
  const seconds = Math.max(1, Math.min(15, duration));
  const baseForFifteenSeconds =
    model === "seedance-2.0"
      ? 100
      : model === "kling-v3-turbo"
        ? 110
        : mode === "4K"
          ? 260
          : mode === "pro"
            ? 180
            : 140;
  return Math.max(50, Math.round((baseForFifteenSeconds * seconds) / 15));
}

function estimateSceneCredits(
  scenes: Scene[],
  model: VideoModelId,
  mode: "std" | "pro" | "4K",
) {
  return scenes.reduce(
    (total, scene) => total + estimateVideoCredits(model, scene.duration, mode),
    0,
  );
}

function GenerationCost({
  credits,
  children,
}: {
  credits: number;
  children: ReactNode;
}) {
  const balance = useContext(CreditPreviewContext);
  const roundedCost = Math.max(0, Math.round(credits));
  const hasBalance =
    balance?.status === "ready" && typeof balance.credits === "number";
  const currentBalance = hasBalance ? balance.credits : null;
  const projectedBalance =
    currentBalance === null ? null : Math.max(0, currentBalance - roundedCost);
  const insufficientCredits =
    currentBalance !== null && currentBalance < roundedCost;
  const formatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  });

  return (
    <div className="generation-cost-action">
      {children}
      <span className="generation-cost-chip">≈ {formatter.format(roundedCost)} credits</span>
      <span className="generation-cost-tooltip" role="tooltip">
        <b>Estimated Kie cost: {formatter.format(roundedCost)} credits</b>
        <span>
          {currentBalance === null || projectedBalance === null
            ? "Connect Kie AI to preview the balance change."
            : insufficientCredits
              ? `${formatter.format(currentBalance)} credits available · ${formatter.format(roundedCost - currentBalance)} more needed`
              : `${formatter.format(currentBalance)} → ${formatter.format(projectedBalance)} credits after this action`}
        </span>
        <small>Final Kie usage can vary by model and output settings.</small>
      </span>
    </div>
  );
}

function compactPromptSection(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

const assetCompositionDirections = [
  "Use a clean three-quarter reference view with the subject clearly separated from the background.",
  "Use a straight-on production reference composition with distinctive silhouette and material detail.",
  "Use a slightly low camera angle and a clearly different pose or spatial arrangement from the other asset references.",
  "Use a wider contextual reference view while keeping this exact asset as the unmistakable primary subject.",
];

function stripImageAspectRatio(value: string) {
  return value
    .replace(/\b(?:aspect ratio|frame|format)\s*:?\s*\d+\s*[:/]\s*\d+\b/gi, "")
    .replace(/\b(?:portrait|vertical|landscape)\s+\d+\s*[:/]\s*\d+\b/gi, "")
    .replace(/\b\d+\s*[:/]\s*\d+\s+(?:aspect ratio|frame|format)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildDistinctAssetImagePrompt(
  snapshot: ProductionSnapshot,
  asset: Asset,
  index: number,
  total: number,
) {
  const composition =
    assetCompositionDirections[index % assetCompositionDirections.length];
  const visualDirection = stripImageAspectRatio(
    asset.visualPrompt ?? asset.detail,
  );
  return [
    `PRIMARY ASSET: "${asset.name}" (${asset.type}).`,
    `Generate asset ${index + 1} of ${total} as its own unique production reference image.`,
    `The unmistakable main subject must be ${asset.name}; do not replace it with another character, venue, or object from the story.`,
    composition,
    `ASSET-SPECIFIC DETAILS: ${asset.detail}`,
    `VISUAL DIRECTION: ${visualDirection}`,
    `SHARED CONTINUITY: ${snapshot.style}; ${snapshot.tone.join(
      ", ",
    )}; preserve the same production era, palette, and world design without reusing another asset's subject or composition. The image dimensions are applied separately by the generation setting; do not render aspect-ratio text in the image.`,
  ].join("\n");
}

function buildContinuityLockedVideoPrompt(
  snapshot: ProductionSnapshot,
  scene: Scene,
) {
  const characterContinuity = compactPromptSection(
    snapshot.characters
    .map(
      (character) =>
          `${character.name} (${character.role}): ${character.appearance}`,
    )
      .join(" | "),
    620,
  );
  const visualAssets = compactPromptSection(
    snapshot.assets
    .map(
      (asset) =>
          `${asset.type} ${asset.name}: ${asset.detail}`,
    )
      .join(" | "),
    620,
  );
  const sharedContinuity = [
    "SERIES CONTINUITY LOCK — apply identically in every clip.",
    `Style: ${snapshot.style}. Frame: ${snapshot.aspectRatio}. Tone: ${snapshot.tone.join(", ")}. Pacing: ${snapshot.pacing}.`,
    characterContinuity
      ? `Characters: ${characterContinuity}.`
      : "",
    visualAssets ? `Assets: ${visualAssets}.` : "",
    "Keep identical faces, age, hair, wardrobe, proportions, color grade, lenses, lighting, production design, locations, and props. Never redesign recurring elements.",
  ]
    .filter(Boolean)
    .join("\n");
  const sceneHeader = `SCENE ${scene.id} — ${scene.title} (${scene.duration}s):`;
  const availableSceneCharacters = Math.max(
    400,
    VIDEO_PROMPT_SAFE_LIMIT - sharedContinuity.length - sceneHeader.length - 4,
  );
  const scenePrompt = compactPromptSection(
    scene.prompt,
    availableSceneCharacters,
  );
  return compactPromptSection(
    [
      sharedContinuity,
      sceneHeader,
      scenePrompt,
  ]
    .filter(Boolean)
      .join("\n\n"),
    VIDEO_PROMPT_SAFE_LIMIT,
  );
}

const steps = [
  {
    id: 1,
    label: "Creative brief",
    short: "Brief",
    description: "Story, format & controls",
    icon: PencilLine,
  },
  {
    id: 2,
    label: "Story Studio",
    short: "Story Studio",
    description: "Episodes, cast, assets & prompts",
    icon: FolderKanban,
  },
  {
    id: 3,
    label: "Visual assets",
    short: "Assets",
    description: "Characters, sets & props",
    icon: ImageIcon,
  },
  {
    id: 4,
    label: "Scene prompts",
    short: "Prompts",
    description: "Shot-ready prompt plan",
    icon: Layers3,
  },
  {
    id: 5,
    label: "Generate & edit",
    short: "Generate",
    description: "Video, recovery & assembly",
    icon: Clapperboard,
  },
];

const stageItemNames: Record<
  number,
  { singular: string; plural: string }
> = {
  1: { singular: "creative brief", plural: "creative briefs" },
  2: { singular: "story studio", plural: "story studios" },
  3: { singular: "asset pack", plural: "asset packs" },
  4: { singular: "prompt set", plural: "prompt sets" },
  5: { singular: "generation job", plural: "generation jobs" },
};

const initialAssets: Asset[] = [
  {
    id: "aya",
    name: "Aya Lin",
    type: "Character",
    detail: "Lead journalist · sand trench coat · red thread bracelet",
    crop: "18% center",
    selected: true,
    status: "planned",
  },
  {
    id: "ren",
    name: "Ren Kaito",
    type: "Character",
    detail: "Reserved architect · navy silhouette · rain-worn expression",
    crop: "35% center",
    selected: true,
    status: "planned",
  },
  {
    id: "observatory",
    name: "Astra Observatory",
    type: "Venue",
    detail: "Abandoned coastal observatory · blue-hour monsoon",
    crop: "58% center",
    selected: true,
    status: "planned",
  },
  {
    id: "recorder",
    name: "Brass recorder",
    type: "Object",
    detail: "Weathered pocket recorder · red cord · brass mesh",
    crop: "90% center",
    selected: true,
    status: "planned",
  },
  {
    id: "platform",
    name: "Harbour line",
    type: "Venue",
    detail: "Elevated train platform · wet glass · coral signal lights",
    crop: "80% center",
    selected: false,
    status: "planned",
  },
  {
    id: "evidence",
    name: "Archive fragments",
    type: "Object",
    detail: "Salt-stained maps · recording notes · observatory key",
    crop: "96% center",
    selected: false,
    status: "planned",
  },
];

const initialScenes: Scene[] = [
  {
    id: "E01-S01",
    episode: 1,
    title: "The signal returns",
    duration: 12,
    prompt:
      "Wide aerial establishing shot of a rain-soaked coastal city at blue hour. A dormant observatory beacon blinks once above the harbour as the last commuter train crosses frame. Slow cinematic push-in, restrained indigo palette, realistic rain physics, 16:9.",
    provider: "Kie AI · Kling 3.0",
    safety: "Clear",
    selected: true,
    status: "draft",
  },
  {
    id: "E01-S02",
    episode: 1,
    title: "A voice in the static",
    duration: 12,
    prompt:
      "Interior newsroom after hours. Aya Lin, consistent sand trench coat and red thread bracelet, listens to a brass pocket recorder. The waveform trembles, her expression shifts from scepticism to recognition. Intimate medium close-up, rain reflections, subtle handheld camera.",
    provider: "Kie AI · Kling 3.0",
    safety: "Clear",
    selected: true,
    status: "draft",
  },
  {
    id: "E01-S03",
    episode: 1,
    title: "Platform encounter",
    duration: 12,
    prompt:
      "On a near-empty elevated platform, Aya spots Ren across the tracks as a train passes between them. Preserve both character designs. Match cut from red signal light to Aya's bracelet. Elegant lateral tracking shot, wet glass, natural movement.",
    provider: "Kie AI · Kling 3.0",
    safety: "Clear",
    selected: true,
    status: "draft",
  },
  {
    id: "E01-S04",
    episode: 1,
    title: "The warning",
    duration: 12,
    prompt:
      "Inside the abandoned observatory stairwell, Ren pulls Aya away from falling debris. No injury shown. Urgent but non-graphic tension, dust and rain, flashlight sweep, coherent hands and faces, cinematic camera shake settling into stillness.",
    provider: "Kie AI · Kling 3.0",
    safety: "Review",
    selected: true,
    status: "draft",
  },
  {
    id: "E01-S05",
    episode: 1,
    title: "A name from tomorrow",
    duration: 12,
    prompt:
      "Close detail of the brass recorder playing a final message. Rack focus to Aya and Ren framed beneath the observatory dome. A date seven days in the future appears only on the physical recorder display. Slow orbit, thunder glow, end on their silent reaction.",
    provider: "Kie AI · Kling 3.0",
    safety: "Clear",
    selected: false,
    status: "draft",
  },
];

const defaultRoughStory =
  "A sceptical journalist receives a weather-damaged recording of her own voice predicting a city-wide disaster seven days before it happens. To learn who sent it, she must work with the reclusive architect who designed the abandoned observatory where the signal began.";

const defaultFinishedBrief =
  "THE LAST MONSOON is an eight-part cinematic mystery for young adults. Investigative journalist Aya Lin receives a weather-damaged recording of her own voice predicting a city-wide disaster seven days before it happens. Her only lead is Ren Kaito, the reclusive architect behind the abandoned coastal observatory where the signal began. Together they must trace the impossible broadcast while every attempt to change the future creates a new warning. Each one-minute episode advances one discovery, one emotional reversal, and one visual clue. The drama uses a rain-soaked indigo and coral palette, restrained slow-burn pacing, recurring recorder and red-thread motifs, strict character continuity, English dialogue, a 16:9 frame, and PG-13 non-graphic suspense.";

const defaultStoryline =
  "Seven days before the largest monsoon in a generation reaches Meridian Bay, investigative journalist Aya Lin receives an impossible recording: her own voice, older and exhausted, naming people who will disappear when the observatory signal activates. The recording leads her to Ren Kaito, an architect hiding his role in a failed climate-warning project. Each transmission reveals a different future, but every attempt to prevent it changes who is speaking on the next tape. Across eight tightly paced episodes, Aya and Ren uncover a civic cover-up, rebuild trust, and face the final choice: expose the truth today, or preserve the timeline that keeps the city alive.";

const defaultEpisodePlan: EpisodeOutline[] = [
  ["The voice in the rain", "Aya receives the impossible recording and traces its signal to the abandoned observatory."],
  ["Static between stations", "A second transmission reveals that changing one future creates another missing person."],
  ["The architect's map", "Ren's hidden plans expose a sealed chamber beneath the city's warning network."],
  ["Seven names", "Aya identifies the people named by the signal while the monsoon changes course."],
  ["A city that remembers", "Old witnesses reveal that the first transmission happened decades earlier."],
  ["The false evacuation", "A manufactured emergency forces Aya and Ren to choose whom they can trust."],
  ["Tomorrow's witness", "The final recording names Aya as the person who must send the signal."],
  ["The last monsoon", "Aya and Ren expose the cover-up and make the choice that determines which city survives."],
].map(([title, summary], index) => ({ number: index + 1, title, summary }));

const defaultCharacters: CharacterProfile[] = [
  {
    name: "Aya Lin",
    role: "Protagonist · Investigative journalist",
    appearance:
      "Early 30s, sharp dark eyes, rain-dark bob, sand trench coat, red thread bracelet.",
    personality:
      "Analytical and relentless. Uses scepticism as armour; terrified of becoming unreliable.",
    arc: "Learns that truth is not only something to expose, but something to carry responsibly.",
  },
  {
    name: "Ren Kaito",
    role: "Deuteragonist · Civic architect",
    appearance:
      "Mid 30s, composed posture, navy workwear, tired expression, old drafting pencil.",
    personality:
      "Precise, guarded, quietly compassionate. Carries guilt for the observatory project.",
    arc: "Moves from controlled isolation to choosing public accountability beside Aya.",
  },
  {
    name: "Mara Eno",
    role: "Editor · Mentor",
    appearance:
      "Late 50s, silver crop, practical linen shirts, translucent amber glasses.",
    personality:
      "Warm but politically astute. Protects Aya without withholding hard truths.",
    arc: "Reveals her connection to the first transmission and accepts its consequences.",
  },
  {
    name: "Tomas Neri",
    role: "Antagonist · Emergency director",
    appearance:
      "Early 50s, immaculate charcoal suits, calm smile, monsoon authority badge.",
    personality:
      "Persuasive, paternal, convinced secrecy is the only path to civic order.",
    arc: "His certainty fractures when the signal predicts his own act of betrayal.",
  },
];

const defaultSnapshot: ProductionSnapshot = {
  completed: [],
  title: "The Last Monsoon",
  roughStory: defaultRoughStory,
  generatedBrief: defaultFinishedBrief,
  episodes: 8,
  episodeLength: 1,
  style: "Cinematic mystery",
  language: "English",
  aspectRatio: "16:9",
  pacing: "Slow burn",
  audience: "Young adults",
  rating: "PG-13",
  tone: ["Atmospheric", "Emotional"],
  storyline: defaultStoryline,
  episodePlan: defaultEpisodePlan,
  characters: defaultCharacters,
  assets: initialAssets,
  scenes: initialScenes,
  autoFallback: true,
  assembled: false,
  episodeDrafts: 1,
};

const formatProducedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Production time unavailable";
  return `${new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Singapore",
  }).format(date)} SGT`;
};

const cloneSnapshot = (snapshot: ProductionSnapshot): ProductionSnapshot => ({
  ...snapshot,
  completed: [...(snapshot.completed ?? [])],
  tone: [...(snapshot.tone ?? [])],
  episodePlan: (snapshot.episodePlan ?? []).map((episode) => ({
    ...episode,
  })),
  characters: (snapshot.characters ?? []).map((character) => ({
    ...character,
  })),
  assets: (snapshot.assets ?? []).map((asset) => ({ ...asset })),
  scenes: (snapshot.scenes ?? []).map((scene) => ({ ...scene })),
});

const demoRecordIdPrefix = "last-monsoon-stage-";
const demoCharacterNames = ["aya lin", "ren kaito", "mara eno", "tomas neri"];

const containsDemoCharacter = (value: string) => {
  const normalized = value.toLowerCase();
  return demoCharacterNames.some((name) => normalized.includes(name));
};

const sanitizePersistedRecord = (record: WorkflowRecord): WorkflowRecord => {
  const snapshot = cloneSnapshot(record.snapshot);
  snapshot.assets = snapshot.assets.map((asset) => ({
    ...asset,
    visualPrompt: asset.visualPrompt
      ? stripImageAspectRatio(asset.visualPrompt)
      : asset.visualPrompt,
  }));
  const generatedContext = [
    snapshot.generatedBrief,
    snapshot.storyline,
    ...snapshot.episodePlan.map((episode) => `${episode.title} ${episode.summary}`),
    ...snapshot.characters.map(
      (character) =>
        `${character.name} ${character.role} ${character.appearance} ${character.personality} ${character.arc}`,
    ),
    ...snapshot.assets.map(
      (asset) => `${asset.name} ${asset.detail} ${asset.visualPrompt ?? ""}`,
    ),
    ...snapshot.scenes.map((scene) => `${scene.title} ${scene.prompt}`),
  ].join(" ");
  const creatorNamedDemoCharacter = containsDemoCharacter(snapshot.roughStory);
  const hasInheritedDemoCharacter =
    !creatorNamedDemoCharacter && containsDemoCharacter(generatedContext);

  if (record.stage === 1) {
    snapshot.storyline = "";
    snapshot.episodePlan = [];
    snapshot.characters = [];
    snapshot.assets = [];
    snapshot.scenes = [];
    snapshot.episodeDrafts = 0;
    snapshot.assembled = false;
    if (hasInheritedDemoCharacter) snapshot.generatedBrief = "";
  } else if (hasInheritedDemoCharacter) {
    snapshot.storyline = "";
    snapshot.episodePlan = [];
    snapshot.characters = [];
    snapshot.assets = [];
    snapshot.scenes = [];
    snapshot.episodeDrafts = 0;
    snapshot.assembled = false;
    snapshot.completed = snapshot.completed.filter((stage) => stage < 2);
  }

  return { ...record, snapshot };
};

const buildStageGenerationSnapshot = (
  targetStage: 0 | 1 | 2 | 3 | 4,
  snapshot: ProductionSnapshot,
) => {
  const creativeDirection = {
    title: snapshot.title,
    roughStory: snapshot.roughStory,
    episodes: snapshot.episodes,
    episodeLength: snapshot.episodeLength,
    style: snapshot.style,
    language: snapshot.language,
    aspectRatio: snapshot.aspectRatio,
    pacing: snapshot.pacing,
    audience: snapshot.audience,
    rating: snapshot.rating,
    tone: [...snapshot.tone],
  };
  if (targetStage === 0 || targetStage === 1) return creativeDirection;
  if (targetStage === 2) {
    return { ...creativeDirection, generatedBrief: snapshot.generatedBrief };
  }
  if (targetStage === 3) {
    return {
      ...creativeDirection,
      storyline: snapshot.storyline,
      episodePlan: snapshot.episodePlan.map((episode) => ({ ...episode })),
      characters: snapshot.characters.map((character) => ({ ...character })),
    };
  }
  return {
    ...creativeDirection,
    storyline: snapshot.storyline,
    episodePlan: snapshot.episodePlan.map((episode) => ({ ...episode })),
    characters: snapshot.characters.map((character) => ({ ...character })),
    assets: snapshot.assets.map(({ name, type, detail, visualPrompt }) => ({
      name,
      type,
      detail,
      visualPrompt,
    })),
  };
};

const createBlankBriefSnapshot = (): ProductionSnapshot => ({
  ...cloneSnapshot(defaultSnapshot),
  completed: [],
  title: "Untitled drama",
  roughStory: "",
  generatedBrief: "",
  storyline: "",
  episodePlan: [],
  characters: [],
  assets: [],
  scenes: [],
  assembled: false,
  episodeDrafts: 0,
});

const createEmptyStageSnapshot = (
  stage: number,
  source: ProductionSnapshot,
): ProductionSnapshot => {
  const snapshot = cloneSnapshot(source);
  if (stage === 2) {
    snapshot.storyline = "";
    snapshot.episodePlan = [];
    snapshot.characters = [];
    snapshot.assets = [];
    snapshot.scenes = [];
    snapshot.episodeDrafts = 0;
  }
  if (stage === 3) {
    snapshot.assets = [];
    snapshot.scenes = [];
  }
  if (stage === 4) snapshot.scenes = [];
  if (stage === 5) {
    snapshot.scenes = snapshot.scenes.map((scene) => ({
      ...scene,
      status: "draft",
    }));
    snapshot.assembled = false;
  }
  return snapshot;
};

const stepPaths: Record<number, string> = {
  1: "/drama-studio?step=1",
  2: "/drama-studio?step=2",
  3: "/drama-studio?step=3",
  4: "/drama-studio?step=4",
  5: "/drama-studio?step=5",
};

export default function DramaStudio({
  initialStep = 1,
  ownerId,
}: {
  initialStep?: number;
  ownerId: string;
}) {
  configureDramaStorageOwner(ownerId);
  configureCombinedEpisodeOwner(ownerId);
  const [activeStep, setActiveStep] = useState(initialStep);
  const [completed, setCompleted] = useState<number[]>(
    Array.from({ length: Math.max(0, initialStep - 1) }, (_, index) => index + 1),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [briefSeedBusy, setBriefSeedBusy] = useState(false);
  const [storyBusyKeys, setStoryBusyKeys] = useState<string[]>([]);
  const [videoBusyKeys, setVideoBusyKeys] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [failureLogs, setFailureLogs] = useState<FailureLogEntry[]>([]);
  const [referenceAssets, setReferenceAssets] = useState<PersonaMediaAsset[]>([]);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [referenceBusyRole, setReferenceBusyRole] =
    useState<PersonaMediaAsset["role"] | null>(null);
  const [credentialPrompt, setCredentialPrompt] =
    useState<CredentialPrompt | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [workspaceView, setWorkspaceView] =
    useState<WorkspaceView>("library");
  const [draftSourceId, setDraftSourceId] = useState("");
  const [editingRecordId, setEditingRecordId] = useState("");
  const [videoMode, setVideoMode] = useState<"std" | "pro" | "4K">("pro");
  const [videoSound, setVideoSound] = useState(true);
  const [chatModel, setChatModel] =
    useState<ChatModelId>("gemini-3-pro");
  const [imageModel, setImageModel] =
    useState<ImageModelId>("seedream-4.5");
  const [videoModel, setVideoModel] =
    useState<VideoModelId>("seedance-2.0");
  const [generationPreferencesHydrated, setGenerationPreferencesHydrated] =
    useState(false);
  const [title, setTitle] = useState("Untitled drama");
  const [roughStory, setRoughStory] = useState("");
  const [generatedBrief, setGeneratedBrief] = useState("");
  const [episodes, setEpisodes] = useState(8);
  const [episodeLength, setEpisodeLength] = useState(1);
  const [style, setStyle] = useState("Cinematic mystery");
  const [language, setLanguage] = useState("English");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [pacing, setPacing] = useState("Slow burn");
  const [audience, setAudience] = useState("Young adults");
  const [rating, setRating] = useState("PG-13");
  const [tone, setTone] = useState(["Atmospheric", "Emotional"]);
  const [storyline, setStoryline] = useState("");
  const [episodePlan, setEpisodePlan] = useState<EpisodeOutline[]>([]);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [autoFallback, setAutoFallback] = useState(true);
  const [assembled, setAssembled] = useState(false);
  const [episodeDrafts, setEpisodeDrafts] = useState(0);
  const [workflowRecords, setWorkflowRecords] = useState<WorkflowRecord[]>([]);
  const [selectedRecordIds, setSelectedRecordIds] = useState<
    Record<number, string>
  >({});
  const [hydrated, setHydrated] = useState(false);
  const reusableAssetHandled = useRef(false);
  const creditRefreshTimeout = useRef<number | null>(null);
  const kieCredits = useKieCredits();

  const setVideoOperationBusy = useCallback((key: string, active: boolean) => {
    setVideoBusyKeys((current) =>
      active
        ? current.includes(key)
          ? current
          : [...current, key]
        : current.filter((item) => item !== key),
    );
  }, []);

  const setStoryOperationBusy = useCallback((key: string, active: boolean) => {
    setStoryBusyKeys((current) =>
      active
        ? current.includes(key)
          ? current
          : [...current, key]
        : current.filter((item) => item !== key),
    );
  }, []);

  const scheduleCreditRefresh = useCallback(() => {
    if (creditRefreshTimeout.current !== null) {
      window.clearTimeout(creditRefreshTimeout.current);
    }
    creditRefreshTimeout.current = window.setTimeout(
      () => void kieCredits.refresh(),
      2500,
    );
  }, [kieCredits]);

  useEffect(
    () => () => {
      if (creditRefreshTimeout.current !== null) {
        window.clearTimeout(creditRefreshTimeout.current);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const loadReferences = async () => {
      try {
        const response = await fetch("/api/app", { cache: "no-store" });
        const payload = (await response.json()) as {
          personaProfile?: { mediaAssets?: PersonaMediaAsset[] };
        };
        if (!cancelled && response.ok) {
          setReferenceAssets(payload.personaProfile?.mediaAssets ?? []);
        }
      } catch {
        if (!cancelled) {
          setToast("Persona reference assets could not be loaded.");
        }
      }
    };
    void loadReferences();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(
          dramaStorageKey(GENERATION_PREFERENCES_STORAGE_KEY),
        );
        if (stored) {
          const parsed = JSON.parse(stored) as {
            imageModel?: ImageModelId;
            videoModel?: VideoModelId;
            videoMode?: "std" | "pro" | "4K";
            videoSound?: boolean;
          };
          if (imageModelOptions.some((option) => option.value === parsed.imageModel)) {
            setImageModel(parsed.imageModel as ImageModelId);
          }
          if (videoModelOptions.some((option) => option.value === parsed.videoModel)) {
            setVideoModel(parsed.videoModel as VideoModelId);
          }
          if (["std", "pro", "4K"].includes(parsed.videoMode ?? "")) {
            setVideoMode(parsed.videoMode as "std" | "pro" | "4K");
          }
          if (typeof parsed.videoSound === "boolean") {
            setVideoSound(parsed.videoSound);
          }
        }
      } catch {
        // Ignore malformed browser preferences and keep the Seedream/Seedance defaults.
      }
      setGenerationPreferencesHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!generationPreferencesHydrated) return;
    window.localStorage.setItem(
      dramaStorageKey(GENERATION_PREFERENCES_STORAGE_KEY),
      JSON.stringify({ imageModel, videoModel, videoMode, videoSound }),
    );
  }, [
    generationPreferencesHydrated,
    imageModel,
    videoMode,
    videoModel,
    videoSound,
  ]);

  const applySnapshot = useCallback((snapshot: ProductionSnapshot) => {
    setCompleted(snapshot.completed);
    setTitle(snapshot.title);
    setRoughStory(snapshot.roughStory);
    setGeneratedBrief(snapshot.generatedBrief ?? snapshot.roughStory ?? "");
    setEpisodes(snapshot.episodes);
    setEpisodeLength(snapshot.episodeLength);
    setStyle(snapshot.style);
    setLanguage(snapshot.language);
    setAspectRatio(snapshot.aspectRatio);
    setPacing(snapshot.pacing);
    setAudience(snapshot.audience);
    setRating(snapshot.rating);
    setTone([...snapshot.tone]);
    setStoryline(snapshot.storyline);
    setEpisodePlan(
      (snapshot.episodePlan ?? []).map((episode) => ({
        ...episode,
      })),
    );
    setCharacters(
      (snapshot.characters ?? []).map((character) => ({
        ...character,
      })),
    );
    setAssets(snapshot.assets.map((asset) => ({ ...asset })));
    setScenes(snapshot.scenes.map((scene) => ({ ...scene })));
    setAutoFallback(snapshot.autoFallback);
    setAssembled(snapshot.assembled);
    setEpisodeDrafts(snapshot.episodeDrafts);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const libraryText = window.localStorage.getItem(
        dramaStorageKey("drama-studio:workflow-library-v2"),
      );
      if (libraryText) {
        try {
          const library = JSON.parse(libraryText) as WorkflowLibrary;
          if (Array.isArray(library.records) && library.selectedIds) {
            const normalizedRecords = library.records
              .filter((record) => !record.id.startsWith(demoRecordIdPrefix))
              .map((record, index) =>
                sanitizePersistedRecord({
                  ...record,
                  createdAt:
                    record.createdAt ??
                    new Date(Date.now() - index * 60_000).toISOString(),
                  snapshot: {
                    ...record.snapshot,
                    generatedBrief:
                      record.snapshot.generatedBrief ??
                      record.snapshot.roughStory ??
                      "",
                  },
                }),
              );
            const validRecordIds = new Set(
              normalizedRecords.map((record) => record.id),
            );
            const normalizedSelectedIds = Object.fromEntries(
              Object.entries(library.selectedIds).filter(([, recordId]) =>
                validRecordIds.has(recordId),
              ),
            ) as Record<number, string>;
            setWorkflowRecords(normalizedRecords);
            setSelectedRecordIds(normalizedSelectedIds);
            const selected =
              normalizedRecords.find(
                (record) => record.id === normalizedSelectedIds[initialStep],
              ) ??
              normalizedRecords.find((record) => record.stage === initialStep);
            if (selected) applySnapshot(selected.snapshot);
            setHydrated(true);
            return;
          }
        } catch {
          // Fall through to the legacy draft migration.
        }
      }

      const stored = window.localStorage.getItem(
        dramaStorageKey("drama-studio:last-monsoon-production"),
      );
      if (stored) {
        try {
          const legacy = JSON.parse(stored) as Partial<ProductionSnapshot>;
          const snapshot: ProductionSnapshot = {
            ...defaultSnapshot,
            ...legacy,
            completed: legacy.completed ?? defaultSnapshot.completed,
            tone: legacy.tone ?? defaultSnapshot.tone,
            assets: legacy.assets ?? defaultSnapshot.assets,
            scenes: legacy.scenes ?? defaultSnapshot.scenes,
          };
          const migratedRecord = sanitizePersistedRecord({
            id: `legacy-brief-${Date.now()}`,
            stage: 1,
            name: `${snapshot.title || "Untitled drama"} · Brief`,
            createdAt: new Date().toISOString(),
            updatedAt: "Migrated from an earlier workspace",
            snapshot: {
              ...snapshot,
              tone: [...snapshot.tone],
              assets: snapshot.assets.map((asset) => ({ ...asset })),
              scenes: snapshot.scenes.map((scene) => ({ ...scene })),
            },
          });
          setWorkflowRecords([migratedRecord]);
          setSelectedRecordIds({ 1: migratedRecord.id });
          applySnapshot(migratedRecord.snapshot);
        } catch {
          // Leave the workspace empty if legacy local data is malformed.
        }
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [applySnapshot, initialStep]);

  const productionSnapshot = useMemo<ProductionSnapshot>(
    () => ({
      completed,
      title,
      roughStory,
      generatedBrief,
      episodes,
      episodeLength,
      style,
      language,
      aspectRatio,
      pacing,
      audience,
      rating,
      tone,
      storyline,
      episodePlan,
      characters,
      assets,
      scenes,
      autoFallback,
      assembled,
      episodeDrafts,
    }),
    [
      completed,
      title,
      roughStory,
      generatedBrief,
      episodes,
      episodeLength,
      style,
      language,
      aspectRatio,
      pacing,
      audience,
      rating,
      tone,
      storyline,
      episodePlan,
      characters,
      assets,
      scenes,
      autoFallback,
      assembled,
      episodeDrafts,
    ],
  );

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      dramaStorageKey("drama-studio:last-monsoon-production"),
      JSON.stringify(productionSnapshot),
    );
  }, [hydrated, productionSnapshot]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      dramaStorageKey("drama-studio:workflow-library-v2"),
      JSON.stringify({
        records: workflowRecords,
        selectedIds: selectedRecordIds,
      } satisfies WorkflowLibrary),
    );
  }, [hydrated, selectedRecordIds, workflowRecords]);

  useEffect(() => {
    if (!hydrated) return;
    const generatedAssets: LibraryAsset[] = workflowRecords.flatMap((record) =>
      (record.stage !== 2 && record.stage !== 3) || record.model === "Asset Library"
        ? []
        : record.snapshot.assets.flatMap((asset) =>
            asset.status === "ready" && asset.resultUrl && !asset.libraryAssetId
              ? [
                  {
                    id: createLibraryAssetId(record.id, asset.id, asset.resultUrl),
                    sourceRecordId: record.id,
                    sourceAssetId: asset.id,
                    name: asset.name,
                    type: asset.type,
                    detail: asset.detail,
                    visualPrompt: asset.visualPrompt
                      ? stripImageAspectRatio(asset.visualPrompt)
                      : asset.visualPrompt,
                    resultUrl: asset.resultUrl,
                    project: record.snapshot.title || "Untitled drama",
                    crop: asset.crop,
                    savedAt: new Date().toISOString(),
                    usageCount: 0,
                  } satisfies LibraryAsset,
                ]
              : [],
          ),
    );
    if (!generatedAssets.length) return;
    const deletedIds = new Set(readDeletedAssetIds());
    const current = readAssetLibrary().filter((asset) => !deletedIds.has(asset.id));
    const merged = [...current];
    generatedAssets.filter((asset) => !deletedIds.has(asset.id)).forEach((asset) => {
      const index = merged.findIndex(
        (item) => item.id === asset.id || item.resultUrl === asset.resultUrl,
      );
      if (index >= 0) {
        const existing = merged[index];
        merged[index] = {
          ...existing,
          ...asset,
          id: existing.id,
          savedAt: existing.savedAt,
          usageCount: existing.usageCount ?? 0,
          lastUsedAt: existing.lastUsedAt,
        };
      }
      else merged.push(asset);
    });
    writeAssetLibrary(merged);
  }, [hydrated, workflowRecords]);

  useEffect(() => {
    if (!hydrated || initialStep !== 2 || reusableAssetHandled.current) return;
    reusableAssetHandled.current = true;
    const pendingText = window.localStorage.getItem(dramaStorageKey(REUSABLE_ASSET_STORAGE_KEY));
    if (!pendingText) return;
    window.localStorage.removeItem(dramaStorageKey(REUSABLE_ASSET_STORAGE_KEY));
    try {
      const reusable = JSON.parse(pendingText) as LibraryAsset;
      const source =
        workflowRecords.find(
          (record) => record.id === selectedRecordIds[2] && record.stage === 2,
        ) ?? workflowRecords.find((record) => record.stage === 2);
      if (!source || !reusable.resultUrl) return;
      const snapshot = cloneSnapshot(source.snapshot);
      if (
        !snapshot.assets.some(
          (asset) =>
            asset.resultUrl === reusable.resultUrl && asset.name === reusable.name,
        )
      ) {
        snapshot.assets = [
          ...snapshot.assets,
          {
            id: `reused-${reusable.sourceAssetId}-${Date.now()}`,
            name: reusable.name,
            type: reusable.type,
            detail: reusable.detail,
            visualPrompt: reusable.visualPrompt,
            crop: reusable.crop,
            selected: true,
            status: "ready",
            resultUrl: reusable.resultUrl,
            libraryAssetId: reusable.id,
            libraryAssetName: reusable.name,
          },
        ];
      }
      const timeout = window.setTimeout(() => {
        setWorkflowRecords((current) =>
          current.map((record) =>
            record.id === source.id
              ? { ...record, snapshot, updatedAt: "Asset reused just now" }
              : record,
          ),
        );
        setSelectedRecordIds((current) => ({ ...current, 2: source.id }));
        applySnapshot(snapshot);
        setWorkspaceView("library");
        setToast(`${reusable.name} added to this Story Studio.`);
      }, 0);
      return () => window.clearTimeout(timeout);
    } catch {
      const timeout = window.setTimeout(
        () => setToast("That reusable asset could not be opened."),
        0,
      );
      return () => window.clearTimeout(timeout);
    }
  }, [applySnapshot, hydrated, initialStep, selectedRecordIds, workflowRecords]);

  const readyScenes = scenes.filter((scene) => scene.status === "ready").length;
  const activeRecords = workflowRecords.filter(
    (record) => record.stage === activeStep,
  );
  const activeRecord =
    activeRecords.find(
      (record) => record.id === selectedRecordIds[activeStep],
    ) ?? activeRecords[0];
  const sourceRecords =
    activeStep === 5
      ? workflowRecords.filter(
          (record) =>
            (record.stage === 2 && record.snapshot.scenes.length > 0) ||
            record.stage === 4,
        )
      : activeStep > 1
      ? workflowRecords.filter((record) => record.stage === activeStep - 1)
      : [];

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const markChanged = () => {
    setSaved(false);
    window.setTimeout(() => setSaved(true), 750);
  };

  const addFailureLog = (
    entry: Omit<FailureLogEntry, "id" | "timestamp"> & {
      id?: string;
      timestamp?: string;
    },
  ) => {
    const log: FailureLogEntry = {
      ...entry,
      id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };
    setFailureLogs((current) => {
      if (current.some((item) => item.id === log.id)) return current;
      return [log, ...current].slice(0, 20);
    });
  };

  const copyFailureLogs = async () => {
    const output = JSON.stringify(
      {
        notice:
          "Sanitized Drama Studio Kie diagnostics. API keys and Authorization headers are intentionally excluded.",
        entries: failureLogs,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(output);
      setToast("Failed-task output copied. You can send it to Codex.");
    } catch {
      setToast("Copy failed. Select the log text manually.");
    }
  };

  const makeRecord = (
    stage: number,
    snapshot: ProductionSnapshot,
    sourceId?: string,
  ): WorkflowRecord => {
    const stageLabel = steps[stage - 1].label;
    return {
      id: `${stage}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      stage,
      name:
        stage === 1
          ? `${snapshot.title || "Untitled drama"} · Brief`
          : `${snapshot.title || "Untitled drama"} · ${stageLabel}`,
      sourceId,
      createdAt: new Date().toISOString(),
      updatedAt: "Created just now",
      snapshot: cloneSnapshot(snapshot),
    };
  };

  const saveActiveRecord = () => {
    if (workspaceView !== "edit" || !editingRecordId) return;
    setWorkflowRecords((current) =>
      current.map((record) =>
        record.id === editingRecordId
          ? {
              ...record,
              name:
                activeStep === 1
                  ? `${title || "Untitled drama"} · Brief`
                  : record.name,
              updatedAt: "Edited just now",
              snapshot: cloneSnapshot(productionSnapshot),
            }
          : record,
      ),
    );
  };

  const openStep = (
    step: number,
    snapshot?: ProductionSnapshot,
    view: WorkspaceView = "library",
  ) => {
    setActiveStep(step);
    setWorkspaceView(view);
    setEditingRecordId("");
    if (snapshot) applySnapshot(snapshot);
    window.history.pushState({}, "", stepPaths[step]);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startCreate = (stage: number, sourceId?: string) => {
    const source =
      stage === 5
        ? workflowRecords.find((record) => record.id === sourceId) ??
          workflowRecords.find(
            (record) =>
              record.stage === 2 &&
              record.id === selectedRecordIds[2] &&
              record.snapshot.scenes.length > 0,
          ) ??
          workflowRecords.find(
            (record) => record.stage === 2 && record.snapshot.scenes.length > 0,
          ) ??
          workflowRecords.find((record) => record.stage === 4)
        : stage > 1
        ? workflowRecords.find((record) => record.id === sourceId) ??
          workflowRecords.find(
            (record) => record.id === selectedRecordIds[stage - 1],
          ) ??
          workflowRecords.find((record) => record.stage === stage - 1)
        : undefined;
    const snapshot =
      stage === 1
        ? createBlankBriefSnapshot()
        : createEmptyStageSnapshot(
            stage,
            source?.snapshot ?? createBlankBriefSnapshot(),
          );
    setDraftSourceId(source?.id ?? "");
    setActiveStep(stage);
    setWorkspaceView("create");
    setEditingRecordId("");
    applySnapshot(snapshot);
    window.history.pushState({}, "", stepPaths[stage]);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setToast(
      stage === 1
        ? "New brief input opened."
        : `Selected source loaded. Press Generate when you are ready.`,
    );
  };

  const selectWorkflowRecord = (recordId: string) => {
    const record = workflowRecords.find((item) => item.id === recordId);
    if (!record) return;
    setSelectedRecordIds((current) => ({
      ...current,
      [record.stage]: record.id,
    }));
    setEditingRecordId(record.id);
    setWorkspaceView("edit");
    applySnapshot(record.snapshot);
    setToast(`${record.name} opened for review and manual editing.`);
  };

  const selectSourceRecord = (sourceId: string) => {
    if (activeStep === 1) return;
    const source = workflowRecords.find((record) => record.id === sourceId);
    if (!source) return;
    setDraftSourceId(sourceId);
    applySnapshot(createEmptyStageSnapshot(activeStep, source.snapshot));
    setToast(`${source.name} selected. Generation has not started.`);
  };

  const deleteWorkflowRecord = (recordId: string) => {
    const record = workflowRecords.find((item) => item.id === recordId);
    if (!record) return;
    const remaining = workflowRecords.filter(
      (item) => item.stage === record.stage && item.id !== recordId,
    );
    setWorkflowRecords((current) =>
      current.filter((item) => item.id !== recordId),
    );
    setSelectedRecordIds((current) => {
      const next = { ...current };
      if (next[record.stage] === recordId) {
        next[record.stage] = remaining[0]?.id ?? "";
      }
      return next;
    });
    setWorkspaceView("library");
    setDeleteCandidateId(null);
    setToast(`${record.name} deleted.`);
  };

  const updateWorkflowRecordContent = (recordId: string, value: string) => {
    setWorkflowRecords((current) =>
      current.map((record) => {
        if (record.id !== recordId) return record;
        const snapshot = cloneSnapshot(record.snapshot);
        if (record.stage === 1) snapshot.generatedBrief = value;
        if (record.stage === 2) snapshot.storyline = value;
        if (record.stage === 3) {
          const blocks = value.split(/\n\s*\n/);
          snapshot.assets = snapshot.assets.map((asset, index) => ({
            ...asset,
            detail: blocks[index] ?? asset.detail,
            visualPrompt: stripImageAspectRatio(
              blocks[index] ?? asset.visualPrompt ?? asset.detail,
            ),
          }));
        }
        if (record.stage === 4 || record.stage === 5) {
          const blocks = value.split(/\n\s*\n/);
          snapshot.scenes = snapshot.scenes.map((scene, index) => ({
            ...scene,
            prompt: blocks[index] ?? scene.prompt,
          }));
        }
        return { ...record, snapshot, updatedAt: "Edited just now" };
      }),
    );
    markChanged();
  };

  const updateWorkflowRecordSnapshot = (
    recordId: string,
    patch: Partial<ProductionSnapshot>,
  ) => {
    setWorkflowRecords((current) =>
      current.map((record) =>
        record.id === recordId
          ? {
              ...record,
              snapshot: { ...cloneSnapshot(record.snapshot), ...patch },
              updatedAt: "Edited just now",
            }
          : record,
      ),
    );
    markChanged();
  };

  const openStoryStudioAsGenerationJob = (source: WorkflowRecord) => {
    const snapshot = createEmptyStageSnapshot(5, source.snapshot);
    snapshot.scenes = snapshot.scenes.map((scene) => ({
      ...scene,
      selected: true,
      status: "draft",
      taskId: undefined,
      resultUrl: undefined,
    }));
    snapshot.assembled = false;
    const record = {
      ...makeRecord(5, snapshot, source.id),
      model: modelLabel(videoModelOptions, videoModel),
    };

    setWorkflowRecords((current) => [...current, record]);
    setSelectedRecordIds((current) => ({
      ...current,
      2: source.id,
      5: record.id,
    }));
    setActiveStep(5);
    setWorkspaceView("library");
    setEditingRecordId("");
    setDraftSourceId(source.id);
    applySnapshot(snapshot);
    window.history.pushState({}, "", stepPaths[5]);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setToast(
      `${record.name} opened with all ${snapshot.scenes.length} scene prompts ready to generate.`,
    );
  };

  const createNextFromRecord = (recordId: string) => {
    const source = workflowRecords.find((record) => record.id === recordId);
    if (!source || source.stage >= 5) return;
    if (source.stage === 1 && !source.snapshot.generatedBrief?.trim()) {
      setToast("This brief has no finished generated brief to use.");
      return;
    }
    if (source.stage === 2) {
      if (!source.snapshot.storyline.trim()) {
        setToast("This Story Studio has no finished storyline to use.");
        return;
      }
      if (
        !source.snapshot.assets.length ||
        source.snapshot.assets.some((asset) => asset.status !== "ready")
      ) {
        setToast("Generate and approve every planned visual asset first.");
        return;
      }
      if (!source.snapshot.scenes.length) {
        setToast("Generate all episode scene prompts before creating videos.");
        return;
      }
      openStoryStudioAsGenerationJob(source);
      return;
    }
    if (source.stage === 3 && source.snapshot.assets.length === 0) {
      setToast("This asset pack has no generated assets to use.");
      return;
    }
    if (source.stage === 4 && source.snapshot.scenes.length === 0) {
      setToast("This prompt set has no generated scenes to use.");
      return;
    }
    setSelectedRecordIds((current) => ({
      ...current,
      [source.stage]: source.id,
    }));
    startCreate(source.stage + 1, source.id);
  };

  const showKieCredentialPrompt = (message: string) => {
    setCredentialPrompt({
      provider: "kie",
      title: "KIE AI Key required",
      message,
    });
  };

  const generateCreativeSeed = async () => {
    setBriefSeedBusy(true);
    try {
      const credentialResponse = await fetch("/api/drama/credentials", {
        cache: "no-store",
      });
      const credentialState = (await credentialResponse.json()) as {
        configured?: boolean;
        statuses?: { kie?: { connected?: boolean } };
      };
      if (!credentialState.statuses?.kie?.connected) {
        showKieCredentialPrompt(
          credentialState.configured === false
            ? "Connect your KIE AI Key after the credential vault is configured in Settings."
            : "Add your KIE AI Key to generate a working title and rough premise.",
        );
        return;
      }

      const response = await fetch("/api/drama/generate/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetStage: 0,
          model: chatModel,
          snapshot: buildStageGenerationSnapshot(0, productionSnapshot),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        diagnostic?: KieDiagnostic;
        result?: {
          title?: string;
          roughStory?: string;
        };
      };
      const logDetails = {
        operation: "creative_seed_generation",
        item: "Working title and rough premise",
        model: modelLabel(chatModelOptions, chatModel),
        message: payload.message ?? "Kie AI seed generation failed.",
        diagnostic: payload.diagnostic,
      };

      if (payload.error === "missing_credential") {
        addFailureLog(logDetails);
        showKieCredentialPrompt(
          "Add your KIE AI Key to generate a working title and rough premise.",
        );
        return;
      }
      if (
        !response.ok ||
        !payload.result?.title?.trim() ||
        !payload.result.roughStory?.trim()
      ) {
        addFailureLog(logDetails);
        throw new Error(payload.message ?? "Kie AI seed generation failed.");
      }

      setTitle(payload.result.title.trim());
      setRoughStory(payload.result.roughStory.trim());
      markChanged();
      scheduleCreditRefresh();
      setToast(
        "New title and story seed generated. Edit either field or regenerate again.",
      );
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "The working title and premise could not be generated.",
      );
    } finally {
      setBriefSeedBusy(false);
    }
  };

  const uploadReferenceAsset = async (
    role: PersonaMediaAsset["role"],
    file: File,
  ) => {
    setReferenceBusyRole(role);
    try {
      const form = new FormData();
      form.set("role", role);
      form.set("file", file);
      const response = await fetch("/api/drama/references", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as {
        asset?: PersonaMediaAsset;
        error?: string;
      };
      if (!response.ok || !payload.asset) {
        throw new Error(payload.error || "Reference upload failed.");
      }
      const replacedIds =
        role === "product photo"
          ? []
          : referenceAssets
              .filter((asset) => asset.role === role)
              .map((asset) => asset.id);
      setReferenceAssets((current) => [
        ...current.filter(
          (asset) => role === "product photo" || asset.role !== role,
        ),
        payload.asset!,
      ]);
      setSelectedReferenceIds((current) => [
        ...current.filter((id) => !replacedIds.includes(id)),
        payload.asset!.id,
      ]);
      setToast(payload.asset.label + " saved and selected as a reference.");
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Reference upload failed.",
      );
    } finally {
      setReferenceBusyRole(null);
    }
  };

  const submitMediaTask = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/drama/generate/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        references: selectedReferenceIds.map((id) => ({ id })),
      }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      message?: string;
      taskId?: string;
      model?: string;
      diagnostic?: KieDiagnostic;
    };
    if (response.status === 401 && payload.error === "missing_credential") {
      showKieCredentialPrompt(
        "Add your KIE AI Key to generate images and video through Kie AI.",
      );
      const error = new Error("KIE AI Key required.") as DiagnosticError;
      error.diagnostic = payload.diagnostic;
      throw error;
    }
    if (!response.ok || !payload.taskId) {
      const error = new Error(
        payload.message ?? "Kie AI media generation failed.",
      ) as DiagnosticError;
      error.diagnostic = payload.diagnostic;
      throw error;
    }
    scheduleCreditRefresh();
    window.parent.postMessage(
      { type: "cabuild:drama-queue-updated" },
      window.location.origin,
    );
    return {
      taskId: payload.taskId,
      model: payload.model ?? "Kie AI",
    };
  };

  const generateStoryAsset = async (recordId: string, assetId: string) => {
    const record = workflowRecords.find((item) => item.id === recordId);
    const assetIndex = record?.snapshot.assets.findIndex(
      (asset) => asset.id === assetId,
    ) ?? -1;
    if (!record || assetIndex < 0) return;
    const asset = record.snapshot.assets[assetIndex];
    const busyKey = `story-asset-${recordId}-${assetId}`;
    setStoryOperationBusy(busyKey, true);
    try {
      const task = await submitMediaTask({
        kind: "image",
        model: imageModel,
        title: record.snapshot.title + " · " + asset.name,
        recordId,
        itemId: asset.id,
        prompt: buildDistinctAssetImagePrompt(
          record.snapshot,
          asset,
          assetIndex,
          record.snapshot.assets.length,
        ),
        aspectRatio: record.snapshot.aspectRatio,
      });
      setWorkflowRecords((current) =>
        current.map((item) =>
          item.id !== recordId
            ? item
            : {
                ...item,
                model: `${item.model ?? "Kie AI"} + ${task.model}`,
                updatedAt: "Image generation submitted just now",
                snapshot: {
                  ...item.snapshot,
                  assets: item.snapshot.assets.map((currentAsset) =>
                    currentAsset.id === assetId
                      ? {
                          ...currentAsset,
                          taskId: task.taskId,
                          resultUrl: undefined,
                          progress: 0,
                          error: undefined,
                          libraryAssetId: undefined,
                          libraryAssetName: undefined,
                          status: "generating" as const,
                        }
                      : currentAsset,
                  ),
                },
              },
        ),
      );
      setToast(`${asset.name} image generation started with ${task.model}.`);
    } catch (error) {
      const diagnosticError = error as DiagnosticError;
      addFailureLog({
        operation: "story_studio_image_submission",
        item: asset.name,
        model: modelLabel(imageModelOptions, imageModel),
        message:
          error instanceof Error ? error.message : "Image generation failed.",
        diagnostic: diagnosticError.diagnostic,
      });
      if (!(error instanceof Error) || error.message !== "KIE AI Key required.") {
        setToast(error instanceof Error ? error.message : "Image generation failed.");
      }
    } finally {
      setStoryOperationBusy(busyKey, false);
    }
  };

  const generateStoryAssetGroup = async (
    recordId: string,
    assetType: "Character" | "World",
  ) => {
    const record = workflowRecords.find((item) => item.id === recordId);
    if (!record) return;
    const targets = record.snapshot.assets
      .map((asset, index) => ({ asset, index }))
      .filter(({ asset }) =>
        assetType === "Character"
          ? asset.type === "Character"
          : asset.type === "Venue" || asset.type === "Object",
      );
    if (!targets.length) {
      setToast(
        assetType === "Character"
          ? "This Story Studio has no character assets to generate."
          : "This Story Studio has no venue or object assets to generate.",
      );
      return;
    }

    const groupName = assetType === "Character" ? "characters" : "world";
    const groupLabel = assetType === "Character" ? "characters" : "venues and objects";
    const busyKey = `story-assets-${recordId}-${groupName}`;
    setStoryOperationBusy(busyKey, true);
    let submittedCount = 0;
    let failedCount = 0;
    try {
      for (const { asset, index } of targets) {
        try {
          const task = await submitMediaTask({
            kind: "image",
            model: imageModel,
            title: record.snapshot.title + " · " + asset.name,
            recordId,
            itemId: asset.id,
            prompt: buildDistinctAssetImagePrompt(
              record.snapshot,
              asset,
              index,
              record.snapshot.assets.length,
            ),
            aspectRatio: record.snapshot.aspectRatio,
          });
          submittedCount += 1;
          setWorkflowRecords((current) =>
            current.map((item) =>
              item.id !== recordId
                ? item
                : {
                    ...item,
                    model: `${item.model ?? "Kie AI"} + ${task.model}`,
                    updatedAt: `${assetType} image generation submitted just now`,
                    snapshot: {
                      ...item.snapshot,
                      assets: item.snapshot.assets.map((currentAsset) =>
                        currentAsset.id === asset.id
                          ? {
                              ...currentAsset,
                              taskId: task.taskId,
                              resultUrl: undefined,
                              progress: 0,
                              error: undefined,
                              libraryAssetId: undefined,
                              libraryAssetName: undefined,
                              status: "generating" as const,
                            }
                          : currentAsset,
                      ),
                    },
                  },
            ),
          );
        } catch (error) {
          failedCount += 1;
          const diagnosticError = error as DiagnosticError;
          addFailureLog({
            operation: `story_studio_${groupName}_submission`,
            item: asset.name,
            model: modelLabel(imageModelOptions, imageModel),
            message:
              error instanceof Error ? error.message : "Image generation failed.",
            diagnostic: diagnosticError.diagnostic,
          });
          if (error instanceof Error && error.message === "KIE AI Key required.") {
            break;
          }
        }
      }
      if (submittedCount > 0) {
        setToast(
          `${submittedCount} ${groupLabel} started generating with ${modelLabel(
            imageModelOptions,
            imageModel,
          )}${failedCount ? `; ${failedCount} failed to submit.` : "."}`,
        );
      } else if (failedCount > 0) {
        setToast(`Kie AI could not start the ${groupLabel}. Check the failed-task output.`);
      }
    } finally {
      setStoryOperationBusy(busyKey, false);
    }
  };

  const generateStoryPrompts = async (
    recordId: string,
    episodeCount: number,
    episodeNumber?: number,
  ) => {
    const record = workflowRecords.find((item) => item.id === recordId);
    if (!record) return;
    const orderedEpisodePlan = [...record.snapshot.episodePlan].sort(
      (first, second) => first.number - second.number,
    );
    const selectedEpisodePlan = episodeNumber
      ? orderedEpisodePlan.filter((episode) => episode.number === episodeNumber)
      : orderedEpisodePlan.slice(0, episodeCount);
    if (!selectedEpisodePlan.length) return;
    const targetEpisodeNumbers = new Set(
      selectedEpisodePlan.map((episode) => episode.number),
    );
    const busyKey = episodeNumber
      ? `story-prompts-${recordId}-${episodeNumber}`
      : `story-prompts-${recordId}`;
    setStoryOperationBusy(busyKey, true);
    try {
      const response = await fetch("/api/drama/generate/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetStage: 4,
          model: chatModel,
          snapshot: buildStageGenerationSnapshot(4, {
            ...record.snapshot,
            episodes: selectedEpisodePlan.length,
            episodePlan: selectedEpisodePlan,
          }),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        model?: string;
        diagnostic?: KieDiagnostic;
        result?: {
          scenes?: Array<{
            id: string;
            episode: number;
            title: string;
            duration: number;
            prompt: string;
            safety: Scene["safety"];
          }>;
        };
      };
      if (response.status === 401 && payload.error === "missing_credential") {
        showKieCredentialPrompt(
          "Add your KIE AI Key to generate scene prompts for every episode.",
        );
        return;
      }
      if (!response.ok || !payload.result?.scenes?.length) {
        addFailureLog({
          operation: "story_studio_prompt_generation",
          item: record.name,
          model: modelLabel(chatModelOptions, chatModel),
          message: payload.message ?? "Scene prompt generation failed.",
          diagnostic: payload.diagnostic,
        });
        throw new Error(payload.message ?? "Scene prompt generation failed.");
      }
      const scenes: Scene[] = payload.result.scenes.map((scene, index) => ({
        ...scene,
        id: episodeNumber ? `E${episodeNumber}-S${index + 1}` : scene.id,
        episode: episodeNumber ?? scene.episode,
        duration: Math.max(3, Math.min(15, scene.duration)),
        provider: `Kie AI · ${modelLabel(videoModelOptions, videoModel)}`,
        selected: true,
        status: "draft",
      }));
      setWorkflowRecords((current) =>
        current.map((item) =>
          item.id !== recordId
            ? item
            : {
                ...item,
                model: payload.model ?? item.model,
                updatedAt: episodeNumber
                  ? `Episode ${episodeNumber} prompts regenerated just now`
                  : "Selected episode prompts generated just now",
                snapshot: {
                  ...item.snapshot,
                  scenes: [
                    ...item.snapshot.scenes.filter(
                      (scene) => !targetEpisodeNumbers.has(scene.episode),
                    ),
                    ...scenes,
                  ].sort(
                    (first, second) =>
                      first.episode - second.episode ||
                      first.id.localeCompare(second.id),
                  ),
                  completed: Array.from(
                    new Set([...item.snapshot.completed, 2, 3, 4]),
                  ),
                },
              },
        ),
      );
      scheduleCreditRefresh();
      setToast(
        episodeNumber
          ? `Episode ${episodeNumber}: ${scenes.length} scene prompts regenerated.`
          : `${scenes.length} scene prompts generated across ${selectedEpisodePlan.length} ${
              selectedEpisodePlan.length === 1 ? "episode" : "episodes"
            }.`,
      );
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Scene prompt generation failed.",
      );
    } finally {
      setStoryOperationBusy(busyKey, false);
    }
  };

  const regenerateStoryVideo = async (recordId: string, sceneId: string) => {
    const record = workflowRecords.find((item) => item.id === recordId);
    const scene = record?.snapshot.scenes.find((item) => item.id === sceneId);
    if (!record || !scene) return;
    const busyKey = `regenerate-video-${recordId}-${sceneId}`;
    setVideoOperationBusy(busyKey, true);
    const originalScene = { ...scene };
    setWorkflowRecords((current) =>
      current.map((item) =>
        item.id !== recordId
          ? item
          : {
              ...item,
              snapshot: {
                ...item.snapshot,
                scenes: item.snapshot.scenes.map((currentScene) =>
                  currentScene.id === sceneId
                    ? {
                        ...currentScene,
                        resultUrl: undefined,
                        status: "generating" as const,
                      }
                    : currentScene,
                ),
              },
            },
      ),
    );
    try {
      const task = await submitMediaTask({
        kind: "video",
        model: videoModel,
        title:
          record.snapshot.title +
          " · Episode " +
          scene.episode +
          ": " +
          scene.title,
        recordId,
        itemId: scene.id,
        prompt: buildContinuityLockedVideoPrompt(record.snapshot, scene),
        duration: scene.duration,
        aspectRatio: record.snapshot.aspectRatio,
        mode: videoMode,
        sound: videoSound,
      });
      setWorkflowRecords((current) =>
        current.map((item) =>
          item.id !== recordId
            ? item
            : {
                ...item,
                model: task.model,
                updatedAt: `${scene.title} regeneration submitted just now`,
                snapshot: {
                  ...item.snapshot,
                  scenes: item.snapshot.scenes.map((currentScene) =>
                    currentScene.id === sceneId
                      ? {
                          ...currentScene,
                          taskId: task.taskId,
                          provider: task.model,
                          resultUrl: undefined,
                          status: "generating" as const,
                        }
                      : currentScene,
                  ),
                },
              },
        ),
      );
      setToast(`${scene.title} is regenerating with ${task.model}.`);
    } catch (error) {
      setWorkflowRecords((current) =>
        current.map((item) =>
          item.id !== recordId
            ? item
            : {
                ...item,
                snapshot: {
                  ...item.snapshot,
                  scenes: item.snapshot.scenes.map((currentScene) =>
                    currentScene.id === sceneId
                      ? { ...originalScene }
                      : currentScene,
                  ),
                },
              },
        ),
      );
      const diagnosticError = error as DiagnosticError;
      addFailureLog({
        operation: "video_regeneration_submission",
        item: scene.title,
        model: modelLabel(videoModelOptions, videoModel),
        message:
          error instanceof Error ? error.message : "Video regeneration failed.",
        taskId: scene.taskId,
        diagnostic: diagnosticError.diagnostic,
      });
      if (!(error instanceof Error) || error.message !== "KIE AI Key required.") {
        setToast(
          error instanceof Error ? error.message : "Video regeneration failed.",
        );
      }
    } finally {
      setVideoOperationBusy(busyKey, false);
    }
  };

  const generateStoryEpisode = async (
    recordId: string,
    episodeNumber: number,
    operation: "generate" | "generate-combine",
  ) => {
    const record = workflowRecords.find((item) => item.id === recordId);
    const targets = record?.snapshot.scenes.filter(
      (scene) => scene.episode === episodeNumber,
    );
    if (!record || !targets?.length) return;
    const busyKey = `generate-episode-${operation}-${recordId}-${episodeNumber}`;
    setVideoOperationBusy(busyKey, true);
    const originalScenes = new Map(
      targets.map((scene) => [scene.id, { ...scene }]),
    );
    const submittedSceneIds = new Set<string>();
    setWorkflowRecords((current) =>
      current.map((item) =>
        item.id !== recordId
          ? item
          : {
              ...item,
              snapshot: {
                ...item.snapshot,
                scenes: item.snapshot.scenes.map((scene) =>
                  scene.episode === episodeNumber
                    ? {
                        ...scene,
                        resultUrl: undefined,
                        status: "generating" as const,
                      }
                    : scene,
                ),
              },
            },
      ),
    );
    let submittedCount = 0;
    let failedCount = 0;
    try {
      for (const scene of targets) {
        try {
          const task = await submitMediaTask({
            kind: "video",
            model: videoModel,
            title:
              record.snapshot.title +
              " · Episode " +
              scene.episode +
              ": " +
              scene.title,
            recordId,
            itemId: scene.id,
            prompt: buildContinuityLockedVideoPrompt(record.snapshot, scene),
            duration: scene.duration,
            aspectRatio: record.snapshot.aspectRatio,
            mode: videoMode,
            sound: videoSound,
          });
          submittedCount += 1;
          submittedSceneIds.add(scene.id);
          setWorkflowRecords((current) =>
            current.map((item) =>
              item.id !== recordId
                ? item
                : {
                    ...item,
                    model: task.model,
                    updatedAt: `Episode ${episodeNumber} generation submitted just now`,
                    snapshot: {
                      ...item.snapshot,
                      scenes: item.snapshot.scenes.map((currentScene) =>
                        currentScene.id === scene.id
                          ? {
                              ...currentScene,
                              taskId: task.taskId,
                              provider: task.model,
                              resultUrl: undefined,
                              status: "generating" as const,
                            }
                          : currentScene,
                      ),
                    },
                  },
            ),
          );
        } catch (error) {
          failedCount += 1;
          const originalScene = originalScenes.get(scene.id);
          if (originalScene) {
            setWorkflowRecords((current) =>
              current.map((item) =>
                item.id !== recordId
                  ? item
                  : {
                      ...item,
                      snapshot: {
                        ...item.snapshot,
                        scenes: item.snapshot.scenes.map((currentScene) =>
                          currentScene.id === scene.id
                            ? { ...originalScene }
                            : currentScene,
                        ),
                      },
                    },
              ),
            );
          }
          const diagnosticError = error as DiagnosticError;
          addFailureLog({
            operation: "episode_video_generation_submission",
            item: `Episode ${episodeNumber} · ${scene.title}`,
            model: modelLabel(videoModelOptions, videoModel),
            message:
              error instanceof Error ? error.message : "Episode generation failed.",
            taskId: scene.taskId,
            diagnostic: diagnosticError.diagnostic,
          });
          if (error instanceof Error && error.message === "KIE AI Key required.") {
            break;
          }
        }
      }
      if (submittedCount > 0) {
        setToast(
          `Episode ${episodeNumber}: ${submittedCount} clips started with ${modelLabel(
            videoModelOptions,
            videoModel,
          )}${failedCount ? `; ${failedCount} failed to submit.` : "."}`,
        );
      } else if (failedCount > 0) {
        setToast(
          `Episode ${episodeNumber} could not start. Check the failed-task output.`,
        );
      }
    } finally {
      const notSubmitted = new Set(
        targets
          .filter((scene) => !submittedSceneIds.has(scene.id))
          .map((scene) => scene.id),
      );
      if (notSubmitted.size) {
        setWorkflowRecords((current) =>
          current.map((item) =>
            item.id !== recordId
              ? item
              : {
                  ...item,
                  snapshot: {
                    ...item.snapshot,
                    scenes: item.snapshot.scenes.map((currentScene) => {
                      const originalScene = originalScenes.get(currentScene.id);
                      return notSubmitted.has(currentScene.id) && originalScene
                        ? { ...originalScene }
                        : currentScene;
                    }),
                  },
                },
          ),
        );
      }
      setVideoOperationBusy(busyKey, false);
    }
  };

  const generateCurrentStage = async () => {
    if (activeStep === 1 && !roughStory.trim()) {
      setToast("Add a rough story before generating the finished brief.");
      return;
    }
    if (activeStep > 1 && !draftSourceId) {
      setToast(`Select a finished ${stageItemNames[activeStep - 1].singular}.`);
      return;
    }
    if (
      activeStep === 5 &&
      (!assets.length || assets.some((asset) => asset.status !== "ready"))
    ) {
      setToast("Finish every Story Studio asset before generating final videos.");
      return;
    }

    setBusy("stage-generate");
    try {
      const snapshot = cloneSnapshot(productionSnapshot);
      let model = "Kie AI";
      let generationNotice = "";

      if (activeStep <= 4) {
        const response = await fetch("/api/drama/generate/stage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetStage: activeStep,
            model: chatModel,
            snapshot: buildStageGenerationSnapshot(
              activeStep as 1 | 2 | 3 | 4,
              snapshot,
            ),
          }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          message?: string;
          model?: string;
          diagnostic?: KieDiagnostic;
          result?: {
            brief?: string;
            storyline?: string;
            episodes?: EpisodeOutline[];
            characters?: CharacterProfile[];
            assets?: Array<{
              name: string;
              type: Asset["type"];
              detail: string;
              visualPrompt: string;
            }>;
            scenes?: Array<{
              id: string;
              episode: number;
              title: string;
              duration: number;
              prompt: string;
              safety: Scene["safety"];
            }>;
          };
        };
        if (response.status === 401 && payload.error === "missing_credential") {
          addFailureLog({
            operation: "structured_stage_generation",
            item: steps[activeStep - 1].label,
            model: modelLabel(chatModelOptions, chatModel),
            message:
              payload.message ??
              "The saved KIE AI credential was not available to this request.",
            diagnostic: payload.diagnostic,
          });
          showKieCredentialPrompt(
            "Add your KIE AI Key to generate briefs, stories, assets, prompts, and video.",
          );
          return;
        }
        if (!response.ok || !payload.result) {
          addFailureLog({
            operation: "structured_stage_generation",
            item: steps[activeStep - 1].label,
            model: modelLabel(chatModelOptions, chatModel),
            message: payload.message ?? "Kie AI generation failed.",
            diagnostic: payload.diagnostic,
          });
          throw new Error(payload.message ?? "Kie AI generation failed.");
        }

        model = payload.model ?? "Kie AI";
        if (activeStep === 1) {
          snapshot.generatedBrief = payload.result.brief ?? "";
        }
        if (activeStep === 2) {
          snapshot.storyline = payload.result.storyline ?? "";
          snapshot.episodePlan = payload.result.episodes ?? [];
          snapshot.characters = payload.result.characters ?? [];
          snapshot.assets = (payload.result.assets ?? []).map((asset, index) => ({
            id: `${asset.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")}-${index + 1}`,
            name: asset.name,
            type: asset.type,
            detail: asset.detail,
            visualPrompt: stripImageAspectRatio(asset.visualPrompt),
            crop: `${18 + ((index * 17) % 74)}% center`,
            selected: true,
            status: "planned" as const,
          }));
          snapshot.scenes = [];
          snapshot.episodeDrafts = snapshot.episodePlan.length;
        }
        if (activeStep === 3) {
          const planned = (payload.result.assets ?? []).map((asset, index) => ({
            id: `${asset.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")}-${index + 1}`,
            name: asset.name,
            type: asset.type,
            detail: asset.detail,
            visualPrompt: stripImageAspectRatio(asset.visualPrompt),
            crop: `${18 + ((index * 17) % 74)}% center`,
            selected: true,
            status: "planned" as const,
          }));
          if (!planned.length) {
            throw new Error("Kie AI returned no visual assets to generate.");
          }
          const submitted: Asset[] = [];
          for (let index = 0; index < planned.length; index += 1) {
            const asset = planned[index];
            try {
              const task = await submitMediaTask({
                kind: "image",
                model: imageModel,
                title: snapshot.title + " · " + asset.name,
                recordId: "draft-stage-" + activeStep,
                itemId: asset.id,
                prompt: buildDistinctAssetImagePrompt(
                  snapshot,
                  asset,
                  index,
                  planned.length,
                ),
                aspectRatio: snapshot.aspectRatio,
              });
              submitted.push({
                ...asset,
                taskId: task.taskId,
                resultUrl: undefined,
                progress: 0,
                error: undefined,
                status: "generating",
              });
            } catch (error) {
              const diagnosticError = error as DiagnosticError;
              addFailureLog({
                operation: "image_task_submission",
                item: asset.name,
                model: modelLabel(imageModelOptions, imageModel),
                message:
                  error instanceof Error
                    ? error.message
                    : "Unknown image task submission error.",
                diagnostic: diagnosticError.diagnostic,
              });
              if (!submitted.length) throw error;
              submitted.push(...planned.slice(index));
              generationNotice =
                error instanceof Error
                  ? `${index} image tasks were submitted before Kie stopped: ${error.message}`
                  : "Some asset image tasks could not be submitted.";
              break;
            }
          }
          snapshot.assets = submitted;
          model = `${payload.model ?? "Kie AI"} + Kie AI · ${modelLabel(
            imageModelOptions,
            imageModel,
          )}`;
        }
        if (activeStep === 4) {
          snapshot.scenes = (payload.result.scenes ?? []).map((scene) => ({
            ...scene,
            duration: Math.max(3, Math.min(15, scene.duration)),
            provider: `Kie AI · ${modelLabel(videoModelOptions, videoModel)}`,
            selected: true,
            status: "draft",
          }));
        }
      } else {
        const targets = snapshot.scenes.filter((scene) => scene.selected);
        if (!targets.length) throw new Error("Select at least one scene.");
        const submittedScenes: Scene[] = [];
        let submittedCount = 0;
        for (let index = 0; index < snapshot.scenes.length; index += 1) {
          const scene = snapshot.scenes[index];
          if (!scene.selected) {
            submittedScenes.push(scene);
            continue;
          }
          try {
            const task = await submitMediaTask({
              kind: "video",
              model: videoModel,
              title:
                snapshot.title +
                " · Episode " +
                scene.episode +
                ": " +
                scene.title,
              recordId: "draft-stage-" + activeStep,
              itemId: scene.id,
              prompt: buildContinuityLockedVideoPrompt(snapshot, scene),
              duration: scene.duration,
              aspectRatio: snapshot.aspectRatio,
              mode: videoMode,
              sound: videoSound,
            });
            submittedCount += 1;
            submittedScenes.push({
              ...scene,
              taskId: task.taskId,
              provider: task.model,
              status: "generating",
            });
            model = task.model;
          } catch (error) {
            const diagnosticError = error as DiagnosticError;
            addFailureLog({
              operation: "video_task_submission",
              item: scene.title,
              model: modelLabel(videoModelOptions, videoModel),
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown video task submission error.",
              taskId: scene.taskId,
              diagnostic: diagnosticError.diagnostic,
            });
            if (!submittedCount) throw error;
            submittedScenes.push(...snapshot.scenes.slice(index));
            generationNotice =
              error instanceof Error
                ? `${submittedCount} video tasks were submitted before Kie stopped: ${error.message}`
                : "Some video tasks could not be submitted.";
            break;
          }
        }
        snapshot.scenes = submittedScenes;
        model =
          model === "Kie AI"
            ? `Kie AI · ${modelLabel(videoModelOptions, videoModel)}`
            : model;
      }

      snapshot.completed = Array.from(
        new Set([...snapshot.completed, activeStep]),
      );
      const record = {
        ...makeRecord(activeStep, snapshot, draftSourceId || undefined),
        model,
      };
      setWorkflowRecords((current) => [...current, record]);
      setSelectedRecordIds((current) => ({
        ...current,
        [activeStep]: record.id,
      }));
      applySnapshot(snapshot);
      setWorkspaceView("library");
      setEditingRecordId("");
      scheduleCreditRefresh();
      setToast(
        generationNotice ||
          `${steps[activeStep - 1].label} generated with ${model} and added to the library.`,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "KIE AI Key required."
      ) {
        setToast(
          error instanceof Error
            ? error.message
            : "Kie AI could not generate this stage.",
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const refreshKieTasks = async (recordId: string, quiet = false) => {
    const record = workflowRecords.find((item) => item.id === recordId);
    if (!record) return;
    const taskIds = Array.from(
      new Set(
        [
          ...record.snapshot.assets
            .filter((asset) => !quiet || asset.status === "generating")
            .map((asset) => asset.taskId),
          ...record.snapshot.scenes
            .filter((scene) => !quiet || scene.status === "generating")
            .map((scene) => scene.taskId),
        ].filter((taskId): taskId is string => Boolean(taskId)),
      ),
    );
    if (!taskIds.length) {
      if (!quiet) setToast("This item has no Kie media tasks to refresh.");
      return;
    }

    if (!quiet) setBusy(`refresh-${recordId}`);
    try {
      const statuses = new Map<
        string,
        {
          state: string;
          resultUrl?: string;
          message?: string;
          failCode?: string;
          model?: string;
          progress?: number;
        }
      >();
      await Promise.all(
        taskIds.map(async (taskId) => {
          const response = await fetch(
            `/api/drama/generate/media?taskId=${encodeURIComponent(taskId)}`,
          );
          const payload = (await response.json()) as {
            error?: string;
            message?: string;
            state?: string;
            resultUrls?: string[];
            failCode?: string;
            model?: string;
            progress?: number;
            diagnostic?: KieDiagnostic;
          };
          if (response.status === 401 && payload.error === "missing_credential") {
            if (!quiet) {
              showKieCredentialPrompt(
                "Add your KIE AI Key to check Kie image and video tasks.",
              );
            }
            addFailureLog({
              id: `missing-credential-${taskId}`,
              operation: "media_task_status",
              item: record.name,
              model: record.model ?? "Kie AI",
              taskId,
              message: payload.message ?? "KIE AI Key required.",
              diagnostic: payload.diagnostic,
            });
            if (quiet) {
              setWorkflowRecords((current) =>
                current.map((item) =>
                  item.id !== recordId
                    ? item
                    : {
                        ...item,
                        snapshot: {
                          ...item.snapshot,
                          assets: item.snapshot.assets.map((asset) =>
                            asset.taskId === taskId
                              ? { ...asset, status: "planned" as const }
                              : asset,
                          ),
                          scenes: item.snapshot.scenes.map((scene) =>
                            scene.taskId === taskId
                              ? { ...scene, status: "queued" as const }
                              : scene,
                          ),
                        },
                      },
                ),
              );
            }
            throw new Error("KIE AI Key required.");
          }
          if (!response.ok || !payload.state) {
            addFailureLog({
              operation: "media_task_status",
              item: record.name,
              model: payload.model ?? record.model ?? "Kie AI",
              taskId,
              message: payload.message ?? "Could not refresh a Kie task.",
              diagnostic: payload.diagnostic,
            });
            throw new Error(payload.message ?? "Could not refresh a Kie task.");
          }
          if (payload.state === "fail") {
            addFailureLog({
              id: `failed-task-${taskId}-${payload.failCode ?? "unknown"}`,
              operation: "media_task_failed",
              item:
                record.snapshot.assets.find(
                  (asset) => asset.taskId === taskId,
                )?.name ??
                record.snapshot.scenes.find(
                  (scene) => scene.taskId === taskId,
                )?.title ??
                record.name,
              model: payload.model ?? record.model ?? "Kie AI",
              taskId,
              message:
                payload.message ||
                `Kie AI marked this task as failed${
                  payload.failCode ? ` (${payload.failCode})` : ""
                }.`,
              diagnostic: payload.diagnostic,
            });
          }
          const resultUrl = payload.resultUrls?.[0];
          const effectiveState =
            payload.state === "success" && !resultUrl
              ? "generating"
              : payload.state;
          statuses.set(taskId, {
            state: effectiveState,
            resultUrl,
            message: payload.message,
            failCode: payload.failCode,
            model: payload.model,
            progress:
              effectiveState === "generating" && payload.state === "success"
                ? 99
                : payload.progress,
          });
        }),
      );

      const newlyCompletedTask = [...statuses.entries()].some(
        ([taskId, task]) =>
          task.state === "success" &&
          (record.snapshot.assets.some(
            (asset) => asset.taskId === taskId && asset.status === "generating",
          ) ||
            record.snapshot.scenes.some(
              (scene) => scene.taskId === taskId && scene.status === "generating",
            )),
      );
      if (newlyCompletedTask) {
        scheduleCreditRefresh();
        window.parent.postMessage(
          { type: "cabuild:drama-queue-updated" },
          window.location.origin,
        );
      }

      setWorkflowRecords((current) =>
        current.map((item) => {
          if (item.id !== recordId) return item;
          const snapshot = cloneSnapshot(item.snapshot);
          snapshot.assets = snapshot.assets.map((asset) => {
            const task = asset.taskId ? statuses.get(asset.taskId) : undefined;
            if (!task) return asset;
            return {
              ...asset,
              status:
                task.state === "success"
                  ? "ready"
                  : task.state === "fail"
                    ? "planned"
                    : "generating",
              resultUrl: task.resultUrl ?? asset.resultUrl,
              progress:
                task.state === "success"
                  ? 100
                  : task.state === "fail"
                    ? undefined
                    : task.progress ?? asset.progress,
              error:
                task.state === "fail"
                  ? task.message ||
                    `Kie AI failed to generate this image${
                      task.failCode ? ` (${task.failCode})` : ""
                    }.`
                  : undefined,
            };
          });
          snapshot.scenes = snapshot.scenes.map((scene) => {
            const task = scene.taskId ? statuses.get(scene.taskId) : undefined;
            if (!task) return scene;
            return {
              ...scene,
              status:
                task.state === "success"
                  ? "ready"
                  : task.state === "fail"
                    ? "queued"
                    : "generating",
              resultUrl: task.resultUrl ?? scene.resultUrl,
            };
          });
          return { ...item, snapshot, updatedAt: "Kie status checked just now" };
        }),
      );
      const failedTasks = [...statuses.values()].filter(
        (task) => task.state === "fail",
      );
      if (failedTasks.length > 0) {
        setToast(
          failedTasks[0].message ||
            `Kie AI reported ${failedTasks.length} failed media task${
              failedTasks.length === 1 ? "" : "s"
            }.`,
        );
      } else if (!quiet) {
        setToast("Kie AI task statuses refreshed.");
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "KIE AI Key required."
      ) {
        if (!quiet) {
          setToast(
            error instanceof Error
              ? error.message
              : "Could not refresh Kie tasks.",
          );
        }
      }
    } finally {
      if (!quiet) setBusy(null);
    }
  };

  const pendingMediaTasks = workflowRecords.flatMap((record) => [
    ...record.snapshot.assets.flatMap((asset) =>
      asset.taskId && asset.status === "generating"
        ? [{ recordId: record.id, taskId: asset.taskId }]
        : [],
    ),
    ...record.snapshot.scenes.flatMap((scene) =>
      scene.taskId && scene.status === "generating"
        ? [{ recordId: record.id, taskId: scene.taskId }]
        : [],
    ),
  ]);
  const pendingMediaTaskSignature = pendingMediaTasks
    .map(({ recordId, taskId }) => `${recordId}:${taskId}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!hydrated || !pendingMediaTaskSignature) return;
    const recordIds = Array.from(
      new Set(pendingMediaTasks.map(({ recordId }) => recordId)),
    );
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        await Promise.all(
          recordIds.map((recordId) => refreshKieTasks(recordId, true)),
        );
      } finally {
        polling = false;
      }
    };
    const starter = window.setTimeout(() => void poll(), 1200);
    const timer = window.setInterval(() => void poll(), 4000);
    return () => {
      window.clearTimeout(starter);
      window.clearInterval(timer);
    };
    // Restart when tasks are submitted or completed so polling never retains a
    // pre-submission render that did not yet contain the provider task IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, pendingMediaTaskSignature]);

  const navToStep = (step: number) => {
    const selected =
      workflowRecords.find(
        (record) => record.id === selectedRecordIds[step],
      ) ?? workflowRecords.find((record) => record.stage === step);
    openStep(step, selected?.snapshot, "library");
  };
  const deleteCandidate = workflowRecords.find(
    (record) => record.id === deleteCandidateId,
  );
  return (
    <CreditPreviewContext.Provider
      value={{ credits: kieCredits.credits, status: kieCredits.status }}
    >
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <AppSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        title={title}
        episodes={episodes}
        activePage={
          activeStep === 1
            ? "creative-brief"
            : activeStep === 5
              ? "generate-edit"
              : "story-studio"
        }
        onSelectWorkflow={navToStep}
      />

      <main className="main">
        <header className="topbar">
          <div className="topbar-row">
            <div className="title-cluster">
              <button
                className="menu-button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
              >
                <Menu size={18} />
              </button>
              <div>
                <div className="page-title">Create a drama</div>
                <div className="breadcrumbs">
                  Productions <span>/</span> {title || "Untitled"}{" "}
                  <span>/</span> {steps[activeStep - 1].label}
                </div>
              </div>
            </div>
            <div className="topbar-actions">
              <WorkspaceModeSwitcher activeMode="drama" />
              <div className={`save-state ${saved ? "saved" : ""}`}>
                {saved ? <Check size={12} /> : <Activity size={12} />}
                {saved ? "All changes saved" : "Saving…"}
              </div>
              <Link href="/drama-studio" className="quiet-button">
                <Clock3 size={14} />
                History
              </Link>
              <button
                className="credit-pill"
                onClick={() => {
                  void kieCredits.refresh();
                  setToast(kieCredits.message);
                }}
                title={kieCredits.message}
              >
                <Zap size={13} fill="currentColor" />
                {kieCredits.label}
              </button>
              <Link
                href="/drama-studio"
                className="icon-button"
                aria-label="Settings"
              >
                <Settings size={16} />
              </Link>
            </div>
          </div>

          <div className="production-strip">
            <div className="strip-stat">
              <span>Format</span>
              <b>
                {episodes} × {episodeLength} min
              </b>
            </div>
            <div className="strip-stat">
              <span>Scenes planned</span>
              <b>{scenes.length}</b>
            </div>
            <div className="strip-stat">
              <span>Assets ready</span>
              <b>{assets.filter((asset) => asset.status === "ready").length}</b>
            </div>
            <div className="strip-stat">
              <span>Video ready</span>
              <b>
                {readyScenes}/{scenes.length}
              </b>
            </div>
            <div className="strip-spacer" />
            <span className="demo-pill">
              <span className="demo-dot" />
              Guided workspace
            </span>
          </div>
        </header>

        <div className="main-panel">
          <section className="step-hero">
            <div className="step-hero-copy">
              <span className="step-kicker">Drama workflow</span>
              <h1>{steps[activeStep - 1].label}</h1>
              <p>{getStepDescription(activeStep)}</p>
            </div>
          </section>

          <section className="drama-reference-panel" aria-labelledby="drama-reference-title">
            <div className="drama-reference-head">
              <div>
                <span className="context-kicker">Optional continuity controls</span>
                <h2 id="drama-reference-title">Reference assets</h2>
                <p>
                  Select saved Persona media or upload a workspace-owned reference.
                  Selected assets are included in every new image or video request.
                </p>
              </div>
              <span className="drama-reference-count">
                {selectedReferenceIds.length} selected
              </span>
            </div>

            {referenceAssets.length > 0 ? (
              <div className="drama-reference-list">
                {referenceAssets.map((asset) => {
                  const selected = selectedReferenceIds.includes(asset.id);
                  return (
                    <button
                      type="button"
                      key={asset.id}
                      className={"drama-reference-chip " + (selected ? "selected" : "")}
                      aria-pressed={selected}
                      onClick={() =>
                        setSelectedReferenceIds((current) =>
                          selected
                            ? current.filter((id) => id !== asset.id)
                            : [...current, asset.id],
                        )
                      }
                    >
                      {asset.role === "audio" ? (
                        <Play size={14} />
                      ) : (
                        <ImageIcon size={14} />
                      )}
                      <span>
                        <b>{asset.label}</b>
                        <small>{asset.role}</small>
                      </span>
                      {selected && <Check size={13} />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="drama-reference-empty">
                No saved Persona media yet. Upload one below to save and select it.
              </p>
            )}

            <div className="drama-reference-uploads">
              {referenceRoleOptions.map((option) => (
                <label
                  className={
                    "drama-reference-upload " +
                    (referenceBusyRole === option.role ? "busy" : "")
                  }
                  key={option.role}
                >
                  <input
                    type="file"
                    accept={option.accept}
                    disabled={referenceBusyRole !== null}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadReferenceAsset(option.role, file);
                    }}
                  />
                  <Plus size={14} />
                  {referenceBusyRole === option.role
                    ? "Uploading…"
                    : option.label}
                </label>
              ))}
            </div>
            <p className="drama-reference-note">
              References use GPT Image 2 or Seedream 4.5 for images and Seedance
              2.0 for video. Unsupported model combinations are blocked before a
              paid task is created.
            </p>
          </section>

          {failureLogs.length > 0 && (
            <section className="temporary-error-log" aria-live="polite">
              <div className="temporary-error-log-head">
                <div>
                  <span className="context-kicker">Temporary diagnostic area</span>
                  <h2>Kie failed-task output</h2>
                  <p>
                    Safe to send to Codex. The API key and Authorization header
                    are never included.
                  </p>
                </div>
                <div className="temporary-error-log-actions">
                  <button
                    className="secondary-button"
                    onClick={() => void copyFailureLogs()}
                  >
                    <Copy size={13} /> Copy failed-task output
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setFailureLogs([])}
                  >
                    <X size={13} /> Clear
                  </button>
                </div>
              </div>
              <textarea
                aria-label="Kie failed-task output"
                readOnly
                value={JSON.stringify(
                  {
                    notice:
                      "Sanitized diagnostics. API keys and Authorization headers are excluded.",
                    entries: failureLogs,
                  },
                  null,
                  2,
                )}
              />
              <div className="temporary-error-log-foot">
                <ShieldAlert size={13} />
                <span>
                  The credential fingerprint confirms which saved key was used
                  without revealing the key itself.
                </span>
                <Link href="/drama-studio">
                  Verify saved KIE AI Key
                </Link>
              </div>
            </section>
          )}

          {workspaceView === "library" && (
            <WorkflowContextBar
              key={activeStep}
              stage={activeStep}
              records={activeRecords}
              allRecords={workflowRecords}
              selectedId={activeRecord?.id ?? ""}
              busy={busy}
              storyBusyKeys={storyBusyKeys}
              videoBusyKeys={videoBusyKeys}
              onCreate={() => startCreate(activeStep)}
              onUse={(recordId) => {
                if (activeStep === 5) {
                  selectWorkflowRecord(recordId);
                  return;
                }
                createNextFromRecord(recordId);
              }}
              onDelete={setDeleteCandidateId}
              onChange={updateWorkflowRecordContent}
              onUpdateSnapshot={updateWorkflowRecordSnapshot}
              imageModel={imageModel}
              setImageModel={setImageModel}
              chatModel={chatModel}
              setChatModel={setChatModel}
              videoModel={videoModel}
              setVideoModel={setVideoModel}
              videoMode={videoMode}
              setVideoMode={setVideoMode}
              videoSound={videoSound}
              setVideoSound={setVideoSound}
              onGenerateAsset={(recordId, assetId) =>
                void generateStoryAsset(recordId, assetId)
              }
              onGenerateAssetGroup={(recordId, assetType) =>
                void generateStoryAssetGroup(recordId, assetType)
              }
              onGeneratePrompts={(recordId, episodeCount, episodeNumber) =>
                void generateStoryPrompts(recordId, episodeCount, episodeNumber)
              }
              onRegenerateVideo={(recordId, sceneId) =>
                void regenerateStoryVideo(recordId, sceneId)
              }
              onGenerateEpisode={(recordId, episodeNumber, operation) =>
                void generateStoryEpisode(recordId, episodeNumber, operation)
              }
            />
          )}

          {workspaceView === "create" && activeStep === 1 && (
            <StepOne
              values={{
                title,
                roughStory,
                episodes,
                episodeLength,
                style,
                language,
                aspectRatio,
                pacing,
                audience,
                rating,
                tone,
              }}
              setters={{
                setTitle,
                setRoughStory,
                setEpisodes,
                setEpisodeLength,
                setStyle,
                setLanguage,
                setAspectRatio,
                setPacing,
                setAudience,
                setRating,
                setTone,
              }}
              busy={busy}
              briefSeedBusy={briefSeedBusy}
              chatModel={chatModel}
              setChatModel={setChatModel}
              markChanged={markChanged}
              onGenerateSeed={() => void generateCreativeSeed()}
              onContinue={() => void generateCurrentStage()}
            />
          )}

          {workspaceView === "create" && activeStep > 1 && (
            <StageCreationPanel
              stage={activeStep}
              sourceRecords={sourceRecords}
              selectedSourceId={draftSourceId}
              snapshot={productionSnapshot}
              scenes={scenes}
              setScenes={setScenes}
              busy={busy}
              videoMode={videoMode}
              setVideoMode={setVideoMode}
              videoSound={videoSound}
              setVideoSound={setVideoSound}
              chatModel={chatModel}
              setChatModel={setChatModel}
              imageModel={imageModel}
              setImageModel={setImageModel}
              videoModel={videoModel}
              setVideoModel={setVideoModel}
              onSelectSource={selectSourceRecord}
              onBack={() => setWorkspaceView("library")}
              onGenerate={() => void generateCurrentStage()}
            />
          )}

          {workspaceView === "edit" && (
            <StageResultEditor
              stage={activeStep}
              snapshot={productionSnapshot}
              setGeneratedBrief={setGeneratedBrief}
              setStoryline={setStoryline}
              setEpisodePlan={setEpisodePlan}
              setCharacters={setCharacters}
              setAssets={setAssets}
              setScenes={setScenes}
              onBack={() => setWorkspaceView("library")}
              onSave={() => {
                saveActiveRecord();
                setWorkspaceView("library");
                setToast("Your manual edits were saved.");
              }}
              onRegenerate={() => {
                const record = workflowRecords.find(
                  (item) => item.id === editingRecordId,
                );
                if (activeStep === 1) {
                  setDraftSourceId("");
                  setWorkspaceView("create");
                  return;
                }
                startCreate(activeStep, record?.sourceId);
              }}
            />
          )}
        </div>
      </main>

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          <span>{toast}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {deleteCandidate && (
        <div className="confirmation-scrim" role="presentation">
          <section
            className="confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-record-title"
            aria-describedby="delete-record-description"
          >
            <div className="confirmation-icon"><X size={19} /></div>
            <div>
              <span className="context-kicker">Confirm deletion</span>
              <h2 id="delete-record-title">Delete this result?</h2>
              <p id="delete-record-description">
                “{deleteCandidate.name}” will be removed from this page. Generated
                images already saved in Asset Library will remain reusable.
              </p>
            </div>
            <div className="confirmation-actions">
              <button className="secondary-button" onClick={() => setDeleteCandidateId(null)}>
                Cancel
              </button>
              <button
                className="danger-button"
                onClick={() => deleteWorkflowRecord(deleteCandidate.id)}
              >
                Delete result
              </button>
            </div>
          </section>
        </div>
      )}

      {credentialPrompt && (
        <div className="credential-prompt-scrim" role="presentation">
          <section
            className="credential-prompt-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credential-prompt-title"
          >
            <div className="credential-prompt-icon">
              <KeyRound size={20} />
            </div>
            <div>
              <span className="context-kicker">Credential needed</span>
              <h2 id="credential-prompt-title">{credentialPrompt.title}</h2>
              <p>{credentialPrompt.message}</p>
            </div>
            <div className="credential-prompt-actions">
              <button
                className="secondary-button"
                onClick={() => setCredentialPrompt(null)}
              >
                Not now
              </button>
              <Link
                href="/drama-studio"
                className="primary-button"
              >
                <KeyRound size={14} />
                Add KIE AI Key
              </Link>
            </div>
          </section>
        </div>
      )}
    </div>
    </CreditPreviewContext.Provider>
  );
}

function WorkflowContextBar({
  stage,
  records,
  allRecords,
  selectedId,
  busy,
  storyBusyKeys,
  videoBusyKeys,
  onCreate,
  onUse,
  onDelete,
  onChange,
  onUpdateSnapshot,
  imageModel,
  setImageModel,
  chatModel,
  setChatModel,
  videoModel,
  setVideoModel,
  videoMode,
  setVideoMode,
  videoSound,
  setVideoSound,
  onGenerateAsset,
  onGenerateAssetGroup,
  onGeneratePrompts,
  onRegenerateVideo,
  onGenerateEpisode,
}: {
  stage: number;
  records: WorkflowRecord[];
  allRecords: WorkflowRecord[];
  selectedId: string;
  busy: string | null;
  storyBusyKeys: string[];
  videoBusyKeys: string[];
  onCreate: () => void;
  onUse: (recordId: string) => void;
  onDelete: (recordId: string) => void;
  onChange: (recordId: string, value: string) => void;
  onUpdateSnapshot: (
    recordId: string,
    patch: Partial<ProductionSnapshot>,
  ) => void;
  imageModel: ImageModelId;
  setImageModel: (value: ImageModelId) => void;
  chatModel: ChatModelId;
  setChatModel: (value: ChatModelId) => void;
  videoModel: VideoModelId;
  setVideoModel: (value: VideoModelId) => void;
  videoMode: "std" | "pro" | "4K";
  setVideoMode: (value: "std" | "pro" | "4K") => void;
  videoSound: boolean;
  setVideoSound: (value: boolean) => void;
  onGenerateAsset: (recordId: string, assetId: string) => void;
  onGenerateAssetGroup: (
    recordId: string,
    assetType: "Character" | "World",
  ) => void;
  onGeneratePrompts: (
    recordId: string,
    episodeCount: number,
    episodeNumber?: number,
  ) => void;
  onRegenerateVideo: (recordId: string, sceneId: string) => void;
  onGenerateEpisode: (
    recordId: string,
    episodeNumber: number,
    operation: "generate" | "generate-combine",
  ) => void;
}) {
  const currentName = stageItemNames[stage];
  const useLabel = `Use ${currentName.singular.replace("creative ", "")}`;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState("Newest");
  const [expandedRecordId, setExpandedRecordId] = useState(
    selectedId || records[0]?.id || "",
  );
  const [expandedEpisodeKey, setExpandedEpisodeKey] = useState("");
  const initializedEpisodeRecords = useRef(new Set<string>());
  const [autoCombineEpisodes, setAutoCombineEpisodes] = useState<
    Record<string, boolean>
  >({});
  const [expandedClipKeys, setExpandedClipKeys] = useState<string[]>([]);
  const [episodeInfoKey, setEpisodeInfoKey] = useState("");
  const [combiningEpisodeKey, setCombiningEpisodeKey] = useState("");
  const [combineProgress, setCombineProgress] = useState("");
  const [combineErrors, setCombineErrors] = useState<Record<string, string>>({});
  const [combinedEpisodes, setCombinedEpisodes] = useState<
    Record<string, { url: string; createdAt: string; clipCount: number }>
  >({});

  useEffect(() => {
    if (stage !== 5) return;
    const record =
      records.find((item) => item.id === selectedId) ?? records[0];
    if (!record || initializedEpisodeRecords.current.has(record.id)) return;
    const firstEpisode = [...record.snapshot.scenes]
      .sort((first, second) => first.episode - second.episode)[0]?.episode;
    initializedEpisodeRecords.current.add(record.id);
    if (!firstEpisode) return;
    const timeout = window.setTimeout(
      () => setExpandedEpisodeKey(`${record.id}-${firstEpisode}`),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [records, selectedId, stage]);

  useEffect(() => {
    if (stage !== 5) return;
    let active = true;
    void readCombinedEpisodes()
      .then((entries) => {
        if (!active) return;
        const restored: Record<
          string,
          { url: string; createdAt: string; clipCount: number }
        > = {};
        entries.forEach((entry) => {
          if (restored[entry.id]) return;
          restored[entry.id] = {
            url: URL.createObjectURL(entry.blob),
            createdAt: entry.createdAt,
            clipCount: entry.scenes.length,
          };
        });
        setCombinedEpisodes(restored);
      })
      .catch(() => {
        // Episode clips remain usable if this browser blocks IndexedDB.
      });
    return () => {
      active = false;
    };
  }, [stage]);

  const combineEpisode = useCallback(async (
    record: WorkflowRecord,
    episodeNumber: number,
  ) => {
    const episodeKey = `${record.id}-${episodeNumber}`;
    const allEpisodeScenes = record.snapshot.scenes
      .filter((scene) => scene.episode === episodeNumber)
      .sort((first, second) => first.id.localeCompare(second.id));
    const episodeScenes = allEpisodeScenes;
    const urls = episodeScenes.flatMap((scene) =>
      scene.status === "ready" && scene.resultUrl ? [scene.resultUrl] : [],
    );
    if (urls.length !== episodeScenes.length || urls.length === 0) {
      setCombineErrors((current) => ({
        ...current,
        [episodeKey]: "Generate every clip in this episode before combining it.",
      }));
      return;
    }

    setCombiningEpisodeKey(episodeKey);
    setCombineProgress("Preparing episode assembly…");
    setCombineErrors((current) => ({ ...current, [episodeKey]: "" }));
    try {
      const { combineEpisodeVideos } = await import(
        "@/lib/drama/combine-episode-videos"
      );
      const { blob, url } = await combineEpisodeVideos(urls, setCombineProgress);
      const episodeTitle =
        record.snapshot.episodePlan.find(
          (episode) => episode.number === episodeNumber,
        )?.title ?? `Episode ${episodeNumber}`;
      const createdAt = new Date().toISOString();
      await saveCombinedEpisode({
        id: episodeKey,
        recordId: record.id,
        project: record.snapshot.title || "Untitled drama",
        episode: episodeNumber,
        episodeTitle,
        createdAt,
        blob,
        scenes: episodeScenes.map((scene) => ({
          id: scene.id,
          title: scene.title,
          prompt: scene.prompt,
          duration: scene.duration,
          provider: scene.provider,
          resultUrl: scene.resultUrl,
        })),
        assets: record.snapshot.assets.flatMap((asset) =>
          asset.resultUrl
            ? [
                {
                  name: asset.name,
                  type: asset.type,
                  prompt: asset.visualPrompt || asset.detail,
                  resultUrl: asset.resultUrl,
                },
              ]
            : [],
        ),
      });
      setCombinedEpisodes((current) => {
        const previous = current[episodeKey];
        if (previous) URL.revokeObjectURL(previous.url);
        return {
          ...current,
          [episodeKey]: { url, createdAt, clipCount: episodeScenes.length },
        };
      });
      onUpdateSnapshot(record.id, { assembled: true });
    } catch (error) {
      setCombineErrors((current) => ({
        ...current,
        [episodeKey]:
          error instanceof Error
            ? error.message
            : "The episode could not be combined.",
      }));
    } finally {
      setCombiningEpisodeKey("");
      setCombineProgress("");
    }
  }, [onUpdateSnapshot]);

  useEffect(() => {
    if (stage !== 5 || combiningEpisodeKey) return;
    const target = Object.keys(autoCombineEpisodes).find(
      (autoCombineKey) => {
        const separator = autoCombineKey.lastIndexOf("::");
        const recordId = autoCombineKey.slice(0, separator);
        const record = records.find((item) => item.id === recordId);
        if (!record) return false;
        const episodeNumber = Number(autoCombineKey.slice(separator + 2));
        const episodeScenes = record.snapshot.scenes.filter(
          (scene) => scene.episode === episodeNumber,
        );
        return (
          episodeScenes.length > 0 &&
          episodeScenes.every(
            (scene) => scene.status === "ready" && scene.resultUrl,
          )
        );
      },
    );
    if (!target) {
      const stalledTarget = Object.keys(autoCombineEpisodes).find(
        (autoCombineKey) => {
          const separator = autoCombineKey.lastIndexOf("::");
          const recordId = autoCombineKey.slice(0, separator);
          const record = records.find((item) => item.id === recordId);
          if (!record) return true;
          const episodeNumber = Number(autoCombineKey.slice(separator + 2));
          const submissionBusy = videoBusyKeys.includes(
            `generate-episode-generate-combine-${recordId}-${episodeNumber}`,
          );
          const episodeScenes = record.snapshot.scenes.filter(
            (scene) => scene.episode === episodeNumber,
          );
          return (
            !submissionBusy &&
            episodeScenes.length > 0 &&
            !episodeScenes.some((scene) => scene.status === "generating") &&
            episodeScenes.some(
              (scene) => scene.status !== "ready" || !scene.resultUrl,
            )
          );
        },
      );
      if (!stalledTarget) return;
      const separator = stalledTarget.lastIndexOf("::");
      const recordId = stalledTarget.slice(0, separator);
      const episodeNumber = Number(stalledTarget.slice(separator + 2));
      const episodeKey = `${recordId}-${episodeNumber}`;
      const timeout = window.setTimeout(() => {
        setAutoCombineEpisodes((current) => {
          const next = { ...current };
          delete next[stalledTarget];
          return next;
        });
        setCombineErrors((current) => ({
          ...current,
          [episodeKey]:
            "Automatic combine stopped because one or more clips failed to generate. Regenerate the failed clips, then press Combine.",
        }));
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    const autoCombineKey = target;
    const separator = autoCombineKey.lastIndexOf("::");
    const recordId = autoCombineKey.slice(0, separator);
    const record = records.find((item) => item.id === recordId);
    if (!record) return;
    const episodeNumber = Number(autoCombineKey.slice(separator + 2));
    const timeout = window.setTimeout(() => {
      setAutoCombineEpisodes((current) => {
        const next = { ...current };
        delete next[autoCombineKey];
        return next;
      });
      void combineEpisode(record, episodeNumber);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    autoCombineEpisodes,
    combineEpisode,
    combiningEpisodeKey,
    records,
    stage,
    videoBusyKeys,
  ]);

  const preview = (record: WorkflowRecord) => {
    if (stage === 1) {
      return (
        record.snapshot.generatedBrief ||
        "Finished brief unavailable. Open this item to regenerate it with Kie AI."
      );
    }
    if (stage === 2) {
      return (
        record.snapshot.storyline ||
        "Use a finished brief, then press Generate in the Story Bible creator."
      );
    }
    if (stage === 3) {
      return (
        record.snapshot.assets
          .map((asset) => asset.visualPrompt ?? asset.detail)
          .join("\n\n") ||
        "No generated asset descriptions are available in this pack."
      );
    }
    if (stage === 4) {
      return (
        record.snapshot.scenes
          .map((scene) => scene.prompt)
          .join("\n\n") ||
        "No generated scene prompts are available in this set."
      );
    }
    return (
      record.snapshot.scenes
        .map((scene) => scene.prompt)
        .join("\n\n") ||
      "No video generation scenes are available in this job."
    );
  };

  const recordState = (record: WorkflowRecord) => {
    const generating =
      record.snapshot.assets.some((asset) => asset.status === "generating") ||
      record.snapshot.scenes.some((scene) => scene.status === "generating");
    if (generating) return "Generating";
    if (record.id === selectedId) return "Current";
    const ready =
      record.snapshot.completed.includes(stage) ||
      record.snapshot.assets.some((asset) => asset.status === "ready") ||
      record.snapshot.scenes.some((scene) => scene.status === "ready");
    return ready ? "Ready" : "Saved";
  };

  const visibleRecords = records
    .filter((record) => {
      const source = allRecords.find((item) => item.id === record.sourceId);
      const matchesQuery = `${record.name} ${preview(record)} ${source?.name ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase());
      const matchesStatus =
        statusFilter === "All" || recordState(record) === statusFilter;
      return matchesQuery && matchesStatus;
    })
    .sort((first, second) => {
      if (sortOrder === "Oldest") {
        return Date.parse(first.createdAt) - Date.parse(second.createdAt);
      }
      if (sortOrder === "Title A–Z") {
        return first.name.localeCompare(second.name);
      }
      return Date.parse(second.createdAt) - Date.parse(first.createdAt);
    });
  const effectiveExpandedId = visibleRecords.some(
    (record) => record.id === expandedRecordId,
  )
    ? expandedRecordId
    : visibleRecords[0]?.id ?? "";

  return (
    <section className="stage-library-panel">
      <div className="stage-library-head">
        <div className="workflow-context-intro">
          <span className="context-kicker">
            {stage === 1 ? "Brief library" : `${currentName.singular} library`}
          </span>
          <b>
            {records.length}{" "}
            {records.length === 1 ? currentName.singular : currentName.plural}
          </b>
          <small>
            Every generated version stays in this list until you delete it.
          </small>
        </div>

        <div className="context-actions">
          <button className="primary-button compact-primary" onClick={onCreate}>
            <Plus size={14} /> Create new {currentName.singular}
          </button>
        </div>
      </div>

      <div className="stage-library-toolbar" aria-label="Library controls">
        <label className="stage-library-search">
          <Search size={14} />
          <span className="sr-only">Search results</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${currentName.plural}`}
          />
        </label>
        <label className="stage-library-select">
          <span>Filter</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            {['All', 'Current', 'Generating', 'Ready', 'Saved'].map((option) => (
              <option value={option} key={option}>{option}</option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>
        <label className="stage-library-select">
          <span>Sort</span>
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
          >
            {['Newest', 'Oldest', 'Title A–Z'].map((option) => (
              <option value={option} key={option}>{option}</option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>
        <span className="stage-library-result-count">
          {visibleRecords.length} of {records.length}
        </span>
      </div>

      <div className="stage-record-grid">
        {records.length === 0 && (
          <div className="empty-library-card">
            <Sparkles size={22} />
            <h3>No finished {currentName.plural} yet</h3>
            <p>
              Create one with Kie AI. It will appear here only after generation
              succeeds.
            </p>
            <button className="primary-button" onClick={onCreate}>
              <Plus size={14} /> Create {currentName.singular}
            </button>
          </div>
        )}
        {records.length > 0 && visibleRecords.length === 0 && (
          <div className="empty-library-card compact-empty-library">
            <Search size={20} />
            <h3>No matching results</h3>
            <p>Try another search term or filter.</p>
            <button
              className="secondary-button"
              onClick={() => {
                setQuery("");
                setStatusFilter("All");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
        {visibleRecords.map((record) => {
          const selected = record.id === selectedId;
          const loading = busy === `use-${record.id}`;
          const jobGenerating =
            stage === 5 &&
            record.snapshot.scenes.some(
              (scene) => scene.status === "generating",
            );
          const assetsGenerating =
            stage === 3 &&
            record.snapshot.assets.some(
              (asset) => asset.status === "generating",
            );
          const jobReady =
            stage === 5 &&
            record.snapshot.scenes.some((scene) => scene.status === "ready") &&
            record.snapshot.scenes.every(
              (scene) =>
                !scene.selected ||
                scene.status === "ready" ||
                !scene.taskId,
            );
          const expanded = effectiveExpandedId === record.id;
          const source = allRecords.find((item) => item.id === record.sourceId);
          const storyReady =
            stage !== 2 ||
            (record.snapshot.assets.length > 0 &&
              record.snapshot.assets.every((asset) => asset.status === "ready") &&
              record.snapshot.scenes.length > 0);
          const videoEpisodes = Array.from(
            new Set(record.snapshot.scenes.map((scene) => scene.episode)),
          ).sort((first, second) => first - second);
          return (
            <article
              className={`stage-record-card ${
                selected ? "selected" : ""
              } ${stage === 5 ? "video-job-card" : ""} ${
                expanded ? "expanded" : "collapsed"
              }`}
              key={record.id}
            >
              <div className="stage-record-header">
                <button
                  className="record-collapse-button"
                  onClick={() =>
                    setExpandedRecordId(expanded ? "" : record.id)
                  }
                  aria-expanded={expanded}
                  aria-controls={`record-content-${record.id}`}
                >
                  <span className="record-title-stack">
                    <span className="record-title-line">
                      <h3>{record.name}</h3>
                      <span
                        className={`status-pill ${
                          jobGenerating || assetsGenerating
                            ? "warning"
                            : jobReady || recordState(record) === "Ready"
                              ? "ready"
                              : "outline"
                        }`}
                      >
                        {jobGenerating || assetsGenerating
                          ? "Generating"
                          : recordState(record)}
                      </span>
                    </span>
                    <span className="record-detail-line">
                      <span>
                        <Clock3 size={11} /> Produced {formatProducedAt(record.createdAt)}
                      </span>
                      {stage > 1 && (
                        <span>
                          <FolderKanban size={11} /> Source: {source?.name ?? "Unavailable"}
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronDown
                    size={16}
                    className={`record-collapse-chevron ${expanded ? "open" : ""}`}
                  />
                </button>
                <div className="stage-record-header-actions">
                  {stage !== 5 && (
                    <button
                      className="record-arrow-button"
                      onClick={() => onUse(record.id)}
                      disabled={Boolean(busy) || !storyReady}
                      aria-label={`${useLabel}: ${record.name}`}
                      title={useLabel}
                    >
                      {loading ? <LoadingMark /> : <ArrowRight size={18} />}
                    </button>
                  )}
                  <button
                    className="delete-record-button"
                    aria-label={`Delete ${record.name}`}
                    onClick={() => onDelete(record.id)}
                    title="Delete result"
                  >
                    <X size={17} />
                  </button>
                </div>
              </div>
              {expanded && (
              <div
                className="stage-record-body"
                id={`record-content-${record.id}`}
              >
                <div className="stage-record-content">
                  {stage === 2 && (
                    <StoryStudioRecord
                      record={record}
                      storyBusyKeys={storyBusyKeys}
                      imageModel={imageModel}
                      setImageModel={setImageModel}
                      chatModel={chatModel}
                      setChatModel={setChatModel}
                      onChangeStory={(value) => onChange(record.id, value)}
                      onUpdate={(patch) => onUpdateSnapshot(record.id, patch)}
                      onGenerateAsset={(assetId) =>
                        onGenerateAsset(record.id, assetId)
                      }
                      onGenerateAssetGroup={(assetType) =>
                        onGenerateAssetGroup(record.id, assetType)
                      }
                      onGeneratePrompts={(episodeCount, episodeNumber) =>
                        onGeneratePrompts(record.id, episodeCount, episodeNumber)
                      }
                    />
                  )}
                  {stage === 3 && record.snapshot.assets.length > 0 && (
                    <div className="generated-asset-strip">
                      {record.snapshot.assets.map((asset) =>
                        asset.resultUrl ? (
                            <a
                              href={asset.resultUrl}
                              target="_blank"
                              rel="noreferrer"
                              key={asset.id}
                              aria-label={`Open generated image for ${asset.name}`}
                            >
                              <span
                                role="img"
                                aria-label={asset.name}
                                style={{
                                  backgroundImage: `url(${JSON.stringify(
                                    asset.resultUrl,
                                  )})`,
                                }}
                              />
                              <b>{asset.name}</b>
                            </a>
                          ) : (
                            <div
                              className={`generated-asset-placeholder ${asset.status}`}
                              key={asset.id}
                              aria-live={
                                asset.status === "generating"
                                  ? "polite"
                                  : undefined
                              }
                            >
                              <span>
                                {asset.status === "generating" ? (
                                  <LoadingMark />
                                ) : (
                                  <ImageIcon size={17} />
                                )}
                                <b>
                                  {asset.status === "generating"
                                    ? `Generating${
                                        typeof asset.progress === "number"
                                          ? ` · ${asset.progress}%`
                                          : ""
                                      }`
                                    : "Not generated"}
                                </b>
                              </span>
                              <b>{asset.name}</b>
                              {asset.error && (
                                <small
                                  className="generated-asset-error"
                                  role="alert"
                                >
                                  {asset.error}
                                </small>
                              )}
                            </div>
                          ),
                      )}
                    </div>
                  )}
                  {stage === 5 && (
                    <div className="generated-job-workspace">
                      <section className="generated-job-settings">
                        <div>
                          <span>Generation settings</span>
                          <h4>Settings for episode and clip generation</h4>
                          <p>
                            These choices apply to every Generate Episode and
                            Regenerate Video action in this job.
                          </p>
                        </div>
                        <div className="generated-job-setting-fields">
                          <ModelSelect
                            label="Video model"
                            value={videoModel}
                            options={videoModelOptions}
                            onChange={(value) =>
                              setVideoModel(value as VideoModelId)
                            }
                          />
                          {videoModel === "kling-3.0" && (
                            <SelectField
                              label="Kling quality"
                              value={videoMode}
                              options={["std", "pro", "4K"]}
                              onChange={(value) =>
                                setVideoMode(value as "std" | "pro" | "4K")
                              }
                            />
                          )}
                          {videoModel !== "kling-v3-turbo" && (
                            <SelectField
                              label="Generate sound"
                              value={videoSound ? "On" : "Off"}
                              options={["On", "Off"]}
                              onChange={(value) =>
                                setVideoSound(value === "On")
                              }
                            />
                          )}
                          {videoModel === "kling-v3-turbo" && (
                            <div className="field">
                              <label>Turbo output</label>
                              <div className="fixed-model-value">
                                720p · no sound option
                              </div>
                            </div>
                          )}
                        </div>
                      </section>
                      <div className="generated-video-episodes">
                      {videoEpisodes.map((episodeNumber) => {
                        const episodeScenes = record.snapshot.scenes.filter(
                          (scene) => scene.episode === episodeNumber,
                        );
                        const episodeOutline = record.snapshot.episodePlan.find(
                          (episode) => episode.number === episodeNumber,
                        );
                        const episodeTitle = episodeOutline?.title;
                        const episodeStoryline =
                          episodeOutline?.summary ||
                          "No episode storyline has been added yet.";
                        const episodeKey = `${record.id}-${episodeNumber}`;
                        const autoCombineKey = `${record.id}::${episodeNumber}`;
                        const episodeCollapsed = expandedEpisodeKey !== episodeKey;
                        const episodeGenerateBusy =
                          videoBusyKeys.includes(
                            `generate-episode-generate-${record.id}-${episodeNumber}`,
                          );
                        const episodeGenerateCombineBusy =
                          videoBusyKeys.includes(
                            `generate-episode-generate-combine-${record.id}-${episodeNumber}`,
                          );
                        const episodeAutoCombineQueued = Boolean(
                          autoCombineEpisodes[autoCombineKey],
                        );
                        const generatedClipCount = episodeScenes.filter(
                          (scene) => scene.status === "ready" && scene.resultUrl,
                        ).length;
                        const episodeReadyToCombine =
                          episodeScenes.length > 0 &&
                          episodeScenes.every(
                            (scene) => scene.status === "ready" && scene.resultUrl,
                          );
                        const episodeCombining = combiningEpisodeKey === episodeKey;
                        const combinedEpisode = combinedEpisodes[episodeKey];
                        const episodeGenerationCost = estimateSceneCredits(
                          episodeScenes,
                          videoModel,
                          videoMode,
                        );
                        return (
                          <section
                            className="generated-video-episode"
                            key={episodeNumber}
                          >
                            <div className="generated-video-episode-head">
                              <div>
                                <span>Episode {episodeNumber}</span>
                                <h4>{episodeTitle || `Episode ${episodeNumber}`}</h4>
                              </div>
                              <div className="generated-video-episode-actions">
                                <span>
                                  {generatedClipCount}/{episodeScenes.length} clips generated
                                </span>
                                <span className={combinedEpisode ? "combined-ready" : ""}>
                                  {combinedEpisode ? "Combined ready" : "Not combined"}
                                </span>
                                <button
                                  className="generated-episode-info"
                                  onClick={() => {
                                    setExpandedEpisodeKey(episodeKey);
                                    setEpisodeInfoKey(episodeKey);
                                  }}
                                  aria-haspopup="dialog"
                                >
                                  <Info size={13} /> Episode info
                                </button>
                                <button
                                  className="generated-episode-collapse"
                                  onClick={() =>
                                    setExpandedEpisodeKey((current) =>
                                      current === episodeKey ? "" : episodeKey,
                                    )
                                  }
                                  aria-expanded={!episodeCollapsed}
                                  aria-controls={`episode-content-${episodeKey}`}
                                  aria-label={`${
                                    episodeCollapsed ? "Expand" : "Collapse"
                                  } Episode ${episodeNumber}`}
                                  title={
                                    episodeCollapsed
                                      ? "Expand episode"
                                      : "Collapse episode"
                                  }
                                >
                                  <ChevronDown
                                    size={15}
                                    className={
                                      episodeCollapsed ? "" : "episode-open"
                                    }
                                  />
                                </button>
                              </div>
                            </div>
                            {!episodeCollapsed && (
                            <div
                              className="generated-video-episode-body"
                              id={`episode-content-${episodeKey}`}
                            >
                            <div className="episode-generation-bar">
                              <div>
                                <span>Episode generation</span>
                                <b>Generate every clip, or generate and automatically combine the full episode.</b>
                              </div>
                              <div>
                                <GenerationCost credits={episodeGenerationCost}>
                                  <button
                                    className="generated-episode-button"
                                    disabled={episodeGenerateBusy}
                                    onClick={() => {
                                      setAutoCombineEpisodes((current) => {
                                        const next = { ...current };
                                        delete next[autoCombineKey];
                                        return next;
                                      });
                                      onGenerateEpisode(
                                        record.id,
                                        episodeNumber,
                                        "generate",
                                      );
                                    }}
                                  >
                                    {episodeGenerateBusy ? (
                                      <><LoadingMark /> Generating episode</>
                                    ) : generatedClipCount > 0 ? (
                                      <><RefreshCcw size={13} /> Regenerate episode</>
                                    ) : (
                                      <><Play size={13} /> Generate episode</>
                                    )}
                                  </button>
                                </GenerationCost>
                                <GenerationCost credits={episodeGenerationCost}>
                                  <button
                                    className="generated-episode-button generate-and-combine"
                                    disabled={
                                      episodeGenerateCombineBusy ||
                                      episodeAutoCombineQueued ||
                                      episodeCombining
                                    }
                                    onClick={() => {
                                      setAutoCombineEpisodes((current) => ({
                                        ...current,
                                        [autoCombineKey]: true,
                                      }));
                                      onGenerateEpisode(
                                        record.id,
                                        episodeNumber,
                                        "generate-combine",
                                      );
                                    }}
                                  >
                                    {episodeGenerateCombineBusy ||
                                    episodeAutoCombineQueued ||
                                    episodeCombining ? (
                                      <><LoadingMark /> Generating &amp; combining</>
                                    ) : generatedClipCount > 0 ? (
                                      <><RefreshCcw size={13} /> Regenerate &amp; combine</>
                                    ) : (
                                      <><Layers3 size={13} /> Generate &amp; combine</>
                                    )}
                                  </button>
                                </GenerationCost>
                                <button
                                  className="generated-episode-combine"
                                  disabled={
                                    episodeCombining ||
                                    !episodeReadyToCombine
                                  }
                                  onClick={() =>
                                    void combineEpisode(record, episodeNumber)
                                  }
                                  title={
                                    episodeReadyToCombine
                                      ? "Combine every completed clip in scene order"
                                      : "Generate every episode clip before combining"
                                  }
                                >
                                  {episodeCombining ? (
                                    <><LoadingMark /> Combining</>
                                  ) : (
                                    <><Layers3 size={13} /> Combine</>
                                  )}
                                </button>
                              </div>
                            </div>
                            <div className={`combined-episode-panel ${combinedEpisode ? "ready" : ""}`}>
                                {episodeCombining ? (
                                  <div className="combined-episode-progress" role="status" aria-live="polite">
                                    <LoadingMark />
                                    <span>
                                      <b>Combining Episode {episodeNumber}</b>
                                      <small>{combineProgress}</small>
                                    </span>
                                  </div>
                                ) : combinedEpisode ? (
                                  <>
                                    <video controls playsInline preload="metadata" src={combinedEpisode.url} />
                                    <div className="combined-episode-copy">
                                      <span className="status-pill ready">Main episode video</span>
                                      <b>Episode {episodeNumber} · {combinedEpisode.clipCount} clips combined in scene order</b>
                                      <small>Created {formatProducedAt(combinedEpisode.createdAt)} · saved to Production Info</small>
                                    </div>
                                    <div className="combined-episode-actions">
                                      <a
                                        className="secondary-button"
                                        href={combinedEpisode.url}
                                        download={`${record.snapshot.title || "drama"}-episode-${episodeNumber}.mp4`}
                                      >
                                        <Download size={13} /> Save episode MP4
                                      </a>
                                    </div>
                                  </>
                                ) : combineErrors[episodeKey] ? (
                                  <div className="combined-episode-error" role="alert">
                                    <ShieldAlert size={14} /> {combineErrors[episodeKey]}
                                  </div>
                                ) : (
                                  <div className="combined-episode-empty">
                                    <Film size={20} />
                                    <span>
                                      <b>Main combined video not generated</b>
                                      <small>Generate every episode clip, then combine them in scene order.</small>
                                    </span>
                                  </div>
                                )}
                              </div>
                            {episodeInfoKey === episodeKey && (
                              <div
                                className="episode-info-scrim"
                                role="presentation"
                                onMouseDown={(event) => {
                                  if (event.target === event.currentTarget) {
                                    setEpisodeInfoKey("");
                                  }
                                }}
                              >
                                <section
                                  className="episode-info-dialog"
                                  role="dialog"
                                  aria-modal="true"
                                  aria-labelledby={`episode-info-title-${episodeKey}`}
                                >
                                  <div className="episode-info-dialog-head">
                                    <div>
                                      <span className="context-kicker">Episode {episodeNumber} details</span>
                                      <h3 id={`episode-info-title-${episodeKey}`}>
                                        {episodeTitle || `Episode ${episodeNumber}`}
                                      </h3>
                                    </div>
                                    <button
                                      className="icon-button"
                                      onClick={() => setEpisodeInfoKey("")}
                                      aria-label="Close episode info"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                  <div className="episode-info-dialog-body">
                                    <section>
                                      <h4>Episode storyline</h4>
                                      <p>{episodeStoryline}</p>
                                    </section>
                                    <section>
                                      <h4>Episode prompts</h4>
                                      <div className="episode-info-prompt-list">
                                        {episodeScenes.map((scene) => (
                                          <article key={scene.id}>
                                            <b>{scene.id} · {scene.title}</b>
                                            <p>{scene.prompt}</p>
                                          </article>
                                        ))}
                                      </div>
                                    </section>
                                    <section>
                                      <h4>Images used</h4>
                                      <div className="episode-info-asset-list">
                                        {record.snapshot.assets.flatMap((asset) =>
                                          asset.resultUrl
                                            ? [
                                                <article key={asset.id}>
                                                  <span
                                                    role="img"
                                                    aria-label={asset.name}
                                                    style={{
                                                      backgroundImage: `url(${JSON.stringify(
                                                        asset.resultUrl,
                                                      )})`,
                                                    }}
                                                  />
                                                  <div>
                                                    <b>{asset.name}</b>
                                                    <p>{asset.visualPrompt || asset.detail}</p>
                                                  </div>
                                                </article>,
                                              ]
                                            : [],
                                        )}
                                      </div>
                                    </section>
                                  </div>
                                </section>
                              </div>
                            )}
                            <button
                              className="episode-clips-toggle"
                              onClick={() =>
                                setExpandedClipKeys((current) =>
                                  current.includes(episodeKey)
                                    ? current.filter((key) => key !== episodeKey)
                                    : [...current, episodeKey],
                                )
                              }
                              aria-expanded={expandedClipKeys.includes(episodeKey)}
                              aria-controls={`episode-clips-${episodeKey}`}
                            >
                              <span>
                                <Clapperboard size={14} /> Episode clips
                                <small>{generatedClipCount}/{episodeScenes.length} generated</small>
                              </span>
                              <ChevronDown
                                size={15}
                                className={
                                  expandedClipKeys.includes(episodeKey)
                                    ? "episode-open"
                                    : ""
                                }
                              />
                            </button>
                            {expandedClipKeys.includes(episodeKey) && (
                            <div
                              className="generated-video-grid"
                              id={`episode-clips-${episodeKey}`}
                            >
                              {episodeScenes.map((scene) => {
                                const regenerating =
                                  scene.status === "generating" ||
                                  videoBusyKeys.includes(
                                    `regenerate-video-${record.id}-${scene.id}`,
                                  );
                                const clipGenerationCost = estimateVideoCredits(
                                  videoModel,
                                  scene.duration,
                                  videoMode,
                                );
                                return (
                                  <article
                                    className={`generated-video-card ${scene.status}`}
                                    key={scene.id}
                                  >
                                    <div
                                      className="generated-video-frame"
                                      style={{
                                        aspectRatio:
                                          record.snapshot.aspectRatio.replace(
                                            ":",
                                            " / ",
                                          ),
                                      }}
                                    >
                                      {scene.resultUrl && !regenerating ? (
                                        <video
                                          controls
                                          playsInline
                                          preload="metadata"
                                          src={scene.resultUrl}
                                          aria-label={`Video preview for ${scene.title}`}
                                        />
                                      ) : regenerating ? (
                                        <div
                                          className="video-generating-state"
                                          role="status"
                                          aria-live="polite"
                                        >
                                          <LoadingMark />
                                          <b>Generating</b>
                                          <span>Kie AI is creating this clip</span>
                                        </div>
                                      ) : (
                                        <div className="video-waiting-state">
                                          <Clapperboard size={20} />
                                          <b>
                                            {scene.status === "queued"
                                              ? "Needs attention"
                                              : "Not generated"}
                                          </b>
                                          <span>{scene.status.replace("-", " ")}</span>
                                        </div>
                                      )}
                                    </div>
                                    <div className="generated-video-info">
                                      <span>
                                        {scene.id} · {scene.duration}s · {scene.status}
                                      </span>
                                      <h4>{scene.title}</h4>
                                      <small>{scene.provider}</small>
                                      <label className="generated-video-prompt">
                                        <span>Editable generation prompt</span>
                                        <textarea
                                          value={scene.prompt}
                                          onChange={(event) =>
                                            onUpdateSnapshot(record.id, {
                                              scenes:
                                                record.snapshot.scenes.map(
                                                  (item) =>
                                                    item.id === scene.id
                                                      ? {
                                                          ...item,
                                                          prompt:
                                                            event.target.value,
                                                        }
                                                      : item,
                                                ),
                                            })
                                          }
                                        />
                                      </label>
                                      <GenerationCost credits={clipGenerationCost}>
                                        <button
                                          className="generated-video-regenerate"
                                          disabled={regenerating}
                                          onClick={() =>
                                            onRegenerateVideo(record.id, scene.id)
                                          }
                                        >
                                          {regenerating ? (
                                            <><LoadingMark /> Generating</>
                                          ) : scene.resultUrl || scene.taskId ? (
                                            <><RefreshCcw size={13} /> Regenerate clip</>
                                          ) : (
                                            <><Play size={13} /> Generate clip</>
                                          )}
                                        </button>
                                      </GenerationCost>
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                            )}
                            </div>
                            )}
                          </section>
                        );
                      })}
                      </div>
                    </div>
                  )}
                  {stage !== 2 && stage !== 5 && (
                    <textarea
                      className="stage-record-editor"
                      aria-label={`Editable content for ${record.name}`}
                      value={preview(record)}
                      onChange={(event) => onChange(record.id, event.target.value)}
                    />
                  )}
                  {record.model && (
                    <div className="stage-record-meta">
                      <span>
                        <Sparkles size={11} /> {record.model}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StoryStudioRecord({
  record,
  storyBusyKeys,
  imageModel,
  setImageModel,
  chatModel,
  setChatModel,
  onChangeStory,
  onUpdate,
  onGenerateAsset,
  onGenerateAssetGroup,
  onGeneratePrompts,
}: {
  record: WorkflowRecord;
  storyBusyKeys: string[];
  imageModel: ImageModelId;
  setImageModel: (value: ImageModelId) => void;
  chatModel: ChatModelId;
  setChatModel: (value: ChatModelId) => void;
  onChangeStory: (value: string) => void;
  onUpdate: (patch: Partial<ProductionSnapshot>) => void;
  onGenerateAsset: (assetId: string) => void;
  onGenerateAssetGroup: (assetType: "Character" | "World") => void;
  onGeneratePrompts: (episodeCount: number, episodeNumber?: number) => void;
}) {
  const snapshot = record.snapshot;
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  const [libraryTargetId, setLibraryTargetId] = useState("");
  const [promptEpisodeCount, setPromptEpisodeCount] = useState(
    Math.max(1, snapshot.episodes),
  );
  const [hiddenSections, setHiddenSections] = useState({
    prompts: false,
    assets: false,
  });

  const toggleSection = (section: keyof typeof hiddenSections) => {
    setHiddenSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setLibraryAssets(readAssetLibrary()),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [record.id, snapshot.assets]);

  const libraryTarget = snapshot.assets.find(
    (asset) => asset.id === libraryTargetId,
  );
  const compatibleLibraryAssets = libraryTarget
    ? libraryAssets.filter((asset) => asset.type === libraryTarget.type)
    : [];

  const chooseLibraryAsset = (libraryAsset: LibraryAsset) => {
    if (!libraryTarget) return;
    onUpdate({
      assets: snapshot.assets.map((asset) =>
        asset.id === libraryTarget.id
          ? {
              ...asset,
              visualPrompt: stripImageAspectRatio(
                libraryAsset.visualPrompt || asset.visualPrompt || asset.detail,
              ),
              crop: libraryAsset.crop,
              selected: true,
              status: "ready",
              taskId: undefined,
              progress: 100,
              error: undefined,
              resultUrl: libraryAsset.resultUrl,
              libraryAssetName: libraryAsset.name,
              libraryAssetId: libraryAsset.id,
            }
          : asset,
      ),
    });
    setLibraryAssets(markLibraryAssetUsed(libraryAsset.id));
    setLibraryTargetId("");
  };
  const readyAssets = snapshot.assets.filter(
    (asset) => asset.status === "ready",
  ).length;
  const allAssetsReady =
    snapshot.assets.length > 0 && readyAssets === snapshot.assets.length;
  const canGeneratePrompts = snapshot.episodePlan.length > 0;
  const promptedEpisodes = new Set(
    snapshot.scenes.map((scene) => scene.episode),
  ).size;

  const renderAsset = (asset: Asset) => {
    const generating = asset.status === "generating";
    const itemBusy = storyBusyKeys.includes(
      `story-asset-${record.id}-${asset.id}`,
    );
    return (
      <article className={`story-studio-asset ${asset.status}`} key={asset.id}>
        <div
          className="story-studio-asset-visual"
          style={
            asset.resultUrl
              ? { backgroundImage: `url(${JSON.stringify(asset.resultUrl)})` }
              : undefined
          }
        >
          {!asset.resultUrl && (generating || itemBusy ? <LoadingMark /> : <ImageIcon size={22} />)}
          {(generating || itemBusy) && (
            <span className="story-studio-generating">
              Generating
              {typeof asset.progress === "number"
                ? ` · ${asset.progress}%`
                : ""}
              {" · checking every 4s"}
            </span>
          )}
        </div>
        <div className="story-studio-asset-copy">
          <span>{asset.type}</span>
          <h4>{asset.name}</h4>
          {asset.libraryAssetName && (
            <span className="story-studio-library-source">
              <ImageIcon size={11} /> Library reference: {asset.libraryAssetName}
            </span>
          )}
          <p>{asset.detail}</p>
          <label>
            <span>Editable image prompt</span>
            <textarea
              value={asset.visualPrompt ?? asset.detail}
              onChange={(event) =>
                onUpdate({
                  assets: snapshot.assets.map((item) =>
                    item.id === asset.id
                      ? { ...item, visualPrompt: event.target.value }
                      : item,
                  ),
                })
              }
            />
          </label>
          {asset.error && (
            <div className="story-studio-asset-error" role="alert">
              <ShieldAlert size={13} />
              <span>{asset.error}</span>
            </div>
          )}
          <div className="story-studio-asset-actions">
            <GenerationCost credits={imageCreditEstimate[imageModel]}>
              <button
                className={asset.status === "ready" ? "secondary-button" : "primary-button"}
                disabled={itemBusy || generating}
                onClick={() => onGenerateAsset(asset.id)}
              >
                {generating || itemBusy ? (
                  <><LoadingMark /> Generating with Kie AI</>
                ) : asset.status === "ready" ? (
                  <><RefreshCcw size={13} /> Regenerate image</>
                ) : (
                  <><Sparkles size={13} /> Generate image</>
                )}
              </button>
            </GenerationCost>
            <button
              className="secondary-button"
              disabled={generating || !libraryAssets.length}
              onClick={() => setLibraryTargetId(asset.id)}
              title={
                libraryAssets.length
                  ? "Choose an existing generated image"
                  : "Generate an image first to add it to Asset Library"
              }
            >
              <ImageIcon size={13} /> Choose from Asset Library
            </button>
          </div>
        </div>
      </article>
    );
  };

  const characterAssets = snapshot.assets.filter(
    (asset) => asset.type === "Character",
  );
  const worldAssets = snapshot.assets.filter(
    (asset) => asset.type !== "Character",
  );
  const generatingCharacters =
    storyBusyKeys.includes(`story-assets-${record.id}-characters`);
  const generatingLocations =
    storyBusyKeys.includes(`story-assets-${record.id}-world`);
  const generatingPromptSet = storyBusyKeys.includes(
    `story-prompts-${record.id}`,
  );
  return (
    <div className="story-studio-workspace">
      <section className="story-studio-section">
        <div className="story-studio-section-head">
          <div>
            <span>Full-season story</span>
            <h3>Series storyline</h3>
          </div>
          <span className="status-pill ready">Editable</span>
        </div>
        <textarea
          className="story-studio-storyline"
          value={snapshot.storyline}
          onChange={(event) => onChangeStory(event.target.value)}
        />
      </section>

      <section className="story-studio-section">
        <div className="story-studio-section-head">
          <div>
            <span>Every episode</span>
            <h3>{snapshot.episodePlan.length} complete episode storylines</h3>
          </div>
        </div>
        <div className="story-studio-episodes">
          {snapshot.episodePlan.map((episode, index) => (
            <article className="story-studio-episode" key={episode.number}>
              <span>Episode {episode.number}</span>
              <input
                value={episode.title}
                aria-label={`Episode ${episode.number} title`}
                onChange={(event) =>
                  onUpdate({
                    episodePlan: snapshot.episodePlan.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, title: event.target.value }
                        : item,
                    ),
                  })
                }
              />
              <textarea
                value={episode.summary}
                aria-label={`Episode ${episode.number} storyline`}
                onChange={(event) =>
                  onUpdate({
                    episodePlan: snapshot.episodePlan.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, summary: event.target.value }
                        : item,
                    ),
                  })
                }
              />
            </article>
          ))}
        </div>
      </section>

      <section className="story-studio-section collapsible-studio-section">
        <div className="story-studio-section-head prompt-section-head">
          <div>
            <span>Episode prompts</span>
            <h3>
              {snapshot.scenes.length} prompts across {promptedEpisodes} episodes
            </h3>
          </div>
          <div className="story-studio-section-actions">
            <div className="story-studio-prompt-controls">
              <ModelSelect
                label="Prompt model"
                value={chatModel}
                options={chatModelOptions}
                onChange={(value) => setChatModel(value as ChatModelId)}
              />
              <SelectField
                label="Episodes to generate"
                value={String(promptEpisodeCount)}
                options={Array.from(
                  { length: Math.max(1, snapshot.episodes) },
                  (_, index) => String(index + 1),
                )}
                onChange={(value) => setPromptEpisodeCount(Number(value))}
              />
              <GenerationCost
                credits={chatCreditEstimate[chatModel] * promptEpisodeCount}
              >
                <button
                  className={snapshot.scenes.length ? "secondary-button" : "primary-button"}
                  disabled={!canGeneratePrompts || generatingPromptSet}
                  title={
                    canGeneratePrompts
                      ? "Generate prompts from the episode storylines; completed asset images are optional"
                      : "Add at least one episode storyline first"
                  }
                  onClick={() => onGeneratePrompts(promptEpisodeCount)}
                >
                  {generatingPromptSet ? (
                    <><LoadingMark /> Generating {promptEpisodeCount} episodes</>
                  ) : snapshot.scenes.length ? (
                    <><RefreshCcw size={13} /> Regenerate selected episodes</>
                  ) : (
                    <><Sparkles size={13} /> Generate episode prompts</>
                  )}
                </button>
              </GenerationCost>
            </div>
            <button
              className="studio-section-toggle"
              onClick={() => toggleSection("prompts")}
              aria-expanded={!hiddenSections.prompts}
              aria-controls={`story-prompts-${record.id}`}
              aria-label={`${hiddenSections.prompts ? "Show" : "Hide"} episode prompts`}
            >
              <ChevronDown className={hiddenSections.prompts ? "" : "open"} size={16} />
            </button>
          </div>
        </div>
        {!hiddenSections.prompts && (
          <div className="story-studio-scene-episodes" id={`story-prompts-${record.id}`}>
            {snapshot.episodePlan.map((episode) => {
              const episodeScenes = snapshot.scenes.filter(
                (scene) => scene.episode === episode.number,
              );
              const episodeBusy = storyBusyKeys.includes(
                `story-prompts-${record.id}-${episode.number}`,
              );
              return (
                <section key={episode.number}>
                  <div className="story-studio-scene-episode-head">
                    <span>Episode {episode.number}</span>
                    <b>{episode.title}</b>
                    <small>{episodeScenes.length} prompts</small>
                    <GenerationCost credits={chatCreditEstimate[chatModel]}>
                      <button
                        className="regenerate-episode-prompts"
                        disabled={!canGeneratePrompts || episodeBusy}
                        title={
                          canGeneratePrompts
                            ? `Generate prompts for Episode ${episode.number}`
                            : "Add an episode storyline first"
                        }
                        onClick={() => onGeneratePrompts(1, episode.number)}
                      >
                        {episodeBusy ? (
                          <><LoadingMark /> Regenerating</>
                        ) : (
                          <><RefreshCcw size={12} /> Regenerate episode prompts</>
                        )}
                      </button>
                    </GenerationCost>
                  </div>
                  {episodeScenes.length > 0 ? (
                    <div className="story-studio-scenes">
                      {snapshot.scenes.map((scene, sceneIndex) =>
                        scene.episode === episode.number ? (
                          <article key={`${scene.id}-${sceneIndex}`}>
                            <span>{scene.id} · {scene.duration}s · {scene.safety}</span>
                            <h4>{scene.title}</h4>
                            <textarea
                              value={scene.prompt}
                              aria-label={`Editable prompt for ${scene.title}`}
                              onChange={(event) =>
                                onUpdate({
                                  scenes: snapshot.scenes.map((item, itemIndex) =>
                                    itemIndex === sceneIndex
                                      ? { ...item, prompt: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </article>
                        ) : null,
                      )}
                    </div>
                  ) : (
                    <p className="story-studio-episode-prompt-empty">
                      Generate or regenerate this episode&apos;s prompts independently.
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>

      <section className="story-studio-section collapsible-studio-section">
        <div className="story-studio-section-head">
          <div>
            <span>Visual assets</span>
            <h3>{readyAssets}/{snapshot.assets.length} character, venue, and object images ready</h3>
          </div>
          <button
            className="studio-section-toggle"
            onClick={() => toggleSection("assets")}
            aria-expanded={!hiddenSections.assets}
            aria-controls={`story-assets-${record.id}`}
            aria-label={`${hiddenSections.assets ? "Show" : "Hide"} visual assets`}
          >
            <ChevronDown className={hiddenSections.assets ? "" : "open"} size={16} />
          </button>
        </div>
        {!hiddenSections.assets && (
          <div className="story-studio-asset-groups" id={`story-assets-${record.id}`}>
            <section className="story-studio-asset-group">
              <div className="story-studio-subsection-head">
                <div>
                  <span>Cast and character continuity</span>
                  <h4>{snapshot.characters.length} recurring characters</h4>
                </div>
                <div className="story-studio-bulk-controls">
                  <ModelSelect
                    label="Character image model"
                    value={imageModel}
                    options={imageModelOptions}
                    onChange={(value) => setImageModel(value as ImageModelId)}
                  />
                  <GenerationCost
                    credits={characterAssets.length * imageCreditEstimate[imageModel]}
                  >
                    <button
                      className="primary-button"
                      disabled={!characterAssets.length || generatingCharacters}
                      onClick={() => onGenerateAssetGroup("Character")}
                    >
                      {generatingCharacters ? (
                        <><LoadingMark /> Generating all characters</>
                      ) : (
                        <><Sparkles size={13} /> Generate all characters</>
                      )}
                    </button>
                  </GenerationCost>
                </div>
              </div>
              <div className="story-studio-asset-grid">
                {characterAssets.map(renderAsset)}
              </div>
            </section>

            <section className="story-studio-asset-group">
              <div className="story-studio-subsection-head">
                <div>
                  <span>Venues and objects</span>
                  <h4>{worldAssets.length} production assets</h4>
                </div>
                <div className="story-studio-bulk-controls compact">
                  <span className={`status-pill ${allAssetsReady ? "ready" : "warning"}`}>
                    {readyAssets}/{snapshot.assets.length} images ready
                  </span>
                  <GenerationCost
                    credits={worldAssets.length * imageCreditEstimate[imageModel]}
                  >
                    <button
                      className="primary-button"
                      disabled={!worldAssets.length || generatingLocations}
                      onClick={() => onGenerateAssetGroup("World")}
                    >
                      {generatingLocations ? (
                        <><LoadingMark /> Generating venues and objects</>
                      ) : (
                        <><Sparkles size={13} /> Generate venues and objects</>
                      )}
                    </button>
                  </GenerationCost>
                </div>
              </div>
              <div className="story-studio-asset-grid">
                {worldAssets.map(renderAsset)}
              </div>
            </section>
          </div>
        )}
      </section>

      {libraryTarget && (
        <div className="confirmation-scrim asset-picker-scrim" role="presentation">
          <section
            className="asset-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-picker-title"
          >
            <div className="asset-picker-head">
              <div>
                <span className="context-kicker">Asset Library</span>
                <h2 id="asset-picker-title">
                  Choose a {libraryTarget.type.toLowerCase()} reference for {libraryTarget.name}
                </h2>
                <p>
                  Selecting an existing generated image marks this asset ready without using new Kie credits.
                </p>
              </div>
              <button
                className="icon-button"
                onClick={() => setLibraryTargetId("")}
                aria-label="Close Asset Library picker"
              >
                <X size={16} />
              </button>
            </div>
            <div className="asset-picker-grid">
              {compatibleLibraryAssets.map((libraryAsset) => (
                <button
                  className="asset-picker-card"
                  key={libraryAsset.id}
                  onClick={() => chooseLibraryAsset(libraryAsset)}
                >
                  <span
                    className="asset-picker-image"
                    role="img"
                    aria-label={libraryAsset.name}
                    style={{
                      backgroundImage: `url(${JSON.stringify(libraryAsset.resultUrl)})`,
                    }}
                  />
                  <span>
                    <b>{libraryAsset.name}</b>
                    <small>{libraryAsset.project} · {libraryAsset.type}</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
            {!compatibleLibraryAssets.length && (
              <div className="empty-library-card compact-empty-library">
                <ImageIcon size={20} />
                <h3>No compatible {libraryTarget.type.toLowerCase()} images</h3>
                <p>Generate one first; completed images are saved to Asset Library automatically.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function StageCreationPanel({
  stage,
  sourceRecords,
  selectedSourceId,
  snapshot,
  scenes,
  setScenes,
  busy,
  videoMode,
  setVideoMode,
  videoSound,
  setVideoSound,
  chatModel,
  setChatModel,
  imageModel,
  setImageModel,
  videoModel,
  setVideoModel,
  onSelectSource,
  onBack,
  onGenerate,
}: {
  stage: number;
  sourceRecords: WorkflowRecord[];
  selectedSourceId: string;
  snapshot: ProductionSnapshot;
  scenes: Scene[];
  setScenes: (value: Scene[]) => void;
  busy: string | null;
  videoMode: "std" | "pro" | "4K";
  setVideoMode: (value: "std" | "pro" | "4K") => void;
  videoSound: boolean;
  setVideoSound: (value: boolean) => void;
  chatModel: ChatModelId;
  setChatModel: (value: ChatModelId) => void;
  imageModel: ImageModelId;
  setImageModel: (value: ImageModelId) => void;
  videoModel: VideoModelId;
  setVideoModel: (value: VideoModelId) => void;
  onSelectSource: (sourceId: string) => void;
  onBack: () => void;
  onGenerate: () => void;
}) {
  const sourceName = stage === 5 ? stageItemNames[2] : stageItemNames[stage - 1];
  const selectedSource = sourceRecords.find(
    (record) => record.id === selectedSourceId,
  );
  const labels: Record<
    number,
    { title: string; copy: string; button: string }
  > = {
    2: {
      title: "Create a new Story Studio",
      copy: "Choose a finished brief. Kie AI will generate the full-season storyline, every episode storyline, all recurring characters, and the complete visual-asset plan in one result.",
      button: "Generate complete Story Studio",
    },
    3: {
      title: "Create a new visual asset pack",
      copy: "Choose a finished Story Bible. Kie AI will design the recurring characters, venues, and objects, then submit their image tasks.",
      button: "Generate asset images",
    },
    4: {
      title: "Create a new scene prompt set",
      copy: "Choose a finished asset pack. Kie AI will break Episode 1 into individually editable scenes no longer than 15 seconds.",
      button: "Generate scene prompts",
    },
    5: {
      title: "Create a new generation job",
      copy: "Choose a completed Story Studio, select the finished scene prompts you want, and submit only those scenes to your selected Kie AI video model.",
      button: "Generate selected scenes",
    },
  };
  const content = labels[stage];
  const selectedScenes = scenes.filter((scene) => scene.selected);
  const selectedCount = selectedScenes.length;
  const generationCost =
    stage === 3
      ? chatCreditEstimate[chatModel] +
        snapshot.assets.length * imageCreditEstimate[imageModel]
      : stage === 5
        ? estimateSceneCredits(selectedScenes, videoModel, videoMode)
        : chatCreditEstimate[chatModel] *
          (stage === 2 ? 2 : Math.max(1, snapshot.episodes));
  const finalSourceReady =
    stage !== 5 ||
    (snapshot.assets.length > 0 &&
      snapshot.assets.every((asset) => asset.status === "ready") &&
      snapshot.scenes.length > 0);
  const selectedModelSummary =
    stage === 3
      ? `${modelLabel(chatModelOptions, chatModel)} + ${modelLabel(
          imageModelOptions,
          imageModel,
        )}`
      : stage === 5
        ? modelLabel(videoModelOptions, videoModel)
        : modelLabel(chatModelOptions, chatModel);

  return (
    <div className="single-column-content">
      <section className="card create-stage-card">
        <div className="card-heading">
          <div>
            <h2>{content.title}</h2>
            <p>{content.copy}</p>
          </div>
          <span className="safe-pill">
            <Sparkles size={11} /> Kie AI · {selectedModelSummary}
          </span>
        </div>

        {(stage === 2 || stage === 4) && (
          <div className="model-choice-panel">
            <ModelSelect
              label="Generation model"
              value={chatModel}
              options={chatModelOptions}
              onChange={(value) => setChatModel(value as ChatModelId)}
            />
            <p>
              Both models use Kie structured output. Gemini 3 Pro prioritizes
              depth; Gemini 2.5 Flash prioritizes speed and lower cost.
            </p>
          </div>
        )}

        {stage === 3 && (
          <div className="model-choice-panel">
            <div className="form-grid two">
              <ModelSelect
                label="Asset planning model"
                value={chatModel}
                options={chatModelOptions}
                onChange={(value) => setChatModel(value as ChatModelId)}
              />
              <ModelSelect
                label="Asset image model"
                value={imageModel}
                options={imageModelOptions}
                onChange={(value) => setImageModel(value as ImageModelId)}
              />
            </div>
            <p>
              The planning model writes continuity-locked prompts first. Image
              tasks are then submitted one at a time to the selected Kie image
              model so any API error is shown clearly.
            </p>
          </div>
        )}

        <div className="field">
          <label htmlFor={`create-source-${stage}`}>
            Finished source · {sourceName.singular}
          </label>
          <div className="select-wrap">
            <select
              id={`create-source-${stage}`}
              value={selectedSourceId}
              onChange={(event) => onSelectSource(event.target.value)}
            >
              {sourceRecords.map((record) => (
                <option value={record.id} key={record.id}>
                  {record.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
        </div>

        {!selectedSource && (
          <div className="suggestion-box">
            <b>No finished source is available</b>
            <p>
              Return to {steps[stage - 2].label}, create and generate a finished{" "}
              {sourceName.singular}, then use it here.
            </p>
          </div>
        )}

        {selectedSource && stage === 2 && (
          <div className="source-preview-card">
            <span>Finished brief selected</span>
            <h3>{selectedSource.name}</h3>
            <p>{snapshot.generatedBrief}</p>
            <div className="prompt-tags">
              <span>{snapshot.episodes} episodes</span>
              <span>{snapshot.episodeLength} min each</span>
              <span>{snapshot.style}</span>
              <span>{snapshot.rating}</span>
            </div>
          </div>
        )}

        {selectedSource && stage === 3 && (
          <div className="source-preview-card">
            <span>Story Bible selected</span>
            <h3>{selectedSource.name}</h3>
            <p>{snapshot.storyline}</p>
            <div className="prompt-tags">
              <span>{snapshot.characters.length} characters</span>
              <span>{snapshot.episodePlan.length} episode outlines</span>
              <span>{snapshot.aspectRatio}</span>
            </div>
          </div>
        )}

        {stage === 3 && busy === "stage-generate" && (
          <div
            className="asset-generation-progress"
            role="status"
            aria-live="polite"
          >
            <LoadingMark />
            <div>
              <b>Generating visual assets with Kie AI</b>
              <span>
                Planning unique character, venue, and object prompts, then
                submitting each image separately. This may take a few minutes.
              </span>
            </div>
          </div>
        )}

        {selectedSource && stage === 4 && (
          <div className="source-preview-card">
            <span>Asset pack selected</span>
            <h3>{selectedSource.name}</h3>
            <p>
              {snapshot.assets.map((asset) => asset.name).join(", ") ||
                "No assets in this pack."}
            </p>
            <div className="prompt-tags">
              <span>Episode 1 first</span>
              <span>Maximum 15 seconds per scene</span>
              <span>{snapshot.aspectRatio}</span>
            </div>
          </div>
        )}

        {selectedSource && stage === 5 && (
          <>
            {!finalSourceReady && (
              <div className="suggestion-box">
                <b>This Story Studio is not ready for final video</b>
                <p>
                  Return to Story Studio, finish every visual asset, and generate
                  the scene prompts for all episodes.
                </p>
              </div>
            )}
            <div className="form-grid three">
              <ModelSelect
                label="Video model"
                value={videoModel}
                options={videoModelOptions}
                onChange={(value) => setVideoModel(value as VideoModelId)}
              />
              {videoModel === "kling-3.0" ? (
                <>
                  <SelectField
                    label="Kling quality"
                    value={videoMode}
                    options={["std", "pro", "4K"]}
                    onChange={(value) =>
                      setVideoMode(value as "std" | "pro" | "4K")
                    }
                  />
                  <SelectField
                    label="Generate sound"
                    value={videoSound ? "On" : "Off"}
                    options={["On", "Off"]}
                    onChange={(value) => setVideoSound(value === "On")}
                  />
                </>
              ) : videoModel === "seedance-2.0" ? (
                <>
                  <div className="field">
                    <label>Seedance output</label>
                    <div className="fixed-model-value">720p · up to 15 seconds</div>
                  </div>
                  <SelectField
                    label="Generate sound"
                    value={videoSound ? "On" : "Off"}
                    options={["On", "Off"]}
                    onChange={(value) => setVideoSound(value === "On")}
                  />
                </>
              ) : (
                <div className="field">
                  <label>Turbo output</label>
                  <div className="fixed-model-value">720p · no sound option</div>
                </div>
              )}
              <SelectField
                label="Fallback handling"
                value="Ask before changing prompt"
                options={[
                  "Ask before changing prompt",
                  "Safety-adjust automatically",
                ]}
                onChange={() => undefined}
              />
            </div>
            <div className="continuity-lock-preview">
              <div>
                <span className="continuity-lock-icon">
                  <LockKeyhole size={15} />
                </span>
                <div>
                  <b>Shared continuity applied to every selected clip</b>
                  <p>
                    The same character appearances, approved assets, visual
                    style, color grade, lens language, lighting, and production
                    design are compacted into every Kie video prompt. Each final
                    prompt is optimized for {modelLabel(videoModelOptions, videoModel)}{" "}
                    and kept below the safe Kie submission limit.
                  </p>
                </div>
              </div>
              <div className="prompt-tags">
                <span>{snapshot.style}</span>
                <span>{snapshot.aspectRatio}</span>
                <span>{snapshot.characters.length} recurring characters</span>
                <span>{snapshot.assets.length} approved assets</span>
                <span>Maximum {VIDEO_PROMPT_SAFE_LIMIT} characters</span>
              </div>
            </div>
            <div className="generation-detail-panel">
              <div>
                <span>Production</span>
                <b>{snapshot.title}</b>
                <p>{snapshot.storyline}</p>
              </div>
              <dl>
                <div><dt>Episodes</dt><dd>{snapshot.episodePlan.length}</dd></div>
                <div><dt>Available scenes</dt><dd>{scenes.length}</dd></div>
                <div><dt>Selected</dt><dd>{selectedCount}</dd></div>
                <div><dt>Selected runtime</dt><dd>{scenes.filter((scene) => scene.selected).reduce((total, scene) => total + scene.duration, 0)}s</dd></div>
                <div><dt>Video model</dt><dd>{modelLabel(videoModelOptions, videoModel)}</dd></div>
                <div><dt>Continuity assets</dt><dd>{snapshot.assets.length}</dd></div>
              </dl>
            </div>
            <div className="scene-selection-toolbar" aria-label="Scene selection controls">
              <div>
                <b>Choose scenes to generate</b>
                <span>{selectedCount} of {scenes.length} selected</span>
              </div>
              <div>
                <button
                  className="select-all-scenes-button"
                  onClick={() =>
                    setScenes(scenes.map((scene) => ({ ...scene, selected: true })))
                  }
                  disabled={!scenes.length || selectedCount === scenes.length}
                >
                  <CheckCircle2 size={14} /> Select all
                </button>
                <button
                  className="deselect-all-scenes-button"
                  onClick={() =>
                    setScenes(scenes.map((scene) => ({ ...scene, selected: false })))
                  }
                  disabled={!selectedCount}
                >
                  <Square size={14} /> Deselect all
                </button>
              </div>
            </div>
            <div className="create-scene-list">
              {scenes.map((scene) => (
                <article
                  className={`create-scene-row ${
                    scene.selected ? "selected" : ""
                  }`}
                  key={scene.id}
                >
                  <button
                    className={`check-box ${scene.selected ? "checked" : ""}`}
                    aria-label={`Select ${scene.id}`}
                    onClick={() =>
                      setScenes(
                        scenes.map((item) =>
                          item.id === scene.id
                            ? { ...item, selected: !item.selected }
                            : item,
                        ),
                      )
                    }
                  >
                    {scene.selected && <Check size={11} />}
                  </button>
                  <div>
                    <span>
                      Episode {scene.episode} · {scene.id} · {scene.duration}s
                    </span>
                    <h3>{scene.title}</h3>
                    <div className="scene-generation-details">
                      <span><Film size={11} /> Text-to-video</span>
                      <span><Clock3 size={11} /> {scene.duration}-second clip</span>
                      <span><Sparkles size={11} /> {modelLabel(videoModelOptions, videoModel)}</span>
                      <span><Layers3 size={11} /> {snapshot.assets.length} continuity references</span>
                      <span><Gauge size={11} /> {scene.prompt.length} prompt characters</span>
                    </div>
                    <label className="scene-generation-prompt-label">
                      <span>Editable generation prompt</span>
                    <textarea
                      value={scene.prompt}
                      onChange={(event) =>
                        setScenes(
                          scenes.map((item) =>
                            item.id === scene.id
                              ? { ...item, prompt: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    </label>
                  </div>
                  <span
                    className={`status-pill ${
                      scene.safety === "Clear" ? "ready" : "warning"
                    }`}
                  >
                    {scene.safety}
                  </span>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="step-actions with-back">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={14} /> Back to library
        </button>
        <div>
          <b>Generation starts only when you confirm</b>
          <span>
            The new result is saved as a separate library item; your source
            remains unchanged.
          </span>
        </div>
        <GenerationCost credits={generationCost}>
          <button
            className="primary-button"
            disabled={
              !selectedSource ||
              !finalSourceReady ||
              busy === "stage-generate" ||
              (stage === 5 && selectedCount === 0)
            }
            onClick={onGenerate}
          >
            {busy === "stage-generate" ? (
              <>
                <LoadingMark /> Generating with Kie AI
              </>
            ) : (
              <>
                <Sparkles size={14} /> {content.button}
              </>
            )}
          </button>
        </GenerationCost>
      </div>
    </div>
  );
}

function StageResultEditor({
  stage,
  snapshot,
  setGeneratedBrief,
  setStoryline,
  setEpisodePlan,
  setCharacters,
  setAssets,
  setScenes,
  onBack,
  onSave,
  onRegenerate,
}: {
  stage: number;
  snapshot: ProductionSnapshot;
  setGeneratedBrief: (value: string) => void;
  setStoryline: (value: string) => void;
  setEpisodePlan: (value: EpisodeOutline[]) => void;
  setCharacters: (value: CharacterProfile[]) => void;
  setAssets: (value: Asset[]) => void;
  setScenes: (value: Scene[]) => void;
  onBack: () => void;
  onSave: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="single-column-content">
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Review and manually edit</h2>
            <p>
              These are the generated results. The original creator input is not
              shown as the main brief.
            </p>
          </div>
          <span className="safe-pill">
            <CheckCircle2 size={11} /> Saved result
          </span>
        </div>

        {stage === 1 && (
          <div className="field">
            <label htmlFor="finished-brief-editor">Finished brief</label>
            <textarea
              id="finished-brief-editor"
              className="generated-story"
              value={snapshot.generatedBrief}
              onChange={(event) => setGeneratedBrief(event.target.value)}
            />
          </div>
        )}

        {stage === 2 && (
          <div className="result-editor-stack">
            <div className="field">
              <label>Full storyline</label>
              <textarea
                className="generated-story"
                value={snapshot.storyline}
                onChange={(event) => setStoryline(event.target.value)}
              />
            </div>
            <h3>Episode outlines</h3>
            {snapshot.episodePlan.map((episode, index) => (
              <div className="form-grid" key={episode.number}>
                <div className="field">
                  <label>Episode {episode.number} title</label>
                  <input
                    value={episode.title}
                    onChange={(event) =>
                      setEpisodePlan(
                        snapshot.episodePlan.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label>Summary</label>
                  <textarea
                    value={episode.summary}
                    onChange={(event) =>
                      setEpisodePlan(
                        snapshot.episodePlan.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, summary: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              </div>
            ))}
            <h3>Character continuity</h3>
            {snapshot.characters.map((character, index) => (
              <div className="form-grid three" key={`${character.name}-${index}`}>
                <div className="field">
                  <label>Name</label>
                  <input
                    value={character.name}
                    onChange={(event) =>
                      setCharacters(
                        snapshot.characters.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label>Appearance</label>
                  <textarea
                    value={character.appearance}
                    onChange={(event) =>
                      setCharacters(
                        snapshot.characters.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, appearance: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label>Personality & arc</label>
                  <textarea
                    value={`${character.personality}\n\n${character.arc}`}
                    onChange={(event) =>
                      setCharacters(
                        snapshot.characters.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, personality: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {stage === 3 && (
          <div className="result-editor-stack">
            {snapshot.assets.map((asset, index) => (
              <article className="source-preview-card" key={asset.id}>
                <span>
                  {asset.type} · {asset.status}
                </span>
                <div className="form-grid">
                  <div className="field">
                    <label>Asset name</label>
                    <input
                      value={asset.name}
                      onChange={(event) =>
                        setAssets(
                          snapshot.assets.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Visual prompt</label>
                    <textarea
                      value={asset.visualPrompt ?? asset.detail}
                      onChange={(event) =>
                        setAssets(
                          snapshot.assets.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, visualPrompt: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
                {asset.taskId && <small>Kie task: {asset.taskId}</small>}
                {asset.status === "generating" && (
                  <div className="inline-asset-generating" role="status">
                    <LoadingMark />
                    <div>
                      <b>Generating image</b>
                      <span>
                        Kie AI is creating this unique asset reference
                        {typeof asset.progress === "number"
                          ? ` · ${asset.progress}%`
                          : ""}
                        .
                      </span>
                    </div>
                  </div>
                )}
                {asset.error && (
                  <div className="story-studio-asset-error" role="alert">
                    <ShieldAlert size={13} />
                    <span>{asset.error}</span>
                  </div>
                )}
                {asset.resultUrl && (
                  <a
                    className="generated-asset-result"
                    href={asset.resultUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span
                      role="img"
                      aria-label={`Generated ${asset.name}`}
                      style={{
                        backgroundImage: `url(${JSON.stringify(
                          asset.resultUrl,
                        )})`,
                      }}
                    />
                    <b>Open generated image</b>
                  </a>
                )}
              </article>
            ))}
          </div>
        )}

        {(stage === 4 || stage === 5) && (
          <div className="result-editor-stack">
            {snapshot.scenes.map((scene, index) => (
              <article className="source-preview-card" key={scene.id}>
                <span>
                  {scene.id} · {scene.duration}s · {scene.status}
                </span>
                <h3>{scene.title}</h3>
                <textarea
                  value={scene.prompt}
                  onChange={(event) =>
                    setScenes(
                      snapshot.scenes.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, prompt: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                {scene.taskId && <small>Kie task: {scene.taskId}</small>}
                {stage === 5 && scene.status === "generating" && (
                  <div className="inline-video-generating">
                    <LoadingMark />
                    <div>
                      <b>Generating</b>
                      <span>Kie AI is creating this clip.</span>
                    </div>
                  </div>
                )}
                {stage === 5 && scene.resultUrl && (
                  <video
                    className="inline-video-preview"
                    controls
                    playsInline
                    preload="metadata"
                    src={scene.resultUrl}
                    aria-label={`Video preview for ${scene.title}`}
                  />
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="step-actions with-back">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={14} /> Back to library
        </button>
        <div>
          <b>Keep this version or regenerate</b>
          <span>Regeneration creates a new item and preserves this one.</span>
        </div>
        <button className="secondary-button" onClick={onRegenerate}>
          <RefreshCcw size={14} /> Regenerate
        </button>
        <button className="primary-button" onClick={onSave}>
          <Check size={14} /> Save manual edits
        </button>
      </div>
    </div>
  );
}

function StepOne({
  values,
  setters,
  busy,
  briefSeedBusy,
  chatModel,
  setChatModel,
  markChanged,
  onGenerateSeed,
  onContinue,
}: {
  values: {
    title: string;
    roughStory: string;
    episodes: number;
    episodeLength: number;
    style: string;
    language: string;
    aspectRatio: string;
    pacing: string;
    audience: string;
    rating: string;
    tone: string[];
  };
  setters: {
    setTitle: (value: string) => void;
    setRoughStory: (value: string) => void;
    setEpisodes: (value: number) => void;
    setEpisodeLength: (value: number) => void;
    setStyle: (value: string) => void;
    setLanguage: (value: string) => void;
    setAspectRatio: (value: string) => void;
    setPacing: (value: string) => void;
    setAudience: (value: string) => void;
    setRating: (value: string) => void;
    setTone: (value: string[]) => void;
  };
  busy: string | null;
  briefSeedBusy: boolean;
  chatModel: ChatModelId;
  setChatModel: (value: ChatModelId) => void;
  markChanged: () => void;
  onGenerateSeed: () => void;
  onContinue: () => void;
}) {
  const update = (fn: () => void) => {
    fn();
    markChanged();
  };
  const toneOptions = [
    "Atmospheric",
    "Emotional",
    "Suspenseful",
    "Romantic",
    "Darkly comic",
    "Hopeful",
  ];
  const estimatedScenesPerEpisode =
    values.episodeLength === 1 ? 5 : values.episodeLength * 4;
  const estimatedSceneDuration = Math.min(
    15,
    Math.ceil((values.episodeLength * 60) / estimatedScenesPerEpisode),
  );
  const estimatedProductionCredits =
    values.episodes *
    estimatedScenesPerEpisode *
    estimateVideoCredits("seedance-2.0", estimatedSceneDuration, "pro");

  return (
    <div className="content-grid">
      <div className="content-main">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Start with the rough story</h2>
              <p>
                Give the AI enough direction to build from. You’ll review every
                generated result before anything moves forward.
              </p>
            </div>
            <span className="required-pill">Required</span>
          </div>

          <div className="brief-seed-generator">
            <div className="brief-seed-copy">
              <span className="brief-seed-icon">
                <Sparkles size={16} />
              </span>
              <div>
                <b>Need a strong starting point?</b>
                <p>
                  Kie AI will create a working title and premise with a clear
                  protagonist, central conflict, and distinctive world.
                </p>
              </div>
            </div>
            <GenerationCost credits={chatCreditEstimate[chatModel]}>
              <button
                type="button"
                className="primary-button brief-seed-button"
                onClick={onGenerateSeed}
                disabled={briefSeedBusy}
              >
                {briefSeedBusy ? (
                  <>
                    <LoadingMark /> Generating title &amp; premise
                  </>
                ) : values.roughStory.trim() ? (
                  <>
                    <RefreshCcw size={14} /> Regenerate title &amp; premise
                  </>
                ) : (
                  <>
                    <Sparkles size={14} /> Generate title &amp; premise
                  </>
                )}
              </button>
            </GenerationCost>
          </div>

          <div className="field">
            <label htmlFor="project-title">Working title</label>
            <input
              id="project-title"
              value={values.title}
              onChange={(event) =>
                update(() => setters.setTitle(event.target.value))
              }
              placeholder="Untitled drama"
            />
          </div>

          <div className="field">
            <div className="label-row">
              <label htmlFor="rough-story">Rough story or premise</label>
              <span>{values.roughStory.length}/2,000</span>
            </div>
            <textarea
              id="rough-story"
              className="story-input"
              value={values.roughStory}
              onChange={(event) =>
                update(() => setters.setRoughStory(event.target.value))
              }
              placeholder="Describe the world, the main conflict, and anything you already know…"
            />
            <div className="input-tip">
              <Sparkles size={14} />
              <span>
                Strong seeds mention a protagonist, a conflict, and what makes
                the world feel different.
              </span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-heading compact-heading">
            <div>
              <h2>Shape the format</h2>
              <p>These settings determine episode structure and scene count.</p>
            </div>
          </div>

          <div className="form-grid three">
            <SelectField
              label="Number of episodes"
              value={String(values.episodes)}
              options={["4", "6", "8", "10", "12", "16"]}
              onChange={(value) =>
                update(() => setters.setEpisodes(Number(value)))
              }
            />
            <SelectField
              label="Length per episode"
              value={String(values.episodeLength)}
              options={["1", "2", "3", "5", "8"]}
              optionSuffix=" min"
              onChange={(value) =>
                update(() => setters.setEpisodeLength(Number(value)))
              }
            />
            <SelectField
              label="Aspect ratio"
              value={values.aspectRatio}
              options={["16:9", "9:16", "1:1", "2.39:1"]}
              onChange={(value) =>
                update(() => setters.setAspectRatio(value))
              }
            />
            <SelectField
              label="Visual style"
              value={values.style}
              options={[
                "Cinematic mystery",
                "Prestige romance",
                "Graphic novel",
                "Anime drama",
                "Naturalistic",
              ]}
              onChange={(value) => update(() => setters.setStyle(value))}
            />
            <SelectField
              label="Pacing"
              value={values.pacing}
              options={[
                "Slow burn",
                "Balanced",
                "Fast & twisty",
                "Character-led",
              ]}
              onChange={(value) => update(() => setters.setPacing(value))}
            />
            <SelectField
              label="Language"
              value={values.language}
              options={[
                "English",
                "Mandarin",
                "Malay",
                "Japanese",
                "Korean",
              ]}
              onChange={(value) => update(() => setters.setLanguage(value))}
            />
          </div>

          <div className="format-preview">
            <div className="format-icon">
              <Film size={18} />
            </div>
            <div>
              <b>Estimated production</b>
              <span>
                {values.episodes} episodes · approximately{" "}
                {estimatedScenesPerEpisode}{" "}
                scenes each · {values.episodes * values.episodeLength} minutes
                total
              </span>
            </div>
            <span className="estimate-chip">
              ≈{estimatedProductionCredits.toLocaleString()} Seedance video credits
            </span>
          </div>
        </section>

        <section className="card">
          <div className="card-heading compact-heading">
            <div>
              <h2>Creative guardrails</h2>
              <p>Set the audience, tone, and content boundaries.</p>
            </div>
          </div>
          <div className="form-grid three">
            <SelectField
              label="Target audience"
              value={values.audience}
              options={[
                "Young adults",
                "General audience",
                "Mature viewers",
                "Family",
              ]}
              onChange={(value) => update(() => setters.setAudience(value))}
            />
            <SelectField
              label="Content rating"
              value={values.rating}
              options={["G", "PG", "PG-13", "R"]}
              onChange={(value) => update(() => setters.setRating(value))}
            />
            <SelectField
              label="Continuity strength"
              value="Strict"
              options={["Strict", "Balanced", "Flexible"]}
              onChange={markChanged}
            />
          </div>
          <div className="field">
            <label>Emotional tone</label>
            <div className="tone-grid">
              {toneOptions.map((option) => {
                const selected = values.tone.includes(option);
                return (
                  <button
                    type="button"
                    key={option}
                    className={`tone-chip ${selected ? "selected" : ""}`}
                    onClick={() =>
                      update(() =>
                        setters.setTone(
                          selected
                            ? values.tone.filter((item) => item !== option)
                            : [...values.tone, option],
                        ),
                      )
                    }
                  >
                    <span
                      className={`check-box ${selected ? "checked" : ""}`}
                    >
                      {selected && <Check size={11} />}
                    </span>
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="card model-choice-panel">
          <div className="card-heading compact-heading">
            <div>
              <h2>Choose the writing model</h2>
              <p>
                Select which Kie AI model will turn these inputs into the
                finished brief.
              </p>
            </div>
            <span className="safe-pill">
              <Sparkles size={11} /> Kie AI
            </span>
          </div>
          <ModelSelect
            label="Brief generation model"
            value={chatModel}
            options={chatModelOptions}
            onChange={(value) => setChatModel(value as ChatModelId)}
          />
        </section>

        <div className="step-actions">
          <div>
            <b>Ready to generate the finished brief?</b>
            <span>
              Kie AI turns these inputs into a polished creative brief and
              saves only the finished result to the Brief library.
            </span>
          </div>
          <GenerationCost credits={chatCreditEstimate[chatModel]}>
            <button
              className="primary-button"
              onClick={onContinue}
              disabled={!values.roughStory.trim() || busy === "stage-generate"}
            >
              {busy === "stage-generate" ? (
                <>
                  <LoadingMark /> Generating with Kie AI
                </>
              ) : (
                <>
                  Generate finished brief <Sparkles size={15} />
                </>
              )}
            </button>
          </GenerationCost>
        </div>
      </div>

      <aside className="content-side">
        <section className="side-card creative-director">
          <div className="side-card-title">
            <span className="assistant-orb">
              <Sparkles size={15} />
            </span>
            <div>
              <b>Creative director</b>
              <small>Brief check</small>
            </div>
          </div>
          <div className="director-score">
            <div className="score-ring">
              <span>86</span>
            </div>
            <div>
              <b>Strong foundation</b>
              <span>
                Your premise has a clear protagonist, time pressure, and visual
                world.
              </span>
            </div>
          </div>
          <ul className="check-list">
            <li>
              <CheckCircle2 size={14} /> Central conflict is specific
            </li>
            <li>
              <CheckCircle2 size={14} /> Visual motif is repeatable
            </li>
            <li>
              <CheckCircle2 size={14} /> Episode format is model-friendly
            </li>
          </ul>
          <div className="suggestion-box">
            <b>Optional improvement</b>
            <p>
              Name one thing Aya stands to lose personally if she exposes the
              signal.
            </p>
          </div>
        </section>

        <section className="side-card">
          <div className="side-card-title plain">
            <b>How this works</b>
            <span className="safe-pill">
              <Layers3 size={11} /> Flexible
            </span>
          </div>
          <div className="how-list">
            <div>
              <span>1</span>
              <p>
                <b>Generate</b>
                <small>AI creates one production layer.</small>
              </p>
            </div>
            <div>
              <span>2</span>
              <p>
                <b>Review & edit</b>
                <small>You control every word and selection.</small>
              </p>
            </div>
            <div>
              <span>3</span>
              <p>
                <b>Approve</b>
                <small>Save a new version for the next stage.</small>
              </p>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

// Retained as a richer editor module for the later episode-detail expansion.
function StepTwo({
  tab,
  setTab,
  storyline,
  setStoryline,
  episodePlan,
  characters,
  title,
  episodes,
  episodeDrafts,
  setEpisodeDrafts,
  busy,
  onRegenerate,
  runAction,
  onBack,
  onContinue,
}: {
  tab: "story" | "episodes" | "characters";
  setTab: (tab: "story" | "episodes" | "characters") => void;
  storyline: string;
  setStoryline: (value: string) => void;
  episodePlan: EpisodeOutline[];
  characters: CharacterProfile[];
  title: string;
  episodes: number;
  episodeDrafts: number;
  setEpisodeDrafts: (value: number) => void;
  busy: string | null;
  onRegenerate: () => void;
  runAction: (
    key: string,
    action: () => void,
    message: string,
    delay?: number,
  ) => Promise<void>;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="content-grid story-layout">
      <div className="content-main">
        <section className="card story-bible-card">
          <div className="story-cover">
            <div className="cover-overlay">
              <span className="draft-chip">Story bible · Draft 01</span>
              <h2>{title}</h2>
              <p>
                A transmission from seven days ahead. A city with one storm
                left.
              </p>
              <div className="cover-meta">
                <span>{episodes} episodes</span>
                <span>1 minute each</span>
                <span>Mystery drama</span>
              </div>
            </div>
          </div>

          <div className="tab-bar">
            <button
              className={tab === "story" ? "active" : ""}
              onClick={() => setTab("story")}
            >
              Full storyline
            </button>
            <button
              className={tab === "episodes" ? "active" : ""}
              onClick={() => setTab("episodes")}
            >
              Episode plan
              <span>{episodeDrafts}/{episodes}</span>
            </button>
            <button
              className={tab === "characters" ? "active" : ""}
              onClick={() => setTab("characters")}
            >
              Characters
              <span>4</span>
            </button>
          </div>

          {tab === "story" && (
            <div className="tab-content">
              <div className="result-toolbar">
                <div>
                  <span className="result-label">AI-generated draft</span>
                  <span className="confidence-pill">
                    <Sparkles size={11} /> Strong arc
                  </span>
                </div>
                <div className="inline-actions">
                  <button className="small-button" onClick={onRegenerate}>
                    <RefreshCcw
                      size={13}
                      className={busy === "storyline" ? "spin" : ""}
                    />
                    Regenerate
                  </button>
                  <button
                    className="small-button"
                    onClick={() =>
                      runAction(
                        "copy-story",
                        () => void navigator.clipboard.writeText(storyline),
                        "Storyline copied to clipboard.",
                        0,
                      )
                    }
                  >
                    <Copy size={13} /> Copy
                  </button>
                </div>
              </div>
              <textarea
                className="generated-story"
                value={storyline}
                onChange={(event) => setStoryline(event.target.value)}
              />
              <div className="edit-note">
                <PencilLine size={14} />
                <span>
                  This is fully editable. Your version—not the original AI
                  draft—will become the production source.
                </span>
                <span>Auto-saved</span>
              </div>
              <div className="story-pill-row">
                <span>Theme · Truth vs survival</span>
                <span>Motif · Red thread</span>
                <span>Hook · Future recording</span>
                <span>Ending · Bittersweet</span>
              </div>
            </div>
          )}

          {tab === "episodes" && (
            <div className="tab-content">
              <div className="episode-list">
                {Array.from({ length: Math.min(episodes, 8) }).map((_, index) => {
                  const number = index + 1;
                  const episode = episodePlan.find(
                    (item) => item.number === number,
                  );
                  const generated = Boolean(episode) || number <= episodeDrafts;
                  return (
                    <article
                      className={`episode-row ${
                        generated ? "" : "episode-locked"
                      }`}
                      key={number}
                    >
                      <span className="episode-number">
                        {String(number).padStart(2, "0")}
                      </span>
                      <div>
                        <b>
                          {generated
                            ? episode?.title || `Episode ${number}`
                            : `Episode ${number}`}
                        </b>
                        <p>
                          {generated
                            ? episode?.summary ||
                              "The central conflict advances while a new consequence changes the characters' next choice."
                            : "Generate when you are ready to continue the season."}
                        </p>
                      </div>
                      <span
                        className={`status-pill ${
                          generated ? "ready" : "outline"
                        }`}
                      >
                        {generated ? "Draft ready" : "Not generated"}
                      </span>
                      {generated ? (
                        <button
                          className="icon-button"
                          onClick={() =>
                            runAction(
                              `edit-episode-${number}`,
                              () => undefined,
                              `Episode ${number} is ready for manual editing.`,
                              0,
                            )
                          }
                        >
                          <PencilLine size={14} />
                        </button>
                      ) : (
                        <LockKeyhole size={14} className="muted-icon" />
                      )}
                    </article>
                  );
                })}
              </div>
              {episodeDrafts < episodes && (
                <div className="generation-choice">
                  <div>
                    <Sparkles size={17} />
                    <span>
                      <b>Choose how to continue</b>
                      <small>
                        Generate the next episode for closer control, or finish
                        the remaining outline.
                      </small>
                    </span>
                  </div>
                  <div className="inline-actions">
                    <button
                      className="secondary-button"
                      disabled={busy === "next-episode"}
                      onClick={() =>
                        runAction(
                          "next-episode",
                          () =>
                            setEpisodeDrafts(
                              Math.min(episodes, episodeDrafts + 1),
                            ),
                          `Episode ${episodeDrafts + 1} draft generated.`,
                        )
                      }
                    >
                      {busy === "next-episode" ? (
                        <LoadingMark />
                      ) : (
                        <Plus size={14} />
                      )}
                      Generate next
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy === "all-episodes"}
                      onClick={() =>
                        runAction(
                          "all-episodes",
                          () => setEpisodeDrafts(episodes),
                          "Remaining episode outlines generated.",
                          1350,
                        )
                      }
                    >
                      Generate remaining
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "characters" && (
            <div className="tab-content">
              {characters.length > 0 && (
                <div className="generated-character-summary">
                  <span className="result-label">Kie AI character designs</span>
                  <div>
                    {characters.map((character) => (
                      <span key={character.name}>
                        <b>{character.name}</b>
                        <small>{character.role}</small>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="character-grid">
                {[
                  {
                    initials: "AL",
                    name: "Aya Lin",
                    role: "Protagonist · Investigative journalist",
                    color: "blue",
                    appearance:
                      "Early 30s, sharp dark eyes, rain-dark bob, sand trench coat, red thread bracelet.",
                    character:
                      "Analytical and relentless. Uses scepticism as armour; terrified of becoming unreliable.",
                    arc: "Learns that truth is not only something to expose, but something to carry responsibly.",
                  },
                  {
                    initials: "RK",
                    name: "Ren Kaito",
                    role: "Deuteragonist · Civic architect",
                    color: "navy",
                    appearance:
                      "Mid 30s, composed posture, navy workwear, tired expression, old drafting pencil.",
                    character:
                      "Precise, guarded, quietly compassionate. Carries guilt for the observatory project.",
                    arc: "Moves from controlled isolation to choosing public accountability beside Aya.",
                  },
                  {
                    initials: "ME",
                    name: "Mara Eno",
                    role: "Editor · Mentor",
                    color: "coral",
                    appearance:
                      "Late 50s, silver crop, practical linen shirts, translucent amber glasses.",
                    character:
                      "Warm but politically astute. Protects Aya without withholding hard truths.",
                    arc: "Reveals her connection to the first transmission and accepts its consequences.",
                  },
                  {
                    initials: "TN",
                    name: "Tomas Neri",
                    role: "Antagonist · Emergency director",
                    color: "stone",
                    appearance:
                      "Early 50s, immaculate charcoal suits, calm smile, monsoon authority badge.",
                    character:
                      "Persuasive, paternal, convinced secrecy is the only path to civic order.",
                    arc: "His certainty fractures when the signal predicts his own act of betrayal.",
                  },
                ].map((character) => (
                  <article className="character-card" key={character.name}>
                    <div className="character-head">
                      <span className={`character-avatar ${character.color}`}>
                        {character.initials}
                      </span>
                      <div>
                        <h3>{character.name}</h3>
                        <span>{character.role}</span>
                      </div>
                      <button
                        className="icon-button"
                        onClick={() =>
                          runAction(
                            `edit-character-${character.initials}`,
                            () => undefined,
                            `${character.name} character editor opened.`,
                            0,
                          )
                        }
                      >
                        <PencilLine size={13} />
                      </button>
                    </div>
                    <dl>
                      <div>
                        <dt>Appearance</dt>
                        <dd>{character.appearance}</dd>
                      </div>
                      <div>
                        <dt>Personality</dt>
                        <dd>{character.character}</dd>
                      </div>
                      <div>
                        <dt>Season arc</dt>
                        <dd>{character.arc}</dd>
                      </div>
                    </dl>
                    <button
                      className="regenerate-link"
                      onClick={() =>
                        runAction(
                          `regen-character-${character.initials}`,
                          () => undefined,
                          `${character.name} regenerated. Review the updated profile.`,
                        )
                      }
                    >
                      <RefreshCcw size={12} /> Regenerate this character
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        <BottomActions
          onBack={onBack}
          backLabel="Edit brief"
          title="Approve this story bible?"
          subtitle="You can return and edit it later, but approved details will guide every visual asset."
          primaryLabel="Approve & plan visual assets"
          onContinue={onContinue}
        />
      </div>

      <aside className="content-side">
        <section className="side-card review-card">
          <div className="side-card-title plain">
            <b>Story health</b>
            <span className="score-text">92 / 100</span>
          </div>
          <div className="health-bars">
            {[
              ["Hook strength", 96],
              ["Character stakes", 91],
              ["Episode momentum", 88],
              ["Visual potential", 94],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <span>
                  {label} <b>{value}</b>
                </span>
                <div className="health-bar">
                  <i style={{ width: `${value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="side-card">
          <div className="side-card-title plain">
            <b>Continuity anchors</b>
            <span className="count-pill">6 locked</span>
          </div>
          <div className="anchor-list">
            <span>
              <i className="swatch sand" /> Aya’s sand trench coat
            </span>
            <span>
              <i className="swatch red" /> Red thread bracelet
            </span>
            <span>
              <i className="swatch navy" /> Monsoon indigo palette
            </span>
            <span>
              <i className="swatch brass" /> Brass pocket recorder
            </span>
          </div>
          <Link href="/drama-studio" className="full-small-button">
            <Settings size={13} /> Manage continuity
          </Link>
        </section>
        <section className="side-card note-card">
          <Sparkles size={16} />
          <div>
            <b>Nothing moves without you</b>
            <p>
              Generate one episode first, edit any text directly, and approve
              only when the story feels right.
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}

// Retained as a richer editor module for the later asset-detail expansion.
function StepThree({
  assets,
  setAssets,
  selectedAssets,
  busy,
  onGenerate,
  runAction,
  onBack,
  onContinue,
}: {
  assets: Asset[];
  setAssets: (assets: Asset[]) => void;
  selectedAssets: number;
  busy: string | null;
  onGenerate: () => void;
  runAction: (
    key: string,
    action: () => void,
    message: string,
    delay?: number,
  ) => Promise<void>;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [assetFilter, setAssetFilter] = useState<
    "All" | Asset["type"]
  >("All");
  const ready = assets.filter((asset) => asset.status === "ready").length;
  const visibleAssets =
    assetFilter === "All"
      ? assets
      : assets.filter((asset) => asset.type === assetFilter);
  return (
    <div className="single-column-content">
      <section className="card asset-toolbar-card">
        <div>
          <span className="result-label">Visual continuity pack</span>
          <h2>Generate reusable production assets</h2>
          <p>
            Build the people, places, and objects once so every scene starts
            from the same visual language.
          </p>
        </div>
        <div className="toolbar-stats">
          <span>
            <b>{selectedAssets}</b> selected
          </span>
          <span>
            <b>{ready}</b> ready
          </span>
          <button
            className="primary-button"
            onClick={onGenerate}
            disabled={!selectedAssets || busy === "assets"}
          >
            {busy === "assets" ? (
              <>
                <LoadingMark /> Generating
              </>
            ) : (
              <>
                <Sparkles size={14} /> Generate selected
              </>
            )}
          </button>
        </div>
      </section>

      <section className="card flush-card">
        <div className="asset-filterbar">
          <div className="filter-tabs">
            {[
              ["All", "All assets"],
              ["Character", "Characters"],
              ["Venue", "Venues"],
              ["Object", "Objects"],
            ].map(([value, label]) => (
              <button
                className={assetFilter === value ? "active" : ""}
                onClick={() =>
                  setAssetFilter(value as "All" | Asset["type"])
                }
                key={value}
              >
                {label}{" "}
                <span>
                  {value === "All"
                    ? assets.length
                    : assets.filter((asset) => asset.type === value).length}
                </span>
              </button>
            ))}
          </div>
          <div className="inline-actions">
            <button
              className="small-button"
              onClick={() =>
                setAssets(
                  assets.map((asset) => ({ ...asset, selected: true })),
                )
              }
            >
              Select all
            </button>
            <button
              className="small-button"
              onClick={() => {
                const next: Asset = {
                  id: `custom-${Date.now()}`,
                  name: "Custom reference",
                  type: "Object",
                  detail:
                    "New custom production reference · edit prompt before generation",
                  crop: "90% center",
                  selected: true,
                  status: "planned",
                };
                setAssets([...assets, next]);
                setAssetFilter("All");
                void runAction(
                  "custom-asset",
                  () => undefined,
                  "Custom asset added to the continuity pack.",
                  0,
                );
              }}
            >
              <Plus size={13} /> Add custom asset
            </button>
          </div>
        </div>

        <div className="asset-grid">
          {visibleAssets.map((asset) => (
            <article
              className={`asset-card ${asset.selected ? "selected" : ""}`}
              key={asset.id}
            >
              <button
                className={`asset-checkbox ${
                  asset.selected ? "checked" : ""
                }`}
                onClick={() =>
                  setAssets(
                    assets.map((item) =>
                      item.id === asset.id
                        ? { ...item, selected: !item.selected }
                        : item,
                    ),
                  )
                }
                aria-label={`Select ${asset.name}`}
              >
                {asset.selected && <Check size={12} />}
              </button>
              <div className="asset-visual">
                <Image
                  src="/images/last-monsoon-concept.png"
                  alt=""
                  fill
                  sizes="(max-width: 720px) 100vw, 33vw"
                  style={{ objectPosition: asset.crop }}
                />
                {asset.status === "generating" && (
                  <div className="asset-generating">
                    <LoadingMark /> Generating
                  </div>
                )}
                {asset.status === "planned" && (
                  <div className="asset-planned">
                    <ImageIcon size={16} /> Concept planned
                  </div>
                )}
                <span className="asset-type">{asset.type}</span>
              </div>
              <div className="asset-info">
                <div>
                  <h3>{asset.name}</h3>
                  <span
                    className={`status-dot ${
                      asset.status === "ready" ? "ready" : ""
                    }`}
                  >
                    {asset.status === "ready" ? "Ready" : "Not generated"}
                  </span>
                </div>
                <p>{asset.detail}</p>
                <div className="asset-actions">
                  <button
                    onClick={() =>
                      runAction(
                        `edit-asset-${asset.id}`,
                        () => undefined,
                        `${asset.name} prompt is ready for editing.`,
                        0,
                      )
                    }
                  >
                    <PencilLine size={12} /> Edit prompt
                  </button>
                  {asset.status === "ready" && (
                    <button
                      onClick={() =>
                        runAction(
                          `regen-${asset.id}`,
                          () =>
                            setAssets(
                              assets.map((item) =>
                                item.id === asset.id
                                  ? { ...item, status: "ready" }
                                  : item,
                              ),
                            ),
                          `${asset.name} regenerated.`,
                        )
                      }
                    >
                      <RefreshCcw size={12} /> Regenerate
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="continuity-banner">
        <span className="continuity-icon">
          <ShieldAlert size={18} />
        </span>
        <div>
          <b>Continuity lock is on</b>
          <p>
            Approved character faces, wardrobe, props, and venue palettes will
            be referenced in every downstream scene prompt.
          </p>
        </div>
        <Link href="/drama-studio" className="small-button">
          Review lock settings
        </Link>
      </section>

      <BottomActions
        onBack={onBack}
        backLabel="Back to story"
        title="Happy with the visual language?"
        subtitle="Generate at least one asset pack, then approve it to build scene prompts."
        primaryLabel="Approve assets & build prompts"
        onContinue={onContinue}
        disabled={ready === 0}
      />
    </div>
  );
}

// Retained as a richer editor module for the later prompt-detail expansion.
function StepFour({
  scenes,
  setScenes,
  busy,
  selectedScenes,
  sceneMinutes,
  runAction,
  markChanged,
  onBack,
  onContinue,
}: {
  scenes: Scene[];
  setScenes: (scenes: Scene[]) => void;
  busy: string | null;
  selectedScenes: number;
  sceneMinutes: number;
  runAction: (
    key: string,
    action: () => void,
    message: string,
    delay?: number,
  ) => Promise<void>;
  markChanged: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [expanded, setExpanded] = useState("E01-S02");
  return (
    <div className="single-column-content">
      <section className="card scene-control-card">
        <div className="scene-control-top">
          <div>
            <span className="result-label">Prompt studio</span>
            <h2>Episode 1 · The voice in the rain</h2>
            <p>
              Five model-ready scenes from your approved story and asset pack.
              Edit any prompt before approval.
            </p>
          </div>
          <div className="episode-select">
            <label>Viewing episode</label>
            <select defaultValue="1">
              <option value="1">Episode 1</option>
              <option value="2">Episode 2 · Not generated</option>
              <option value="3">Episode 3 · Not generated</option>
            </select>
          </div>
        </div>
        <div className="scene-summary">
          <span>
            <Film size={14} /> <b>5</b> scenes
          </span>
          <span>
            <Clock3 size={14} /> <b>60 sec</b> target
          </span>
          <span>
            <Gauge size={14} /> <b>12 sec</b> each
          </span>
          <span>
            <CheckCircle2 size={14} /> <b>{selectedScenes}</b> selected
          </span>
          <div className="summary-spacer" />
          <button
            className="small-button"
            onClick={() =>
              setScenes(
                scenes.map((scene) => ({ ...scene, selected: true })),
              )
            }
          >
            Select all
          </button>
          <button
            className="primary-button compact-primary"
            disabled={busy === "prompts"}
            onClick={() =>
              runAction(
                "prompts",
                () => undefined,
                `${selectedScenes} prompts refined and continuity-checked.`,
                1100,
              )
            }
          >
            {busy === "prompts" ? <LoadingMark /> : <Sparkles size={13} />}
            Generate selected prompts
          </button>
        </div>
      </section>

      <div className="scene-list">
        {scenes.map((scene, index) => {
          const open = expanded === scene.id;
          return (
            <article
              className={`scene-card ${open ? "expanded" : ""} ${
                scene.selected ? "selected" : ""
              }`}
              key={scene.id}
            >
              <div
                className="scene-row"
                onClick={() => setExpanded(open ? "" : scene.id)}
              >
                <button
                  className={`scene-checkbox ${
                    scene.selected ? "checked" : ""
                  }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setScenes(
                      scenes.map((item) =>
                        item.id === scene.id
                          ? { ...item, selected: !item.selected }
                          : item,
                      ),
                    );
                  }}
                >
                  {scene.selected && <Check size={11} />}
                </button>
                <span className="scene-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="scene-title">
                  <b>{scene.title}</b>
                  <span>{scene.id} · Narrative video</span>
                </div>
                <span className="duration-pill">
                  <Clock3 size={11} /> {scene.duration}s
                </span>
                <span
                  className={`safety-pill ${
                    scene.safety === "Review" ? "review" : ""
                  }`}
                >
                  {scene.safety === "Clear" ? (
                    <CheckCircle2 size={11} />
                  ) : (
                    <ShieldAlert size={11} />
                  )}
                  {scene.safety}
                </span>
                <span className="provider-pill">{scene.provider}</span>
                <ChevronDown
                  size={16}
                  className={open ? "rotate" : ""}
                />
              </div>
              {open && (
                <div className="scene-editor">
                  <div className="scene-reference">
                    <div className="reference-image">
                      <Image
                        src="/images/last-monsoon-concept.png"
                        alt=""
                        fill
                        sizes="240px"
                        style={{
                          objectPosition:
                            index < 2
                              ? "20% center"
                              : index === 4
                                ? "93% center"
                                : "58% center",
                        }}
                      />
                    </div>
                    <span>
                      <ImageIcon size={12} /> 3 continuity references
                    </span>
                  </div>
                  <div className="prompt-editor">
                    <div className="label-row">
                      <label htmlFor={`prompt-${scene.id}`}>
                        Generation prompt
                      </label>
                      <span>{scene.prompt.length} characters</span>
                    </div>
                    <textarea
                      id={`prompt-${scene.id}`}
                      value={scene.prompt}
                      onChange={(event) => {
                        setScenes(
                          scenes.map((item) =>
                            item.id === scene.id
                              ? { ...item, prompt: event.target.value }
                              : item,
                          ),
                        );
                        markChanged();
                      }}
                    />
                    <div className="prompt-controls">
                      <SelectField
                        label="Duration"
                        value={String(scene.duration)}
                        options={["5", "8", "10", "12", "15"]}
                        optionSuffix=" sec"
                        onChange={(value) =>
                          setScenes(
                            scenes.map((item) =>
                              item.id === scene.id
                                ? { ...item, duration: Number(value) }
                                : item,
                            ),
                          )
                        }
                      />
                      <SelectField
                        label="Preferred model"
                        value={scene.provider}
                        options={["Kie AI · Kling 3.0"]}
                        onChange={(value) =>
                          setScenes(
                            scenes.map((item) =>
                              item.id === scene.id
                                ? {
                                    ...item,
                                    provider: value as Scene["provider"],
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                      <SelectField
                        label="Camera movement"
                        value="AI recommended"
                        options={[
                          "AI recommended",
                          "Static",
                          "Dolly",
                          "Handheld",
                        ]}
                        onChange={markChanged}
                      />
                    </div>
                    <div className="prompt-footer">
                      <div className="prompt-tags">
                        <span>Character lock</span>
                        <span>Palette lock</span>
                        <span>Prop reference</span>
                      </div>
                      <button
                        className="regenerate-link"
                        onClick={() =>
                          runAction(
                            `prompt-${scene.id}`,
                            () => undefined,
                            `${scene.id} prompt regenerated.`,
                          )
                        }
                      >
                        <RefreshCcw
                          size={12}
                          className={
                            busy === `prompt-${scene.id}` ? "spin" : ""
                          }
                        />
                        Regenerate prompt
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <section className="selection-summary-card">
        <div className="selection-icon">
          <CheckCircle2 size={20} />
        </div>
        <div>
          <b>{selectedScenes} scenes selected for generation</b>
          <p>
            Estimated output {sceneMinutes} min · the selected Kie model and
            live balance determine the cost shown beside each generation action.
          </p>
        </div>
        <Link href="/drama-studio" className="small-button">
          <Settings size={13} /> Generation settings
        </Link>
      </section>

      <BottomActions
        onBack={onBack}
        backLabel="Back to assets"
        title="Prompts ready for video generation?"
        subtitle="Only checked scenes will move forward. You can return and edit prompts at any time."
        primaryLabel={`Approve ${selectedScenes} scenes`}
        onContinue={onContinue}
        disabled={!selectedScenes}
      />
    </div>
  );
}

// Retained as a richer editor module for the later assembly-detail expansion.
function StepFive({
  scenes,
  selectedScenes,
  readyScenes,
  busy,
  autoFallback,
  setAutoFallback,
  assembled,
  setAssembled,
  runAction,
  onGenerate,
  onBack,
  onComplete,
}: {
  scenes: Scene[];
  selectedScenes: number;
  readyScenes: number;
  busy: string | null;
  autoFallback: boolean;
  setAutoFallback: (value: boolean) => void;
  assembled: boolean;
  setAssembled: (value: boolean) => void;
  runAction: (
    key: string,
    action: () => void,
    message: string,
    delay?: number,
  ) => Promise<void>;
  onGenerate: (
    mode: "selected" | "episode",
    sceneId?: string,
  ) => Promise<void>;
  onBack: () => void;
  onComplete: () => void;
}) {
  const selected = scenes.filter((scene) => scene.selected);
  return (
    <div className="single-column-content">
      <section className="generation-header">
        <div>
          <span className="result-label">Generation queue</span>
          <h2>Episode 1 · Production room</h2>
          <p>
            Generate one shot, selected shots, or the full episode. Nothing
            runs until you choose.
          </p>
        </div>
        <div className="generation-actions">
          <button
            className="secondary-button"
            disabled={busy === "video"}
            onClick={() => {
              const first = selected.find((scene) => scene.status !== "ready");
              if (!first) return;
              onGenerate("selected", first.id);
            }}
          >
            <Play size={13} /> Generate next scene
          </button>
          <button
            className="primary-button"
            disabled={busy === "video" || !selectedScenes}
            onClick={() => onGenerate("episode")}
          >
            {busy === "video" ? (
              <>
                <LoadingMark /> Generating scenes
              </>
            ) : (
              <>
                <Sparkles size={14} /> Generate full episode
              </>
            )}
          </button>
        </div>
      </section>

      <div className="generation-layout">
        <div className="generation-main">
          <section className="card flush-card">
            <div className="queue-heading">
              <div>
                <h3>Scene queue</h3>
                <span>
                  {readyScenes} of {selected.length} ready
                </span>
              </div>
              <div className="queue-progress">
                <span
                  style={{
                    width: `${
                      selected.length
                        ? Math.min(100, (readyScenes / selected.length) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
              <button
                className="small-button"
                onClick={() =>
                  runAction(
                    "export-queue",
                    () =>
                      downloadJson("the-last-monsoon-scene-queue.json", {
                        production: "The Last Monsoon",
                        episode: 1,
                        scenes: selected,
                      }),
                    "Scene queue exported.",
                    0,
                  )
                }
              >
                <Download size={13} /> Export list
              </button>
            </div>
            <div className="queue-list">
              {selected.map((scene, index) => (
                <article className="queue-row" key={scene.id}>
                  <div className="queue-thumb">
                    <Image
                      src="/images/last-monsoon-concept.png"
                      alt=""
                      fill
                      sizes="110px"
                      style={{
                        objectPosition:
                          index < 2
                            ? "20% center"
                            : index === 4
                              ? "93% center"
                              : "58% center",
                      }}
                    />
                    {scene.status === "ready" ? (
                      <span className="play-overlay">
                        <Play size={13} fill="currentColor" />
                      </span>
                    ) : (
                      <span className="scene-time">{scene.duration}s</span>
                    )}
                  </div>
                  <div className="queue-copy">
                    <span>{scene.id}</span>
                    <h3>{scene.title}</h3>
                    <p>
                      {scene.prompt.length > 110
                        ? `${scene.prompt.slice(0, 110)}…`
                        : scene.prompt}
                    </p>
                  </div>
                  <div className="queue-provider">
                    <span>Model</span>
                    <b>{scene.provider}</b>
                    {scene.safety === "Review" && (
                      <small className="reroute-note">
                        <ShieldAlert size={11} /> Fallback eligible
                      </small>
                    )}
                  </div>
                  <div className="queue-status">
                    <GenerationStatus status={scene.status} />
                  </div>
                  <div className="queue-actions">
                    {scene.status === "ready" ? (
                      <>
                        <button
                          className="icon-button"
                          aria-label="Preview scene"
                          onClick={() =>
                            runAction(
                              `preview-${scene.id}`,
                              () => undefined,
                              `${scene.id} preview opened.`,
                              0,
                            )
                          }
                        >
                          <Play size={14} />
                        </button>
                        <button
                          className="small-button"
                          onClick={() =>
                            runAction(
                              `regen-video-${scene.id}`,
                              () => undefined,
                              `${scene.id} regenerated.`,
                              1200,
                            )
                          }
                        >
                          <RefreshCcw
                            size={12}
                            className={
                              busy === `regen-video-${scene.id}` ? "spin" : ""
                            }
                          />
                          Regenerate
                        </button>
                      </>
                    ) : (
                      <button
                        className="small-button"
                        disabled={busy === "video"}
                        onClick={() => {
                          onGenerate("selected", scene.id);
                        }}
                      >
                        <Play size={12} /> Generate
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={`assembly-card ${assembled ? "complete" : ""}`}>
            <div className="assembly-visual">
              {assembled ? (
                <CheckCircle2 size={26} />
              ) : (
                <Clapperboard size={24} />
              )}
            </div>
            <div>
              <span className="result-label">FFmpeg episode assembly</span>
              <h3>
                {assembled
                  ? "Episode 1 master is ready"
                  : "Combine approved scenes into one episode"}
              </h3>
              <p>
                {assembled
                  ? "5 clips joined · audio normalized · H.264 master · 00:01:00"
                  : "Scene order, transition handles, audio normalization, and final encoding are handled in one controlled render."}
              </p>
              {assembled && (
                <div className="assembly-file">
                  <Film size={14} />
                  <span>
                    <b>the-last-monsoon-e01.mp4</b>
                    <small>1080p · 16:9 · 48.6 MB</small>
                  </span>
                </div>
              )}
            </div>
            <button
              className={assembled ? "secondary-button" : "primary-button"}
              disabled={readyScenes < selected.length || busy === "assemble"}
              onClick={() => {
                if (assembled) {
                  void runAction(
                    "download-master",
                    () =>
                      downloadJson("the-last-monsoon-e01-master.json", {
                        filename: "the-last-monsoon-e01.mp4",
                        duration: "00:01:00",
                        resolution: "1080p",
                        codec: "H.264",
                        scenes: selected.map((scene) => scene.id),
                      }),
                    "Episode master manifest downloaded.",
                    0,
                  );
                  return;
                }
                void runAction(
                  "assemble",
                  () => {
                    setAssembled(true);
                    onComplete();
                  },
                  "Episode assembled with FFmpeg.",
                  1500,
                );
              }}
            >
              {busy === "assemble" ? (
                <>
                  <LoadingMark /> Assembling
                </>
              ) : assembled ? (
                <>
                  <Download size={14} /> Download master
                </>
              ) : (
                <>
                  <Clapperboard size={14} /> Assemble episode
                </>
              )}
            </button>
          </section>
        </div>

        <aside className="generation-side">
          <section className="side-card fallback-card">
            <div className="step-mini-label">Step 5.1 · Recovery</div>
            <div className="side-card-title plain">
              <div>
                <b>Smart model fallback</b>
                <small>For restricted or failed scenes</small>
              </div>
              <button
                className={`toggle ${autoFallback ? "on" : ""}`}
                onClick={() => setAutoFallback(!autoFallback)}
                aria-label="Toggle automatic fallback"
              >
                <span />
              </button>
            </div>
            <p className="side-copy">
              If Kie Kling rejects a scene, the system can pause for your
              decision before retrying with a safety-adjusted prompt.
            </p>
            <div className="route-diagram">
              <div>
                <span className="model-logo seed">S</span>
                <p>
                  <b>Kie AI</b>
                  <small>Provider</small>
                </p>
              </div>
              <ArrowRight size={14} />
              <div>
                <span className="model-logo kling">K</span>
                <p>
                  <b>Kling 3.0</b>
                  <small>Fallback model</small>
                </p>
              </div>
            </div>
            <div className="fallback-mode">
              <span
                className={`radio-dot ${autoFallback ? "selected" : ""}`}
              />
              <div>
                <b>
                  {autoFallback ? "Automatically retry" : "Ask me every time"}
                </b>
                <p>
                  {autoFallback
                    ? "The original is preserved and every reroute is logged."
                    : "Generation pauses before changing model or prompt."}
                </p>
              </div>
            </div>
            <Link href="/drama-studio" className="full-small-button">
              <Settings size={13} /> Configure fallback rules
            </Link>
          </section>

          <section className="side-card">
            <div className="side-card-title plain">
              <b>Generation budget</b>
              <span className="safe-pill">Within limit</span>
            </div>
            <div className="budget-metric">
              <strong>Live</strong>
              <span>model-aware estimate</span>
            </div>
            <div className="budget-row">
              <span>Selected scenes</span>
              <b>{selectedScenes}</b>
            </div>
            <div className="budget-row">
              <span>Cost preview</span>
              <b>Shown on hover</b>
            </div>
            <div className="budget-row total">
              <span>After generation</span>
              <b>Balance refreshes</b>
            </div>
          </section>

          <section className="side-card note-card warning-note">
            <ShieldAlert size={16} />
            <div>
              <b>Safety-aware, creator-controlled</b>
              <p>
                Prompts are softened only when needed. You can review the exact
                change and restore the original at any time.
              </p>
            </div>
          </section>
        </aside>
      </div>

      <div className="final-actions">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={14} /> Back to prompts
        </button>
        <div>
          <span>Production status</span>
          <b>
            {assembled
              ? "Episode 1 complete"
              : `${readyScenes}/${selected.length} selected scenes ready`}
          </b>
        </div>
        <button
          className="primary-button"
          disabled={!assembled}
          onClick={onComplete}
        >
          Finish episode <CheckCircle2 size={15} />
        </button>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  optionSuffix = "",
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  optionSuffix?: string;
  onChange: (value: string) => void;
}) {
  const fieldId = useId();
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <div className="select-wrap">
        <select
          id={fieldId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option value={option} key={option}>
              {option}
              {optionSuffix}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </div>
    </div>
  );
}

function ModelSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const fieldId = useId();
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <div className="select-wrap">
        <select
          id={fieldId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </div>
    </div>
  );
}

function BottomActions({
  onBack,
  backLabel,
  title,
  subtitle,
  primaryLabel,
  onContinue,
  disabled = false,
}: {
  onBack: () => void;
  backLabel: string;
  title: string;
  subtitle: string;
  primaryLabel: string;
  onContinue: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="step-actions with-back">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={14} /> {backLabel}
      </button>
      <div>
        <b>{title}</b>
        <span>{subtitle}</span>
      </div>
      <button
        className="primary-button"
        disabled={disabled}
        onClick={onContinue}
      >
        {primaryLabel} <ArrowRight size={15} />
      </button>
    </div>
  );
}

function GenerationStatus({ status }: { status: Scene["status"] }) {
  const labels: Record<Scene["status"], string> = {
    draft: "Not generated",
    queued: "Needs review",
    generating: "Generating",
    ready: "Ready",
    rerouted: "Rerouting",
  };
  return (
    <span className={`generation-status ${status}`}>
      {status === "generating" || status === "rerouted" ? (
        <LoadingMark />
      ) : status === "ready" ? (
        <CheckCircle2 size={12} />
      ) : status === "queued" ? (
        <ShieldAlert size={12} />
      ) : (
        <Square size={11} />
      )}
      {labels[status]}
    </span>
  );
}

function LoadingMark() {
  return <span className="loading-mark" aria-hidden="true" />;
}

function getStepDescription(step: number) {
  const descriptions = [
    "Define the premise, format, audience, and creative boundaries. Nothing is generated until you approve this brief.",
    "Develop every episode, character, visual asset, and scene prompt in one place. Generate or regenerate each image until the complete production plan is ready for final videos.",
    "Create consistent character, venue, and object references that will guide every scene in the series.",
    "Turn each episode into model-ready scenes. Choose exactly which prompts to create, edit, and approve.",
    "Generate selected scenes, recover restricted shots with a fallback model, and assemble each episode with FFmpeg.",
  ];
  return descriptions[step - 1];
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
