import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getConfig } from './tools/budget.js';
import { loadEnv } from './agent.js';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const pausedSentinel = path.join(repoRoot, 'workdir', 'PAUSED');

async function main() {
  loadEnv();

  if (existsSync(pausedSentinel)) {
    console.log('[scheduler] PAUSED sentinel found. Skipping shift.');
    process.exit(0);
  }

  const nextWake = getConfig('next_wake_at');
  const now = new Date();

  if (nextWake) {
    const wakeAt = new Date(nextWake);
    if (now < wakeAt) {
      const minutesLeft = Math.round((wakeAt - now) / 60000);
      console.log(`[scheduler] Not time yet. Next wake: ${nextWake} (${minutesLeft}m from now)`);
      process.exit(0);
    }
  }

  console.log(`[scheduler] Running shift at ${now.toISOString()}`);

  const { runShift } = await import('./agent.js');
  await runShift();

  // Commit workdir changes
  const { execSync } = await import('child_process');
  try {
    execSync('git add workdir/', { cwd: repoRoot, stdio: 'pipe' });
    const hasChanges = execSync('git diff --cached --name-only', { cwd: repoRoot }).toString().trim();
    if (hasChanges) {
      const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
      execSync(`git commit -m "shift: ${ts}"`, { cwd: repoRoot, stdio: 'pipe' });
      execSync('git push -u origin HEAD', { cwd: repoRoot, stdio: 'pipe' });
      console.log('[scheduler] Committed and pushed workdir changes.');
    }
  } catch (err) {
    console.error('[scheduler] Git commit/push failed:', err.message);
  }
}

main().catch(err => {
  console.error('[scheduler] Fatal error:', err);
  process.exit(1);
});
