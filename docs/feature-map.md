# dsh-session-accordion · 功能地图（自动生成，勿手改）

> 生成器：`tools/gen-feature-map.py`（改动代码/场景后重跑）。
> 用途：拿到一句模糊报障时，先在此定位**可观测契约**与对应的自检场景，再跑 `tools/verify-page.py`。

## 1. 概览

| 项 | 值 |
| --- | --- |
| 名称 | `dsh-session-accordion` |
| 版本 | `2.5.9` |
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

`data-ac-hidden` `data-ac-line` `data-ac-user` `data-ac-text` `data-ac-time` `data-ac-fresh` `data-chat-turn` `data-chat-flow-kind`

**页面全局（脚本可直接读）**

- `__dshAccordion`
- `__acReport`
- `__acWithdrawGuard`

**日志前缀**（抓 warn/info 时按这些过滤）

`[auto-collapse]`

## 3. 功能清单

- 平台支持与路线图
- 相关插件
- 中文
- 这是什么
- 效果
- 卸载
- 工作原理
- 诊断
- 兼容性
- 已知限制
- 同类项目
- English
- What it is
- What it looks like

## 4. 自检入口

开发页：`verify/harness.html`（桩 `__ModuleLoader__` + 假 `uiConversation`，原样加载 `client.js`，不改插件源码）。

| 场景 | 文件 | 步骤 | 断言 | 帧预算 |
| --- | --- | --- | --- | --- |
| `accordion-basic` | `verify/scenarios/basic.json` | 1 | no-harness-errors, guard-installed, line-contract, only-newest-expanded, click-toggle, new-turn-folds-previous, report-api | - |
| `scroll-jank` | `verify/scenarios/scroll-jank.json` | 3 | only-newest-expanded, line-contract | {"maxWorstFrameMs": 250, "maxLongTaskWorstMs": 250} |
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

