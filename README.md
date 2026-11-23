# dsh-task-report

Keep a durable task record for DSH work: what was done and how it was verified, what the agent touched, what the user still has to do, what stayed unverified, and a closing summary of value.

The record lives in the workspace at `.dsh-task/<slug>.md` — it survives the session, can be committed, and reads back in any later session.

## Why

A finished task usually leaves its most important facts in the conversation body: progress, side effects, open items. Once the session ends, those are gone. This plugin gives them a fixed structure and a file.

## Install

```bash
pnpm add git+https://github.com/drdrdr666/dsh-task-report.git
```

Then add `dsh-task-report` to the profile bundle list.

## Tool

`task_report` with `action`: `open` | `update` | `close` | `show` | `list`.

`close` refuses to finish while any required section is missing — including "待用户操作" and "未验证项", which must be passed explicitly even when empty.

## Record structure

目标 / 已完成（含证据）/ 进行中 / 阻塞 / 待用户操作 / 副作用清单 / 未验证与已知限制 / 决策记录 / 价值收口 / 下次入口

Side effects are split into five buckets: files, system settings, processes and ports, external accounts, credentials.

## Limitations

- Stored per workspace, not in the session log.
- No automatic capture: side effects, todos and evidence must be recorded through `update`.
- `done[].evidence` is free text; the plugin does not verify it.

## License

MIT
