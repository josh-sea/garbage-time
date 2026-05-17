import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getDb } from './tools/budget.js';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const workdir = path.join(repoRoot, 'workdir');

const DIRS = [
  path.join(workdir, 'drafts'),
  path.join(workdir, 'media'),
  path.join(workdir, 'shifts'),
];

const EMPTY_FILES = [
  path.join(workdir, 'identity.md'),
  path.join(workdir, 'voice.md'),
  path.join(workdir, 'strategy.md'),
  path.join(workdir, 'log.md'),
];

const HUMAN_NOTES = `# Human Notes

This file is how the operator communicates with the agent. It reads this at the start of every shift.

Write steering notes here — tone adjustments, topic guidance, corrections, experiments to try.
The agent will not delete or overwrite this file.

## Controls

- **Pause the agent:** \`touch workdir/PAUSED\` (the scheduler checks for this file)
- **Silence without stopping:** set \`DRY_RUN=true\` in \`.env\`
- **Restart day one:** wipe \`workdir/identity.md\` then \`npm run force-shift\`
- **Steer the voice:** edit \`workdir/voice.md\` directly, or write a note here

## Notes

(empty — add notes here as needed)
`;

function init() {
  console.log('Initializing workdir...');

  for (const dir of DIRS) {
    mkdirSync(dir, { recursive: true });
    console.log(`  created ${path.relative(repoRoot, dir)}/`);
  }

  for (const file of EMPTY_FILES) {
    if (!existsSync(file)) {
      writeFileSync(file, '\n', 'utf8');
      console.log(`  created ${path.relative(repoRoot, file)}`);
    } else {
      console.log(`  exists  ${path.relative(repoRoot, file)}`);
    }
  }

  const humanNotesPath = path.join(workdir, 'human-notes.md');
  if (!existsSync(humanNotesPath)) {
    writeFileSync(humanNotesPath, HUMAN_NOTES, 'utf8');
    console.log(`  created workdir/human-notes.md`);
  } else {
    console.log(`  exists  workdir/human-notes.md`);
  }

  console.log('\nInitializing SQLite...');
  getDb();
  console.log(`  created workdir/state.db`);

  console.log('\nDone. Run `npm run force-shift` to start day one.');
}

init();
