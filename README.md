# 111k

A realtime multiplayer hangout in an abandoned tunnel loop, inspired by the
Superconducting Super Collider tunnel dug under Waxahachie, Texas, and
abandoned in 1993. Right now it is one room: a small office off the loop that
people have taken over for a party.

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
enter chat · E emotes · V first/third person. On phones: left stick moves,
drag to look, buttons for the rest.

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

Environments are modeled in code with `tools/levelkit.py`, a small modeler
and lightmap baker that needs only numpy and Pillow.

1. Geometry is authored as lowpoly boxes, cylinders and quads, with
   tileable textures generated procedurally (`tools/textures.py`).
2. Lighting, ambient occlusion and grime are baked into one lightmap, in the
   spirit of Half-Life 2.
3. In the browser, every surface is an unlit material times the lightmap.
   Avatars get a few real lights matched to the bake.

Rebuild the room with `npm run build:room`. It writes
`assets/env/office.{glb,json}` and `office-lightmap.png`.

The office is about 3,300 triangles and 13 draw calls, which keeps it fast
on phones.

The avatar (`assets/avatars/drifella-default.glb`) is the cards.art default
Drifella. `tools/glbslim.py` prunes the wardrobe options and quantizes the
geometry, which takes the file from 49 MB to 1.2 MB with an identical render.

## Layout

```
index.html, styles.css    page + HUD
src/                      client (ES modules, no bundler)
  main.js                 game loop, camera, peers
  avatar.js  motion.js    character animation, movement, interpolation
  level.js   physics.js   baked level loading, walking collision
  net.js     chat.js      websocket client, chat log + bubbles
  controls.js             keyboard/mouse and touch input
  protocol.js             message validation shared with the server
server/
  worker.js               Cloudflare Worker + Durable Object
  room.js                 room logic (shared with the dev server)
  dev.mjs                 zero-dependency local server
tools/                    asset pipeline (python)
assets/                   built models, lightmaps, level data
vendor/three/             three.js r165
```
