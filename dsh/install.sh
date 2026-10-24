#!/usr/bin/env bash
# Install the CoNest DSH plugins (conest-collab + Discord UI) into a DSH profile.
# Usage: dsh/install.sh [profile] [--lang zh|en]   (default profile: web; honours $DSH_HOME)
#   --lang  default UI language of the profile (the setup wizard passes its own choice)
set -euo pipefail
PROFILE=web
LANG_PREF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --lang) LANG_PREF="${2:-}"; shift 2 ;;
    --lang=*) LANG_PREF="${1#--lang=}"; shift ;;
    -*) echo "unknown option: $1" >&2; exit 1 ;;
    *) PROFILE="$1"; shift ;;
  esac
done
case "$LANG_PREF" in ""|zh|en) ;; *) echo "--lang must be zh or en" >&2; exit 1 ;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI="$HERE/packages/client-ui-discord"

echo "== step: download"
command -v dsh >/dev/null || { echo "dsh not found on PATH; install DeepSeek Harness first" >&2; exit 1; }
if ! command -v pnpm >/dev/null; then
  # npm's global bin may simply be missing from PATH (pnpm already installed there).
  # On Windows, npm prefix -g is where .cmd files live (not in bin/). On Unix, it is in bin/.
  NPM_PREFIX="$(npm prefix -g 2>/dev/null || true)"
  if [ -n "$NPM_PREFIX" ]; then
    export PATH="$NPM_PREFIX:$NPM_PREFIX/bin:$PATH"
  fi
  if ! command -v pnpm >/dev/null; then
    echo "== pnpm not found, installing with npm"
    npm i -g pnpm
    if [ -n "$NPM_PREFIX" ]; then
      export PATH="$NPM_PREFIX:$NPM_PREFIX/bin:$PATH"
    fi
  fi
fi

# dsh-web-app must match the running dsh version, so take it from the local dsh install if present.
DSH_BIN="$(command -v dsh || true)"
WEB_APP=""
if [ -n "$DSH_BIN" ]; then
  DSH_JS="$(node -e 'try { console.log(require("fs").realpathSync(process.argv[1])) } catch(e){}' "$DSH_BIN" 2>/dev/null || true)"
  if [ -n "$DSH_JS" ]; then
    DSH_DIR="$(cd "$(dirname "$DSH_JS")/.." && pwd 2>/dev/null || true)"
    if [ -n "$DSH_DIR" ] && [ -d "$DSH_DIR/node_modules/@deepseek-ai/dsh-web-app" ]; then
      WEB_APP="$DSH_DIR/node_modules/@deepseek-ai/dsh-web-app"
    fi
  fi
fi
# On Windows npm writes `dsh` as a plain shim file, not a symlink, so realpath above lands in the
# npm prefix rather than the package; look the package up under the global node_modules instead.
if [ -z "$WEB_APP" ] && command -v npm >/dev/null; then
  NPM_ROOT="$(npm root -g 2>/dev/null || true)"
  if [ -n "$NPM_ROOT" ] && [ -d "$NPM_ROOT/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app" ]; then
    DSH_DIR="$NPM_ROOT/@deepseek-ai/dsh"
    WEB_APP="$DSH_DIR/node_modules/@deepseek-ai/dsh-web-app"
  fi
fi

echo "== step: deps"
# Reinstall when deps are missing or package.json/pnpm-lock.yaml changed since the last install
# (an upgrade refreshes these files in place); the stamp is a copy of both files.
DEPS_STAMP="$HERE/collab/node_modules/.bothouse-deps"
if [ ! -d "$HERE/collab/node_modules" ] || ! cat "$HERE/collab/package.json" "$HERE/collab/pnpm-lock.yaml" | cmp -s - "$DEPS_STAMP"; then
  echo "== install collab dependencies"
  (cd "$HERE/collab" && pnpm install --frozen-lockfile --config.minimum-release-age=0)
  cat "$HERE/collab/package.json" "$HERE/collab/pnpm-lock.yaml" > "$DEPS_STAMP"
fi

# Rebuild when any UI source is newer than the bundle, so an upgrade does not keep serving a stale one.
if [ -f "$UI/lib/client.js" ] && [ -z "$(find "$UI/src" -newer "$UI/lib/client.js" -type f | head -n 1)" ]; then
  echo "== client-ui-discord already bundled, skipping build"
else
  echo "== build client-ui-discord"
  (cd "$UI" && pnpm install --ignore-workspace && pnpm run bundle)
fi

echo "== step: plugin"
echo "== install into profile $PROFILE"
if [ -n "$WEB_APP" ]; then
  dsh plugin --profile "$PROFILE" add "link:$WEB_APP" "link:$HERE/collab" "link:$UI"
else
  echo "== dsh-web-app not found in local dsh path, linking collab and ui plugins"
  dsh plugin --profile "$PROFILE" add "link:$HERE/collab" "link:$UI"
fi
if [ -n "$LANG_PREF" ] && command -v node >/dev/null; then
  # DSH keeps the UI language as config of the `locale` entry (dsh-client-locale, field
  # `preference`) in the profile's cordis.patch.yml; the Settings > Language row writes the same place.
  PATCH="${DSH_HOME:-$HOME/.dsh}/profiles/$PROFILE/cordis.patch.yml"
  echo "== set default UI language: $LANG_PREF ($PATCH)"
  NODE_PATH="$DSH_DIR/node_modules" node - "$PATCH" "$LANG_PREF" <<'JS'
const fs = require("fs");
const YAML = require("yaml");
const [file, lang] = process.argv.slice(2);
const doc = YAML.parseDocument(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "[]\n");
if (!YAML.isSeq(doc.contents)) doc.contents = doc.createNode([]);
const seq = doc.contents;
let entry = seq.items.find((it) => YAML.isMap(it) && it.get("id") === "locale" && !it.has("insert"));
if (!entry) { entry = doc.createNode({ id: "locale", config: {} }); seq.items.push(entry); }
if (!YAML.isMap(entry.get("config"))) entry.set("config", doc.createNode({}));
entry.get("config").set("preference", lang);
seq.flow = false;
fs.writeFileSync(file, doc.toString());
JS
fi
echo "== done; check with: dsh --profile $PROFILE --dump-config"
echo "== channel data: ${CONEST_COLLAB_DATA:-$HOME/.conest-collab} (collab.sqlite3; set CONEST_COLLAB_DATA before starting dsh to change it)"
