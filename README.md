# 111k

A realtime multiplayer hangout in an abandoned tunnel loop, inspired by the
Superconducting Super Collider tunnel dug under Waxahachie, Texas, and
abandoned in 1993. The loop is about 226 m around, with twenty doors on its
outer side opening onto small offices. One of them has been taken over for a
party; the rest are in various states of abandonment, some locked.

- **Site:** static files on GitHub Pages, with no build step
- **Multiplayer:** a Cloudflare Worker + Durable Object (free tier)
- **3D:** three.js r165 (vendored), with avatars from cards.art

## Run it locally

You only need Node 20+.

```sh
npm run dev        # http://localhost:8000
```

Open two browser windows to see each other. The dev server runs the same room
logic as production, on the same port.

When you arrive you pick a name (it only shows in the chat log) and one of twelve
random avatars, six Drifellas and six Driladies, or the one you wore last time.
Refreshing keeps you where you were; closing the tab sends you back to the picker.

Controls: click to look · WASD move · shift run · space jump (jump again right as
you land to bunny hop: each clean hop goes a little higher and faster) · C crouch ·
enter chat · E emotes · V first/third person · left click punches, or uses what
you hold · right click (or F) drops it.

- Flashlights (fifteen, six of them already on, lying around the loop): left click switches them on and off.
  Every item goes back where it started when the last person leaves, or once nobody has done anything for 3 minutes.
- The paintball gun (in the starting room): left click fires, hold to keep firing.
  Paint stays on the walls; a hit player gets paint on them and drops what they hold.
- Spray cans (ten, round the loop): left click a wall to tag it. Press Esc while
  holding one to pick which piece you spray.
- Doors swing open when you walk into them.

On phones: left stick moves, drag to look, buttons for the rest.

Debug URL params: `?view=3p`, `?cam=x,z,yaw,pitch`, `?exposure=1.2`,
`?server=wss://…`, `?pick=auto&name=…` (skip the picker with a random avatar).

## Deploy

**Site.** Every push to `main` deploys through `.github/workflows/pages.yml`.
In the repo settings, set Pages → Source to "GitHub Actions" once. For a
custom domain, add a `CNAME` file at the root and add the domain to
`ALLOWED_ORIGINS` in `server/wrangler.jsonc`.

**Multiplayer server.** Pushes that touch `server/` run the tests and deploy
the Worker through `.github/workflows/worker.yml`. This needs two repository
secrets:

- `CLOUDFLARE_API_TOKEN`: create it from the "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID`

You can also deploy by hand with `npm run deploy:server`. The client expects
the server at `wss://111k-room.<your-subdomain>.workers.dev/connect`; see
`src/config.js`.

## How the art is made

The world is modeled in Python and lit in Blender, which runs headless as a
Python module (`pip install bpy`, plus numpy, Pillow, scipy and scikit-image).

```sh
npm run build:world              # full bake, about 10 minutes
python3 tools/build_world.py --fast --preview   # quick bake + preview renders in tools/previews/
```

1. `tools/build_world.py` lays out the loop and the door passages;
   `tools/rooms.py` builds the rooms (abandoned offices, a control room, a
   restroom, a squat), `tools/office.py` the party room, and `tools/props.py`
   the furniture, chairs and junk. Textures are procedural (`tools/textures.py`).
2. Graffiti is simulated rather than typeset (`tools/graffiti.py`): letters come
   from hand-drawn alphabets reshaped per style (wildstyle, straight letters,
   bubbles, runic and stretched handstyles, blackletter chisel, rollers,
   extinguisher drips, scratchiti, stencils), and every stroke is sprayed like a
   can, with paint building up where the hand slows, overspray and drips.
   More pieces just for the spray cans come from `tools/graffiti_more.py`
   (cholo placas, Philly wickets, Bay Area busflow, mop drips, brush script,
   hollow 3D throws, hand-cut stencils) and are written to their own atlas,
   `assets/env/world-tags*`, by `python3 tools/graffiti_tags.py`, so adding
   to them never needs the world rebuilt.
3. Blender packs lightmap UVs, bakes direct and bounced light with Cycles and
   denoises the result (`tools/blender/kit.py`). Lamps that flicker are baked
   again on their own; `world-flicker.webp` stores each lamp group's share of
   every texel's light (one group per channel), so the game can dim lamps one
   group at a time without disturbing the lightmap's shadows. Graffiti and small
   junk borrow the lightmap of the surface they sit on. Unlocked room doors are
   exported as separate meshes with their hinges, and swing in the game.
4. In the browser every surface is an unlit material times the lightmap, scaled
   down for dimmed lamp groups, plus flashlight beams (`src/level.js`). Avatars
   are lit by the six baked lights nearest the camera. Paint splats and sprayed
   tags are cut out of the level's triangles around the hit (`src/decals.js`),
   so they wrap corners and carry the wall's own lightmap coordinates.

The build also writes `src/world-items.js` (where the flashlights start), which
the client and the multiplayer server share.

## Avatars

Drifellas and Driladies come from the cards.art models (cardbinder repo).
`tools/avatarparts.py` splits each character's trait packs into a small base
(rig, body, animation library) and one file per trait, compressed with
gltfpack (meshopt), so a visitor only downloads what their avatar wears: about
0.2–0.8 MB instead of 70–135 MB per character.

```sh
npm i -g gltfpack
python3 tools/avatarparts.py /path/to/cardbinder
python3 tools/blender/punch.py /path/to/cardbinder/assets/models/drifmaker/drifella-customizable.blend assets/avatars/moves.glb
```

`src/cards/` holds the cards.art appearance modules unchanged (trait catalogs,
finishes, which parts show), so looks match the showroom. `src/looks.js` rolls
random looks with the drifmaker rarity weights. The punch is authored in
Blender by `tools/blender/punch.py` as aimed key poses on the shared 19-bone
rig.

## Layout

```
index.html, styles.css    page + HUD
src/                      client (ES modules, no bundler)
  main.js                 game loop, camera, peers
  avatar.js  motion.js    character animation, movement, interpolation
  level.js   physics.js   baked level + shader hook, flicker, avatar lights, collision + camera rays
  items.js                held items (flashlights, paintball gun, spray cans)
  decals.js  doors.js     paint and tags on the level, swinging doors
  picker.js  looks.js     avatar picker, random looks; cards/ = cards.art appearance code
  net.js     chat.js      websocket client, chat log + bubbles
  controls.js             keyboard/mouse and touch input
  protocol.js             message validation shared with the server
server/
  worker.js               Cloudflare Worker + Durable Object
  room.js                 room logic (shared with the dev server)
  dev.mjs                 zero-dependency local server
tools/                    asset pipeline (python + blender)
assets/                   built models, lightmaps, level data
vendor/three/             three.js r165
```
