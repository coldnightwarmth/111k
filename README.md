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

Three rooms do something of their own:
- **B-04, the cinema:** a pull-down screen and a projector on a crate, playing the films in `assets/cinema/`
  round and round (`src/cinema-films.js`; everyone sees the same moment, by the clock). The projector is a
  real light carrying the film, so whoever walks into the beam gets it across them and throws a shadow on
  the screen; the beam, the glow round the screen and the light back into the room follow the film's colour,
  and its sound plays softly from the screen (`src/cinema.js`).
- **B-10:** a Super Metal Mons board, 11 x 11 in its starting position, sprayed on the floor (`src/board.js`).
- **B-20, the converter:** stand a painting in its chamber, type a piece number (1 to 111,111) on the keypad
  and hit CONVERT: a shutter comes down and the canvas comes back as that piece of the collection
  (`src/converter.js`; the server does it, `server/room.js`). Open crates round the room hold big painted eggs
  (`src/eggs.js`). The numbering across the CDN's folders is `src/collection.js` (paintings, then 3D,
  animated and eggs), with every painting's proportions in `src/collection-dims.js`
  (`tools/collection_dims.py`).

Voice chat (the mic button, top left, or the start screen): you always hear players near you, from where they
stand. Your mic (M) is opt-in. So is text-to-speech, which reads your chat messages out from your avatar like
your mic would, in one of two voices each: Hugo (higher) or Bruno (lower) for a Drifella, Kiki or Rosie for a
Drilady. The voices are KittenTTS nano running in the browser (`src/tts-worker.js`, `assets/tts/`), and are
only downloaded (about 35 MB) when someone turns it on.

Sounds: footsteps, jumps and landings, punches, the spray can, the paintball gun and its splats, the sponge,
flashlight clicks, picking things up and putting them down, things (paintings especially) clattering as they
fall, doors, the lap timer, the crown, incoming chat, lamps flickering and the tunnel's hum. They're all made in code, nothing
recorded (`src/sfx-synth.js`), a few fresh takes of each, and play from where they happen like voices do,
muffled through walls, with some of the tunnel's echo (`src/sfx.js`). "sounds" in the voice box sets their
volume. `/sfx` (on the GitHub copy) plays every version of every sound; pick one there to hear it in the game
in that browser, and `PICKS` in `src/sfx.js` is what everyone hears.

Debug URL params: `?view=3p`, `?cam=x,z,yaw,pitch`, `?exposure=1.2`,
`?server=wss://…`, `?pick=auto&name=…` (skip the picker with a random avatar).

## Deploy

**Site.** Every push to `main` deploys through `.github/workflows/pages.yml`:
`tools/build_site.sh` builds `_site/` (the game bundled into one file with
esbuild, every import path versioned, cache headers in `_headers`), then
`tools/smoke.mjs` loads that exact build in headless Chrome against the dev
server (`SITE_ROOT=_site`) and walks round, picks up and drops the torch; any
error stops the deploy. To try it locally:
`npm i --no-save esbuild@0.24.0 puppeteer-core@23.11.1 && bash tools/build_site.sh dev && SITE_ROOT=_site node tools/smoke.mjs`.
The same build also goes to Cloudflare (`.github/workflows/site.yml`,
`wrangler.site.jsonc`): static assets with brotli and long cache headers, and
a tiny `site/worker.js` in front of `/assets` that gzips the `.glb` models
(Cloudflare won't by itself). It's at `111k-site.<account>.workers.dev`; a
custom domain is attached to that Worker in the Cloudflare dashboard
(Settings → Domains & Routes) once the domain's DNS is on Cloudflare.
In the repo settings, set Pages → Source to "GitHub Actions" once. For a
custom domain, add a `CNAME` file at the root and add the domain to
`ALLOWED_ORIGINS` in `server/wrangler.jsonc`.

**Multiplayer server.** Pushes that touch `server/` run the tests and deploy
the Worker through `.github/workflows/worker.yml`. This needs two repository
secrets:

- `CLOUDFLARE_API_TOKEN`: create it from the "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID`

Errors from visitors' browsers are kept by the room: `GET /errors` on the
Worker (with an allowed `Origin` header) lists the latest kinds with counts.

You can also deploy by hand with `npm run deploy:server`. The client expects
the server at `wss://111k-room.<your-subdomain>.workers.dev/connect`; see
`src/config.js`.

## How the art is made

The world is modeled in Python and lit in Blender, which runs headless as a
Python module (`pip install bpy`, plus numpy, Pillow, scipy and scikit-image).

```sh
npm run build:world              # full bake, about 10 minutes
python3 tools/build_world.py --fast --preview   # quick bake + preview renders in tools/previews/
KIT_CACHE=/tmp/bakes npm run build:world         # keeps each bake as it finishes: a run that's cut off carries on
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
   hollow 3D throws, hand-cut stencils) and `tools/graffiti_third.py`
   (blockbusters, stickers, wheatpaste posters, ransom-note cut-ups, tile
   mosaics, LED tickers, neon, glitch, pop-art halftone, chalk, comic
   balloons, doctored signs, candlestick charts, ribbon letters) and
   `tools/graffiti_fourth.py` (airbrush, circles, hazard panels, shadow
   letters, polka dots, vertical heaven-spot letters, crossed-out pieces),
   and are
   written to their own atlas,
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
the client and the multiplayer server share. Loose flashlights, buckets and 29
paintings are scattered by `tools/scatter.py`; the paintings are hung, leant and
laid down by a Python port of the game's own placing (`planPlace` in
`src/main.js`), run against the built `world.glb`, so they sit exactly as a
player would put them. `python3 tools/scatter.py` redoes the scatter against an
already built level without a rebuild. The art itself is listed in
`src/paintings.js`; `python3 tools/paintings_webp.py <originals>` makes the
WebP copies the game loads (1024 and 512 px, plus a preview atlas of all of
them) in `assets/paintings/`: re-run it after adding art.

Crates the paintings came in (closed, opened, smashed to planks) stand about
most of the rooms (two lots in some), with empty pallets stacked or leant on
walls and broken bits along the tunnel: `python3 tools/crates.py`
models them, paints their atlas, places them against the built level and
writes `assets/env/world-crates.glb` and `src/crates-placed.js` (their
colliders). They're added at runtime but carry the level's lightmap
coordinates (each vertex takes the light of the floor beside it), so they
light, flicker and take paint like the level: run it again after a rebuild.

Paintings stack, tip and fall: whoever puts one down, drops it or picks one
up runs a few seconds of rigid-body physics (Rapier, `vendor/rapier`,
`src/settle.js`) over the paintings and level round about, and everyone
plays back the tumble. The physics runs in a worker (`src/settle-worker.js`,
the same code as `src/settle-sim.js` on the page if there's no worker), so
it never holds up a frame.

Picking things up and putting them down is shown straight away, before the
server has answered (`items.predict` in `src/items.js`): the server's echo
just confirms it, and if it turns the move down (`refused`) the item goes
back to where the server has it.

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
  voice.js   tts*.js      proximity voice chat, text-to-speech for chat
  sfx.js     sfx-synth.js sound effects: played in 3D / made from scratch (sfx/ is the page to pick versions)
  controls.js             keyboard/mouse and touch input
  protocol.js             message validation shared with the server
server/
  worker.js               Cloudflare Worker + Durable Object
  room.js                 room logic (shared with the dev server)
  dev.mjs                 zero-dependency local server
tools/                    asset pipeline (python + blender)
assets/                   built models, lightmaps, level data
vendor/three/             three.js r165
vendor/onnxruntime/       ONNX Runtime Web 1.22 (wasm), for text-to-speech
vendor/phonemizer/        phonemizer.js (eSpeak NG), text to phonemes for text-to-speech
```
