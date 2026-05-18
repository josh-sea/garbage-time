/**
 * Builds the Garbage Time public journal site.
 * Generates three pages: index.html (About), posts.html, notes.html
 * Run: node docs/build.js
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, cpSync } from 'fs';
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

function mediaRelPath(absolutePath) {
  if (!absolutePath) return null;
  const marker = path.join('workdir', 'media') + path.sep;
  const idx = absolutePath.indexOf(marker);
  if (idx !== -1) return absolutePath.slice(idx + marker.length);
  const m = absolutePath.match(/workdir[/\\]media[/\\](.+)/);
  return m ? m[1] : null;
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
      const statusMatch = raw.match(/^status: (\w+)/m);
      const status = statusMatch ? statusMatch[1] : 'wip';
      const body = raw.replace(/^# Draft.*\n/, '').replace(/^status:.*\n/, '').replace(/\*\*Media:\*\*.*\n?/, '').trim();
      const mediaMatch = raw.match(/\*\*Media:\*\* (.+)/);
      const relPath = mediaMatch ? mediaRelPath(mediaMatch[1].trim()) : null;
      return { filename: f, ts, body, mediaRelPath: relPath, isDraft: true, status };
    });
}

function copyMedia() {
  const src = path.join(workdir, 'media');
  const dest = path.join(outDir, 'media');
  if (!existsSync(src)) return;
  try {
    cpSync(src, dest, { recursive: true });
  } catch (e) {
    console.warn('  media copy warning:', e.message);
  }
}

// ── Identity extraction ───────────────────────────────────────────────────────

function stripMd(s) {
  return s.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^>\s*/, '').trim();
}

function extractBio(md) {
  const bioSection = md.match(/##\s*Bio[^\n]*\n([\s\S]+?)(?=\n##|\n#|$)/i);
  if (bioSection) {
    const line = bioSection[1].trim().split('\n')
      .map(l => stripMd(l.trim()))
      .find(l => l && !l.startsWith('(') && l.length > 10);
    if (line) return line;
  }
  const fallback = md.split('\n').find(l => l.trim() && !l.startsWith('#'));
  return fallback ? stripMd(fallback) : 'An autonomous AI sports observer. Watching what humans stop watching.';
}

function extractHandle(md) {
  const m = md.match(/@[\w]+/);
  return m ? m[0] : '@garbagetimebot';
}

function extractBeat(md) {
  const m = md.match(/##\s*Default [Bb]eat[^\n]*\n([^\n]+)/i);
  if (m) {
    const raw = stripMd(m[1]).replace(/^[-*]\s*/, '');
    const cut = raw.match(/^([^,.:·(]+)/);
    return (cut ? cut[1] : raw).trim().slice(0, 24);
  }
  return 'NBA';
}

// ── Shared CSS ────────────────────────────────────────────────────────────────

const CSS = `
:root {
  --bg: #0d0d16;
  --bg2: #121220;
  --bg3: #1a1a2c;
  --bg4: #222238;
  --border: rgba(168,85,247,0.12);
  --border2: rgba(255,255,255,0.05);
  --fuchsia: #e879f9;
  --fuchsia-dim: rgba(232,121,249,0.1);
  --orange: #f97316;
  --orange-dim: rgba(249,115,22,0.1);
  --blue: #60a5fa;
  --blue-dim: rgba(96,165,250,0.1);
  --green: #4ade80;
  --text: #e2e4f0;
  --text2: #9294aa;
  --text3: #52546a;
  --mono: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
  --sans: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --max: 820px;
  --nav-h: 56px;
  --r: 10px;
  --card-shadow: 0 2px 0 rgba(255,255,255,0.03) inset, 0 8px 32px rgba(0,0,0,0.45);
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
a { color: var(--fuchsia); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; }

/* ── Nav ─────────────────────────────────────── */
nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(12,12,20,0.92);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--border);
  height: var(--nav-h);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 28px; gap: 16px;
}
.nav-brand {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  display: flex; align-items: center; gap: 10px;
  text-decoration: none;
}
.nav-brand:hover { text-decoration: none; }
.nav-icon {
  width: 26px; height: 26px;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--fuchsia) 0%, #a855f7 60%, var(--blue) 100%);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 900; color: #fff;
  flex-shrink: 0;
  box-shadow: 0 2px 10px rgba(168,85,247,0.45), 0 1px 0 rgba(255,255,255,0.12) inset;
}
.nav-links { display: flex; gap: 2px; list-style: none; }
.nav-links a {
  font-size: 12px;
  font-family: var(--mono);
  color: var(--text3);
  padding: 5px 12px;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}
.nav-links a:hover { color: var(--text2); background: rgba(255,255,255,0.04); text-decoration: none; }
.nav-links a.active { color: var(--fuchsia); background: var(--fuchsia-dim); }
.nav-badge {
  font-size: 10px;
  font-family: var(--mono);
  padding: 3px 10px;
  border-radius: 5px;
  background: var(--fuchsia-dim);
  color: var(--fuchsia);
  border: 1px solid rgba(232,121,249,0.2);
  letter-spacing: 0.05em;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Page layout ─────────────────────────────── */
.page { max-width: var(--max); margin: 0 auto; padding: 0 24px 80px; }

/* ── Profile card ────────────────────────────── */
.profile-card {
  display: flex;
  gap: 28px;
  align-items: flex-start;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 32px;
  margin: 40px 0 36px;
  box-shadow: var(--card-shadow);
}
.profile-avatar {
  width: 72px; height: 72px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--fuchsia) 0%, #a855f7 50%, var(--blue) 100%);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--mono);
  font-size: 20px;
  font-weight: 900;
  color: #fff;
  flex-shrink: 0;
  box-shadow: 0 4px 20px rgba(168,85,247,0.4), 0 1px 0 rgba(255,255,255,0.12) inset;
  letter-spacing: -1px;
}
.profile-info { flex: 1; min-width: 0; }
.profile-eyebrow {
  font-family: var(--mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--fuchsia);
  margin-bottom: 6px;
  opacity: 0.85;
}
.profile-name {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
  color: var(--text);
  margin-bottom: 2px;
  line-height: 1.1;
}
.profile-handle {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--text3);
  margin-bottom: 12px;
}
.profile-bio {
  font-size: 15px;
  color: var(--text2);
  line-height: 1.6;
  margin-bottom: 16px;
  max-width: 480px;
}
.profile-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text3);
  background: var(--bg4);
  border: 1px solid var(--border2);
  padding: 3px 9px;
  border-radius: 5px;
  letter-spacing: 0.04em;
}
.chip-fuchsia { color: var(--fuchsia); background: var(--fuchsia-dim); border-color: rgba(232,121,249,0.2); }
.chip-orange  { color: var(--orange);  background: var(--orange-dim);  border-color: rgba(249,115,22,0.2);  }
.chip-blue    { color: var(--blue);    background: var(--blue-dim);    border-color: rgba(96,165,250,0.2);   }

/* ── Tabs ────────────────────────────────────── */
.tabs-container { margin-bottom: 56px; }
.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0;
  gap: 0;
}
.tab-btn {
  font-family: var(--mono);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text3);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 11px 20px;
  cursor: pointer;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}
.tab-btn:hover { color: var(--text2); }
.tab-btn.active { color: var(--fuchsia); border-bottom-color: var(--fuchsia); }

.tab-panel {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 var(--r) var(--r);
  padding: 28px 32px;
  box-shadow: var(--card-shadow);
}
.tab-panel.hidden { display: none; }

/* Prose shared styles (tabs + standalone .prose) */
.tab-panel h1, .tab-panel h2, .tab-panel h3,
.prose h1, .prose h2, .prose h3 {
  font-size: 11px; font-weight: 700;
  color: var(--fuchsia);
  font-family: var(--mono);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin: 24px 0 10px;
}
.tab-panel h1:first-child, .tab-panel h2:first-child, .tab-panel h3:first-child,
.prose h1:first-child, .prose h2:first-child, .prose h3:first-child { margin-top: 0; }
.tab-panel p, .prose p { color: var(--text2); margin-bottom: 10px; font-size: 15px; }
.tab-panel p:last-child, .prose p:last-child { margin-bottom: 0; }
.tab-panel strong, .prose strong { color: var(--text); }
.tab-panel em, .prose em { font-style: italic; }
.tab-panel code, .prose code {
  font-family: var(--mono); font-size: 13px;
  background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 3px; color: var(--blue);
}
.tab-panel pre, .prose pre {
  background: rgba(0,0,0,0.5); border: 1px solid var(--border2);
  border-radius: 8px; padding: 16px; overflow-x: auto; margin: 14px 0;
}
.tab-panel pre code, .prose pre code { background: none; padding: 0; color: var(--text2); }
.tab-panel hr, .prose hr { border: none; border-top: 1px solid var(--border2); margin: 20px 0; }
.tab-panel ul, .tab-panel ol, .prose ul, .prose ol { padding-left: 20px; margin: 10px 0; }
.tab-panel li, .prose li { color: var(--text2); margin-bottom: 6px; font-size: 15px; }
.tab-panel blockquote, .prose blockquote {
  border-left: 3px solid var(--fuchsia);
  padding: 6px 16px; margin: 14px 0;
  color: var(--text2); font-style: italic;
  background: var(--fuchsia-dim); border-radius: 0 6px 6px 0;
}
.tab-panel a, .prose a { color: var(--fuchsia); }
.empty-state { color: var(--text3); font-family: var(--mono); font-size: 13px; font-style: italic; }

/* Standalone prose card */
.section { margin-bottom: 52px; }
.section-label {
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--fuchsia);
  font-weight: 600;
  margin-bottom: 16px;
  display: flex; align-items: center; gap: 10px;
  opacity: 0.9;
}
.section-label::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.section-sub { font-family: var(--mono); font-size: 10px; color: var(--text3); font-weight: 400; }
.prose { background: var(--bg3); border: 1px solid var(--border); border-radius: var(--r); padding: 28px 32px; box-shadow: var(--card-shadow); }

/* ── Page header (Posts / Notes) ─────────────── */
.page-header { padding: 44px 0 32px; border-bottom: 1px solid var(--border); margin-bottom: 36px; }
.page-header h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 6px; }
.page-header p { font-size: 13px; color: var(--text3); font-family: var(--mono); }
.page-header p a { color: var(--text3); }
.page-header p a:hover { color: var(--fuchsia); }

/* ── Post card ───────────────────────────────── */
.post-card {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 22px 24px;
  margin-bottom: 10px;
  box-shadow: var(--card-shadow);
  transition: border-color 0.15s;
}
.post-card:hover { border-color: rgba(168,85,247,0.25); }
.post-card:last-child { margin-bottom: 0; }
.post-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.post-ts { font-family: var(--mono); font-size: 11px; color: var(--text3); }
.badge {
  font-family: var(--mono); font-size: 10px;
  padding: 2px 8px; border-radius: 4px;
  text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600;
}
.badge-draft { background: var(--blue-dim); color: var(--blue); border: 1px solid rgba(96,165,250,0.22); }
.badge-live  { background: rgba(74,222,128,0.08); color: var(--green); border: 1px solid rgba(74,222,128,0.2); }
.badge-sport { background: var(--orange-dim); color: var(--orange); border: 1px solid rgba(249,115,22,0.2); }
.post-body { font-size: 15px; color: var(--text2); white-space: pre-wrap; line-height: 1.65; }
.post-body strong { color: var(--text); }
.post-image { margin-top: 16px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
.post-image img { display: block; width: 100%; height: auto; }
.post-link { margin-top: 12px; }
.post-link a { font-family: var(--mono); font-size: 12px; color: var(--fuchsia); }

.empty-block { text-align: center; padding: 64px 0; font-family: var(--mono); font-size: 13px; color: var(--text3); }

/* ── Note / log entry ────────────────────────── */
.note-entry { padding: 36px 0; border-bottom: 1px solid var(--border); }
.note-entry:last-child { border-bottom: none; }
.note-ts {
  font-family: var(--mono); font-size: 11px; color: var(--text3);
  margin-bottom: 16px;
  display: flex; align-items: center; gap: 8px;
}
.note-ts::before {
  content: ''; display: inline-block;
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--fuchsia); flex-shrink: 0;
}
.note-body h1, .note-body h2, .note-body h3 { font-size: 16px; font-weight: 700; color: var(--text); margin: 18px 0 8px; }
.note-body h1:first-child, .note-body h2:first-child, .note-body h3:first-child { margin-top: 0; }
.note-body p { color: var(--text2); margin-bottom: 10px; font-size: 15px; }
.note-body p:last-child { margin-bottom: 0; }
.note-body strong { color: var(--text); }
.note-body em { font-style: italic; }
.note-body code { font-family: var(--mono); font-size: 13px; background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 3px; color: var(--blue); }
.note-body ul, .note-body ol { padding-left: 20px; margin: 8px 0; }
.note-body li { color: var(--text2); margin-bottom: 4px; font-size: 15px; }
.note-body hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
.note-body blockquote {
  border-left: 3px solid var(--orange);
  padding: 4px 16px; margin: 12px 0;
  color: var(--text2); font-style: italic;
  background: var(--orange-dim); border-radius: 0 6px 6px 0;
}
.note-body a { color: var(--fuchsia); }

/* ── Footer ──────────────────────────────────── */
footer {
  border-top: 1px solid var(--border);
  padding: 24px;
  margin-top: 80px;
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 8px;
  font-family: var(--mono); font-size: 11px; color: var(--text3);
  max-width: var(--max); margin-left: auto; margin-right: auto;
}
footer a { color: var(--text3); }
footer a:hover { color: var(--fuchsia); text-decoration: none; }

@media (max-width: 640px) {
  .profile-card { flex-direction: column; gap: 18px; padding: 22px; }
  .profile-name { font-size: 22px; }
  .tab-panel { padding: 20px; }
  nav { padding: 0 16px; }
  .page { padding: 0 16px 64px; }
  .nav-badge { display: none; }
  .prose { padding: 20px; }
}

/* ── Accordions (About tab sections) ────────── */
.acc-item { border-bottom: 1px solid var(--border2); }
.acc-item:last-child { border-bottom: none; }
.acc-toggle {
  width: 100%; background: none; border: none;
  padding: 11px 0;
  display: flex; align-items: center; justify-content: space-between;
  cursor: pointer;
  color: var(--fuchsia);
  font-family: var(--mono); font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.12em;
  text-align: left; gap: 8px;
  transition: color 0.15s;
}
.acc-toggle:hover { color: var(--text); }
.acc-chevron { flex-shrink: 0; font-size: 15px; opacity: 0.5; transition: transform 0.15s; }
.acc-chevron::before { content: '›'; }
.acc-item.open .acc-chevron { transform: rotate(90deg); }
.acc-body { display: none; padding: 2px 0 16px; }
.acc-item.open .acc-body { display: block; }

/* ── Note truncation + expand ────────────────── */
.note-body.note-collapsed {
  max-height: 7em; overflow: hidden; position: relative;
}
.note-body.note-collapsed::after {
  content: ''; position: absolute;
  bottom: 0; left: 0; right: 0; height: 3.5em;
  background: linear-gradient(transparent, var(--bg));
  pointer-events: none;
}
.note-expand-btn {
  display: inline-block; margin-top: 8px;
  background: none; border: none; cursor: pointer;
  font-family: var(--mono); font-size: 11px;
  color: var(--fuchsia); padding: 0; letter-spacing: 0.04em;
}
.note-expand-btn:hover { text-decoration: underline; }

/* ── Note permalink ──────────────────────────── */
.note-anchor {
  color: var(--text3); text-decoration: none;
  margin-left: 8px; font-size: 13px;
  opacity: 0; transition: opacity 0.1s;
}
.note-ts:hover .note-anchor,
.note-entry:target .note-anchor { opacity: 1; }
.note-entry:target .note-ts { color: var(--fuchsia); }
`;

// ── Shared partials ───────────────────────────────────────────────────────────

function navHtml(active) {
  const link = (href, label, id) =>
    `<li><a href="${href}"${id === active ? ' class="active"' : ''}>${label}</a></li>`;
  return `
<nav>
  <a class="nav-brand" href="./">
    <div class="nav-icon">GT</div>
    Garbage Time
  </a>
  <ul class="nav-links">
    ${link('./', 'About', 'about')}
    ${link('./posts.html', 'Posts', 'posts')}
    ${link('./notes.html', 'Notes', 'notes')}
  </ul>
  <div class="nav-badge">AI · Transparent</div>
</nav>`;
}

function footerHtml(buildTime) {
  return `
<footer>
  <span>Garbage Time · <a href="https://github.com/josh-sea/garbage-time" target="_blank" rel="noopener">github</a></span>
  <span>Built ${escHtml(buildTime)}</span>
</footer>`;
}

function page(title, active, content, buildTime, bodyScript = '') {
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
${bodyScript}
</body>
</html>`;
}

// ── About page ────────────────────────────────────────────────────────────────

function buildAbout({ identity, voice, strategy, buildTime }) {
  const bio    = extractBio(identity);
  const handle = extractHandle(identity);
  const beat   = extractBeat(identity);

  const identityHtml  = identity  ? mdToHtml(identity)  : '<p class="empty-state">Identity not written yet.</p>';
  const voiceHtml     = voice     ? mdToHtml(voice)      : '<p class="empty-state">Voice notes not written yet.</p>';
  const strategyHtml  = strategy  ? mdToHtml(strategy)   : '<p class="empty-state">Strategy not written yet.</p>';

  const content = `
  <div class="profile-card">
    <div class="profile-avatar">GT</div>
    <div class="profile-info">
      <div class="profile-eyebrow">Autonomous AI · Sports Analysis</div>
      <h1 class="profile-name">Garbage Time</h1>
      <div class="profile-handle">${escHtml(handle)}</div>
      <p class="profile-bio">${escHtml(bio)}</p>
      <div class="profile-chips">
        <span class="chip chip-fuchsia">${escHtml(beat)}</span>
        <span class="chip chip-orange">ESPN data</span>
        <span class="chip chip-blue">AI · Transparent</span>
        <span class="chip">Public Journal</span>
      </div>
    </div>
  </div>

  <div class="tabs-container">
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="identity">Identity</button>
      <button class="tab-btn" data-tab="voice">Voice</button>
      <button class="tab-btn" data-tab="strategy">Strategy</button>
    </div>
    <div class="tab-panel" id="tab-identity">
      ${identityHtml}
    </div>
    <div class="tab-panel hidden" id="tab-voice">
      ${voiceHtml}
    </div>
    <div class="tab-panel hidden" id="tab-strategy">
      ${strategyHtml}
    </div>
  </div>`;

  const script = `
<script>
(function(){
  // Tab switching
  var btns = document.querySelectorAll('.tab-btn');
  btns.forEach(function(btn){
    btn.addEventListener('click', function(){
      btns.forEach(function(b){ b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.add('hidden'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.getAttribute('data-tab')).classList.remove('hidden');
    });
  });

  // Accordion: group each h-tag + its following content into collapsible sections
  document.querySelectorAll('.tab-panel').forEach(function(panel){
    var nodes = Array.from(panel.children);
    if (!nodes.some(function(n){ return /^H[123]$/.test(n.tagName); })) return;
    var frag = document.createDocumentFragment();
    var currentBody = null;
    var isFirst = true;
    nodes.forEach(function(node){
      if (/^H[123]$/.test(node.tagName)){
        var item = document.createElement('div');
        item.className = 'acc-item' + (isFirst ? ' open' : '');
        isFirst = false;
        var btn = document.createElement('button');
        btn.className = 'acc-toggle';
        btn.setAttribute('type','button');
        var chevron = document.createElement('span');
        chevron.className = 'acc-chevron';
        btn.appendChild(document.createTextNode(node.textContent));
        btn.appendChild(chevron);
        var body = document.createElement('div');
        body.className = 'acc-body';
        btn.addEventListener('click', function(){ item.classList.toggle('open'); });
        item.appendChild(btn);
        item.appendChild(body);
        frag.appendChild(item);
        currentBody = body;
      } else if (currentBody) {
        currentBody.appendChild(node.cloneNode(true));
      } else {
        frag.appendChild(node.cloneNode(true));
      }
    });
    panel.innerHTML = '';
    panel.appendChild(frag);
  });
})();
</script>`;

  return page('About', 'about', content, buildTime, script);
}

// ── Posts page ────────────────────────────────────────────────────────────────

function buildPosts({ drafts, buildTime }) {
  const all = [...drafts].sort((a, b) => b.ts.localeCompare(a.ts));
  const visible = all.filter(p => !p.isDraft || p.status === 'final');
  const wipCount = all.filter(p => p.isDraft && p.status === 'wip').length;
  const liveCount = all.filter(p => !p.isDraft).length;
  const finalDraftCount = all.filter(p => p.isDraft && p.status === 'final').length;

  const cards = visible.length === 0
    ? '<div class="empty-block">No posts yet. The agent drafts here until X API goes live.</div>'
    : visible.map(p => `
    <div class="post-card">
      <div class="post-meta">
        <span class="post-ts">${escHtml(p.ts)}</span>
        <span class="badge ${p.isDraft ? 'badge-draft' : 'badge-live'}">${p.isDraft ? 'draft' : 'live'}</span>
        ${p.sport ? `<span class="badge badge-sport">${escHtml(p.sport)}</span>` : ''}
      </div>
      <div class="post-body">${escHtml(p.body)}</div>
      ${p.mediaRelPath ? `<div class="post-image"><img src="./media/${escHtml(p.mediaRelPath)}" alt="post visual" loading="lazy"></div>` : ''}
      ${p.xPostId ? `<div class="post-link"><a href="https://x.com/garbagetimebot/status/${escHtml(p.xPostId)}" target="_blank" rel="noopener">↗ View on X</a></div>` : ''}
    </div>`).join('');

  const wipNote = wipCount > 0
    ? ` · <a href="https://github.com/josh-sea/garbage-time/tree/claude/garbage-time-agent-0a3Tg/workdir/drafts" target="_blank" rel="noopener">${wipCount} working draft${wipCount !== 1 ? 's' : ''} in repo</a>`
    : '';

  const content = `
  <div class="page-header">
    <h1>Posts</h1>
    <p>${liveCount} live · ${finalDraftCount} final draft${finalDraftCount !== 1 ? 's' : ''}${wipNote} · newest first</p>
  </div>
  ${cards}`;

  return page('Posts', 'posts', content, buildTime);
}

// ── Notes page ────────────────────────────────────────────────────────────────

function buildNotes({ logEntries, buildTime }) {
  function noteId(ts) {
    return ts ? 'note-' + ts.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 28) : '';
  }

  const entries = logEntries.length === 0
    ? '<div class="empty-block">No log entries yet. The agent writes here after each shift.</div>'
    : logEntries.map(e => {
        const id = noteId(e.ts);
        return `
    <div class="note-entry"${id ? ` id="${id}"` : ''}>
      ${e.ts ? `<div class="note-ts">${escHtml(e.ts)}${id ? `<a href="#${id}" class="note-anchor" title="Link to this note">¶</a>` : ''}</div>` : ''}
      <div class="note-body note-collapsed">${mdToHtml(e.body)}</div>
      <button class="note-expand-btn" type="button">Read more ↓</button>
    </div>`;
      }).join('');

  const script = `
<script>
(function(){
  var COLLAPSED = 'note-collapsed';
  document.querySelectorAll('.note-entry').forEach(function(entry){
    var body = entry.querySelector('.note-body');
    var btn  = entry.querySelector('.note-expand-btn');
    // If content fits without scrolling, remove collapse entirely
    if (body.scrollHeight <= body.clientHeight + 6) {
      body.classList.remove(COLLAPSED);
      btn.remove();
      return;
    }
    btn.addEventListener('click', function(){
      body.classList.remove(COLLAPSED);
      btn.remove();
    });
  });
  // Hash nav: auto-expand + scroll to linked note
  if (location.hash) {
    var target = document.querySelector(location.hash);
    if (target && target.classList.contains('note-entry')) {
      var b = target.querySelector('.note-body');
      var btn = target.querySelector('.note-expand-btn');
      if (b) b.classList.remove('note-collapsed');
      if (btn) btn.remove();
      setTimeout(function(){ target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
    }
  }
})();
</script>`;

  const content = `
  <div class="page-header">
    <h1>Notes</h1>
    <p>${logEntries.length} entr${logEntries.length === 1 ? 'y' : 'ies'} · shift diary · newest first</p>
  </div>
  ${entries}`;

  return page('Notes', 'notes', content, buildTime, script);
}

// ── Build ─────────────────────────────────────────────────────────────────────

const identity   = readMd('identity');
const voice      = readMd('voice');
const strategy   = readMd('strategy');
const logMd      = readMd('log');
const logEntries = parseLog(logMd);
const drafts     = readDrafts();
const buildTime  = new Date().toISOString();

writeFileSync(path.join(outDir, 'style.css'), CSS, 'utf8');
writeFileSync(path.join(outDir, 'index.html'), buildAbout({ identity, voice, strategy, buildTime }), 'utf8');
writeFileSync(path.join(outDir, 'posts.html'), buildPosts({ drafts, buildTime }), 'utf8');
writeFileSync(path.join(outDir, 'notes.html'), buildNotes({ logEntries, buildTime }), 'utf8');
copyMedia();

console.log(`Built to docs/site/`);
console.log(`  identity: ${identity.trim() ? 'yes' : 'empty'}`);
console.log(`  log entries: ${logEntries.length}`);
console.log(`  drafts/posts: ${drafts.length}`);
