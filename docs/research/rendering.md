# Rendering Notes and Recommendation

Sources: https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/ , https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x/ , https://www.figma.com/blog/figma-rendering-powered-by-webgpu/ , https://www.figma.com/blog/keeping-figma-fast/ , https://github.com/penpot/penpot/tree/develop/render-wasm , https://penpot.app/blog/say-hello-to-background-blur/ , https://github.com/penpot/penpot/releases/tag/2.17.0 , https://openpencil.dev/guide/comparison (third-party comparison, treat figures as claims). Provenance: [V] verified, [K] prior knowledge.

## 1. Figma [V unless noted]
- Custom 2D engine, **not** DOM/SVG/Canvas2D. Written in C++, originally compiled to asm.js, then WebAssembly (3x load time improvement; compiled code is cached by the browser so load time no longer scales with app size). Memory is managed manually with compact 32-bit floats and bytes, avoiding GC pauses.
- **WebGL, tile-based** GPU renderer. Reason: masking, blurs, blend modes, dithered gradients, consistent output cross-platform, large documents.
- **Own text layout engine**, because browsers do not expose glyph outlines/kerning tables and text rendering varies between browsers and platforms. Text is rendered as vector glyph outlines (rendered by the GPU path renderer) [K].
- 2023+: migration to **WebGPU** (Chromium shipped it), keeping WebGL as a dynamic fallback. Changes: explicit draw-call arguments instead of global GL state, GLSL shaders kept and auto-translated to WGSL with Naga, batched uniform uploads (`encodeDraw`/`submit`). Opportunities: compute-shader blur, MSAA, RenderBundles.
- Time-sliced rendering prioritizes local edits over remote changes (multiplayer). [V]
- Hit-testing (not documented in those posts) [K]: done in C++ against the scene graph using per-node bounds and exact geometry tests, independent of GPU (no color-picking pass).

## 2. Penpot [V unless noted]
- **Legacy/default**: SVG rendered through the DOM via Reagent/React; each shape is a DOM element; hit testing partially via browser events plus a spatial index on the frontend (quadtree / `selrect`-based index, geometry in `common`) [K]. Struggles with very large boards.
- **New render-wasm**: Rust crate compiled to `wasm32-unknown-emscripten`, uses **Skia (rust-skia custom binaries) on WebGL**. Shape data goes from ClojureScript into WASM linear memory (binary-packed, with serialization cost). Documented subsystems: **tile-based rendering, surfaces (a multi-surface design, reported ~11 surfaces) and tile caching**. Two builds: frontend (speed-optimized) and export (size-optimized, headless). Beta in 2.16 via `&wasm=true`, prototype viewer rendered by wasm in 2.17.0, SVG still the default as of the sources found. Background blur was only possible with Skia's backdrop filter on saved layers. A perf PR reports 10k shapes + 700 booleans: board drop freeze 10.8s -> 1.2s. [V via search results]
- Skia exporters for image/PDF planned. 

## 3. Hit testing approaches (options)
1. **Geometric over scene graph + spatial index (recommended)**: R-tree/quadtree of world-space AABBs (`absoluteRenderBounds` for hover, `absoluteBoundingBox` for select). Candidate query by point or rect, then exact test from the top of z-order down: inverse-transform the point into the node's local space, then test rect/rounded-rect/ellipse analytically; for paths use `Path2D.isPointInPath` (Canvas2D) or Skia `SkPath::contains`; for strokes use stroke-distance test (distance to path <= weight/2 for center align), text via per-line rects. Respect selection scope rules, locked/hidden, clip (a child is only hit within its clipping ancestors' bounds), masks.
2. **GPU color picking**: render ids to an offscreen buffer. Exact for any effect but costs an extra pass, inaccurate with clipping/zoom and needs readback; poor for marquee. Not recommended as primary.
3. **DOM/SVG events (Penpot legacy)**: free hit testing but ties you to DOM scale limits.
Marquee: rect query on the spatial index, then exact geometry intersection only if needed (Figma selects on bounding intersection for most shapes [K]).
Cache world bounds with dirty propagation; update the index incrementally on transform changes.

## 4. Options for an Electron app

| Option | Pros | Cons |
|---|---|---|
| **Canvas2D** | Simplest, ships in Chromium, Path2D, filters (`ctx.filter` blur), blend modes via `globalCompositeOperation`, text via `fillText`. Good to ~5-10k simple nodes with culling and caching | CPU-ish raster (Chromium may GPU-accelerate it), limited blur/shadow quality, no mesh gradients (angular/diamond need workaround), text layout dependent on browser; scaling to 100k nodes needs tiling/caching |
| **WebGL/WebGPU custom engine** | Max performance, full control, Figma-like. WebGPU available in modern Electron (Chromium) | Huge effort: path tessellation or SDF, strokes, boolean, blurs, blend modes, text shaping |
| **CanvasKit (Skia wasm)** (`canvaskit-wasm`) | Skia quality: paths with all joins/caps/dash, path ops (boolean ops built in via `PathOp`), blend modes, runtime shaders (SkSL), blur/backdrop filters, image filters, text shaping with Paragraph API + custom fonts, SVG export (note: the stock `canvaskit-wasm` build does **not** include SkPDF — PDF needs a custom build or separate exporter), pathops/simplify, GPU via WebGL. Same engine Penpot and Flutter web use; Open Pencil does direct TS->CanvasKit full-viewport redraw | wasm size (~6-7MB, fine offline), GL context management, JS<->wasm marshalling, lacks WebGPU backend by default, memory management of Skia objects (`delete()`) |
| **Native Skia via Node addon (`skia-canvas`, Rust skia-safe in Electron main/utility via N-API)** | No wasm limits, can render headless | Can't draw into the renderer's canvas efficiently without shared textures/offscreen; complex packaging |

### Recommendation
1. **Primary renderer: CanvasKit (Skia wasm) on a WebGL surface** in the Electron renderer, with a **retained scene graph** in TS (flat node map) and a **render-list cache** (Picture recording per container/node, `SkPicture`), plus **viewport culling** via the spatial index. Start with full-viewport redraw each frame (fast enough for typical files, as the Open Pencil comparison argues) and add tile/picture caching and a low-res fallback during zoom/pan only when profiling demands it. Skia also gives you boolean path ops, SVG export, and text shaping, which are the hardest items to build.
2. Keep renderer behind an interface (`Renderer.render(sceneSnapshot, viewport, overlays)`, `exportNode(...)`) so a **Canvas2D backend** can serve as a fallback / test backend and a **headless CanvasKit** (Node) can power exports and AI screenshot generation (CanvasKit runs in Node with `canvaskit-wasm` and software surfaces).
3. Render **UI overlays** (selection handles, snapping guides, rulers, measurement lines, text caret) on a **separate 2D canvas or SVG/DOM layer** above the scene, in screen space (crisp at any zoom); DOM for handles gives easy cursor/pointer handling.
4. **Text**: use CanvasKit's Paragraph (HarfBuzz+ICU) with bundled/embedded fonts for deterministic layout; keep an own text-measure cache per node for auto layout HUG; store glyph/line rects like Penpot's `position-data` to drive selection and caret.
5. **Precision**: store transforms as float64 in the model; render with float32 in view space (apply camera in the model-view matrix). Beyond ~1e5 world units use camera-relative coordinates to avoid jitter.
6. **Blend/compositing**: honor `PASS_THROUGH` by drawing children directly; isolate with `saveLayer` for opacity/blend/mask/effects on groups; masks via `saveLayer` + `DstIn`/`SrcIn` blend; background blur via `saveLayer` with backdrop filter (as Penpot did).
7. **Images**: decode to `SkImage` on demand with mip levels, LRU cache keyed by `imageHash`; progressive placeholder.
8. **Performance targets**: 60fps pan/zoom at 10k visible nodes; hit test < 1ms with R-tree; frame time-slicing: process edits before paints; use `requestAnimationFrame` coalescing and dirty rectangles optional.
9. **Future**: if CanvasKit becomes a bottleneck, adopt a WebGPU backend (Skia Graphite) or a Rust render core à la Penpot behind the same interface.
