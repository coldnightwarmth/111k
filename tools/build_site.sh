#!/usr/bin/env bash
# Builds the site as it's deployed, into _site/ (GitHub Pages and Cloudflare Pages both serve this):
#   bash tools/build_site.sh <version>        (the deploy passes the commit: ${GITHUB_SHA::10})
# - the game's code bundled into one file (src/main.js), so a first visit fetches it in one go instead of a
#   chain of ~60 modules; three.js and the physics engine stay separate (shared, and loaded when needed)
# - every deploy's code gets its own version in its import paths, so browsers fetch the new code straight
#   away instead of running what they cached from the last deploy
# - the level's files go by a hash of their contents, so they're only fetched again when the level changes
# Needs esbuild: npm i --no-save esbuild@0.24.0
set -euo pipefail
V="${1:?usage: build_site.sh <version>}"
rm -rf _site && mkdir _site
cp -r index.html 404.html styles.css favicon.svg src vendor assets anim graffiti _site/
[ -f CNAME ] && cp CNAME _site/
touch _site/.nojekyll

# the level's version (src/level.js LEVEL_VERSION), from its files' contents
L="$(cat assets/env/world.glb assets/env/world*.json assets/env/world-*.webp assets/env/world-*.glb | sha256sum | cut -c1-10)"
sed -i -E "s#^const LEVEL_VERSION = '';#const LEVEL_VERSION = '$L';#" _site/src/level.js
grep -q "LEVEL_VERSION = '$L'" _site/src/level.js

# the game in one file (made from the copy, so it has the level's version in it)
npx --no-install esbuild _site/src/main.js --bundle --format=esm --target=es2022 --charset=utf8 \
  --external:three --external:'../vendor/rapier/*' --outfile=_site/src/main.bundle.js --log-level=warning
mv _site/src/main.bundle.js _site/src/main.js
grep -q "LEVEL_VERSION = \"$L\"" _site/src/main.js

# versioned import paths everywhere (the bundle's own few imports, and every module the other pages and the
# physics worker load on their own)
find _site/src -name '*.js' -o -name '*.mjs' | xargs sed -i -E "s#((from|import)[[:space:]]*\(?[[:space:]]*['\"]\.\.?/[^'\"]+\.m?js)(['\"])#\1?v=$V\3#g"
grep -q "rapier.es.js?v=$V" _site/src/main.js
sed -i -E "s#src=\"src/main\.js\"#src=\"src/main.js?v=$V\"#; s#href=\"styles\.css\"#href=\"styles.css?v=$V\"#" _site/index.html
sed -i -E "s#href=\"assets/env/world\.glb\"#href=\"assets/env/world.glb?v=$L\"#" _site/index.html
grep -q "world.glb?v=$L" _site/index.html
grep -q "main.js?v=$V" _site/index.html
# the emote previewer (/anim) and the graffiti review (/graffiti): the same for their script and stylesheet
sed -i -E "s#src=\"\.\./src/anim\.js\"#src=\"../src/anim.js?v=$V\"#; s#href=\"anim\.css\"#href=\"anim.css?v=$V\"#" _site/anim/index.html
grep -q "anim.js?v=$V" _site/anim/index.html
sed -i -E "s#src=\"\.\./src/graffiti-page\.js\"#src=\"../src/graffiti-page.js?v=$V\"#; s#href=\"graffiti\.css\"#href=\"graffiti.css?v=$V\"#" _site/graffiti/index.html
grep -q "graffiti-page.js?v=$V" _site/graffiti/index.html

# how long browsers may keep things (Cloudflare Pages reads this; GitHub Pages ignores it): the code and the
# level are asked for by version, so they keep; pictures and avatars a day (then checked again); pages never
cat > _site/_headers <<'EOF'
/*
  X-Content-Type-Options: nosniff
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/anim/
  Cache-Control: no-cache
/graffiti/
  Cache-Control: no-cache
/src/*
  Cache-Control: public, max-age=604800, immutable
/vendor/*
  Cache-Control: public, max-age=604800, immutable
/assets/env/*
  Cache-Control: public, max-age=604800, immutable
/assets/paintings/*
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
/assets/avatars/*
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
EOF
echo "built _site (code $V, level $L)"
