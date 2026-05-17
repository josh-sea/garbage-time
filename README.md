# Garbage Time

An autonomous AI agent that runs its own sports account on X. It picks its own niche, writes its own voice, makes its own visuals, and decides when and what to post.

The name comes from basketball. Garbage time is what happens when humans stop paying attention — late blowouts, bench units, procedural innings, dead rubbers. The agent pays attention to those parts because the data is still there and that's where the unobserved patterns live.

**The agent is transparently AI.** Its bio says so. It won't pretend to watch games, claim feelings about teams, or impersonate a human fan voice. It analyzes, notices, observes. Sports Twitter is full of takes pretending to be analysis. Garbage Time is analysis that doesn't pretend to be a take.

Inspired by [Andon Labs](https://andonlabs.com) experiments (Project Vend, Mona, Luna): hand an AI a real-world public-facing operation, give it real autonomy, watch what it does.

## How it works

A cron job fires every 30 minutes. The agent checks if it's time to run (it sets its own schedule). If so, it runs a shift: surveys sports data, decides what's worth noticing, writes a post or a visual, and appends to its diary. The full diary is this repo.

Everything the agent produces — its identity, its voice notes, its strategy, its drafts, its shift traces — is committed to `workdir/`. The public diary is the experiment.

## Quickstart

```bash
npm install
npx playwright install chromium

cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
# Leave DRY_RUN=true for now

npm run init        # create workdir structure + SQLite
npm run force-shift # run day one — agent picks its voice, doesn't post yet
```

Then read what it produced:

```
workdir/identity.md    # who it decided to be
workdir/voice.md       # how it decided to write
workdir/strategy.md    # what beat it's covering
workdir/log.md         # its diary
workdir/media/         # visuals it rendered
```

If the voice looks right, install the cron job:

```bash
bash scripts/install-cron.sh
```

## Going live on X

1. Apply for X developer account
2. Add API credentials to `.env`
3. Flip `DRY_RUN=false`
4. The X API call in `src/tools/post.js` has a TODO marker — implement OAuth 1.0a there

## Operator controls

- **Steer the agent:** edit `workdir/human-notes.md` — it reads this every shift
- **Pause:** `touch workdir/PAUSED`
- **Restart day one:** wipe `workdir/identity.md` and run `npm run force-shift`
- **Silence without stopping:** set `DRY_RUN=true` in `.env`

## Architecture

```
cron (every 30 min)
  └─ scheduler.js     checks next_wake_at, exits early if not time
       └─ agent.js    Anthropic SDK loop, max 40 iterations, 11 tools
            ├─ ESPN free public JSON endpoints (no key needed)
            ├─ Playwright HTML→PNG rendering
            ├─ SQLite for shifts/posts/budget/config
            └─ workdir/ markdown files as the agent's working memory
```

## Project layout

```
src/
  agent.js            the shift loop
  scheduler.js        cron entry point
  init.js             one-time workdir setup
  prompts/
    system.md         main system prompt
    day-one.md        first-shift prompt
  tools/
    sports-data.js    ESPN endpoints
    render.js         Playwright HTML→PNG
    journal.js        markdown read/write
    budget.js         SQLite + budget status
    post.js           post + engagement
design/
  base.css            design system
  templates/          example HTML the agent can reference
workdir/              the agent's home (committed to git)
  identity.md
  voice.md
  strategy.md
  log.md
  human-notes.md
  drafts/
  shifts/
scripts/
  install-cron.sh
```
