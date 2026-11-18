# dsh-session-accordion · 功能地图（自动生成，勿手改）

> 生成器：`tools/gen-feature-map.py`（改动代码/场景后重跑）。
> 用途：拿到一句模糊报障时，先在此定位**可观测契约**与对应的自检场景，再跑 `tools/verify-page.py`。

## 1. 概览

| 项 | 值 |
| --- | --- |
| 名称 | `dsh-session-accordion` |
| 版本 | `3.1.0` |
| 说明 | DSH Web chat turn accordion: every interaction folds into one line, only the newest turn opens, and session switches or new turns reset the open state. |
| 入口 | `./index.js`, `./client.js` |
| DSH 形态 | {"bundle": {"patch": "./cordis.patch.yml"}, "client": {"platform": "web", "immediately": true, "inject": []}} |
| 发布文件白名单 | `index.js`, `client.js`, `cordis.patch.yml`, `README.md`, `LICENSE`, `scripts/install.sh`, `scripts/install.ps1`, `scripts/check.mjs` |

## 2. 可观测契约（写断言就看这里）

**挂载点 / slot**

- `[data-slot="conversation.chat.flow"]`

**会话流 DOM**

- 轮次容器：`[data-chat-turn="<id>"]`（同一 id 的过程节点与用户气泡是**兄弟节点**，不是 wrapper）
- 过程节点标记：`data-chat-flow-kind="turn-process"`

**插件写入的属性**

`data-ac-hidden` `data-ac-line` `data-ac-user` `data-ac-text` `data-ac-time` `data-ac-fresh` `data-ac-pinned` `data-ac-pinbox` `data-ac-day` `data-ac-filtered` `data-ac-hit` `data-ac-theme` `data-chat-turn` `data-chat-flow-kind` `data-active` `data-ft-depth` `data-session-id` `data-session` `data-ft-session` `data-id` `data-ac-pos` `data-ac-for` `data-ac-on`

**页面全局（脚本可直接读）**

- `__acOwner`
- `__dshAccordion`
- `__acForget`
- `__acReport`
- `__acStop`
- `__acStart`
- `__acConfig`
- `__acAnnounce`
- `__acSearch`
- `__acDebug`
- `__acWithdrawGuard`

**日志前缀**（抓 warn/info 时按这些过滤）

`[auto-collapse]`

## 3. 功能清单

- 本次更新（3.0）· What's new in 3.0
- 本次更新功能清单（中文）
- What's new in 3.0 (English)
- 平台支持与路线图
- 相关插件
- 中文
- 这是什么
- 效果
- 功能与使用
- 卸载
- 工作原理
- 诊断
- 兼容性
- 已知限制

## 4. 自检入口

开发页：`verify/harness.html`（桩 `__ModuleLoader__` + 假 `uiConversation`，原样加载 `client.js`，不改插件源码）。

| 场景 | 文件 | 步骤 | 断言 | 帧预算 |
| --- | --- | --- | --- | --- |
| `accordion-a` | `verify/scenarios/a.json` | 0 | day-groups, hover-preview, only-newest-fresh, line-contract | - |
| `accordion-b` | `verify/scenarios/b.json` | 0 | pin-toggle-keeps-open, memory-restore, only-newest-fresh, pin-geometry, pin-geometry-open, pin-containment | - |
| `accordion-basic` | `verify/scenarios/basic.json` | 1 | no-harness-errors, guard-installed, line-contract, only-newest-expanded, click-toggle, new-turn-folds-previous, report-api | - |
| `accordion-c` | `verify/scenarios/c.json` | 0 | search-filter, only-newest-fresh | - |
| `accordion-e` | `verify/scenarios/e.json` | 0 | fork-chip, only-newest-fresh | - |
| `accordion-f` | `verify/scenarios/f.json` | 0 | incremental-skip, only-newest-fresh | - |
| `accordion-find-entry` | `verify/scenarios/find-entry.json` | 1 | find-on-composer, find-only-on-session, stop-clears-chrome | - |
| `accordion-g` | `verify/scenarios/g.json` | 0 | a11y-i18n-theme, keyboard-j-esc, only-newest-fresh | - |
| `accordion-p0` | `verify/scenarios/p0.json` | 0 | config-api, lifecycle-stop-start, multi-flow-select, only-newest-fresh | - |
| `perf-scroll-stream` | `verify/scenarios/perf-scroll-stream.json` | 4 | line-contract, only-newest-expanded, no-scroll-writes, no-harness-errors | {"maxWorstFrameMs": 60, "maxLongTaskWorstMs": 120} |
| `accordion-phase2` | `verify/scenarios/phase2.json` | 1 | search-stale, stop-restores | - |
| `accordion-phase3` | `verify/scenarios/phase3.json` | 1 | idle-skip, poison-row, stop-clears-chrome | - |
| `accordion-regression` | `verify/scenarios/regression.json` | 0 | same-length-summary, expand-survives-rerender, session-switch-colliding-ids, stamp-from-native-clock, keyboard-toggle, fmt-old-ms | - |
| `scroll-jank` | `verify/scenarios/scroll-jank.json` | 3 | no-scroll-writes, only-newest-expanded, line-contract, pin-scroll-geometry, scroll-stability, scroll-up-keeps-expansion, identity-stable | {"maxWorstFrameMs": 250, "maxLongTaskWorstMs": 250} |
| `accordion-session-switch` | `verify/scenarios/session-switch.json` | 1 | switch-from-1-turn, only-newest-expanded | - |
| `stream-storm` | `verify/scenarios/stream-storm.json` | 3 | line-contract, only-newest-expanded, no-harness-errors | {"maxWorstFrameMs": 250, "maxLongTaskWorstMs": 250} |

跑法（一条命令，约 1–3 s）：

```powershell
& "$env:USERPROFILE\.openviking\venv\Scripts\python.exe" "$env:USERPROFILE\.dsh\tools\verify-page.py" `
  --root "E:\DSH.Jack.01\dsh-session-accordion" --page verify/harness.html `
  --scenario "E:\DSH.Jack.01\dsh-session-accordion\verify\scenarios\basic.json" --out "E:\DSH.Jack.01\dsh-session-accordion\reports\basic"
```

报告字段：`ok`（总判）、`checks[].detail`（失败原因）、`metrics`（`worstFrameMs` / `p95FrameMs` / `longTaskWorstMs`）、`console`、`pageErrors`。失败会自动落 `shot-<check>.png`。

## 5. 不变量与风险

- 只在结构认得出时动作；异常只 `warn`，不抛。
- 不改内核配置、不碰 `app.asar`、不改会话文件。
- `verify/` 与 `reports/` 不进发布包（`package.json` 的 `files` 白名单未包含）。
- 每条断言都必须能在开发页上失败一次，再修到通过——否则它不叫自检。

