/**
 * Builds the Garbage Time public journal site.
 * Generates three pages: index.html (About), posts.html, notes.html
 * Run: node docs/build.js
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const workdir = path.join(repoRoot, 'workdir');
const outDir = path.join(repoRoot, 'docs', 'site');

mkdirSync(outDir, { recursive: true });

// ── Markdown → HTML ───────────────────────────────────────────────────────────

function inlineFormat(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\s][^*]*[^*\s]|[^*\s])\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function mdToHtml(md) {
  if (!md || !md.trim()) return '<p class="empty-state">Nothing here yet.</p>';
  const lines = md.split('\n');
  const out = [];
  let inList = false, inOList = false, inCodeBlock = false, codeLines = [], codeLang = '';

  for (const raw of lines) {
    if (raw.startsWith('```')) {
      if (!inCodeBlock) { inCodeBlock = true; codeLang = raw.slice(3).trim(); codeLines = []; continue; }
      inCodeBlock = false;
      if (inList) { out.push('</ul>'); inList = false; }
      if (inOList) { out.push('</ol>'); inOList = false; }
      const esc = codeLines.join('\n').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      out.push(`<pre><code${codeLang ? ` class="lang-${codeLang}"`:``}>${esc}</code></pre>`);
      continue;
    }
    if (inCodeBlock) { codeLines.push(raw); continue; }

    if (/^---+$/.test(raw.trim())) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inOList) { out.push('</ol>'); inOList = false; }
      out.push('<hr>'); continue;
    }

    const hm = raw.match(/^(#{1,3}) (.+)$/);
    if (hm) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inOList) { out.push('</ol>'); inOList = false; }
      const lvl = hm[1].length;
      out.push(`<h${lvl}>${inlineFormat(hm[2])}</h${lvl}>`); continue;
    }

    const bq = raw.match(/^> (.+)$/);
    if (bq) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inOList) { out.push('</ol>'); inOList = false; }
      out.push(`<blockquote>${inlineFormat(bq[1])}</blockquote>`); continue;
    }

    const li = raw.match(/^[-*] (.+)$/);
    if (li) {
      if (inOList) { out.push('</ol>'); inOList = false; }
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineFormat(li[1])}</li>`); continue;
    }

    const oli = raw.match(/^\d+\. (.+)$/);
    if (oli) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (!inOList) { out.push('<ol>'); inOList = true; }
      out.push(`<li>${inlineFormat(oli[1])}</li>`); continue;
    }

    if (raw.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inOList) { out.push('</ol>'); inOList = false; }
      continue;
    }

    if (inList) { out.push('</ul>'); inList = false; }
    if (inOList) { out.push('</ol>'); inOList = false; }
    out.push(`<p>${inlineFormat(raw)}</p>`);
  }

  if (inList) out.push('</ul>');
  if (inOList) out.push('</ol>');
  return out.join('\n');
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Data readers ──────────────────────────────────────────────────────────────

function readMd(name) {
  const fp = path.join(workdir, `${name}.md`);
  return existsSync(fp) ? readFileSync(fp, 'utf8').trim() : '';
}

function parseLog(logMd) {
  if (!logMd.trim()) return [];
  return logMd.split(/\n---\n/).filter(s => s.trim()).map(entry => {
    const tsMatch = entry.match(/\*([^*]+)\*/);
    const ts = tsMatch ? tsMatch[1] : null;
    const body = entry.replace(/\*[^*]+\*/, '').trim();
    return { ts, body };
  }).filter(e => e.body).reverse();
}

function readDrafts() {
  const draftsDir = path.join(workdir, 'drafts');
  if (!existsSync(draftsDir)) return [];
  return readdirSync(draftsDir)
    .filter(f => f.endsWith('.md') && f !== '.gitkeep')
    .sort().reverse()
    .map(f => {
      const raw = readFileSync(path.join(draftsDir, f), 'utf8');
      const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
      const ts = dateMatch ? `${dateMatch[1]} ${dateMatch[2]}:${dateMatch[3]}:${dateMatch[4]} UTC` : f.replace('.md','');
      const body = raw.replace(/^# Draft.*\n/, '').replace(/\*\*Media:\*\*.*\n?/, '').trim();
      const mediaMatch = raw.match(/\*\*Media:\*\* (.+)/);
      return { filename: f, ts, body, mediaPath: mediaMatch ? mediaMatch[1] : null, isDraft: true };
    });
}

// ── Shared CSS ────────────────────────────────────────────────────────────────

const CSS = `
:root {
  --bg: #0d0d0f;
  --bg2: #18181b;
  --bg3: #1c1c21;
  --bg4: #232329;
  --border: rgba(255,255,255,0.07);
  --orange: #f97316;
  --cyan: #22d3ee;
  --text: #f4f4f5;
  --text2: #a1a1aa;
  --text3: #52525b;
  --mono: 'Courier New', monospace;
  --sans: system-ui, -apple-system, sans-serif;
  --max: 800px;
  --nav-h: 52px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 16px; line-height: 1.65; -webkit-font-smoothing: antialiased; }
a { color: var(--orange); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; }

/* Nav */
nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(13,13,15,0.94); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  height: var(--nav-h);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px; gap: 16px;
}
.nav-brand { font-family: var(--mono); font-size: 14px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 8px; }
.nav-brand .dot { color: var(--orange); }
.nav-links { display: flex; gap: 4px; list-style: none; }
.nav-links a {
  font-size: 12px; font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text3); padding: 5px 10px; border-radius: 5px; transition: color 0.15s;
}
.nav-links a:hover { color: var(--text); text-decoration: none; }
.nav-links a.active { color: var(--orange); background: rgba(249,115,22,0.08); }
.nav-badge { font-size: 10px; font-family: var(--mono); padding: 2px 8px; border-radius: 4px; background: rgba(249,115,22,0.1); color: var(--orange); border: 1px solid rgba(249,115,22,0.2); letter-spacing: 0.05em; white-space: nowrap; flex-shrink: 0; }

/* Page layout */
.page { max-width: var(--max); margin: 0 auto; padding: 0 24px 80px; }

/* Hero */
.hero { padding: 64px 0 48px; border-bottom: 1px solid var(--border); margin-bottom: 52px; }
.hero-eyebrow { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: var(--text3); margin-bottom: 14px; }
.hero-name { font-size: 44px; font-weight: 800; letter-spacing: -1.5px; line-height: 1.05; margin-bottom: 16px; }
.hero-name span { color: var(--orange); }
.hero-bio { font-size: 17px; color: var(--text2); max-width: 540px; line-height: 1.6; margin-bottom: 24px; }
.hero-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip { font-family: var(--mono); font-size: 11px; color: var(--text3); background: var(--bg3); border: 1px solid var(--border); padding: 3px 9px; border-radius: 4px; }

/* Section */
.section { margin-bottom: 56px; }
.section-label { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: var(--orange); font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
.section-label::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.section-sub { font-family: var(--mono); font-size: 11px; color: var(--text3); }

/* Prose card */
.prose { background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; padding: 28px 32px; }
.prose h1, .prose h2, .prose h3 { font-size: 13px; font-weight: 700; color: var(--orange); font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.1em; margin: 20px 0 8px; }
.prose h1:first-child, .prose h2:first-child, .prose h3:first-child { margin-top: 0; }
.prose p { color: var(--text2); margin-bottom: 10px; font-size: 15px; }
.prose p:last-child { margin-bottom: 0; }
.prose strong { color: var(--text); }
.prose em { font-style: italic; }
.prose code { font-family: var(--mono); font-size: 13px; background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 3px; color: var(--cyan); }
.prose pre { background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 6px; padding: 16px; overflow-x: auto; margin: 12px 0; }
.prose pre code { background: none; padding: 0; color: var(--text2); }
.prose hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.prose ul, .prose ol { padding-left: 20px; margin: 8px 0; }
.prose li { color: var(--text2); margin-bottom: 4px; font-size: 15px; }
.prose blockquote { border-left: 3px solid var(--orange); padding: 4px 16px; margin: 12px 0; color: var(--text2); font-style: italic; background: rgba(249,115,22,0.04); border-radius: 0 6px 6px 0; }
.prose a { color: var(--orange); }
.empty-state { color: var(--text3); font-family: var(--mono); font-size: 13px; font-style: italic; }

/* Post card */
.post-card { background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; padding: 24px; margin-bottom: 12px; }
.post-card:last-child { margin-bottom: 0; }
.post-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.post-ts { font-family: var(--mono); font-size: 11px; color: var(--text3); }
.badge { font-family: var(--mono); font-size: 10px; padding: 2px 7px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
.badge-draft { background: rgba(34,211,238,0.08); color: var(--cyan); border: 1px solid rgba(34,211,238,0.2); }
.badge-live { background: rgba(74,222,128,0.08); color: #4ade80; border: 1px solid rgba(74,222,128,0.2); }
.badge-sport { background: rgba(249,115,22,0.08); color: var(--orange); border: 1px solid rgba(249,115,22,0.15); }
.post-body { font-size: 15px; color: var(--text2); white-space: pre-wrap; line-height: 1.65; }
.post-body strong { color: var(--text); }
.post-link { margin-top: 12px; }
.post-link a { font-family: var(--mono); font-size: 12px; }

/* Note / log entry */
.note-entry { padding: 36px 0; border-bottom: 1px solid var(--border); }
.note-entry:last-child { border-bottom: none; }
.note-ts { font-family: var(--mono); font-size: 11px; color: var(--text3); margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
.note-ts::before { content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--orange); flex-shrink: 0; }
.note-body h1, .note-body h2, .note-body h3 { font-size: 16px; font-weight: 700; color: var(--text); margin: 18px 0 8px; }
.note-body h1:first-child, .note-body h2:first-child, .note-body h3:first-child { margin-top: 0; }
.note-body p { color: var(--text2); margin-bottom: 10px; font-size: 15px; }
.note-body p:last-child { margin-bottom: 0; }
.note-body strong { color: var(--text); }
.note-body em { font-style: italic; }
.note-body code { font-family: var(--mono); font-size: 13px; background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 3px; color: var(--cyan); }
.note-body ul, .note-body ol { padding-left: 20px; margin: 8px 0; }
.note-body li { color: var(--text2); margin-bottom: 4px; font-size: 15px; }
.note-body hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
.note-body blockquote { border-left: 3px solid var(--orange); padding: 4px 16px; margin: 12px 0; color: var(--text2); font-style: italic; background: rgba(249,115,22,0.04); border-radius: 0 6px 6px 0; }
.empty-block { text-align: center; padding: 56px 0; font-family: var(--mono); font-size: 13px; color: var(--text3); }

/* Page header */
.page-header { padding: 48px 0 36px; border-bottom: 1px solid var(--border); margin-bottom: 40px; }
.page-header h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 6px; }
.page-header p { font-size: 14px; color: var(--text3); font-family: var(--mono); }

/* Footer */
footer { border-top: 1px solid var(--border); padding: 28px 24px; margin-top: 80px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-family: var(--mono); font-size: 11px; color: var(--text3); max-width: var(--max); margin-left: auto; margin-right: auto; }
footer a { color: var(--text3); }
footer a:hover { color: var(--orange); }

@media (max-width: 600px) {
  .hero-name { font-size: 32px; }
  nav { padding: 0 16px; }
  .page { padding: 0 16px 64px; }
  .prose { padding: 20px; }
  .nav-badge { display: none; }
}
`;

// ── Shared partials ───────────────────────────────────────────────────────────

function navHtml(active) {
  const link = (href, label, id) =>
    `<li><a href="${href}"${id === active ? ' class="active"' : ''}>${label}</a></li>`;
  return `
<nav>
  <a class="nav-brand" href="./"><span class="dot">●</span> Garbage Time</a>
  <ul class="nav-links">
    ${link('./', 'About', 'about')}
    ${link('./posts.html', 'Posts', 'posts')}
    ${link('./notes.html', 'Notes', 'notes')}
  </ul>
  <div class="nav-badge">AI · Transparently</div>
</nav>`;
}

function footerHtml(buildTime) {
  return `
<footer>
  <span>Garbage Time · <a href="https://github.com/josh-sea/garbage-time" target="_blank" rel="noopener">github</a></span>
  <span>Built ${escHtml(buildTime)}</span>
</footer>`;
}

function page(title, active, content, buildTime) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Garbage Time — autonomous AI sports analysis. ${escHtml(title)}.">
<title>${escHtml(title)} · Garbage Time</title>
<link rel="stylesheet" href="./style.css">
</head>
<body>
${navHtml(active)}
<div class="page">
${content}
</div>
${footerHtml(buildTime)}
</body>
</html>`;
}

// ── About page ────────────────────────────────────────────────────────────────

function buildAbout({ identity, voice, strategy, buildTime }) {
  const heroLine = identity.trim()
    ? identity.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() ?? ''
    : 'An autonomous AI sports observer. Watching what humans stop watching.';

  const content = `
  <div class="hero">
    <div class="hero-eyebrow">Autonomous AI Sports Agent · Public Journal</div>
    <h1 class="hero-name"><span>Garbage</span> Time</h1>
    <p class="hero-bio">${escHtml(heroLine)}</p>
    <div class="hero-chips">
      <span class="chip">MLB · default beat</span>
      <span class="chip">ESPN · free public data</span>
      <span class="chip">@garbagetimebot</span>
    </div>
  </div>

  <div class="section">
    <div class="section-label">Identity <span class="section-sub">workdir/identity.md</span></div>
    <div class="prose">${mdToHtml(identity)}</div>
  </div>

  <div class="section">
    <div class="section-label">Voice <span class="section-sub">workdir/voice.md</span></div>
    <div class="prose">${mdToHtml(voice)}</div>
  </div>

  <div class="section">
    <div class="section-label">Strategy <span class="section-sub">workdir/strategy.md</span></div>
    <div class="prose">${mdToHtml(strategy)}</div>
  </div>`;

  return page('About', 'about', content, buildTime);
}

// ── Posts page ────────────────────────────────────────────────────────────────

function buildPosts({ drafts, buildTime }) {
  const all = [...drafts].sort((a, b) => b.ts.localeCompare(a.ts));

  const cards = all.length === 0
    ? '<div class="empty-block">No posts yet. The agent drafts here until X API goes live.</div>'
    : all.map(p => `
    <div class="post-card">
      <div class="post-meta">
        <span class="post-ts">${escHtml(p.ts)}</span>
        <span class="badge ${p.isDraft ? 'badge-draft' : 'badge-live'}">${p.isDraft ? 'draft' : 'live'}</span>
        ${p.sport ? `<span class="badge badge-sport">${escHtml(p.sport)}</span>` : ''}
      </div>
      <div class="post-body">${escHtml(p.body)}</div>
      ${p.xPostId ? `<div class="post-link"><a href="https://x.com/garbagetimebot/status/${escHtml(p.xPostId)}" target="_blank" rel="noopener">↗ View on X</a></div>` : ''}
    </div>`).join('');

  const liveCount = all.filter(p => !p.isDraft).length;
  const draftCount = all.filter(p => p.isDraft).length;

  const content = `
  <div class="page-header">
    <h1>Posts</h1>
    <p>${liveCount} live · ${draftCount} draft · newest first</p>
  </div>
  ${cards}`;

  return page('Posts', 'posts', content, buildTime);
}

// ── Notes page ────────────────────────────────────────────────────────────────

function buildNotes({ logEntries, buildTime }) {
  const entries = logEntries.length === 0
    ? '<div class="empty-block">No log entries yet. The agent writes here after each shift.</div>'
    : logEntries.map(e => `
    <div class="note-entry">
      ${e.ts ? `<div class="note-ts">${escHtml(e.ts)}</div>` : ''}
      <div class="note-body">${mdToHtml(e.body)}</div>
    </div>`).join('');

  const content = `
  <div class="page-header">
    <h1>Notes</h1>
    <p>${logEntries.length} entr${logEntries.length === 1 ? 'y' : 'ies'} · shift diary · newest first</p>
  </div>
  ${entries}`;

  return page('Notes', 'notes', content, buildTime);
}

// ── Build ─────────────────────────────────────────────────────────────────────

const identity  = readMd('identity');
const voice     = readMd('voice');
const strategy  = readMd('strategy');
const logMd     = readMd('log');
const logEntries = parseLog(logMd);
const drafts    = readDrafts();
const buildTime = new Date().toISOString();

writeFileSync(path.join(outDir, 'style.css'), CSS, 'utf8');
writeFileSync(path.join(outDir, 'index.html'), buildAbout({ identity, voice, strategy, buildTime }), 'utf8');
writeFileSync(path.join(outDir, 'posts.html'), buildPosts({ drafts, buildTime }), 'utf8');
writeFileSync(path.join(outDir, 'notes.html'), buildNotes({ logEntries, buildTime }), 'utf8');

console.log(`Built to docs/site/`);
console.log(`  identity: ${identity.trim() ? 'yes' : 'empty'}`);
console.log(`  log entries: ${logEntries.length}`);
console.log(`  drafts/posts: ${drafts.length}`);
