import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const workdir = path.join(repoRoot, 'workdir');
const shiftsDir = path.join(workdir, 'shifts');
const promptsDir = path.join(repoRoot, 'src', 'prompts');

// Prices per million tokens for claude-sonnet-4-6
const PRICE_INPUT_PER_M = 3.0;
const PRICE_OUTPUT_PER_M = 15.0;
const MODEL = 'claude-sonnet-4-6';
const MAX_ITERATIONS = 40;

export function loadEnv() {
  const envPath = path.join(repoRoot, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// Tool definitions for the Anthropic API
const TOOL_DEFINITIONS = [
  {
    name: 'get_scoreboard',
    description: 'Get current scores and schedule for a sport. Returns all games with status, scores, and game IDs.',
    input_schema: {
      type: 'object',
      properties: {
        sport: { type: 'string', description: 'Sport slug, e.g. "basketball", "football", "baseball", "hockey", "soccer"' },
        league: { type: 'string', description: 'League slug, e.g. "nba", "nfl", "mlb", "nhl", "eng.1" (Premier League), "usa.1" (MLS)' },
      },
      required: ['sport', 'league'],
    },
  },
  {
    name: 'get_game_summary',
    description: 'Get box score, player stats, and recent play-by-play for a specific game. Use game IDs from get_scoreboard.',
    input_schema: {
      type: 'object',
      properties: {
        sport: { type: 'string' },
        league: { type: 'string' },
        game_id: { type: 'string', description: 'Game ID from get_scoreboard' },
      },
      required: ['sport', 'league', 'game_id'],
    },
  },
  {
    name: 'discover_sports',
    description: 'Survey all major sports leagues to see what is live, recently finished, and upcoming today. Good for field trips and finding unexpected stories.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'render_html_to_png',
    description: 'Render HTML to a PNG image file. Write complete HTML with inline styles or rely on the injected base.css design system. Returns the path to the saved PNG.',
    input_schema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'Complete HTML to render. The base.css design system is automatically injected.' },
        filename: { type: 'string', description: 'Output filename (e.g. "stat-hero.png"). Saved to workdir/media/YYYY-MM-DD/' },
      },
      required: ['html', 'filename'],
    },
  },
  {
    name: 'read_journal',
    description: 'Read one of the agent\'s markdown files from workdir/.',
    input_schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          enum: ['identity', 'voice', 'strategy', 'log', 'human-notes'],
          description: 'Which file to read',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'write_journal',
    description: 'Replace the content of identity.md, voice.md, or strategy.md. Cannot be used on log or human-notes.',
    input_schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          enum: ['identity', 'voice', 'strategy'],
          description: 'Which file to replace',
        },
        content: { type: 'string', description: 'New content for the file' },
      },
      required: ['file', 'content'],
    },
  },
  {
    name: 'append_journal',
    description: 'Append a timestamped entry to log.md. Use this for diary entries, shift summaries, and observations.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Content to append to log.md' },
      },
      required: ['content'],
    },
  },
  {
    name: 'check_budget',
    description: 'Check how many posts remain today and how much API budget is left.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'post_to_x',
    description: 'Post content to X (or save as draft if DRY_RUN=true). Content must be ≤280 characters. Use final=true only for the polished, publish-ready version. Working iterations should use final=false (default) — they are kept in the repo but not shown on the public site.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Tweet text, ≤280 characters' },
        media_path: { type: 'string', description: 'Path to a PNG file to attach (optional)' },
        final: { type: 'boolean', description: 'true = publish-ready final draft shown on site. false = working iteration kept in repo only. Default false. Mark only one post per shift as final.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'read_x_engagement',
    description: 'Read engagement data (likes, replies, reposts) on recent posts.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_next_wake',
    description: 'Set the next time the agent should wake up. REQUIRED at the end of every shift.',
    input_schema: {
      type: 'object',
      properties: {
        iso_datetime: {
          type: 'string',
          description: 'ISO 8601 datetime for the next wake (e.g. "2025-01-15T09:00:00Z"). Choose 1-6 hours from now based on what\'s happening in sports.',
        },
      },
      required: ['iso_datetime'],
    },
  },
];

async function dispatchTool(name, input) {
  const { getScoreboard, getGameSummary, discoverSports } = await import('./tools/sports-data.js');
  const { renderHtmlToPng } = await import('./tools/render.js');
  const { readJournal, writeJournal, appendJournal } = await import('./tools/journal.js');
  const { checkBudget, setConfig } = await import('./tools/budget.js');
  const { postToX, readXEngagement } = await import('./tools/post.js');

  switch (name) {
    case 'get_scoreboard':
      return getScoreboard(input.sport, input.league);
    case 'get_game_summary':
      return getGameSummary(input.sport, input.league, input.game_id);
    case 'discover_sports':
      return discoverSports();
    case 'render_html_to_png':
      return renderHtmlToPng(input.html, input.filename);
    case 'read_journal':
      return { content: readJournal(input.file) };
    case 'write_journal':
      writeJournal(input.file, input.content);
      return { success: true, file: input.file };
    case 'append_journal':
      appendJournal(input.content);
      return { success: true };
    case 'check_budget':
      return checkBudget();
    case 'post_to_x':
      return postToX(input.content, input.media_path, input.final ?? false);
    case 'read_x_engagement':
      return readXEngagement();
    case 'set_next_wake':
      setConfig('next_wake_at', input.iso_datetime);
      return { success: true, next_wake: input.iso_datetime };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function runShift() {
  loadEnv();

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set. Add it to .env');
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const startedAt = new Date().toISOString();

  const systemPrompt = readFileSync(path.join(promptsDir, 'system.md'), 'utf8');
  const identityContent = existsSync(path.join(workdir, 'identity.md'))
    ? readFileSync(path.join(workdir, 'identity.md'), 'utf8').trim()
    : '';
  const isDayOne = !identityContent;

  let userPrompt;
  if (isDayOne) {
    userPrompt = readFileSync(path.join(promptsDir, 'day-one.md'), 'utf8');
    console.log('[agent] Day one mode — running identity setup shift.');
  } else {
    userPrompt = `Run your next shift. Check human-notes first, then check budget, then do the work. End by setting your next wake time.

Current time: ${new Date().toISOString()}`;
    console.log('[agent] Running regular shift.');
  }

  const messages = [{ role: 'user', content: userPrompt }];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iterations = 0;
  let detectedSport = null;

  console.log(`[agent] Starting loop (max ${MAX_ITERATIONS} iterations)...`);

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: TOOL_DEFINITIONS,
    });

    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;

    const assistantMessage = { role: 'assistant', content: response.content };
    messages.push(assistantMessage);

    console.log(`[agent] iter ${iterations}: stop_reason=${response.stop_reason}, content blocks=${response.content.length}`);

    if (response.stop_reason === 'end_turn') {
      console.log('[agent] Shift complete.');
      break;
    }

    if (response.stop_reason !== 'tool_use') {
      console.log(`[agent] Unexpected stop_reason: ${response.stop_reason}`);
      break;
    }

    // Dispatch all tool calls in this turn
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      console.log(`[agent]   tool: ${block.name}`, JSON.stringify(block.input).slice(0, 120));

      // Track sport for shift record
      if (!detectedSport && block.input?.sport) detectedSport = block.input.sport;

      let result;
      try {
        result = await dispatchTool(block.name, block.input);
      } catch (err) {
        result = { error: err.message };
        console.error(`[agent]   tool error: ${err.message}`);
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Record shift
  const endedAt = new Date().toISOString();
  const estimatedCost = (totalInputTokens / 1e6) * PRICE_INPUT_PER_M + (totalOutputTokens / 1e6) * PRICE_OUTPUT_PER_M;

  const { recordShift } = await import('./tools/budget.js');
  recordShift({
    startedAt,
    endedAt,
    sport: detectedSport,
    iterations,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    estimatedCostUsd: estimatedCost,
    notes: isDayOne ? 'day-one' : null,
  });

  console.log(`[agent] Shift recorded. Tokens: ${totalInputTokens}in/${totalOutputTokens}out. Est. cost: $${estimatedCost.toFixed(4)}`);

  // Save full trace
  if (!existsSync(shiftsDir)) mkdirSync(shiftsDir, { recursive: true });
  const traceTs = startedAt.replace(/[:.]/g, '-').slice(0, 19);
  const tracePath = path.join(shiftsDir, `${traceTs}.json`);
  writeFileSync(tracePath, JSON.stringify({ startedAt, endedAt, iterations, totalInputTokens, totalOutputTokens, estimatedCost, messages }, null, 2), 'utf8');
  console.log(`[agent] Trace saved: ${path.relative(repoRoot, tracePath)}`);

  return { startedAt, endedAt, iterations, totalInputTokens, totalOutputTokens, estimatedCost };
}

// Run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runShift().catch(err => {
    console.error('[agent] Fatal:', err);
    process.exit(1);
  });
}
