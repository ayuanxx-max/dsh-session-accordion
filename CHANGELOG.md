# Changelog · 更新记录

All notable changes to **DSH 会话交互折叠功能 / DSH Session Turn Accordion**.

## 3.0.0-live（本地真机验证，2026-11-17）

本地装进 profile（`link:` 直连仓库）后在真实 React 聊天流里逐项核对，发现并修掉 3 个只有真机才暴露的问题：

1. **📌 钉住按钮被 React 抹掉**：按钮原先 append 到 `[data-chat-turn]` 行内，聊天流每次重渲染都会删掉这个外来子节点，
   所以真机上根本看不到 📌。改为 `#dsh-ac-pinlayer` 固定层（`position:fixed` + `pointer-events:none`，按钮自身 `auto`），
   每轮 `apply()` 里按行 `getBoundingClientRect()` 重定位、按 turn id 复用与回收。
2. **分叉徽标取不到干净标题**：侧栏行文本含「进行中 / 8分钟」等噪声，徽标写成「↳ 分叉 · L1 · 进行中DSH会话交互折叠功能8分钟」。
   改为优先用 `document.title` 去掉产品后缀；侧栏没有 active 标记时用标题匹配兜底识别当前会话。
3. **搜索框压在标题栏上**：`top:14px` 在无边框窗口里盖住窗口按钮区，改到 `top:44px`。

同时把折叠行文本右内边距从 28px 调到 56px，避免一行摘要与 📌/箭头挤在一起。

真机核对结论（截图 `docs/live/`）：日期头「今天」✓、📌 钉住按钮✓、`↳ 分叉 · L1 · <会话名>` 徽标✓、
hover 预览气泡（时间 + 正文 + “点击展开”）✓、Ctrl+Shift+F 搜索条✓、仅最新一轮展开✓。
回归：11 个场景 harness 全绿；`tools/check.ps1` PASS。

## 3.0.0-draft（本地，未发布）— 六大特性 + 三处残留修复

> 未执行 `发布 x.x.x` 口令，本段只记录本地改动；版本号仍是 2.5.9，发布时再 bump。

### 四、残留问题（先修）
- **dispose**：`ctx.effect` 注册清理，卸载/热重载时清 interval、MutationObserver、三个 document 监听与预览气泡。
- **多面板选流**：`findFlow()` 改为「有可见行优先，其次条数最多」，分屏/浮窗不再选错聊天流。
- **内核兜底可关**：`guard` 开关可禁用 withdraw 补丁，异常仍只 warn，结构认不出就不动作。

### A 时间线
- 日期分组吸头（今天 / 昨天 / MM-DD），跨天自动分段；只有时分的旧轮归入「更早」，不编造日期。
- 折叠行左侧竖向连接线，hover 出预览气泡（时间 + 首段正文 + 「点击展开」）。

### B 会话记忆 + 钉住
- 点击行尾 📌 钉住：新消息到达时该轮保持展开；再点一次解除。
- 每个会话记住展开项与钉住项（`localStorage['dsh-ac-mem:<会话键>']`），切回来恢复；会话键 = 侧边栏标题 + 首轮文本哈希。

### C 搜索过滤
- `Ctrl/Cmd+Shift+F` 打开搜索条，只过滤折叠行；`Enter` 跳到下一个命中并展开，`Esc` 还原。

### E fork-tree 联动
- 当前会话是分叉时，聊天流顶部显示 `↳ 分叉 · L<深度> · <标题>` 徽标；点击不干扰树形侧栏。

### F 稳定性
- 行级增量渲染：签名不变整行跳过，`__acDebug.stats` 可查 passes/rows/skipped/writes。
- 时间戳按「元素 + 原生时钟文本」缓存，避免每帧沿 fiber 回溯。

### G 主题 / 无障碍 / 双语
- 中文/英文界面文案（`i18n: auto|zh|en`）；折叠行 `aria-label`、`aria-expanded`、钉住按钮 `aria-pressed`。
- `j`/`k` 上下移动焦点、`Esc` 全部收起、`aria-live` 播报展开/收起。
- 浅色主题（系统深浅色 + `theme: light|dark` 强制）。

### 一键回滚（任一特性都能单独关掉，不影响其余）
`localStorage['dsh-ac-config'] = {"timeline":false}` 或运行时 `__acConfig({timeline:false})`；
恢复默认 `__acConfig({timeline:true})`，彻底重置 `localStorage.removeItem('dsh-ac-config')`。

| 特性 | 开关 | 关闭后 |
| --- | --- | --- |
| 时间线/预览 | `timeline` | 无日期分组与预览气泡，折叠行为不变 |
| 钉住 | `pin` | 隐藏 📌 按钮，已钉住的轮次按普通轮次折叠 |
| 会话记忆 | `memory` | 不再读写 localStorage，每次打开只展开最新 |
| 搜索 | `search` | 快捷键不响应，无搜索条 |
| 分叉徽标 | `forkchip` | 不显示顶部徽标 |
| 增量渲染 | `incremental` | 每帧重写全部行（旧行为，性能略降） |
| 内核兜底 | `guard` | 不装 withdraw 补丁 |
| 主题 | `theme` | `light`/`dark` 强制，`auto` 跟随系统 |
| 文案 | `i18n` | `zh`/`en` 强制，`auto` 跟随浏览器 |

## Unreleased — 代码复核（2026-11-03 之后）

- 折叠行摘要缓存改为按原文比对：同一轮文本等长替换（流式/编辑）不再残留旧摘要。
- 会话切换改为「行节点整批失联」判定：turnId 重号的两个会话不再互相沿用展开态。
- 原生时间文本归一化：完整日期压成 `MM-DD HH:mm`，只有时分就只显示时分，不再用今天日期冒充旧轮日期。
- `fmtTime` 秒/毫秒判据从 `1e12` 放宽到 `1e11`：2001 年前的毫秒时间戳不再被当作秒。
- 折叠行补 `role=button` / `tabindex=0` / `aria-expanded`，支持 Enter/Space 展开（键盘可达）。
- 属性写入去重（同值不重复 setAttribute），降低每帧样式失效范围。
- 新增回归场景 `verify/scenarios/regression.json`（5 条断言），四场景全绿、`worstFrameMs 16.8`。

## 2.5.9 — 2026-11-04

- 修复「加载更早」失效：长 / 压缩会话点到第 3–4 页后，会话视图重建抛 `conversation Definition "system-message" withdrew materialized target "chat"`；该异常被订阅通知层吞掉，快照不再发布 → 画面停在旧内容，按钮看起来点不动。
- 兜底方式：插件包住 `system-message` / `request-prompt` 两个 Definition 的 `buildViewNode`——原实现返回 null 且该 context 已有 `chat` 节点时，返回同一 key 并标 `visibility:"hidden"`（正是内核错误信息要求的写法，也是核心 assistant-message Definition 的同款处理）；从未物化过节点的 context 仍返回 null，内核恢复返回真节点时立即恢复可见。
- `apply(ctx)` 现在接收 ctx；自检入口 `window.__acWithdrawGuard` → `{ installed, hits, active }`。结构认不出就完全不动作，异常只 warn。
- Fix "Load earlier" going dead after three or four pages on long compacted sessions: guard the conversation rebuild against a Definition withdrawing an already materialized Chat node (hidden instead of null). Diagnostics: `window.__acWithdrawGuard`.

## 2.5.8 — 2026-11-03

- 2.5.7 在 npm 上被以"staged"（延迟 2FA 证明）形式占用，无法覆盖发布；改用 2.5.8 发布同一份代码。
- 2.5.7 was occupied by an npm staged publish, so the same code ships as 2.5.8.

## 2.5.7 — 2026-11-03

- 版本号跳过 2.5.6：npm 上的 `dsh-session-accordion@2.5.6` 发布于 2026-11-02，**不含本轮状态机修复**（`hasVisibleRow` / `hiddenSince` 均不存在），属同名不同物。2.5.7 起以仓库当前代码为准。
- Version bump to 2.5.7 because the npm `2.5.6` tarball was published on 2026-11-02 without this round's state-machine fixes.

## 2.5.6 — 2026-11-03

- 修复可见性探针：改为「任意一行有盒子即视为可见」，不再因为首行被折叠/虚拟化而误判视图隐藏并重置状态。
- 视图隐藏与换会话解耦：隐藏时只跳过渲染、保留展开状态；隐藏超过 1.5s 后再可见才视为重新打开（回到最新一条）。
- 会话切换改用「整批替换（无交集）」判定，替代「任一历史 id 消失」——长会话虚拟化不再误触发重置。
- `dsh.client.immediately` 在 dsh 0.2.1 的 loader 中不再被解析（保留字段仅为兼容旧宿主）。
- Fix the visibility probe to accept any row with a box, so a folded or virtualized first row no longer resets state.
- Separate hidden view from session switch: hiding only skips rendering, and a >1.5 s hidden period reopens on the latest turn.
- Session switch is detected by wholesale replacement (no overlap) instead of any vanished id, so virtualization no longer resets.

## 2.5.5 — 2026-10-30

- 修复 `scripts/install.ps1` 在 PowerShell 5.1 下给 `package.json` 写入 BOM 的问题（BOM 会让 Linux/macOS 上的 node/pnpm 读不了 JSON）。
- 时间胶囊支持时区覆盖：`window.__dshAccordion = { timeZone: 'Asia/Shanghai' }`，默认仍取浏览器时区。
- 尊重 `prefers-reduced-motion`（系统"减少动态效果"），并补 `font-smoothing` 让 macOS/Linux 高分屏更清晰。
- README 增加「兼容性」矩阵：Windows / macOS / Linux(Chromium) / Linux(Firefox) 与限制说明。
- Fixed `scripts/install.ps1` writing a BOM into `package.json` under PowerShell 5.1 (a BOM breaks node/pnpm JSON reads on Linux/macOS).
- Optional time-zone override for the time pill via `window.__dshAccordion = { timeZone }`; browser zone stays the default.
- Respects `prefers-reduced-motion`; added font smoothing for macOS/Linux HiDPI.
- README gains a compatibility matrix (Windows, macOS, Linux Chromium, Linux Firefox) and its limits.

## 2.5.4 — 2026-10-30

- 客户端 loader id 由 `@local/auto-collapse` 改为 `dsh-session-accordion`，与包名一致，可按官方插件方式安装（`plugin_manager install_bundle` / `dsh plugin add`）。
- Client-half loader id now matches the package name, so the bundle installs as a normal DSH plugin.

## 2.5.3 — 2026-10-30

- Linux / macOS 兼容性：README 增加 bash 安装路径（绝对路径符号链接）、按宿主区分 `desktop` / `web` profile；卸载补充 `rm` 写法。
- 新增 `scripts/install.sh`（POSIX）与 `scripts/install.ps1`（Windows），支持 `--dry-run` / `--apply`，改 `package.json` 前先备份。
- 新增 `scripts/check.mjs` 与 GitHub Actions `ci`：在 ubuntu / macos / windows × node 20/22 上校验语法、清单、LF/BOM、`bash -n`、打包与安装冒烟。
- `package.json` 增加 `engines.node >= 18`，`files` 收录安装脚本。
- Linux/macOS compatibility: bash install path with an absolute symlink, `desktop` vs `web` profile guidance, `rm` uninstall.
- Added `scripts/install.sh` (POSIX) and `scripts/install.ps1` (Windows) with `--dry-run` / `--apply` and a package.json backup.
- Added `scripts/check.mjs` and a GitHub Actions `ci` workflow covering ubuntu, macOS and Windows on node 20/22: syntax, manifest, LF/BOM, `bash -n`, pack and install smoke tests.
- `package.json` gains `engines.node >= 18`; `files` now ships the installers.

## 2.5.2 — 2026-10-29

- 仓库更名为 `dsh-session-accordion`（kebab-case，满足 dsh.so 等市场的仓库命名规则）；`package.json` 补 `repository` / `homepage` / `bugs`。
- Renamed the repository to `dsh-session-accordion` (kebab-case, required by marketplaces such as dsh.so) and added `repository` / `homepage` / `bugs` to `package.json`.

## 2.5.1 — 2026-10-29

- 修复 2.5.0 回归：`conversation.chat.flow` 是 `display: contents` 锚点（自身没有盒子），可见性探测恒为空 → 插件整段不工作。改为用行节点的 `getClientRects()` 探测。
- Fix the 2.5.0 regression: the `conversation.chat.flow` anchor is `display: contents` (it has no box of its own), so the visibility probe always reported hidden and the plugin became a no-op. Visibility is now probed from a row node.

## 2.5.0 — 2026-10-29

- 展开态由「每条轮次各记一个布尔值」改为**全局唯一的 `expandedId`**：打开任何会话只展开最近一条。
- 会话切换 / 历史节点消失 / 新轮追加三种事件都会把展开态重置到最新一轮；此前手动展开的轮次在新交互出现时一律折叠。
- The open state is now a single global `expandedId` instead of a per-turn map: opening any session expands only the newest turn.
- Session switch, vanished history nodes and an appended new turn all re-point the open state to the latest turn; previously manual expansions fold when a new interaction starts.

## 2.4.0 — 2026-10-28

- 视觉打磨：时间胶囊（定宽 86px、tabular-nums）、摘要独立列、右侧 chevron、hover/active 状态、展开 0.16s 淡入。
- Polish: fixed-width time pill with tabular numerals, dedicated summary column, chevron affordance, hover/active states, 0.16 s fade-in on expand.

## 2.3.0 — 2026-10-28

- 折叠态改为**整行自绘**（`MM-DD HH:mm  提问摘要…`），原气泡 `visibility:hidden`，行高固定。
- 时间改从 React fiber 的 `props.node.data.time` 读取，修复「没有日期时间」。
- Folded state becomes a self-drawn single row; the original bubble is `visibility:hidden`.
- Timestamp now read from the React fiber node data, fixing the missing date/time.

## 2.2.0 — 2026-10-28

- 折叠行加时间角标（先取原生时钟文本）。
- Time badge on folded rows (native clock text first).

## 2.1.0 — 2026-10-28

- 折叠焦点改为「我的提问」气泡；展开态只显示回答正文，执行过程交还核心（回答结束后收起）。
- The folded row's focus becomes the user question bubble; expanded turns show the answer only, and the process folds natively on completion.

## 2.0.0 — 2026-10-28

- 重写为整轮手风琴：每轮按 `data-chat-turn` 分组，只保留最后一轮展开。
- Rewritten as a whole-turn accordion: turns are grouped by `data-chat-turn`, only the latest stays open.

## 1.0.0 — 2026-10-28

- 初始实验版：点击轨迹视图的「收起所有轮次」按钮。
- Initial experiment: click the trajectory view's "collapse all turns" button.
