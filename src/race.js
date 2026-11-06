// The lap-timer machine in the tunnel wall, just round from the start room: shared by the
// client (which builds it) and the server (which runs the race). Positions follow the
// level builder's loop coordinates: angle a around the loop, offset from its centreline.
export const LOOP_RADIUS = 38;
export const MACHINE_ANGLE = -0.2;
export const RACE_LAPS = 3;
export const RACE_TIMEOUT_MS = 3 * 60 * 1000;   // after this anyone can call off a run
export const BUTTON_RANGE = 2.4;                // metres from the button to push it
export const LAP_ZONE = 4.5;                    // pass within this of the machine for a lap to count
export const LAP_SLACK = .3;                    // radians short of a full lap still counted (the zone is wide)

// a point at loop angle a, offset x from the centreline (outward positive)
export const loopPoint = (a, x) => ({x: (LOOP_RADIUS + x) * Math.cos(a), z: -(LOOP_RADIUS + x) * Math.sin(a)});
export const loopAngle = (x, z) => Math.atan2(-z, x);
export const MACHINE_BASE = 2.45;               // the machine's front at the floor, offset from the centreline
export const BUTTON = loopPoint(MACHINE_ANGLE, 2.65);
export const MACHINE = loopPoint(MACHINE_ANGLE, 2.6);
// keeps bodies off the machine (in the level's collider format)
export const MACHINE_COLLIDER = {...loopPoint(MACHINE_ANGLE, 2.72), hx: .27, hz: .84, yaw: MACHINE_ANGLE, y0: 0, y1: 2.4};

// What everyone sees on the machine.
// state: idle | running | done | cancelled; laps: laps still to go; times in server ms
export function freshRace() { return {state: 'idle', runner: '', name: '', laps: RACE_LAPS, startedAt: 0, time: 0, endedAt: 0}; }
export function publicRace(r, now) {
  return {state: r.state, runner: r.runner, name: r.name, laps: r.laps, startedAt: r.startedAt, time: r.time, endedAt: r.endedAt, now};
}
