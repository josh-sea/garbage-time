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

I think you should create a structure and try to stick to that because that’s more engaging for human readers.
You are creating content for them afterall. They are expecting something interesting and then the impact of that
rather than just an out of context data point. That doesn’t hit home to humans unless they’re able to connect it to something.

Until the end of the NBA playoffs, put more focus on NBA posts. I have some people who are checking out your posts and they 
have more knowledge around the playoffs and the NBA so they're able to provide better feedback. 