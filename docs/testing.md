# Testing plugins

`bun run test` runs vitest. Files that use runes (`$state`, `$effect`) must be named
`*.svelte.test.ts`; the global environment is happy-dom so Svelte compiles for the client.

## The standard plugin test

Every plugin gets the same case: mount it, assert its contribution, dispose it, assert that
observable state equals what it was before mounting. `src/lib/kernel/testing.ts` provides it:

```ts
import { describePlugin } from '../../lib/kernel/testing';
import plugin from './index';

describePlugin('my-plugin', plugin, {
	providers: [coreRegions], // plugins mounted first (what `inject` needs)
	desktop: true, // optional fake window.desktop for renderer plugins
	contributes: ({ ctx }) => {
		expect(ctx.regions.get('my-plugin/panel')).toBeDefined();
	}
});
```

`describePlugin` also asserts that `plugin.name` equals the first argument and that `inject` is
declared. For custom cases use `mountPlugin(plugin, options)`, which returns
`{ ctx, fiber, snapshot, currentState(), assertUnmountsClean(), cleanup() }`.

## What the snapshot covers

`snapshotState(ctx)`: ids of every registry held by a provided service (a service exposes a
registry by keeping it in a plain field), kernel event listener counts, the labelled effect tree
of the root fiber, DOM listeners on `window`/`document` that are still attached, pending timers,
and handlers of a `FakeIpcMain`. A service with other observable state can implement
`snapshotState()` and it is included.

A plugin that leaks (a registry entry without `ctx.effect`, a raw `addEventListener`, an
uncleared interval, an effect attached through the wrong `ctx`) makes `assertUnmountsClean` throw;
`testing.test.ts` has a negative test for each.

## Main plugins

Main-kernel plugins are plugins on a `Context` like renderer ones. Pass a `FakeIpcMain` as
`ipcMain` and register handlers on it inside `ctx.effect` (`handle` with `removeHandler` as the
inverse); its handlers are part of the snapshot.
