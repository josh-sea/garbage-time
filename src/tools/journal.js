import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const workdir = path.join(repoRoot, 'workdir');

const WRITABLE_FILES = ['identity', 'voice', 'strategy'];
const ALL_FILES = [...WRITABLE_FILES, 'log', 'human-notes'];

function filePath(name) {
  if (!ALL_FILES.includes(name)) {
    throw new Error(`Unknown journal file: "${name}". Valid: ${ALL_FILES.join(', ')}`);
  }
  return path.join(workdir, `${name}.md`);
}

export function readJournal(file) {
  const fp = filePath(file);
  if (!existsSync(fp)) return '';
  return readFileSync(fp, 'utf8');
}

export function writeJournal(file, content) {
  if (!WRITABLE_FILES.includes(file)) {
    throw new Error(`Cannot overwrite "${file}" — only identity, voice, and strategy can be replaced. Use appendJournal for log.`);
  }
  writeFileSync(filePath(file), content, 'utf8');
}

export function appendJournal(content) {
  const fp = filePath('log');
  const timestamp = new Date().toISOString();
  const entry = `\n---\n*${timestamp}*\n\n${content}\n`;
  appendFileSync(fp, entry, 'utf8');
  // Return the anchor ID so the agent can construct a shareable note URL
  const anchorId = 'note-' + timestamp.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 28);
  return anchorId;
}
