# Render performance (#45)

Target: 60 fps pan and zoom (16.7 ms a frame) with 10k visible nodes. Decisions:

- **Cull with the spatial index.** The backend asks `SceneCulling.visibleNodes(page, viewRect)`
  (the `spatial` plugin's `SceneIndex.visible`) and draws only those nodes and their ancestors. A
  node whose ancestors are all culled is never visited. Without a culling source everything is drawn.
- **Record big page-level containers as `SkPicture`s** (`lib/renderer/pictureCache.ts`). A
  container with at least `MIN_NODES_TO_RECORD` (40) nodes is recorded once with all its
  descendants and replayed on later frames at any pan or zoom (pictures are vector). Smaller ones
  are drawn directly (cached verdict `small`). Recording runs with culling off.
- **Invalidation** is per page-level container: an edit (`set`, `add`, `del`, `move`) drops the
  recording of the container it touched, and for a move the container it left. Entity changes
  (variables, styles, assets), `reset` (page switch, document replaced, variable mode) and
  `image-ready` / `draw-hooks` frame reasons drop everything, because they can change what any
  container looks like.
- **Not built**: a low-resolution fallback while zooming (replaying pictures stays vector and was
  fast enough), dirty rectangles, nested container recordings, text and fonts (a font arriving
  must invalidate everything when #43 lands: request a frame with reason `image-ready`-style
  invalidation).
- **Time slicing**: edits are applied synchronously by `document.apply` and the renderer paints in
  the next animation frame, so an edit is always processed before the paint that shows it.

## Budgets

`src/lib/renderer/renderPerformance.test.ts` renders a generated scene
(`benchmarkScene.ts`: frames of 400 rectangles; 25 frames = 10k nodes, 250 = 100k) on CanvasKit's
CPU raster surface in Node, prints the numbers on every run and asserts budgets with headroom for
CI noise. Measured when written (1440 x 900):

| Case                                              | Measured    | Budget  |
| ------------------------------------------------- | ----------- | ------- |
| 10k visible, first frame (records 25 pictures)    | ~110-200 ms | 500 ms  |
| 10k visible, panning, replayed from pictures      | ~12-30 ms   | 50 ms   |
| 10k visible, no pictures (cleared every frame)    | ~100-180 ms | 500 ms  |
| 100k page at 100%, culled to the view             | ~6-12 ms    | 100 ms  |

CPU raster is slower than the GPU path the app uses; QA's SwiftShader numbers are not
representative either.
