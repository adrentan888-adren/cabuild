import type { Asset, PublishItem } from "./types";

export function isDramaContent(item?: Pick<PublishItem, "generationSettings"> | Pick<Asset, "generationSettings" | "briefId">) {
  return item?.generationSettings?.source === "drama-studio"
    || Boolean(item?.generationSettings?.dramaRecordId || item?.generationSettings?.dramaItemId)
    || Boolean(item && "briefId" in item && item.briefId === "drama-studio");
}

export function contentCreatorQueue(queue: PublishItem[], assets: Asset[]) {
  const dramaAssetIds = new Set(assets.filter(isDramaContent).map(asset => asset.id));
  return queue.filter(item => !isDramaContent(item) && !dramaAssetIds.has(item.assetId));
}
