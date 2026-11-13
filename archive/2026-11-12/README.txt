111k — every mark on the walls, 12 November 2026, 18:30 Central (the day after launch)

Saved straight from the live room, nothing changed or left out:
  - 23,289 marker strokes (704,549 points), in 569 drawings
  - 150 spray-can tags
  - 3 paint splats
  - the graffiti review as it stood (which tags were hidden, which were rubbed out)

graffiti.json.gz — all of it, as JSON:
  saved, room            when, and which room
  ink   [{id, h, c, t, g, q}]   one per marker stroke
      id   the stroke (the part before ':' is the page that drew it: random, not a player's name)
      h    what it's on: 'w' the walls/floors, 'd<k>' a door, 'p<id>' a painting
      c    colour (0xRRGGBB as a number)
      t    when it was drawn (ms since 1970)
      g    the drawing it belongs to (strokes that cross, or the same colour within a metre)
      q    its points, 8 numbers each: x, y, z in millimetres; the surface's facing (nx, ny, nz) x100;
           the level's lightmap spot (u, v) x10000. Positions are in the world (or the door's / painting's own space).
  sprays [{p, n, up, v, piece, size, r, ...}]   one per tag: where (p), facing (n, up), which tag (piece: a name in
           tags/world-graffiti.json), how big, and the spray's reach
  splats                 paint splats (they fade in the game)
  erased, hidden         the review's state

tags/ — where each tag sits on the artwork (the atlas pages are assets/env/world-tags-0..4.webp at that commit; the zip copy has them too)
  (world-graffiti.json: pieces with page and uv; world-tags.json).

The game as it was is commit 4cce226 of github.com/coldnightwarmth/111k (round3 / main). To see the ink again in a
local copy: unzip graffiti.json.gz, take its "ink" list into a file, and run the dev server with
INK_FILE=<that file> (server/dev.mjs).
