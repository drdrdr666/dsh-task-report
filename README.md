# dsh-task-report

Keep a durable record for one DSH task: what was done and how it was verified, what was touched, what the user still has to do, what stayed unverified, and a closing summary of value.

The record lives in the workspace at `.dsh-task/<slug>.md` — it survives the session, can be committed, and reads back in any later session.

## Why

A finished task usually leaves its most important facts in the conversation body. Once the session ends, those are gone. This plugin gives them a fixed structure and a file — and makes closing a **gate** instead of a formality.

## Two gates at closing

### 1. Content you must state explicitly

- goal, at least one done item **with evidence**
- `value.did` / `value.helped`
- `userActions` and `unverified` (empty arrays accepted, silence is not)
- `sideEffects` structure
- **`coverage.covered` / `coverage.uncovered`** — saying "tests pass" requires saying what they did *not* cover

### 2. Environment leftovers, scanned automatically

| check | what went wrong before |
|---|---|
| leftover credential files (`.gh-token`, …) | five tokens generated, one left on disk |
| ports still listening (9333 / 9222 / 8899) | a debug port lets any local process drive the browser |
| hard-coded stale accounts or copy | reusing a script dragged another project's text in |

These come back as `副作用自检：…` alongside the content check.

## Install

```bash
pnpm add git+https://github.com/drdrdr666/dsh-task-report.git
```

Then add `dsh-task-report` to the profile bundle list.

## Tool

`task_report` with `action`: `open` | `update` | `close` | `show` | `list`.

```
task_report(action:"open", slug:"my-task", goal:"what the user asked for")

task_report(action:"update", patch:{
  phase:"implementing",
  done:[{what:"fixed X", evidence:"node tests/run.mjs — 6 groups pass"}],
  coverage:{ covered:["unit tests","real-image regression"], uncovered:["clean-env install"] },
  sideEffects:{ processes:["started local proxy 8899, closed"] }
})

task_report(action:"close", patch:{
  userActions:[{action:"restart the host", why:"old code still loaded", ifNot:"fix has no effect"}],
  unverified:["install path not exercised in a clean environment"],
  value:{did:"…", helped:"…", reuse:["tools/xxx.mjs is reusable"]},
  sideEffects:{files:["added lib/x.js"]}
})
```

## Record structure

1. Goal
2. Done (every item carries evidence)
3. In progress
4. Blocked (reason / tried / who must act)
5. User actions (action / why / what happens if skipped)
6. Side effects
7. Unverified and known limits (including covered / uncovered scope)
8. Decisions
9. Value summary
10. Next entry point

Side effects are split into five buckets because each is forgotten differently: files, system settings, processes and ports, external accounts, credentials.

## Limitations

- Stored per workspace, not in the session log.
- No automatic capture: side effects, todos and evidence must be recorded through `update`.
- The environment scan looks at the workspace and local ports only.
- `done[].evidence` is free text; the plugin does not verify it.

## License

MIT
