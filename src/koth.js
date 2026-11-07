// King of the hill: whoever holds the golden crown can start a game by clicking with it. The crown
// goes on their head; after a grace period, whoever wears it banks time, and the first to bank a
// minute wins. A punch or a paintball knocks it off; while a game is on, picking it up puts it
// straight on your head. Shared by the client (which shows it) and the server (which runs it).
export const KOTH_GRACE_MS = 10 * 1000;
export const KOTH_WIN_MS = 60 * 1000;
export const KOTH_UNCLAIMED_MS = 2 * 60 * 1000;   // the crown lies unclaimed this long: the game is called off

// state: idle | grace | running | done | cancelled
// times: banked ms per player id; wearer: who has it on now (banking since `since` once the grace is over)
export function freshKoth() {
  return {state: 'idle', starter: '', starterName: '', startedAt: 0, graceEnds: 0, wearer: '', since: 0, droppedAt: 0,
    times: {}, names: {}, winner: '', winnerName: '', endedAt: 0, hits: []};
}
export const kothActive = k => !!k && (k.state === 'grace' || k.state === 'running');
// a player's time so far, counting the stretch they're wearing it now
export function kothTime(k, id, now) {
  const banked = k.times?.[id] || 0;
  return k.state === 'running' && id && k.wearer === id ? banked + Math.max(0, now - k.since) : banked;
}
export function publicKoth(k, now) {
  return {state: k.state, starter: k.starter, starterName: k.starterName, startedAt: k.startedAt, graceEnds: k.graceEnds,
    wearer: k.wearer, since: k.since, times: {...k.times}, names: {...k.names}, winner: k.winner, winnerName: k.winnerName,
    endedAt: k.endedAt, now};
}
