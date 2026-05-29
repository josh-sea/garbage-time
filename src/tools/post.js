import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { TwitterApi } from 'twitter-api-v2';
import { recordPost, getRecentPosts } from './budget.js';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const draftsDir = path.join(repoRoot, 'workdir', 'drafts');

function saveDraft(content, mediaPath, final) {
  if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const status = final ? 'final' : 'wip';
  const filename = `${ts}-${status}.md`;
  const draftPath = path.join(draftsDir, filename);
  let draftContent = `# Draft — ${new Date().toISOString()}\nstatus: ${status}\n\n${content}\n`;
  if (mediaPath) draftContent += `\n**Media:** ${mediaPath}\n`;
  writeFileSync(draftPath, draftContent, 'utf8');
  recordPost({ postedAt: new Date().toISOString(), content, mediaPath: mediaPath ?? null, isDraft: true });
  return {
    success: true,
    draft: true,
    final,
    path: draftPath,
    message: `${final ? 'Final draft' : 'Working draft'} saved to ${filename}`,
  };
}

// X wraps every http/https URL to exactly 23 chars via t.co
function tweetLength(text) {
  return text.replace(/https?:\/\/\S+/g, '12345678901234567890123').length;
}

export async function postToX(content, mediaPath, final = false) {
  const dryRun = process.env.DRY_RUN !== 'false';

  const charCount = tweetLength(content);
  if (charCount > 280) {
    const overage = charCount - 280;
    return {
      error: `Tweet is ${charCount} chars over the 280-char limit by ${overage}. (URLs count as 23 chars each.) Shorten and retry.`,
      char_count: charCount,
      limit: 280,
      overage,
    };
  }

  if (dryRun) return { ...saveDraft(content, mediaPath, final), char_count: charCount };

  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET } = process.env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) {
    throw new Error('Missing X API credentials. Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET in env.');
  }

  const client = new TwitterApi({
    appKey: X_API_KEY,
    appSecret: X_API_SECRET,
    accessToken: X_ACCESS_TOKEN,
    accessSecret: X_ACCESS_SECRET,
  });

  try {
    let mediaIds = [];
    if (mediaPath && existsSync(mediaPath)) {
      const mediaData = readFileSync(mediaPath);
      const mediaId = await client.v1.uploadMedia(mediaData, { mimeType: 'image/png' });
      mediaIds = [mediaId];
    }

    const tweetPayload = { text: content };
    if (mediaIds.length > 0) tweetPayload.media = { media_ids: mediaIds };

    const tweet = await client.v2.tweet(tweetPayload);
    const xPostId = tweet.data.id;

    recordPost({ postedAt: new Date().toISOString(), content, mediaPath: mediaPath ?? null, isDraft: false, xPostId });
    console.log(`[post] Posted to X: https://x.com/garbagetimebot/status/${xPostId}`);
    return {
      success: true,
      draft: false,
      final,
      x_post_id: xPostId,
      url: `https://x.com/garbagetimebot/status/${xPostId}`,
      message: `Posted to X: ${xPostId}`,
    };
  } catch (err) {
    // 402 = API plan doesn't support posting; fall back to draft so content isn't lost
    const code = err.code ?? err.data?.status;
    if (code === 402 || code === 403) {
      console.warn(`[post] X API returned ${code} — saving as draft instead. Upgrade to Basic plan to enable live posting.`);
      return {
        ...saveDraft(content, mediaPath, final),
        api_error: code,
        message: `X API ${code} — saved as draft. Upgrade plan to post live.`,
      };
    }
    throw err;
  }
}

export async function readXEngagement() {
  const posts = getRecentPosts(10);
  return posts.map(p => ({
    id: p.id,
    posted_at: p.posted_at,
    is_draft: p.is_draft === 1,
    content_preview: p.content.slice(0, 100) + (p.content.length > 100 ? '...' : ''),
    sport: p.sport,
    likes: p.likes,
    replies: p.replies,
    reposts: p.reposts,
    x_post_id: p.x_post_id,
  }));
}
