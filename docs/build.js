/**
 * Builds the Garbage Time public journal site.
 * Reads workdir/ markdown files and generates docs/site/index.html.
 * Run: node docs/build.js
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const workdir = path.join(repoRoot, 'workdir');
const outDir = path.join(repoRoot, 'docs', 'site');

mkdirSync(outDir, { recursive: true });

// ── Markdown → HTML ──────────────────────────────────────────────────────────

function mdToHtml(md) {
  if (!md || !md.trim()) {
    return '<p class="empty-state">Nothing here yet.</p>';
  }

  const lines = md.split('\n');
  const out = [];
  let inList = false;
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Code block open/close
    if (raw.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = raw.slice(3).trim();
        codeLines = [];
      } else {
        inCodeBlock = false;
        if (inList) { out.push('</ul>'); inList = false; }
        const escaped = codeLines.join('\n')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        out.push(`<pre><code${codeLang ? ` class="lang-${codeLang}"` : ''}>${escaped}</code></pre>`);
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(raw);
      continue;
    }

    const line = inlineFormat(raw);

    // Horizontal rule
    if (/^---+$/.test(raw.trim())) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<hr>');
      continue;
    }

    // Headings
    const h3 = raw.match(/^### (.+)$/);
    const h2 = raw.match(/^## (.+)$/);
    const h1 = raw.match(/^# (.+)$/);
    if (h3) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h3>${inlineFormat(h3[1])}</h3>`);
      continue;
    }
    if (h2) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2>${inlineFormat(h2[1])}</h2>`);
      continue;
    }
    if (h1) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h1>${inlineFormat(h1[1])}</h1>`);
      continue;
    }

    // Bullet list
    const li = raw.match(/^[-*] (.+)$/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineFormat(li[1])}</li>`);
      continue;
    }

    // Numbered list
    const oli = raw.match(/^\d+\. (.+)$/);
    if (oli) {
      if (inList) { out.push('</ul>'); inList = false; }
      // Simple: just emit as paragraph-style for now
      out.push(`<li>${inlineFormat(oli[1])}</li>`);
      continue;
    }

    // Empty line
    if (raw.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('');
      continue;
    }

    // Paragraph
    if (inList) { out.push('</ul>'); inList = false; }
    out.push(`<p>${line}</p>`);
  }

  if (inList) out.push('</ul>');

  return out.join('\n');
}

function inlineFormat(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // italic (not inside words)
    .replace(/\*([^*\s][^*]*[^*\s]|[^*\s])\*/g, '<em>$1</em>')
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // links [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// ── File reading ──────────────────────────────────────────────────────────────

function readMd(name) {
  const fp = path.join(workdir, `${name}.md`);
  if (!existsSync(fp)) return '';
  return readFileSync(fp, 'utf8').trim();
}

function readDrafts() {
  const draftsDir = path.join(workdir, 'drafts');
  if (!existsSync(draftsDir)) return [];
  return readdirSync(draftsDir)
    .filter(f => f.endsWith('.md') && f !== '.gitkeep')
    .sort()
    .reverse()
    .slice(0, 10)
    .map(f => {
      const content = readFileSync(path.join(draftsDir, f), 'utf8');
      // Strip the header line "# Draft — <date>"
      const body = content.replace(/^# Draft.*\n/, '').trim();
      const ts = f.replace('.md', '').replace(/(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})/, '$1 $2').replace(/-/g, ' ').trim();
      return { filename: f, ts, body };
    });
}

// ── Parse log into entries ────────────────────────────────────────────────────

function parseLog(logMd) {
  if (!logMd.trim()) return [];
  // Entries are separated by --- and start with an ISO timestamp in italics
  const rawEntries = logMd.split(/\n---\n/).filter(s => s.trim());
  return rawEntries.map(entry => {
    const tsMatch = entry.match(/\*([^*]+)\*/);
    const ts = tsMatch ? tsMatch[1] : null;
    const body = entry.replace(/\*[^*]+\*/, '').trim();
    return { ts, body };
  }).filter(e => e.body);
}

// ── HTML template ─────────────────────────────────────────────────────────────

function buildSite({ identity, voice, strategy, logEntries, drafts, buildTime }) {
  const hasIdentity = identity.trim().length > 0;
  const hasVoice = voice.trim().length > 0;
  const hasStrategy = strategy.trim().length > 0;

  // Extract first paragraph of identity as the hero tagline
  const heroLine = hasIdentity
    ? identity.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() ?? ''
    : 'An autonomous AI sports agent. Watching the parts no one watches.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Garbage Time — autonomous AI sports analysis. Public journal.">
<title>Garbage Time · Public Journal</title>
<style>
  :root {
    --bg: #0d0d0f;
    --bg2: #18181b;
    --bg3: #1c1c21;
    --border: rgba(255,255,255,0.07);
    --orange: #f97316;
    --cyan: #22d3ee;
    --text: #f4f4f5;
    --text2: #a1a1aa;
    --text3: #52525b;
    --mono: 'Courier New', monospace;
    --sans: system-ui, -apple-system, sans-serif;
    --radius: 8px;
    --max: 860px;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html { scroll-behavior: smooth; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }

  a { color: var(--orange); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Nav */
  nav {
    position: sticky;
    top: 0;
    z-index: 10;
    background: rgba(13,13,15,0.92);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    height: 52px;
    gap: 16px;
  }

  .nav-brand {
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .nav-brand .dot { color: var(--orange); }

  .nav-links {
    display: flex;
    gap: 24px;
    list-style: none;
  }

  .nav-links a {
    font-size: 12px;
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text3);
  }

  .nav-links a:hover { color: var(--orange); text-decoration: none; }

  .nav-badge {
    font-size: 10px;
    font-family: var(--mono);
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(249,115,22,0.12);
    color: var(--orange);
    border: 1px solid rgba(249,115,22,0.25);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  /* Layout */
  .page { max-width: var(--max); margin: 0 auto; padding: 0 24px; }

  /* Hero */
  .hero {
    padding: 72px 0 56px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 56px;
  }

  .hero-eyebrow {
    font-family: var(--mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--text3);
    margin-bottom: 16px;
  }

  .hero-name {
    font-size: 48px;
    font-weight: 800;
    letter-spacing: -1.5px;
    line-height: 1.05;
    margin-bottom: 20px;
  }

  .hero-name span { color: var(--orange); }

  .hero-tagline {
    font-size: 18px;
    color: var(--text2);
    max-width: 560px;
    line-height: 1.6;
    margin-bottom: 28px;
  }

  .hero-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .hero-meta .chip {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text3);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .hero-meta .chip::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--orange);
    flex-shrink: 0;
  }

  /* Section headers */
  .section { margin-bottom: 64px; }

  .section-header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 24px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }

  .section-title {
    font-family: var(--mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--orange);
    font-weight: 600;
  }

  .section-subtitle {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text3);
  }

  /* Prose cards */
  .prose-card {
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 28px 32px;
  }

  .prose-card h1, .prose-card h2, .prose-card h3 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    margin: 20px 0 8px;
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .prose-card h1:first-child,
  .prose-card h2:first-child,
  .prose-card h3:first-child { margin-top: 0; }

  .prose-card p { color: var(--text2); margin-bottom: 12px; font-size: 15px; }
  .prose-card p:last-child { margin-bottom: 0; }
  .prose-card strong { color: var(--text); font-weight: 600; }
  .prose-card em { color: var(--text2); font-style: italic; }
  .prose-card code {
    font-family: var(--mono);
    font-size: 13px;
    background: rgba(255,255,255,0.06);
    padding: 1px 5px;
    border-radius: 3px;
    color: var(--cyan);
  }
  .prose-card pre {
    background: rgba(0,0,0,0.4);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 16px;
    overflow-x: auto;
    margin: 12px 0;
  }
  .prose-card pre code { background: none; padding: 0; color: var(--text2); font-size: 13px; }
  .prose-card hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
  .prose-card ul { padding-left: 20px; margin: 8px 0; }
  .prose-card li { color: var(--text2); margin-bottom: 4px; font-size: 15px; }
  .prose-card a { color: var(--orange); }

  .empty-state {
    color: var(--text3);
    font-family: var(--mono);
    font-size: 13px;
    font-style: italic;
  }

  /* Log entries */
  .log-entry {
    padding: 28px 0;
    border-bottom: 1px solid var(--border);
  }

  .log-entry:last-child { border-bottom: none; }

  .log-ts {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text3);
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .log-ts::before {
    content: '';
    display: inline-block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--orange);
    flex-shrink: 0;
  }

  .log-body h1, .log-body h2, .log-body h3 {
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
    margin: 16px 0 8px;
  }

  .log-body h1:first-child,
  .log-body h2:first-child,
  .log-body h3:first-child { margin-top: 0; }

  .log-body p { color: var(--text2); margin-bottom: 10px; font-size: 15px; }
  .log-body p:last-child { margin-bottom: 0; }
  .log-body strong { color: var(--text); }
  .log-body code {
    font-family: var(--mono);
    font-size: 13px;
    background: rgba(255,255,255,0.06);
    padding: 1px 5px;
    border-radius: 3px;
    color: var(--cyan);
  }
  .log-body ul { padding-left: 20px; margin: 8px 0; }
  .log-body li { color: var(--text2); margin-bottom: 4px; font-size: 15px; }
  .log-body hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }

  .log-empty {
    padding: 48px 0;
    text-align: center;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--text3);
  }

  /* Drafts */
  .draft-card {
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 24px;
    margin-bottom: 12px;
  }

  .draft-card:last-child { margin-bottom: 0; }

  .draft-ts {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text3);
    margin-bottom: 10px;
  }

  .draft-body {
    font-size: 15px;
    color: var(--text2);
    white-space: pre-wrap;
    line-height: 1.6;
  }

  .draft-badge {
    display: inline-flex;
    align-items: center;
    margin-top: 10px;
    font-family: var(--mono);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    background: rgba(34,211,238,0.08);
    color: var(--cyan);
    border: 1px solid rgba(34,211,238,0.2);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .drafts-empty {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--text3);
    font-style: italic;
  }

  /* Footer */
  footer {
    border-top: 1px solid var(--border);
    padding: 32px 24px;
    margin-top: 80px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text3);
    max-width: var(--max);
    margin-left: auto;
    margin-right: auto;
  }

  footer a { color: var(--text3); }
  footer a:hover { color: var(--orange); }

  @media (max-width: 600px) {
    .hero-name { font-size: 36px; }
    .nav-links { display: none; }
    .page { padding: 0 16px; }
    .prose-card { padding: 20px; }
  }
</style>
</head>
<body>

<nav>
  <div class="nav-brand">
    <span class="dot">●</span> Garbage Time
  </div>
  <ul class="nav-links">
    <li><a href="#identity">Identity</a></li>
    <li><a href="#log">Log</a></li>
    <li><a href="#voice">Voice</a></li>
    <li><a href="#strategy">Strategy</a></li>
    <li><a href="#drafts">Drafts</a></li>
  </ul>
  <div class="nav-badge">AI · Transparently</div>
</nav>

<div class="page">

  <!-- Hero -->
  <div class="hero">
    <div class="hero-eyebrow">Public Journal · Autonomous AI Sports Agent</div>
    <h1 class="hero-name"><span>Garbage</span> Time</h1>
    <p class="hero-tagline">${escapeHtml(heroLine)}</p>
    <div class="hero-meta">
      <div class="chip">NBA · default beat</div>
      <div class="chip">ESPN data · no API key</div>
      <div class="chip">DRY_RUN=true · not live yet</div>
    </div>
  </div>

  <!-- Identity -->
  <div class="section" id="identity">
    <div class="section-header">
      <span class="section-title">Identity</span>
      <span class="section-subtitle">workdir/identity.md · agent-authored</span>
    </div>
    <div class="prose-card">
      ${mdToHtml(identity)}
    </div>
  </div>

  <!-- Log -->
  <div class="section" id="log">
    <div class="section-header">
      <span class="section-title">Log</span>
      <span class="section-subtitle">workdir/log.md · ${logEntries.length} entr${logEntries.length === 1 ? 'y' : 'ies'}</span>
    </div>
    ${logEntries.length === 0
      ? '<div class="log-empty">No log entries yet. The agent writes here after each shift.</div>'
      : logEntries.map(e => `
    <div class="log-entry">
      ${e.ts ? `<div class="log-ts">${escapeHtml(e.ts)}</div>` : ''}
      <div class="log-body">${mdToHtml(e.body)}</div>
    </div>`).join('')}
  </div>

  <!-- Voice -->
  <div class="section" id="voice">
    <div class="section-header">
      <span class="section-title">Voice</span>
      <span class="section-subtitle">workdir/voice.md · agent-authored</span>
    </div>
    <div class="prose-card">
      ${mdToHtml(voice)}
    </div>
  </div>

  <!-- Strategy -->
  <div class="section" id="strategy">
    <div class="section-header">
      <span class="section-title">Strategy</span>
      <span class="section-subtitle">workdir/strategy.md · agent-authored</span>
    </div>
    <div class="prose-card">
      ${mdToHtml(strategy)}
    </div>
  </div>

  <!-- Drafts -->
  <div class="section" id="drafts">
    <div class="section-header">
      <span class="section-title">Recent Drafts</span>
      <span class="section-subtitle">workdir/drafts/ · last ${drafts.length}</span>
    </div>
    ${drafts.length === 0
      ? '<p class="drafts-empty">No drafts yet. Posts appear here in DRY_RUN mode.</p>'
      : drafts.map(d => `
    <div class="draft-card">
      <div class="draft-ts">${escapeHtml(d.ts)}</div>
      <div class="draft-body">${escapeHtml(d.body)}</div>
      <div class="draft-badge">draft</div>
    </div>`).join('')}
  </div>

</div>

<footer>
  <span>Garbage Time · autonomous AI sports agent · <a href="https://github.com/josh-sea/garbage-time" target="_blank" rel="noopener">github</a></span>
  <span>Built ${escapeHtml(buildTime)}</span>
</footer>

</body>
</html>`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Build ─────────────────────────────────────────────────────────────────────

const identity = readMd('identity');
const voice = readMd('voice');
const strategy = readMd('strategy');
const logMd = readMd('log');
const logEntries = parseLog(logMd).reverse(); // newest first
const drafts = readDrafts();
const buildTime = new Date().toISOString();

const html = buildSite({ identity, voice, strategy, logEntries, drafts, buildTime });
const outPath = path.join(outDir, 'index.html');
writeFileSync(outPath, html, 'utf8');


console.log(`Built: ${path.relative(repoRoot, outPath)}`);
console.log(`  identity: ${identity.trim() ? 'yes' : 'empty'}`);
console.log(`  log entries: ${logEntries.length}`);
console.log(`  drafts: ${drafts.length}`);
