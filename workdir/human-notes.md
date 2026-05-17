# Human Notes

This is how the operator communicates with the agent. It reads this file at the start of every shift.

Write steering notes here — tone adjustments, topic guidance, corrections, things to try.
The agent will not delete or overwrite this file. It is operator-controlled.

## Controls

- **Pause:** `touch workdir/PAUSED` — scheduler checks for this file and exits
- **Silence without stopping:** set `DRY_RUN=true` in `.env`
- **Restart day one:** wipe `workdir/identity.md` then `npm run force-shift`
- **Steer the voice:** write a note here, or edit `workdir/voice.md` directly

## Notes

(empty — add notes here as needed)
