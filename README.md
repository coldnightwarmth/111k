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

Controls: click to look · WASD move · shift run · space jump · C crouch ·
enter chat · E emotes · V first/third person. Left click punches, or picks up
a flashlight you're looking at; holding one, left click switches it on and
off and right click (or F) drops it. Punching someone knocks them back and
makes them drop what they hold. On phones: left stick moves, drag to look,
buttons for the rest.

Debug URL params: `?view=3p`, `?cam=x,z,yaw,pitch`, `?exposure=1.2`,
`?server=wss://…`.

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
3. Blender packs lightmap UVs, bakes direct and bounced light with Cycles and
   denoises the result (`tools/blender/kit.py`). Lamps that flicker are baked a
   second time into `world-flicker.webp`, one lamp group per channel, so the
   game can dim them individually. Graffiti and small junk borrow the lightmap
   of the surface they sit on.
4. In the browser every surface is an unlit material times the lightmap, minus
   any dimmed lamp groups, plus flashlight beams (`src/level.js`). Avatars are
   lit by the six baked lights nearest the camera.

The build also writes `src/world-items.js` (where the flashlights start), which
the client and the multiplayer server share.

The avatar (`assets/avatars/drifella-default.glb`) is the cards.art default
Drifella. `tools/glbslim.py` prunes the wardrobe options and quantizes the
geometry, which takes the file from 49 MB to 1.2 MB with an identical render.

## Layout

```
index.html, styles.css    page + HUD
src/                      client (ES modules, no bundler)
  main.js                 game loop, camera, peers
  avatar.js  motion.js    character animation, movement, interpolation
  level.js   physics.js   baked level + shader hook, flicker, avatar lights, collision + camera rays
  items.js                 flashlights: on the ground, in hands, beams
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
