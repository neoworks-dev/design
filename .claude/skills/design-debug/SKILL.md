---
name: design-debug
description: Launch, drive and inspect the design app the way a person uses it — on a virtual display (watchable with vncviewer), controlled over CDP via `bun run qa`. Use whenever a UI bug is reported (reproduce before proposing a fix), when verifying that a change actually works in the running app, when exploring for bugs, or whenever you need a screenshot, renderer state or logs from the app.
---

# Debugging the app with `bun run qa`

Everything goes through `bun run qa <command>` (`bun run qa help` lists all). It starts its **own**
instance of the app on a virtual X display, which is not the user's desktop, with an isolated
profile in `.qa/profile`. You drive it over the Chrome DevTools Protocol, which Electron exposes
through `--remote-debugging-port`. Never launch, restart or attach to an instance the user started
themselves.

Source: `scripts/qa.ts`, `scripts/lib/` (`virtualDisplay.ts`, `cdp.ts`, `input.ts`, `probe.ts`,
`session.ts`). The Electron side of it is `electron/debug.ts`.

## Session

```bash
bun run qa start              # production build (builds if missing), display, CDP, vncviewer
bun run qa start --dev        # vite dev server + HMR instead; edits to src/ show up live
bun run qa start --build      # rebuild first (production mode)
bun run qa start --fresh      # wipe the isolated profile
bun run qa start --no-viewer  # don't open vncviewer on the user's desktop
bun run qa status             # mode, display, CDP endpoint, log path
bun run qa stop               # app, dev server, display, viewer — always clean up
```

- **The display** is Xvnc on `:100`–`:109`. Grove's QA uses `:90`–`:99`, so don't move into
  that range. `start` opens `vncviewer :10x` so the user can watch, unless you pass `--no-viewer`.
  Use `--no-viewer` for unattended runs. Use the viewer when the user wants to watch, or when
  you're debugging together.
- **Readiness.** `start` returns once the renderer sets `<html data-ready="true">`, which happens
  after the app has booted. If boot breaks, `start` fails and tells you to read the logs.
- **Changes in `electron/`** need a restart (`qa stop && qa start`). In `--dev` mode, changes in
  `src/` hot-reload. In build mode, use `qa start --build`.
- **WebGL** runs on SwiftShader (software rendering), because no GPU driver works on Xvnc. Canvas
  output is correct, but **frame times here are not representative**. Don't draw performance
  conclusions from a QA session.

## Seeing

`probe` is the main loop. It prints the accessibility tree: each element's role, name, ref and box
in window pixels.

```bash
bun run qa probe              # everything
bun run qa probe layers       # only lines matching a role, name or ref
```

```
{"title":"","url":"app://design/","size":"1439x899","focus":"body","summary":null}
text "Untitled" e1  @12,11 49x16
button "–" e2  @1290,2 41x36
```

Refs (`e2`) stay valid until the DOM changes. A stale ref is an error that tells you to probe
again, never a click somewhere unintended.

**The canvas is opaque to probe.** CanvasKit draws pixels, so shapes, selection and handles are not
in the DOM. For canvas state, use the renderer debug hook (see below) through `eval`. Use
screenshots for what only a picture can show.

```bash
bun run qa screenshot after-resize                     # .qa/shots/NNN-after-resize.png
bun run qa screenshot handles --crop 600,300,200,200   # x,y,w,h — zoom into a region
```

**Read every screenshot you take** with the Read tool. Never open one in an image viewer. Use a
crop when you're checking one detail. Screenshots are for alignment, rendering, overlap and
clipping, not for finding out what is on screen, because `probe` answers that more precisely and
far more cheaply.

Transient UI such as menus, popovers or a hover state has to be photographed in the same CDP
connection as the action that produced it. Add `--screenshot <label>` to the action:

```bash
bun run qa rightclick at=700,400 --screenshot context-menu
```

## Acting

```bash
bun run qa click "Layers"            # also dblclick, rightclick
bun run qa click e7
bun run qa click at=720,450          # canvas points have no element: use coordinates
bun run qa drag at=600,300 at=800,450    # stepped, so pointermove deltas accumulate
bun run qa type "Hello"              # inserts into the focused element
bun run qa press Escape              # chords: Control+z, Control+Shift+z, Shift+Tab, v, r
bun run qa press v r                 # several in order (tool switches, etc.)
bun run qa scroll -400 --at at=720,450
bun run qa wait "Export" [--gone] [--timeout 10000]
```

| Target form | Means |
| --- | --- |
| `e12` | element from the last `probe` |
| `Layers` | accessible name: exact match first, then case-insensitive substring; interactive roles win |
| `role=button:Save` | name within one role, when the bare name is ambiguous |
| `css=.selector` | when nothing else fits |
| `at=x,y` | a window point, for the canvas and anything without an element |

Hold modifiers on a drag or click with `--modifiers Control,Alt,Shift` (for example
`bun run qa drag at=600,300 at=800,450 --modifiers Alt`). To photograph drag feedback (insertion
lines, ghosts, value labels) add `--screenshot-before-release <label>`: it is taken with the
button still down.

## Renderer state: `eval` and the debug hook

```bash
bun run qa eval 'window.desktop.system'
bun run qa eval 'document.documentElement.dataset.ready'
bun run qa eval '(() => { const element = document.activeElement; return element && element.outerHTML.slice(0, 200) })()'
```

`eval` takes one **expression**. Promises are awaited and the result is printed as JSON. Wrap
statements in an IIFE.

**`window.__design_debug`** is the kernel's debug surface, contributed by a debug plugin in
QA/dev builds. `probe` prints its `summary()` in the header line. Its intended contents (add to it
when you need something, rather than poking internals ad hoc):

- `summary()` — current page, selection ids, active tool, zoom, document node count, failed plugin
  fibers.
- `ctx` — the root kernel context. `ctx.fiber.getEffects()` gives the labelled effect tree: what
  each plugin currently has installed.
- `document`, `selection`, `viewport`, `history` — the live services. For example,
  `viewport.worldToScreen({x, y})` turns a node position into an `at=x,y` target.
- `plugins()` — every fiber with its state (PENDING / ACTIVE / FAILED) and error.

Until that plugin exists, `summary` prints `null`.

## Logs

```bash
bun run qa logs              # last 80 lines, main + renderer interleaved
bun run qa logs 200 --renderer
bun run qa logs --main
```

In QA mode, main mirrors the renderer console into its own stdout with a `[renderer:<level>]`
prefix, so `.qa/main.log` holds both halves in order. Renderer crashes show up as
`[renderer:gone]`. In `--dev` mode, the vite output is in `.qa/vite.log`.

Native dialogs can't be clicked on the virtual display. A waiting message box logs
`[qa] native message box waiting: ...` and blocks whatever asked (e.g. the crash-recovery prompt
for an untitled file a killed session left in `.qa/profile/untitled/`: no file is open, and saving
or `blobs.put` fail with "no document file open"). Start with `--fresh`, or answer dialogs through
the environment: `DESIGN_QA_MESSAGE_BOX=<button index>`, `DESIGN_QA_OPEN_PATH`,
`DESIGN_QA_SAVE_PATH`. `DESIGN_QA_FIXTURE=0` starts without the fixture scene (a real, editable blank file).

## Raw CDP

`qa status` prints the endpoint (`http://127.0.0.1:<port>/json/list`). Anything that speaks CDP
can attach to it: Chrome's `chrome://inspect` (add the port as a target), a Playwright
`connectOverCDP`, or a one-off script using `CdpSession` from `scripts/lib/cdp.ts`. Pick the
`page` target whose URL isn't `devtools://`.

## Procedure for a bug

1. **Reproduce first.** `qa start --fresh`, do the shortest path to the symptom, then `probe`
   and screenshot it. Guessing from source alone is wrong more often than right.
2. **Find the mechanism.** Check `qa logs` for errors and failed fibers, use `eval` on the debug
   hook for state, and check `ctx.fiber.getEffects()` for missing or leaked contributions.
3. **Fix**, then **verify in the same way you reproduced it**. Re-run the exact steps and show the
   screenshot or state that proves the fix. If the bug is a plugin unload leak, also check that
   mount → dispose leaves the effect tree as it was.
4. `qa stop`.

## Reporting findings

When exploring rather than fixing, file one issue per finding on `neoworks-dev/design`. Use
**`gh bot`** for every write (`gh bot issue create -R neoworks-dev/design ...`), never plain `gh`.
Write what you did, what happened and what you expected, in that order. Include the probe excerpt,
plus the screenshot when the problem is visual. Use one `area:*` label plus `bug` or
`enhancement`. Check `gh issue list -R neoworks-dev/design --search "<words>"` for duplicates
first.
