# Figma client analysis (2026-10-08)

Goal: find evidence in Figma's shipped web client for canvas move behaviour. Pass 1 (unauthenticated) found nothing
useful about the editor. Pass 2 (2026-10-08) analysed a CDP dump of the logged-in editor tab (177
files, including the 51 MB C++ wasm core). Everything below about the editor comes from pass 2.

## What was downloaded

Location: `/home/moritz/.cache/figma-client-analysis/raw/` (outside the repo, never committed;
`manifest.txt` there lists sizes). Helper scripts live in `../tools/`.

| Source | Result |
| --- | --- |
| `https://www.figma.com/` | 200. Marketing site, a Next.js app (`/_netlify/_next/static/chunks/*`). No editor code. Not downloaded beyond the HTML. |
| `https://www.figma.com/login`, `/files`, `/signup` | 200, identical auth shell (`data-entrypoint="auth"`). Loads the rspack bundles below. |
| `https://www.figma.com/community`, `/community/file/<id>/...` | 202 with `x-amzn-waf-action: challenge` (CloudFront WAF bot challenge). Not bypassed. |
| `https://www.figma.com/design/<key>/<name>` | 404 without a real key. A real key needs auth for the editor entrypoint; not attempted. |
| `https://admin.figma.com/admin/webpack-artifacts/<sha>/*.min.js.map` | Source maps referenced by `sourceMappingURL`. Fetch was blocked by the permission system (internal host), not attempted. |

Bundles fetched from `https://www.figma.com/webpack-artifacts/assets/<name>-<hash>.min.js`
(send `Accept-Encoding`, i.e. `curl --compressed`, otherwise you get gzip bytes):

- `runtime~auth-0a3eb47c5df6df0b` (rspack runtime, 4.6 KB). Chunk URL pattern: `l.p + name + "-" + hash + ".min.js"`, public path `/webpack-artifacts/assets/`. The global is `rspackChunk_figma_web_bundler`. Its chunk map only lists locale chunks (`auth_hi-in`, ...).
- `vendor-core` (React DOM), `vendor`, `cssbuilder`, `svg`, `auth`.
- `374-8816202bb02b38a5` (857 KB, shared chunk). **The only file with substantial editor-related strings**: telemetry throttle tables, a desktop-app bridge, and an enum of C++ entry points (see below).

Build ids seen: per-entrypoint git SHAs in the map URLs, e.g. auth `5ddcbe24...`, shared chunk
`674fa66a...`, cssbuilder `0fd9ed69...`, early bundle `dab2da3f...`.

## Structure learned

- Figma uses its own rspack wrapper (`@figma/web-bundler`), one runtime per entrypoint (`runtime~<entry>`), entrypoints `auth`, `early`, `404`, and (not seen here) a fullscreen editor entrypoint. Shared chunks are numeric (`374`).
- The editor core is C++ in wasm, called from JS. The JS-side names of those entry points are visible in shared chunk 374 (a profiling scope enum, see `moving.md`). No `.wasm` URL, `compiled_wasm`, or `fullscreen_*.js` reference exists in any publicly reachable file; those URLs are only emitted by the logged-in editor page.

## Not obtained (needed)

- Editor entrypoint HTML and its runtime chunk (chunk map to fullscreen chunks).
- The wasm binary (`compiled_wasm*`), where thresholds and snapping live.
- Keyboard shortcut tables (JS in the editor chunks).
- Source maps.

## Re-run

```sh
D=/home/moritz/.cache/figma-client-analysis; mkdir -p $D/raw && cd $D/raw
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
curl -sL --compressed -A "$UA" -o page_login.html https://www.figma.com/login
# list bundle URLs (HTML escapes / as &#47;)
rg -o 'webpack-artifacts&#47;assets&#47;[A-Za-z0-9~_.-]+\.min\.js' page_login.html | sed 's/&#47;/\//g' | sort -u
# then: curl -sL --compressed -A "$UA" -O https://www.figma.com/<path>
```

Tooling: curl, ripgrep, python3 -I for string extraction. `wasm-objdump`/`wasm2wat` are not
installed; when the wasm is available try `bunx wabt`/`strings`.

## Index

- `moving.md`: move behaviour evidence, confidence tags, experiments for the live session.
- `shortcuts.md`: shortcut table (no new code evidence yet; points to what to extract).

## Pass 2: editor dump

Location: `/home/moritz/.cache/figma-client-analysis/editor/` (index.json maps URL to file). Read and
grep only; nothing executed. Key files:

| File | What |
| --- | --- |
| `85-figma_app-fd47025286a7e902.min.js` (8 MB) | Main app: TS bindings to the wasm (`EditorPreferences`, `MouseBehaviorEvent`, `InteractionCpp` ...), preferences hooks. |
| `86-5727-930338d8d15ac930.min.js` (14 MB) | Action registry (`jsonName` entries with handlers), menu glue, connector tool, many bindings. |
| `52-807-*`, `84-2766-*`, `90-2647-*`, `153-9288-*` | Menus, view menu items, quick-actions lists, action id lists. |
| `174-compiled_wasm.js` (2.3 MB) | Emscripten glue: exported C++ binding names (e.g. `_EditorPreferences_Internal___getProperty_snapToPixelGrid`, `_InteractionCpp_snapToPointDeltaPoint`). |
| `219-compiled_wasm.wasm` (51 MB) | C++ core. Minified export names, **no function names**, but `__FILE__` strings give source paths and the data segment holds the whole keyboard shortcut JSON. |

Wasm facts: 51073 functions, build_id `10fb5cff8e585e05a686f64510a86e9a`, built with wasm exceptions
(wasm2wat needs `--enable-all`). C++ sources are under `fullscreen/lib/...` (509 paths listed by
`strings`), e.g. `editor-ui/interactions/FGMoveSelectionBehavior.cpp`,
`FGResizeSelectionBehavior.cpp`, `FGCornerRotationBehavior.cpp`, `FGReorderListItemBehavior.cpp`,
`scenegraph/FGMoveTransformer.cpp`, `FGSelectionTransformer.cpp`, `FGStacking.cpp`,
`ui/FGPointerTracker.cpp`, `editor/interactions/FGHitTest.cpp`,
`editor-ui/interactions/move-selection-delegates/FGMoveSelectionLayoutHelpers.cpp`.

### Method (reproducible)

All tools in `../tools/` of the cache dir (outside the repo), run with `python3 -I`:

1. Shortcuts: the keymap JSON is embedded in the wasm data. `shortcuts.py <wasm> <out.json>` finds
   `"toggle-snapping-to-pixels":[` and walks back to the enclosing JSON object; `flat.py` and
   `mkshort.py` flatten it.
2. wabt 1.0.37 binary from the GitHub release, unpacked in `tools/wabt/`:
   `wasm2wat --enable-all --no-check --no-debug-names -o core.wat 219-compiled_wasm.wasm` (about 1 GB of text, 2 minutes).
3. Map JS export name to wasm function: glue line `_X=Module._X=e.R$` plus `wasm-objdump -x -j Export`
   gives `R$ -> func[44567]`; `getfunc.sh core.wat <idx>` prints one function.
4. Find the code behind a source file: `dataaddr.py` converts a `strings -t d` file offset of the
   `__FILE__` string to its linear memory address; `xref.py core.wat <addr>` lists functions with
   `i32.const <addr>`; `memstr.py` reads the NUL-terminated string at a memory address (to decode
   log message pointers found in functions).
5. Constants: scripts `scan5.py`/`scan6.py` find small functions with a given float constant.

### Index

- `moving.md`: move behaviour evidence, measured vs code, open experiments.
- `snapping.md`: snapping preferences, thresholds, API surface.
- `shortcuts.md`: the full design-mode shortcut table extracted from the wasm.
- `paste.md`: where pasted and duplicated nodes land (next to the original with a 40 px gap, keep/centre in a container, 2x viewport guard, post-paste view adjust), function map, dead ends, experiments.
