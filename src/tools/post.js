import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { recordPost, getRecentPosts } from './budget.js';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const draftsDir = path.join(repoRoot, 'workdir', 'drafts');

export async function postToX(content, mediaPath, final = false) {
  const dryRun = process.env.DRY_RUN !== 'false';

  if (content.length > 280) {
    console.warn(`[post] Warning: content is ${content.length} chars (limit 280). Posting anyway.`);
  }

  if (dryRun) {
    if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const status = final ? 'final' : 'wip';
    const filename = `${ts}-${status}.md`;
    const draftPath = path.join(draftsDir, filename);

    let draftContent = `# Draft — ${new Date().toISOString()}\nstatus: ${status}\n\n${content}\n`;
    if (mediaPath) draftContent += `\n**Media:** ${mediaPath}\n`;

    writeFileSync(draftPath, draftContent, 'utf8');

    recordPost({
      postedAt: new Date().toISOString(),
      content,
      mediaPath: mediaPath ?? null,
      isDraft: true,
    });

    return {
      success: true,
      draft: true,
      final,
      path: draftPath,
      message: `${final ? 'Final draft' : 'Working draft'} saved to ${filename}`,
    };
  }

  // TODO: implement X API call with OAuth 1.0a
  // Recommended package: twitter-api-v2
  // Steps:
  //   1. For text-only: POST https://api.twitter.com/2/tweets with { text: content }
  //   2. For media: first upload via POST https://upload.twitter.com/1.1/media/upload.json
  //      then include media_ids in the tweet payload
  //   3. Use X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET from process.env
  throw new Error(
    'X API not yet implemented. Set DRY_RUN=true or implement OAuth 1.0a in src/tools/post.js'
  );
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
