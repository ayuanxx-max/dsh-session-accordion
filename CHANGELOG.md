# Changelog · 更新记录

## 3.0.0-live 修订 7（换掉会触发跳屏的界面调用方式，2026-11-17）

反馈：**还是跳，换掉现有的界面修改调用方式（容易触发跳屏幕的方式）**。

这一版改的是"怎么改界面"，不是再叠一层补丁：

| 之前的做法 | 为什么容易跳 | 现在 |
| --- | --- | --- |
| `overflow-anchor: none` 禁用浏览器滚动锚定，指望自己算 | 高度一变，浏览器既不帮你钉住视口，自己算的补偿又常常没生效 | 改回 `overflow-anchor: auto`，让浏览器负责把视口钉在锚点节点上 |
| 锚点补偿用 `scrollWatchedHost`（滚轮事件落点上找的容器） | 滚轮事件常被合并/丢失，这个容器经常是 `null` 或错的 → `ANC=0`，补偿形同不存在 | 新增 `chatScrollerFor(flow)`：从**当前真实的一行**向上找可滚容器，`isConnected` 校验后才缓存 |
| 每次 mutation 都跑一遍日期头/分叉徽标的增删 | 这两件事会插入/移除 30px 的节点，属于"改布局"，流式期间每秒几十次机会顶动视口 | 新增**布局签名** `layoutSignature(rendered, pinnedIds)`：展开目标、日期分组、钉住集合都没变，就完全不碰这些布局节点 |
| 滚动静默期 | 停手 160ms 就恢复写入，正好落在减速尾巴上改布局 | 仍是 **160ms**（试过 320ms：连点折叠都要等，手感变迟钝，实测断言也红），但静默期内**只放行钉住图标**（绝对定位覆盖层，不影响任何行位置），其余一律推迟到停手后 |

保留的能力（没有因为"少改"而丢）：折叠/展开、只展开最新一条、钉住常开、预览卡、搜索、日期头、键盘操作、记忆恢复。

自动化测量的边界（写在前面，避免再给你一个"我测了不跳"的空承诺）：

- 用 42 帧（约 5.4 s）连续截图 + 1D 行剖面互相关测滚动位移，最大单步位移与轮子档位一致，没有发现跳变；HUD 里 `H=0`（apply 从未改变 `scrollHeight`）、`ANC=0`（没有高度变化需要抵账）。
- 也就是说：**在我这套自动滚动里复现不出来**。如果仍跳，最有效的定位是打开 HUD（控制台 `localStorage['dsh-ac-debug']='1'` 后「重新加载界面」），滚到跳的那一刻，把左下角 `FLIP / JUMP / RESET / H / ANC` 那几行发我。
- 想立刻排除插件因素：`__acConfig({timeline:false})` 关折叠、`__acConfig({pin:false})` 关钉住，两个都关还跳就说明是应用自身（React 流式到底跟随 / 虚拟滚动卸载）。

验证：11 场景 / 43 断言全绿；`tools\check.ps1` = `RESULT: PASS (13 checks)`。

## 3.0.0-live 修订 6（乱跳/乱打开的第四个真根因，📌 隔 1 字符、提示随系统语言，2026-11-17）

反馈仍然是：**鼠标滚动上下时还是会上下乱跳，并乱打开**；另外要求 📌 与文字只隔 **1** 个字符、悬停提示文字**跟随系统语言**。

这次不再靠"截图两帧对比"猜，而是给插件装了计数 HUD，在真机（Electron DSH NEXT 1098×1240）上跑同一段滚动，读出真实数据：

```text
mut=130 A=19 Ascroll=0 W=52 RESET=0 Rflow=0 Rempty=1 NOVIS=0 PV=0/0 flip=2 dh=0 H=0
（修前：40 秒内 A=26 却有 RESET=613，即 613 次 apply 走了"提前返回 + 清空折叠状态"的分支）
FLIP 43 -> 39   ← 用户没点任何东西，展开目标自己变了
JUMP 3235 -> 466（−2769px，紧跟在 FLIP 后 35ms）
```

四个根因（前面几版都在打外围）：

| # | 根因 | 为什么会导致"乱跳 + 乱打开" | 修法 |
| --- | --- | --- | --- |
| 1 | `MutationObserver` 挂在 `document.documentElement` 的整个子树，apply 自己写 DOM（钉住层、日期头）又触发 observer → 自触发循环 | 每秒几十次 apply，其中大量在"容器瞬时空"的分支里跑 | observer 只认**聊天区**里的变化，并且忽略插件自己写的节点（`#dsh-ac-dbg`/`.dsh-ac-pinlayer`/`.dsh-ac-preview`/日期头）；实测 `mut` 从 600+/40s 降到 ~130 |
| 2 | 容器一瞬为空就 `resetState()`，`trackExpanded` 里 `prev.length === 0` 也直接"展开最新一条" | 用户正看着的轮次被折掉、换成最新一条 → 视口上方内容高度骤变 → **上下跳**；看起来就是"自己打开了一条" | 空态只清缓存（`dropSeen`），不再丢 `expandedId`/钉住状态；首次渲染只在"确实还没有展开目标"时才选最新 |
| 3 | 用"上一轮的 DOM 节点是否还在 flow 里"判断是否换了会话 | 流式渲染时 React 会把行整批重建，旧节点集体消失 → 误判换会话 → 又折掉当前轮次 | 换会话改用 `sessionKey`；id 层面只认"无交集"与"追加"；`isChopTail` 只在**静止**时生效（虚拟卸载也会掐掉尾部，滚动中不能当换会话） |
| 4 | 折叠/展开改变高度 + 浏览器滚动锚定 | 浏览器自己挪 `scrollTop`，表现为滚动中突然蹦一屏 | ① 滚动容器设 `overflow-anchor: none`；② 自己实现视口锚定：以"这次不会被改动的第一条可见行"为锚点，用 `scrollTop` 抵消高度变化（贴底不补偿，避免抢"跟随最新"） |

顺带：

- 📌 与文字间距 **2 字符 → 1 字符**（`pinAnchor` 里 `chWidthOf(font) * 1`；气泡内左侧内缩同步改为 `PIN_HALF*2 + 1ch + 4`，保持一致），折叠行仍居中、仍不越出气泡右边界。
- 悬停提示/预览文字**跟随系统语言**：`CFG.i18n` → `documentElement.lang` → `body.lang` → `navigator.language` → `navigator.userLanguage`，并监听 `languagechange` 后立即 `apply(true)` 重绘。
- 滚轮/滚动落点向上找**真正在滚**的容器（`adoptScroller`）再挂监听：之前挂错层，静默期经常根本没进。
- 新增回归断言 `expand-survives-rerender`：同 id 整批重建（= React 重渲染）后，用户手动展开的那一条必须还是它（这条用例能直接挡住根因 3 复发）。

验证：

- 11 场景 / **43 断言全绿**（新增 `expand-survives-rerender`）。
- 真机重载后连点 加载更早 ×3、慢速上滚 6 档再下滚 6 档：`flip` 不再增长、`PV=0`（滚动中不弹预览）、`Ascroll=0`（静默期内不 apply）、`H=0`（apply 不改变 `scrollHeight`）。
- `tools\check.ps1` = `RESULT: PASS (13 checks)`。

诚实边界：滚动"跳"有一部分来自应用自身（流式自动跟到底是 DSH 行为、虚拟滚动会卸载行）。这版保证的是**插件不再改展开目标、不再改高度、不再自触发重排**；若还看到跳，可 `localStorage['dsh-ac-debug']='1'` 后「重新加载界面」，左下角会显示上面那行计数，把 `FLIP/JUMP/RESET` 的读数发我即可定位到具体机制。

回滚：`git revert <本提交>`；只想关预览：`localStorage['dsh-ac-config']` 设 `{"timeline":false}`；想关钉住：`__acConfig({pin:false})`。

## 3.0.0-live 修订 5（滚动不再上下跳 / 滚过去的行不再弹"预览会话"，2026-11-17）

真机反馈：**鼠标滚动上下时还是会上下乱跳，并在乱跳后打开一个鼠标指针停留的会话**。

两个独立根因，都已修：

| # | 根因 | 现象 | 修法 |
| --- | --- | --- | --- |
| 1 | 应用里有持续 mutation（流式"用时 X"每秒更新），每次 mutation 都触发 apply；apply 会重排时间线日期头（插/删 30px），`insertBefore` 遇到 React 刚摘掉的行还会抛 `NotFoundError`，apply 半途中断（半边折叠、标题缺失） | 滚动中视口被反复顶得上下跳 | ① 滚动/滚轮期间进入 160ms 静默期，静默期内**推迟 apply**（用户主动点击/搜索仍 `apply(true)` 立即生效）；② 日期头**只在"后面没有行"时才删**，rendered 暂时不完整不删；③ `insertBefore` 前先确认目标行仍在 flow 里 |
| 2 | 预览气泡挂在 `mouseover` 上；滚轮让折叠行从静止指针下滑过也会触发 `mouseover` | 一滚动就从指针位置"打开一个会话"（其实是预览卡片） | ① 滚动中/静默期内 `mouseover` 直接不弹并隐藏；② 悬停 **160ms 驻留**后才弹；③ 指针离开立即取消待弹定时器 |

顺带加固：

- 📌 内缩 `--dsh-ac-pinpad` 的字符宽改为「优先展开行、退化取任意用户气泡」，避免"没有展开行→撤内缩→文字回流"造成的跳动。
- 新增断言 `scroll-stability`：连续 8 次滚轮/滚动过程中，折叠行数、日期头数量、`flow.scrollHeight` 必须**完全不变**；滚动中悬停折叠行**不得**弹预览，停稳后悬停仍要弹（能力不丢）。

验证：

- 11 场景 / **42 断言全绿**（`scroll-jank` 现含 `pin-scroll-geometry` + `scroll-stability`）。
- 真机（Electron DSH NEXT，pid 27192，窗口 1098×1240）：加载更早 ×3 后，滚轮上滚 11 步再下滚 11 步，截图逐像素比对 **shift = 0 / 平均误差 = 0.00** —— 视图完全回到原位置，无累积漂移、无跳变；滚动过程中没有预览卡片弹出。
- `tools\check.ps1` = `RESULT: PASS (13 checks)`。

回滚：`git revert <本提交>`；只想关预览：`localStorage['dsh-ac-config']` 设 `{"timeline":false}`；想关钉住：`__acConfig({pin:false})`。

## 3.0.0-live 修订 4（📌 画进文本框内部 + 全状态包含性断言，2026-11-17）

真机反馈：**📌 放到文本框里面，其它逻辑不变**。

做法（只改"落点所在的空间"，不改位置公式）：

| 项 | 旧 | 新 |
| --- | --- | --- |
| 展开行 📌 所在空间 | 气泡**外面**的空白区（与气泡边距无关） | 气泡**内部**：开启钉住时给用户气泡加左侧内缩 `--dsh-ac-pinpad = 22 + 2×字符宽 + 4`（`!important`，只作用 `[data-ac-pinbox="1"]` 下的 `_bubble`） |
| 位置公式 | `x = 首字左 − 2ch − 半个按钮` | **不变**（内缩把文字右移，公式自然落在气泡内的留白里） |
| 折叠行 | 摘要文字末尾 + 2ch（本来就在文本框内） | 不变 |
| 关闭钉住 | — | 移除 `data-ac-pinbox` 与变量，气泡内缩回到 0，不留痕迹 |

同时继续排查并加固：

- 新增断言 `pin-containment`：逐行检查每个 📌 是否落在"自己的文本框"内（折叠行=行矩形，展开行=气泡矩形），中途展开中间一轮再查一次 → 6/6 通过、0 越界。
- 新增断言 `pin-scroll-geometry`（修订 3 起，本轮并入全量）：7 段滚动、119 个 📌 相对行的漂移 **0.00px**。
- 断言 `pin-geometry-open` 增加"必须在气泡内"的硬条件（`br.left >= bubble.left`）。
- 复核过的状态：折叠 / 展开 / 钉住（📌）/ 解除 / 记忆恢复 / 仅最新展开 / 搜索过滤（隐藏行不画）/ 滚动 / 流式追加 / 关闭 `pin` 开关。

验证：11 场景 / **41 断言全绿**；`tools\check.ps1` = `RESULT: PASS (13 checks)`；真机重新加载后 📌 位于气泡内、首字前 2 字符（截图 `docs/live/3.0-pin-inbox.png`）。

回滚：`git revert <本提交>`；运行时 `__acConfig({pin:false})`（内缩随开关一起消失）。

## 3.0.0-live 修订 3（钉住：展开行改到正文首字前 / 滚动零漂移，2026-11-17）

真机反馈：**屏幕位置乱跳**、**打开折叠后 📌 错位**。同时按新标准改展开行落点：

| 项 | 旧行为 | 新行为 |
| --- | --- | --- |
| 展开行落点 | 气泡**右缘** + 2 字符，整块垂直中心（长消息时中心跑到正文中部） | **正文第一个字符前方 2 字符**，垂直对齐**这一行文字**（`Range` 取首个可见字符，不靠估算） |
| 间距口径 | “隔两个字符”按按钮中心算，实际视觉间隙只有约 4px | 按**图标边缘到文字**算：`半个按钮宽 + 2 字符`（约 15px 间隙），折叠行与展开行同一口径 |
| 折叠行落点 | 写死 `row.left + 104`、`row.right - 62` | 内缩改从 `::after` 的 `left/right` 计算值读（CSS 改了自动跟），偏移量仍 +2 字符 |
| 滚动时"乱跳" | 只给视口 ±160px 内的行写坐标，其余 `display:none`；滚动/流式时行进出这个窗口 → 📌 忽隐忽现 | 坐标本身就是**内容坐标系**（不随滚动变），改为每轮全量写、不再显隐；新增断言 `pin-scroll-geometry`：7 段上下滚动、119 个 📌 的 `(按钮-行)` 相对偏移最大漂移 **0.00px** |
| 渲染/点击两套公式 | `syncPins()` 与 `pinHotspot()` 各算一遍（容易只改一处） | 合并为 `pinAnchor()`：渲染与点击热区共用同一落点 |
| 延迟校正误闪 | `schedulePinFix()` 用旧行节点，行被 React 换掉时算出 0 矩形 | 先查 `rows[0].user.isConnected`，节点已换就跳过，等下一轮 apply |
| 容器识别 | 首轮在布局前可能退到 `body` 并一直用下去 | 若当前是 `body` 且能认出真正的滚动容器，升级一次（坐标每轮全量重算，切换安全） |

验证：11 场景 / **40 断言全绿**（新增 `b.pin-geometry-open`、`scroll-jank.pin-scroll-geometry`）；`tools\check.ps1` = `RESULT: PASS (13 checks)`；真机重新加载界面后 📌 钉住/解除各一次，落点不变（截图 `docs/live/3.0-pin-open.png`）。

回滚：`git revert <本提交>`；运行时 `__acConfig({pin:false})` 关钉住。

## 3.0.0-live 修订 2（钉住：位置基准 + 点击热区，2026-11-17）

真机反馈：**点钉住后 📌 错位、乱放，还有一堆贴在正文里**。三条独立根因：

| 现象 | 根因 | 改法 |
| --- | --- | --- |
| 📌 整体偏移、飘在正文里 | 钉住层挂到 `scrollHostOf(flow)`，但该容器 `position` 是 `static`，层的**包含块落到了更外层**；写坐标却按容器 `rect` 减去，基准不一致 | `pinLayer(host)` 里对非 `body` 容器补 `position:relative`（打 `data-ac-pos` 标记），层与容器共用同一基准 |
| 一有日期头/分叉徽标，整批下移约 30px | `syncPins()` 在 `applyDays()/applyForkChip()` **之前**执行，之后插入的日期头把所有行往下推 | `syncPins()` 移到 apply 末尾（最后一次改行位置的 DOM 操作之后），并加 `schedulePinFix()`：下一帧 + 120ms 各校正一次，兜住图片加载/流式增高 |
| 点 📌 没反应（个别环境点到行上） | 聊天区覆盖层吃掉按钮的 pointer 事件，`event.target` 不是按钮 | 点击判定改挂到**行本身**：`pinHotspot(rowEl, clientX, clientY)` 用与渲染同一套公式算热区（±13px），命中就切钉住；按钮自身的 `data-ac-for` 分支保留 |
| 拖动滚动掉帧 | 每轮 apply 对每行先写 `left/top` 再读下一行 rect（读写交替 → 逐行强制重排） | 改成"**先只读一批、再只写一批**"，且只给视口内（±160px）的行写坐标；层在滚动容器内，滚动本身零 JS |

验证：11 场景 / **38 断言全绿**（含 `b.pin-geometry`）；`tools\check.ps1` = `RESULT: PASS (13 checks)`；`node --check client.js` 通过；真机重新加载界面后连点 📌 复核（截图 `docs/live/3.0-pin-fix.png`）。

回滚：`git revert <本提交>`；或运行时 `__acConfig({pin:false})` 关掉钉住；`localStorage.removeItem('dsh-ac-config')` 复位配置。版本仍为本地 `3.0.0`（未 npm publish / 无 tag / 无 Release）。

## 3.0.0-live 修订（钉住按钮：性能 + 对齐，2026-11-17）

真机反馈两条：**拖动滚动严重掉帧**、**📌 位置错乱**。根因与改法：

| 问题 | 根因 | 改法 |
| --- | --- | --- |
| 滚动卡顿 | 📌 挂在 `body` 固定层，每轮 apply 都对全部行 `getBoundingClientRect()` 再写 `left/top`；滚动触发重渲染即整批重排 | 层移进 `flow` 内部（`position:absolute`，`flow` 补 `position:relative`），**随内容原生滚动**；几何按 `(turn\|文本\|行宽)` 缓存，未见结构变化不读布局也不写样式；仅用一次廉价形状快照（展开态 + 行数 + 日期头/徽标数量）判断整批失效 |
| 位置错乱 | 固定在行右缘 `rect.right-40`，与文字长度无关；展开行落到气泡外的空白处 | 折叠行：`min(文字起点+实测文字宽, 行右-62)` 再 **+2 字符**；展开行：气泡右缘 +2 字符；两者都以 `translate(-50%,-50%)` 落在 **行垂直中心**，并夹到 `行右-34` 避开 chevron |
| i18n 失效 | 只在 `data-ac-on` 变化时写 `aria-label`，`__acConfig({i18n})` 不刷新 | 每轮比对文案，变化即写 |

附带：折叠行摘要右边界 56→62px 给 📌 让位；窗口 `resize` 触发重排。

回归：11 场景 **38 断言全绿**（新增 `pin-geometry`：中心 Y 误差 <2px、X 误差 <3px）。
真机（link 安装、重新加载界面）核对：折叠行 📌 紧贴省略号后 2 字符、行内垂直居中；滚动 12 格后再滚回，📌 始终跟住所在行。


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
