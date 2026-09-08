export function firstInvalidCampaignPost(posts, { allowCloudDraftWithoutMedia = false } = {}) {
  return (posts || []).find((post) => post.active !== false
    && (!post.text?.trim() || (!allowCloudDraftWithoutMedia && !(post.media?.length || post.imagePath?.trim()))));
}
