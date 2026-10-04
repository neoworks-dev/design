# Brief for implementation agents

You implement a chunk of issues from `neoworks-dev/design`. Read this whole file first.

## Before writing code

1. Read `CLAUDE.md` (architecture and rules: everything is a plugin, registries + services +
   plugins, one `document.apply` mutation path, code style).
2. Load the skills `extension-system` (kernel rules) and `ui-components` (before any UI), and
   `design-debug` (running the app). Their files are in `.claude/skills/*/SKILL.md`.
3. Read each issue you're assigned: `gh issue view <n> -R neoworks-dev/design`. Read the
   design docs it references (`docs/design/data-model.md` wins over `docs/research/`).
4. `bun install` if `node_modules` is missing (you may be in a fresh git worktree; the
   `@neoworks*` packages are `link:` dependencies and resolve through bun's global links).

## While working

- Do the work yourself: **do not spawn subagents or forks.**

- Work issue by issue in dependency order. **One commit per issue** (or a few), message in
  normal prose, ending with `Closes #<n>` and the line
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit with the existing git
  identity. **Do not push** and do not merge — the orchestrator merges your branch.
- Every commit must pass `bun run check`, `bun run lint` and `bun run test`.
- Follow the kernel rules strictly: every side effect wrapped in `ctx.effect` with a label, every
  dependency in `inject`, dispose by identity, no `$state` on `Service` subclasses. Every plugin
  gets the mount / unmount / state-identical test.
- Do **not** edit the linked packages (`../extension-system`, `../combined-agent-harness-adapter`,
  `../neoworks.dev/packages/ui`, `../lint-config`). If one blocks you (bug, missing component),
  work around it locally in the smallest way, and list it in your final report.
- Don't widen scope: if an issue needs something from a later issue, build the minimal seam and
  note it. If an issue's text conflicts with `CLAUDE.md` or the design doc, those win; say so in
  the proof.
- Keep the app bootable at every commit (`bun run qa start` must reach ready).

## Proof — required for every issue you close

Post it with `bun run proof <issue> --body <file> [--shot <png> ...]` (run from the repo root;
it uploads screenshots to the `qa-screenshots` branch and comments via `gh bot`). Never use plain
`gh` for writes; if `gh bot` fails, stop and report it.

- **UI work:** screenshots from `bun run qa` (`--no-viewer`), cropped to what matters
  (`--crop`), showing the feature working: before/after or the states that matter (hover, open
  menu, selection). Read each screenshot yourself before posting. Plus a short text: what it
  shows and how you drove it (the qa commands).
- **Logic work:** a simple but detailed explanation: what was built (files, main types/functions),
  why it is designed that way (link the rule or design-doc section), and how it is verified (test
  names and what they assert, output of the test run summary).
- Mention deviations from the issue text, and anything left for later issues.

Body template:

```markdown
## What
...
## Why this way
...
## Verification
...
## Notes / follow-ups
...
```

## Final report (your reply to the orchestrator, under 300 words)

Issues completed (with commit hashes), issues not completed and why, workarounds for linked
packages, decisions the orchestrator should know about, and anything that will affect the next
chunk.
