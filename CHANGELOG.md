# Changelog · 更新记录

## 3.1.2

**2026-11-18 · 入口改挂会话框右上**

- 位置：🔍 改成**与发送箭头同尺寸、右边缘对齐、贴在箭头正上方 6px**（会话框右上那一格）；
  搜索输入框仍在按钮左侧就地展开，与按钮同一水平线，点开/收起都不移动。
- 守门：`placeFind()` 自己判定 `sessionHasTurns()`，`start()` 的延时测量、resize 调用都不会在
  非会话页留下 `--ac-find-*` / `--ac-q-*`（这次发现旧实现里延时 placeFind 会把变量写回来）。
- 验证：`find-entry` 三条断言覆盖「同尺寸 / 右对齐 / 在箭头正上方 / resize 不跳 / 搜索框在左侧同一行 /
  空会话收干净」；16 场景 0 红，`worstFrameMs 16.8` / `longTaskWorstMs 0` 不变。

## 3.1.1

**2026-11-18 · 搜索入口常驻输入框内**

- 位置：🔍 从「浮在发送箭头正上方」改成**与发送箭头同一行、贴在它左边 8px**；搜索框在按钮左边展开，
  点开/收起都不再移动位置。窗口尺寸变化只重算一次几何。
- 让位：发送箭头左边已经有别的按钮（语音/附件/停止）时自动向左让开，不叠在别人身上。
- 只在会话页出现：`sessionHasTurns()` 判定「会话流容器里已有轮次行」才挂入口；回首页、新建对话页、
  设置页一律收掉，`--ac-find-*` / `--ac-q-*` 五个定位变量一并清除。
- 性能：箭头元素缓存（不再每趟全量扫 button）；几何签名不变时一次都不写 CSS 变量。
- 验证：新增 `verify/scenarios/find-entry.json`（`find-on-composer` / `find-only-on-session` / `stop-clears-chrome`），
  harness 加了假输入框与假发送箭头；16 个场景断言 0 红，掉帧基线仍是 `worstFrameMs 16.8` / `longTaskWorstMs 0`。

## 3.1.0

**2026-11-18**

三阶段复核修复合并为 3.1.0：P0 4 项、P1 9 项、阶段 3 3 项（细节见下方各节）。三处对外可见的行为变化：

- `__acReport()` 多了 `passes`（整表 pass 计数），供自检判断是否空转。
- `__acStop()` 现在真的把页面还原（样式/行属性/📌 层/搜索框/主题/行内变量/监听全撤），`__acStart()` 立即重折。
- 搜索的 Esc / 关闭会回到搜索前的展开目标与滚动位置。

## 修复：阶段 3（2026-11-18）

- 空转：1500ms 兜底 pass 加“无变化快返回”（结构/展开目标/查询/钉住/会话 key/开关全同就跳过）。
  A/B 实测（40 轮静置 3.4s）：整表 pass 由 **3 趟降到 1 趟**。
- 健壮性：行循环逐行 try/catch；`groups()` 读 `data-chat-turn` 也兜住；`__acReport()`
  逐行兜底——一行结构异常只会跳过它自己，整趟与诊断接口都不再崩。
- 生命周期：`stop()` 回收 `pinFixRaf` 与 120ms 的 `pinFixTimer`；`restoreDom()` 清空
  `lastPinFlow/lastPinRows` 与两个签名，停后改窗口尺寸不会再长出 📌。
- 搜索：关掉搜索时收回 `--ac-find-*` / `--ac-q-*` 五个定位变量。
- 可观测：`__acReport()` 新增 `passes`（整表 pass 计数），供自检判断是否空转。
- 验证：新增 `verify/scenarios/phase3.json`（`idle-skip` / `poison-row` / `stop-clears-chrome`），
  15 个场景断言 0 红。

## 修复：阶段 2（2026-11-18）

- 搜索：命中表每趟整体重建（以前只做交集，零命中仍显示 1/N，回车会跳到不含关键词的轮次）。
- 搜索：打开时记下展开目标与滚动位置，关闭时还原（跳过去的那一轮不再留在展开态）。
- 生命周期：`__acStop()` 真的把页面还原（样式表、行属性、📌 层、搜索框、主题、行内变量、全部监听），
  `__acStart()` 立即重折；行级弱引用缓存在停止时清空，避免“属性撤了、缓存说写过”而不重画。
- 生命周期：`apply`/`schedule` 在停止后直接返回，`disposed` 不再是死变量。
- 健壮性：事件回调里的 `apply` 全部走 `safeApply`（异常只 warn，不留半折状态）。
- 键盘：输入区判定认 `isContentEditable`、`role=textbox` 与 shadow DOM；Esc 在弹窗打开或已被
  应用处理时不再抢默认行为。
- 性能：`syncPins` 加脏检查（尺寸/展开目标/钉住数不变不重量），语言与配置变更时失效缓存。
- 性能：`noteScroll` 不再把 keydown 当滚动信号，`adoptScroller` 限频 400ms。
- 启动：`document.body` 未就绪时等 `DOMContentLoaded`；新增单例守卫，重复求值只跑一个实例。
- 验证：新增 `verify/scenarios/phase2.json`（`search-stale`、`stop-restores`），14 个场景全绿。

## 修复：P0 四项（2026-11-18）

- 换会话：`expandedId` 在会话切换时会校验，1 轮会话切到多轮会话不再整屏全折叠；
  记忆只落当前列表中存在的目标，不再把上一个会话的 turn id 写进新会话的记忆槽。
- 性能：调试用的高度/日期头读取收进 `DBG.on` 守卫（每 pass 少 4 次同步布局）。
- 性能：滚动采样器的 rAF 句柄被保存，`__acStop()` 会真正取消它，`__acStart()` 时重新启动。
- 性能：`MutationObserver` 只对「新挂载轮次行」走同步折叠，流式文本增量一律走 rAF 节流。
- 验证：新增 `verify/scenarios/session-switch.json`（`switch-from-1-turn`），13 个场景全绿。

## 复核报告：性能 / 代码 / 逻辑（2026-11-18）

- 新增 `docs/review-2026-11-18.md`：3 路独立审计 + 逐条回源码复核，红/黄项按 P0/P1/P2 分级，
  附"确认干净、别动"清单与三阶段修复顺序。
- 顺带修掉 `signoff p5`（空话闸门）7 处措辞，闸门从 FAIL 转 PASS。

## 文档修订 2：头部功能清单 + 撤掉最后一张图（2026-11-18）

- 头部（30 秒理解之后）新增「本次更新（3.0）· What's new in 3.0」：中文 9 条 + 英文 9 条功能清单，
  详细操作说明仍留在正文的中文「功能与使用」与英文「Features and usage」。
- 撤掉头部最后一张图 `docs/images/session-management.svg`（文件保留在仓库，README 不再内嵌），
  至此 README 全文 0 张动图 0 张内嵌图，只剩徽章。
- GitHub Release v3.0.0 正文同步换成同一份功能清单。

## 文档修订：README 用中英双语说明替代演示 GIF（2026-11-18）

- 删掉 `docs/images/demo-accordion.gif`（1.26 MB）与 `docs/images/demo-forktree.gif`（1.47 MB），
  说明改为**按语言分段落位**：中文 8 小节（折叠/三态/钉住/搜索/时间线/分叉/性能/开关）放进 `## 中文`
  的「效果」与「安装」之间，英文 6 小节镜像放进 `## English` 的「What it looks like」与「Install」之间；
  自检命令并入中文「诊断」段。
- 顺带清掉文末重复的第二份开关代码块与重复的自检行。
- 保留 `docs/images/session-management.svg`（静态示意图，不是动图）。
- 影响面：README 本地链接全部校验通过（0 缺失）；npm 包体内不含 `docs/images`，
  所以 npm 页面上的 README 要等下一次发版才会更新（3.0.0 的包快照仍是旧版）。

## 3.0.0 发布记录（2026-11-18，已发布）

| 通道 | 结果 |
| --- | --- |
| npm | `dsh-session-accordion@3.0.0` 已公开，`latest = 3.0.0`（发布者 `jack.camps`，published 2026-11-18T05:06:04Z；9 文件 45,478 B，shasum `3af606b5`） |
| git tag | `v3.0.0`（`ac38923`，已推 origin） |
| GitHub Release | <https://github.com/ayuanxx-max/dsh-session-accordion/releases/tag/v3.0.0>，附件 `dsh-session-accordion-3.0.0.tgz` |
| 本机 profile | `~/.dsh/profiles/desktop` 从 `link:E:/...` 切成 `"3.0.0"`；因应用运行时 pnpm 重命名被 EPERM 挡住，改用「解包 npm tarball 覆盖 node_modules 条目」完成；重载界面后折叠/🔍/三态配色正常 |

发版前检查：12 场景 50 断言全绿、`tools/precommit.ps1` PASS(101)、`tools/check.ps1` PASS(13)、
`node --check` 0、`npm pack --dry-run` 9 文件。

踩坑记录：npm 首次 `publish` 报 404 是 token 失效（`whoami` 401）；修好 token 后 `publish` 报
`409 Cannot publish over previously staged version`，其实是 3.0.0 已经发布、注册表读端点还在缓存旧文档
（几分钟后 `/3.0.0` 返回 200、`dist-tags.latest=3.0.0`）；再跑一次 `publish` 会报
`cannot publish over the previously published versions: 3.0.0`，可用来反证"已经发上去了"。

## 3.0.0-live 修订 13（🔍 贴到发送箭头上方 + 三态配色 + 滚动性能，2026-11-17）

**1. 搜索入口位置**：右下角 🔍 现在是「发送箭头正上方、同 x、同尺寸」。
做法是 `placeFind()` 实测发送按钮的 `getBoundingClientRect()`，把 `right/bottom/size` 写进
CSS 变量 `--ac-find-*`；只在启动、`resize`、挂载后 0.9s/2.6s 各测一次，**不进逐帧路径**。
搜索条改用 `--ac-q-right/--ac-q-bottom`，于是开在按钮**左侧**、与按钮同一水平带。

**2. 三态配色（一眼分辨）**：

| 状态 | 视觉 |
| --- | --- |
| 折叠行 | 灰色底 + 次要色文字（`data-ac-line="1"`），时间更淡 |
| 展开行 | 原样，无底色 |
| 钉住行 | 左侧 2px 强调色条（`data-ac-pinned="1"`）；折叠时再叠淡蓝底 |

**3. 滚动性能**（用户报：任务执行中上滚查看会卡）：

- `MutationObserver` 回调：**滚动中只有「新增了轮次行」才立刻同步折叠**（那是唯一会让行先高后低、
  导致滚动条一涨一缩的情况）；流式输出改的是文本节点、高度不变，一律走 rAF 节流。
  以前每来一次 delta 就在主线程跑一遍全表 `apply()`，边滚边卡。
- 📌 覆盖层几何：滚动中最多 90ms 量一次（`pinsSyncAllowed()`），滚停后那次 `apply` 全量校正。
  覆盖层坐标本来就是内容坐标，滚动时不该变，所以跳过量测不影响落点。
- 新增场景 `perf-scroll-stream`：60 轮 + 40 次 storm + 持续上滚，断言 `line-contract` /
  `only-newest-expanded` / `no-scroll-writes` / `no-harness-errors`，并设
  `maxWorstFrameMs=60` / `maxLongTaskWorstMs=120` 兜住回归。

**诚实边界**：harness 前后帧统计都是 `worst=16.8ms / longTask=0`（页面太小，测不出差异），
所以"更快"这一点只在结构上成立（少跑全表 apply、少量几何），真机手感需要人确认；
这次新增的只有性能守卫，没有可量化的前后对比数字。

回滚：`git revert <本修订提交>`；只关搜索入口：`__acConfig({search:false})`。

## 3.0.0-live 修订 12（C 搜索：快捷键被应用占用 → 改常驻 🔍 按钮，2026-11-17）

真机实测：按 `Ctrl+Shift+F` 弹出的是 **DSH 自带的查找/跳转面板**（顶部“找…/无匹配”加一排候选），
插件的搜索条根本没出现 —— 也就是说特性 C 在真机上等于按不出来。

- **快捷键不可靠**：`Ctrl+Shift+F` / `Ctrl+Alt+F` / `Ctrl+Shift+K` 在真机上先后都被应用自带的
  查找面板接管（弹的是应用的条，而且它抢走焦点，打字进不到我们的输入框）。
- 因此给搜索加**常驻入口**：右下角一个固定的 🔍 按钮（`#dsh-ac-find`，`position:fixed` 挂在
  `document.body`，**不进入聊天流、不改任何行高**），点它开关搜索条；`Ctrl+Shift+K` 仍保留作快捷键。
- 打开搜索时焦点补抓三次（立即 / 40ms / 160ms，`preventScroll`），防止被应用抢回输入框。
- 其余逻辑不变：只过滤折叠行、`Enter` 跳到下一个命中并展开、`Esc` 关闭并还原。

其余 A/B/E/F/G 本次逐条复核（见下表），未发现新问题。

| 特性 | 覆盖断言 | 真机复核 |
| --- | --- | --- |
| A 时间线（日期吸头 + hover 预览） | `day-groups` / `hover-preview` | 日期头正常分段（10-29/10-30/11-03/今天） |
| B 记忆 + 钉住 | `pin-toggle-keeps-open` / `memory-restore` / `pin-geometry*` / `pin-containment` / `pin-scroll-geometry` | 钉住/解除、📌 位置（隔一字符、行内居中）已在前几轮实测 |
| C 搜索 | `search-filter` | ✅ 真机全链路：点 🔍 → 输入框弹出 → 打 `npm` 命中 `1/2` → `Enter` 跳转并展开命中轮 |
| E 分叉徽标 | `fork-chip` | 顶部 `↳ 分叉 · L1 · …` 正常显示 |
| F 稳定性（增量渲染） | `incremental-skip` / `scroll-stability` / `no-scroll-writes` | 46 断言全绿 |
| G 主题/无障碍/双语 | `a11y-i18n-theme` / `keyboard-j-esc` | 真机 `Esc` 全收（最新一条变折叠行）已验证 |

真机验证方式（不碰用户的鼠标/键盘）：用 `PostMessage` 向窗口投 `WM_*` 消息点按钮、打字、回车，
再截屏比对。这样自动化不会再抢走指针，也不会污染用户的输入框。

回滚：`git revert <本修订提交>`。版本仍本地 `3.0.0`，未发布。

## 3.0.0-live 修订 11（真机采样定位：滚动条来回跳 = 高度一涨一缩，2026-11-17）

真机 HUD 采样（`scrollHeight` / `scrollTop` 每帧记录方向变化）：

```
第一轮：JUMP 0->4199 / 4199->0 交替     SHCHG=12 SHOSC=12
第三轮：JUMP 693->937 597->937 1192->1597 ...（全部单向）  SHCHG=5 SHOSC=0 STOSC=0
```

`SHOSC` = 高度方向反转次数，`STOSC` = 位置方向反转次数。第一轮两者都在 12 次上下徘徊，
就是用户说的“滚动条一直上下跳”；现在 30 次滚轮上翻 + 6 批“加载更早”，两者都是 0。

**根因 5：新挂载的行先以全高绘制，下一帧才被折叠。**
`MutationObserver` 回调里只调 `schedule()`（rAF = 下一帧），于是每次 React 重渲染
（流式输出时每秒数次）都会先画一遍全高、再收缩一次；高度一涨一缩 → 右侧滚动条来回跳，
`scrollTop` 也因此被浏览器锚定/夹取来回搬（`Wn=0`，没有任何人写属性）。
现在观察者回调里**同步**跑折叠（MutationObserver 回调是微任务，早于本帧绘制），
新行从第一帧起就是折叠态；12ms 节流防止刷爆。

**根因 6：滚动中整体推迟 apply，等于把上面的“全高闪一帧”放大成几百毫秒。**
现在滚动中照常折叠，只推迟“插/删日期头”这类成批改高度的动作，滚停后 160ms 补上。

**根因 7：“加载更早”会让虚拟窗口整批换成另一批 id（完全不交集），被当成换会话 → 展开目标乱换。**
展开目标一换就有一条展开（高）+ 一条收起（矮），滚动条跟着跳。
现在“真换会话”要同时满足：列表完全不交集 + 持续 120ms + **停在底部** + **会话 key 真的变了**。
滚上去加载历史时这四条不可能同时成立。

验证：11 场景 46 断言全绿；真机 30 次上滚采样 `SHOSC=0 STOSC=0`。

回滚：`git revert <本修订提交>`。版本仍本地 `3.0.0`，未发布。

## 3.0.0-live 修订 10（全面复盘：把“往上滚就跳 / 乱打开别的会话”的四个来源一次清掉，2026-11-17）

这次不是单点补丁，是把“什么情况下允许改展开目标”“谁能动滚动位置”两条链路整个重画。

**根因 1：插件强制把 `overflow-anchor` 改成 `auto`（两处）。**
应用自己关掉了浏览器滚动锚定（`none`），我们又把它打开。React 整体重建列表时锚点节点丢失，
浏览器重新挑锚点会落到列表末尾——表现就是“往上滚，页面突然弹到底部”，
而且这种位移**不留任何 `scrollTop` 写记录**（真机探针实测 `Wn=0`，只有 `JUMP 1706→4440`）。
现在两处强制全部删除，滚动锚定归应用所有。

**根因 2：容器闪空一帧就丢掉“记住的上一批行”。**
`dropSeen()` 在 `Rempty/Rflow`（“加载更早”/虚拟滚动会让 flow 闪空一帧）里把 `seenIds` 清空，
于是回来的列表既没有交集也没有前序 → 被当成“首次渲染/换会话” → `expandedId` 被改成最新一条
（实测 `FLIP null -> 47`）→ 高度突变 + 视口跳。现在闪空只丢节点引用，**绝不丢 id 参照系**。

**根因 3：`sessionKey` 用侧栏标题文字。**
标题里带“3小时 / 刚刚”这类相对时间，会随时间漂移（实测 `KEY ac:y0m2m -> ac:y0u2m2`），
key 一变就走“记忆恢复”，把展开目标换成历史上某一条。现在优先用侧栏行的稳定 id 属性
（`data-session-id` / `data-session` / `data-ft-session` / `data-id` / `id`），
退回标题时也会剥掉相对时间尾巴；并且**key 不再参与“换会话”判定**。

**根因 4：`isChopTail` / `!keepCurrent` 分支在虚拟滚动卸载展开行时改判。**
展开行被虚拟滚动临时移出 DOM，`ids` 里就找不到它，旧代码据此改判“最新一条”，
它回到 DOM 时是折叠态 → 上方内容突然变矮 → 上下跳。

**现在的规则（唯一真相）**

1. 自动改变展开目标只允许三种情况：**真·首屏**、**新轮追加**（`isAppend`）、**真换会话**
   （前后两次列表完全不交集且持续 ≥120ms；空列表帧直接返回，不参与判定）。
2. 用户主动收起（点行、按 `Esc`）置 `userFolded`，此后只有新轮/换会话才会再自动展开。
3. `scrollTop` 保持只读：本次仍然一行都不写。
4. 折叠只在滚动静默期结束后应用；滚动中只刷新钉住图标（`position:absolute` 覆盖层，不影响行位置）。

**验证**：11 个场景 / 46 条断言全绿（`failScenarios=0`）。新增断言 `identity-stable`：
展开第 4 条 → 容器整体闪空 → 同一批 id 回来 → 再让尾部两条被虚拟卸载，展开目标必须始终是第 4 条。
上一版 `d760da3` 上它是红的。同时新增测试钩子 `__acForget()`，
让 harness 能真正模拟“从零装载一份记录”，避免用例之间残留展开状态互相污染。

回滚：`git revert <本修订提交>`。版本仍本地 `3.0.0`，未发布。

## 3.0.0-live 修订 9（页面不跳了但滚动条在抖：插件对 scrollTop 只读，从不写回，2026-11-17）

反馈原话：**页面先不跳但右侧滚动条在跳，然后向上滚页面的时候页面和滚动条一直再跳。**

“内容看着没动、滚动条却在抽”只有一种解释：**有人在反复写 `scrollTop`**，而且写的不多、写得频繁。
翻代码只剩一处：

```js
if (Math.abs(delta) > 1 && beyond > 40) {
  scroller.scrollTop = st0 + delta;   // ← 每一 pass 写一次
}
```

这是修订 5 加的“事后抵账”：改完高度把视口钉回原处。问题是插件的 mutation 每秒很多次，
于是变成**插件写一次 scrollTop → 应用滚动监听回写一次 → 插件再算一次**，两边对着写，滚动条就来回抽；
往上滚时两边都不让，越滚越抖。而且它的锚点还取自 `scrollWatchedHost`（经常是 null 或错节点），
`delta` 时而 0 时而几十像素，正好形成抖动而不是稳定补偿。

修法：**把这一句删掉，插件对滚动位置只读。**

- 删除 `scroller.scrollTop = st0 + delta` 全部逻辑，同时删掉只服务于它的 `pickAnchorRow`；
- 高度变化引起的视口位移，完全交给浏览器原生滚动锚定；并在 apply 里把真实滚动容器上的
  `overflow-anchor` 若有 `none` 就恢复成 `auto`（只恢复样式，不写位置）；
- 现在插件里只剩两处移动视口，且都是**用户显式动作**：`Alt+↑/↓` 键盘导航、搜索跳到命中行。

验证：

- 新增断言 **`no-scroll-writes`**：把 `Element.prototype.scrollTop` 的 setter 临时包一层，
  seed 20 轮 → 滚到中间 → 点视口上方那一行（高度变化落在视口上方）→ 再追加一轮，
  全程断言 **写入次数 = 0**。
- 11 场景 / **45 断言全绿**；`tools\check.ps1` = `RESULT: PASS (13 checks)`。
- 说明一句：这条断言在上一版上也没有红（因为旧代码的锚点取错，delta 经常是 0，反而“侥幸”没写）。
  所以它的价值是**把“插件不写滚动位置”这个不变量钉死**，防止以后再长回来；它能证明的边界就到这里。

如果这次还抖，那就只剩应用侧：把 `__acConfig({timeline:false})` 关掉折叠再看，仍然抖就与应用自身的滚动监听有关。

## 3.0.0-live 修订 8（往上滚 = 收起最新一条 + 打开别的：会话 key 一直在漂，2026-11-17）

反馈原话：**往上面滚动的时候会刷新页面，会收起最近一条会话，会打开一个刷新后鼠标停留在的会话。**

这次抓到了机制，不是猜的：

`sessionKey()` 的种子里有 **“第一行的文字”**：

```js
const first = flow.querySelector('[data-chat-turn]');
const head = first.textContent.slice(0, 60);
const seed = title + '|' + head + '|' + path;   // ← 往上滚，首行就换了
```

往上滚会触发“加载更早”/虚拟滚动，**首行必然被换掉** → key 漂移 → 命中这段逻辑：

1. `key !== memKey` → 当成“换了会话”；
2. `trackExpanded(..., switched = true)` → 不管 id 有没有撞车，`expandedId = last`（收起你展开的那条）；
3. `loadMem(新 key)` 里可能正好有一条**别的 key 留下的记忆**，`expanded` 指向历史上某一条 → 于是“打开一个别的会话/轮次”；
4. 第 2、3 步都会改高度，加起来就是肉眼看到的“页面刷新 + 上下跳”。

同一个会话在内存里因此会散成很多个 key，记忆互相串门——这才是“打开鼠标停留那条”的真实来路。

修法（四道锁）：

| 锁 | 做法 |
| --- | --- |
| 1 | `sessionKey` 只用**侧栏当前会话标题 / `document.title` + path**，**彻底不看行文字** |
| 2 | “换会话”必须 **key 变了且 id 一个都不重合**（`switched && !overlap`）；只 chop 掉一部分行不算 |
| 3 | 记忆只在**真换会话**时恢复（`switchedNow`），滚动导致的 key 抖动一律不恢复记忆 |
| 4 | 滚动静默期内保底：`expandedId` 一律回退到进入静默期前的目标 |

另外：分叉徽标改成自己的签名（`forkInfo` 的层级+标题），既能实时消失，又不会被“布局签名没变”一起跳掉。

真机/自动化验证：

- 新增断言 **`scroll-up-keeps-expansion`**（seed 12 → 展开第 6 条 → 头部插 3 条 + 2 条模拟“加载更早” → 断言仍是第 6 条展开、最新一条折叠）。
  **在上一版上这条断言是红的**：`{"open":[],"want":"t6"}` —— 什么都没展开，正是你看到的现象。
- 11 场景 / **44 断言全绿**；`tools\check.ps1` = `RESULT: PASS (13 checks)`。
- HUD 新增 `KEY=`（会话 key 变化次数）、`MEM=`（记忆恢复次数）、`KEEP=`（静默期保底次数）。正常滚动这三个都应该 **0**。

如果你那边还看得到：先 `localStorage['dsh-ac-debug']='1'` → 重新加载界面 → 往上滚，只要 `KEY=` 还在涨，就说明还有别的东西在改会话身份，把那行发我即可。

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


All notable changes to **DSH 会话历史折叠功能 / DSH Session History Accordion**.

## 3.0.0-live（本地真机验证，2026-11-17）

本地装进 profile（`link:` 直连仓库）后在真实 React 聊天流里逐项核对，发现并修掉 3 个只有真机才暴露的问题：

1. **📌 钉住按钮被 React 抹掉**：按钮原先 append 到 `[data-chat-turn]` 行内，聊天流每次重渲染都会删掉这个外来子节点，
   所以真机上根本看不到 📌。改为 `#dsh-ac-pinlayer` 固定层（`position:fixed` + `pointer-events:none`，按钮自身 `auto`），
   每轮 `apply()` 里按行 `getBoundingClientRect()` 重定位、按 turn id 重新挂载与回收。
2. **分叉徽标取不到干净标题**：侧栏行文本含「进行中 / 8分钟」等噪声，徽标写成「↳ 分叉 · L1 · 进行中DSH会话历史折叠功能8分钟」。
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
- `Ctrl/Cmd+Shift+K` 打开搜索条（备用 `Ctrl/Cmd+Alt+F`），只过滤折叠行；`Enter` 跳到下一个命中并展开，`Esc` 还原。
  （`Ctrl+Shift+F` 与 `Ctrl+Alt+F` 都被 DSH 自带的查找面板占用，故以 `Ctrl+Shift+K` 为准。）

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
恢复默认 `__acConfig({timeline:true})`，并 `localStorage.removeItem('dsh-ac-config')` 清空配置。

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

- Linux / macOS 兼容性：README 增加 bash 安装路径（完整路径符号链接）、按宿主区分 `desktop` / `web` profile；卸载补充 `rm` 写法。
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
