/**
 * DSH 轮次手风琴（整轮折叠 / 提问单行摘要 / 日期时间 / 会话级重置）
 *
 * 行为（全工作区 / 全会话）：
 *   1. 打开任何会话：只展开**最近一条**交互，历史交互各占一行
 *      （时间胶囊 + 提问摘要 + chevron），过程与回答全部隐藏；
 *   2. 产生新交互：新的一轮自动展开，之前所有展开的轮次（包括手动展开的）一律折叠；
 *   3. 切换工作区/会话：状态整体重置，仍然只展开最近一条。
 *
 * 唯一展开态由 `expandedId`（单个 turnId）表示；会话切换/历史消失/新轮追加
 * 三种事件都会把 `expandedId` 重新指向列表最后一条。
 *
 * 时间来源：React fiber 的 `props.node.data.time` → 原生 `*_timeStart` 文本 → 无。
 *
 * 安全阀：结构认不出就不动作；异常只 warn；不改核心配置、不碰 app.asar。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-accordion',
  factory() {
    const STYLE_ID = 'dsh-auto-collapse-style';
    const FLOW_SEL = '[data-slot="conversation.chat.flow"]';
    const ITEM_SEL = '[data-chat-turn]';
    const HIDE_ATTR = 'data-ac-hidden';
    const LINE_ATTR = 'data-ac-line';
    const USER_ATTR = 'data-ac-user';
    const TEXT_ATTR = 'data-ac-text';
    const TIME_ATTR = 'data-ac-time';
    const FRESH_ATTR = 'data-ac-fresh';
    const PIN_ATTR = 'data-ac-pinned';
    const PINBOX_ATTR = 'data-ac-pinbox';
    const DAY_ATTR = 'data-ac-day';
    const FILTER_ATTR = 'data-ac-filtered';
    const HIT_ATTR = 'data-ac-hit';

    /* ---- 3.0 基础：配置开关（每项特性都能单独关掉） ------------------- *
     * localStorage['dsh-ac-config'] 或运行时 window.__acConfig({...})。
     * 任何一项设 false，对应特性立即停止渲染，其余不受影响。            */
    const CFG_KEY = 'dsh-ac-config';
    const DEFAULTS = {
      timeline: true, pin: true, memory: true, search: true, forkchip: true, guard: true,
      incremental: true, i18n: 'auto', theme: 'auto',
    };
    let CFG = Object.assign({}, DEFAULTS);
    try {
      const raw = window.localStorage.getItem(CFG_KEY);
      if (raw) CFG = Object.assign(CFG, JSON.parse(raw));
    } catch (err) {
      /* 私密模式 / 无 localStorage：用默认值 */
    }

    const STRINGS = {
      zh: {
        pin: '钉住', unpin: '解除钉住', search: '搜索提问', searchHint: '输入关键词 · Enter 下一个 · Esc 关闭',
        noMatch: '无匹配', today: '今天', yesterday: '昨天', earlier: '更早', preview: '点击展开',
        fork: '分叉', turns: '轮', searchLabel: '按提问内容过滤折叠行', pinLabel: '把这一轮钉住，新消息不再折叠它',
        expand: '已展开', collapse: '已收起', turn: '第', turnUnit: '轮',
      },
      en: {
        pin: 'Pin', unpin: 'Unpin', search: 'Search prompts', searchHint: 'Type to filter · Enter next · Esc close',
        noMatch: 'No match', today: 'Today', yesterday: 'Yesterday', earlier: 'Earlier', preview: 'Click to expand',
        fork: 'Fork', turns: 'turns', searchLabel: 'Filter folded turns by prompt text', pinLabel: 'Pin this turn so new messages keep it open',
        expand: 'expanded', collapse: 'collapsed', turn: 'turn', turnUnit: '',
      },
    };

    /**
     * 语言来源（“随系统设置”）：显式配置优先，其次应用自己的 html[lang]、
     * 再看 body/根节点的 lang、最后退回 navigator.language。
     */
    function lang() {
      if (CFG.i18n === 'zh' || CFG.i18n === 'en') return CFG.i18n;
      try {
        const picks = [
          document.documentElement.getAttribute('lang'),
          document.body === null ? null : document.body.getAttribute('lang'),
          window.navigator.language,
          window.navigator.userLanguage,
        ];
        for (let i = 0; i < picks.length; i += 1) {
          const v = String(picks[i] || '');
          if (/^zh/i.test(v)) return 'zh';
          if (/^en/i.test(v)) return 'en';
        }
      } catch (err) {
        /* 取不到就用默认 */
      }
      return 'zh';
    }

    function t(key) {
      const dict = STRINGS[lang()] || STRINGS.zh;
      return dict[key] !== undefined ? dict[key] : (STRINGS.zh[key] || key);
    }

    const CHEVRON = 'url("data:image/svg+xml,' +
      '%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2712%27%20height=%2712%27' +
      '%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%23909090%27' +
      '%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27' +
      '%3E%3Cpolyline%20points=%279%206%2015%2012%209%2018%27/%3E%3C/svg%3E")';

    /** 当前会话说：唯一展开的 turnId；null = 全部折叠。 */
    let expandedId = null;
    /** 上一帧看到的 turnId 序列，用来判定「追加 / 消失 / 新会话」。 */
    let seenIds = [];
    /** 上一帧的行节点；整批失联 = 会话被整体替换（turnId 可能重号）。 */
    let seenNodes = [];
    /** 最近一次“不交集”批次出现的时刻：只有持续存在才认定为真的换会话。 */
    let disjointSince = 0;
    /** 用户手动把唯一展开的那条也收起来了：此后只有新轮/换会话才会自动展开。 */
    let userFolded = false;
    /** 上一趟看到的会话 key（侧栏稳定 id / 标题指纹），用来给“真换会话”再加一道锁。 */
    let lastTrackKey = '';

    const textCache = new WeakMap();
    /** 行级渲染状态：签名不变就整行跳过（F：增量渲染）。 */
    const rowState = new WeakMap();
    const lastRest = new WeakMap();
    /** 时间戳按「元素 + 原生时钟文本」缓存，避免每帧沿 fiber 回溯。 */
    const stampCache = new WeakMap();
    const stats = { passes: 0, rows: 0, skipped: 0, writes: 0 };
    let pending = false;
    let started = false;
    let logged = false;

    function applyTheme() {
      try {
        const root = document.documentElement;
        if (CFG.theme === 'light' || CFG.theme === 'dark') root.setAttribute('data-ac-theme', CFG.theme);
        else root.removeAttribute('data-ac-theme');
      } catch (err) {
        /* 主题只影响观感 */
      }
    }

    /* ===== 临时诊断 HUD：定位“滚动上下跳 / 乱打开”，定位完即删 ===== */
    const DBG = {
      on: (function () {
        try {
          return window.localStorage.getItem('dsh-ac-debug') === '1';
        } catch (err) {
          return false;
        }
      })(),
      counters: {
        applyDuringScroll: 0, apply: 0, wheel: 0, reset: 0, noVis: 0, pv: 0, pvSupp: 0,
        daysAdd: 0, daysDel: 0, hChange: 0, mut: 0, rFlow: 0, rEmpty: 0, flip: 0, hWhole: 0,
        scrollN: 0, jump: 0, sampled: 0, anchored: 0,
        memRestore: 0, keyChange: 0, keepDuringScroll: 0,
      },
      lastExpanded: null,
      lastTop: null,
      lastY: null,
      lines: [],
      el: null,
      lastH: 0,
    };
    function dbgRender() {
      if (DBG.on !== true) return;
      if (DBG.el === null || !document.body.contains(DBG.el)) {
        DBG.el = document.createElement('pre');
        DBG.el.id = 'dsh-ac-dbg';
        DBG.el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;margin:0;padding:6px 8px;'
          + 'background:rgba(0,0,0,.85);color:#7CFC00;font:12px/1.3 Consolas,monospace;max-width:700px;'
          + 'white-space:pre;pointer-events:none;border-radius:6px';
        document.body.appendChild(DBG.el);
      }
      const c = DBG.counters;
      if (DBG.on === true) {
        let prob = [];
        let node = flowRef;
        let guard = 0;
        while (node !== null && node !== document.body && guard < 8) {
          guard += 1;
          if (node.nodeType === 1) {
            prob.push((node.tagName || '?').slice(0, 6) + ':' + node.scrollTop + '/' + (node.scrollHeight - node.clientHeight));
          }
          node = node.parentElement;
        }
        DBG.probe = prob.join(' ');
      }
      DBG.el.textContent = 'mut=' + c.mut + ' A=' + c.apply + ' Ascroll=' + c.applyDuringScroll
        + ' W=' + c.wheel + ' RESET=' + c.reset + ' Rflow=' + c.rFlow + ' Rempty=' + c.rEmpty
        + ' S=' + c.scrollN + ' SAMP=' + c.sampled + ' JUMP=' + c.jump + ' ANC=' + c.anchored + ' KEY=' + c.keyChange + ' MEM=' + c.memRestore
        + ' KEEP=' + c.keepDuringScroll
        + ' NOVIS=' + c.noVis
        + ' PV=' + c.pv + '/' + c.pvSupp + ' day+=' + c.daysAdd + '-' + c.daysDel
        + ' dh=' + c.hChange + ' H=' + c.hWhole + ' flip=' + c.flip

        + '\n' + (DBG.probe || '') + '\n' + DBG.lines.join('\n')

    }
    function dbg(label) {
      if (DBG.on !== true) return;
      const d = new Date();
      DBG.lines.push(d.toTimeString().slice(3, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0') + ' ' + label);
      while (DBG.lines.length > 5) DBG.lines.shift();
      dbgRender();
    }

    function ensureStyle() {
      if (document.getElementById(STYLE_ID) !== null) return;
      const tag = document.createElement('style');
      tag.id = STYLE_ID;
      tag.textContent = [
        '[' + HIDE_ATTR + '="1"]{display:none!important}',

        '[' + LINE_ATTR + '="1"]{position:relative;height:2em;margin:1px 0;overflow:hidden;',
        '  cursor:pointer;border-radius:8px;transition:background-color .12s ease;',
        '  background-repeat:no-repeat;background-position:right 9px center;background-size:12px 12px;',
        '  background-image:' + CHEVRON + '}',
        '[' + LINE_ATTR + '="1"]>*{visibility:hidden!important}',
        /* 三态可分辨：折叠=灰底次要色字；展开=原样无底；钉住=左侧强调色条（折叠时再叠淡蓝底） */
        '[' + LINE_ATTR + '="1"]{background:rgba(127,127,127,.10);border-radius:8px}',
        '[' + LINE_ATTR + '="1"]::after{color:var(--dsw-alias-label-secondary,#a9a9a9)!important}',
        '[' + LINE_ATTR + '="1"]::before{opacity:.62}',
        '[' + PIN_ATTR + '="1"]{box-shadow:inset 2px 0 0 0 var(--dsw-alias-brand-primary,#6f8cff)}',
        '[' + PIN_ATTR + '="1"][' + LINE_ATTR + '="1"]{background:rgba(111,140,255,.12)}',

        /* 📌 画在气泡内部：只在钉住特性开启时加左侧内缩，变量由 syncPins 按字号算 */
        '[' + PINBOX_ATTR + '="1"] [' + USER_ATTR + '="1"] [class*="_bubble"]{',
        '  padding-left:var(--dsh-ac-pinpad,0px)!important}',

        '[' + LINE_ATTR + '="1"]::before{content:attr(' + TIME_ATTR + ');position:absolute;',
        '  left:8px;top:50%;transform:translateY(-50%);width:86px;text-align:center;',
        '  font-size:11px;line-height:18px;border-radius:999px;white-space:nowrap;',
        '  font-variant-numeric:tabular-nums;letter-spacing:.02em;',
        '  color:var(--dsw-alias-label-tertiary,#9aa0a6);',
        '  background:rgba(127,127,127,.16);pointer-events:none}',
        '[' + LINE_ATTR + '="1"]:not([' + TIME_ATTR + '])::before{content:none}',

        '[' + LINE_ATTR + '="1"]::after{content:attr(' + TEXT_ATTR + ');position:absolute;',
        '  left:104px;right:62px;top:50%;transform:translateY(-50%);',
        '  font-size:.92em;line-height:1.5em;white-space:nowrap;overflow:hidden;',
        '  text-overflow:ellipsis;color:var(--dsw-alias-label-secondary,#c9c9c9)}',
        '[' + LINE_ATTR + '="1"]:not([' + TIME_ATTR + '])::after{left:12px}',

        '[' + LINE_ATTR + '="1"]:hover{background-color:rgba(127,127,127,.10)}',
        '[' + LINE_ATTR + '="1"]:hover::after{color:var(--dsw-alias-label-primary,#fff)}',
        '[' + LINE_ATTR + '="1"]:active{background-color:rgba(127,127,127,.18)}',

        '.dsh-ac-search{position:fixed;right:var(--ac-q-right,74px);bottom:var(--ac-q-bottom,150px);',
        '  top:auto;z-index:2147483001;display:none;align-items:center;gap:6px;',
        '  padding:5px 8px;border-radius:10px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.28);',
        '  background:var(--dsw-alias-bg-elevated,#2a2a2a);border:1px solid rgba(127,127,127,.3);',
        '  color:var(--dsw-alias-label-primary,#fff)}',
        '.dsh-ac-search .dsh-ac-q{width:190px;border:0;outline:0;background:transparent;color:inherit;font-size:12px}',
        '.dsh-ac-search .dsh-ac-count{font-size:11px;opacity:.65;font-variant-numeric:tabular-nums;min-width:2.2em;text-align:center}',
        '.dsh-ac-search .dsh-ac-close{border:0;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;opacity:.6;padding:0 2px}',
        '.dsh-ac-search .dsh-ac-close:hover{opacity:1}',
        '[' + FILTER_ATTR + '="1"]{display:none!important}',

        /* C：搜索入口按钮。fixed 挂在 body 上，不进入聊天流 → 不改变行高、不触发滚动抖动 */
        /* 位置/尺寸由 placeFind() 按发送箭头实测写进这几个变量；拿不到箭头时用默认值 */
        '.dsh-ac-find{position:fixed;right:var(--ac-find-right,26px);bottom:var(--ac-find-bottom,150px);',
        '  z-index:2147483000;width:var(--ac-find-size,28px);height:var(--ac-find-size,28px);',
        '  padding:0;border-radius:999px;',
        '  border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.14);',
        '  color:var(--dsw-alias-label-secondary,#c9c9c9);font-size:13px;line-height:26px;',
        '  text-align:center;cursor:pointer;opacity:.55;transition:opacity .12s ease}',
        '.dsh-ac-find:hover,.dsh-ac-find[aria-pressed="true"]{opacity:1}',
        '[' + HIT_ATTR + '="1"]{box-shadow:inset 0 0 0 1px rgba(255,196,0,.55)}',
        '[data-ac-user="1"]{position:relative}',
        '.dsh-ac-pin{position:absolute;left:0;top:0;width:22px;height:22px;margin:0;padding:0;border:0;',
        '  transform:translate(-50%,-50%);display:inline-flex;align-items:center;justify-content:center;',
        '  font-size:13px;line-height:1;cursor:pointer;opacity:.45;background:transparent;color:inherit;',
        '  border-radius:6px;transition:opacity .12s ease,background-color .12s ease}',
        '.dsh-ac-pin:hover{opacity:1;background:rgba(127,127,127,.18)}',
        '.dsh-ac-pinlayer{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:60}',
        '.dsh-ac-pinlayer .dsh-ac-pin{pointer-events:auto}',
        '.dsh-ac-pin[data-ac-on="1"]{opacity:1}',
        '.dsh-ac-live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
        '[data-ac-theme="light"] .dsh-ac-preview{box-shadow:0 8px 24px rgba(0,0,0,.14);border-color:rgba(0,0,0,.12)}',
        '[data-ac-theme="light"] .dsh-ac-day{background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 90%,transparent);color:#555}',
        '[data-ac-theme="light"] .dsh-ac-fork{background:rgba(0,0,0,.06);border-color:rgba(0,0,0,.12);color:#444}',
        '@media (prefers-color-scheme:light){.dsh-ac-preview{box-shadow:0 8px 24px rgba(0,0,0,.14);border-color:rgba(0,0,0,.12)}}',
        '.dsh-ac-fork{display:inline-flex;align-items:center;gap:6px;margin:2px 6px 6px;padding:2px 9px;',
        '  font-size:11px;border-radius:999px;width:max-content;cursor:pointer;',
        '  color:var(--dsw-alias-label-secondary,#c9c9c9);background:rgba(127,127,127,.14);',
        '  border:1px solid rgba(127,127,127,.22)}',
        '.dsh-ac-fork:hover{background:rgba(127,127,127,.24)}',
        '.dsh-ac-day{position:sticky;top:0;z-index:3;margin:6px 0 2px;padding:2px 8px;',
        '  font-size:11px;font-weight:600;letter-spacing:.04em;border-radius:6px;width:max-content;',
        '  color:var(--dsw-alias-label-secondary,#c9c9c9);background:color-mix(in srgb,var(--dsw-alias-bg-base,#1e1e1e) 88%,transparent);',
        '  backdrop-filter:blur(4px);pointer-events:none}',
        '.dsh-ac-preview{position:fixed;z-index:9999;display:none;padding:8px 10px;border-radius:10px;',
        '  font-size:12px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.32);',
        '  color:var(--dsw-alias-label-primary,#fff);background:var(--dsw-alias-bg-elevated,#2a2a2a);',
        '  border:1px solid rgba(127,127,127,.28);pointer-events:none}',
        '.dsh-ac-pv-head{font-size:11px;opacity:.7;margin-bottom:3px;font-variant-numeric:tabular-nums}',
        '.dsh-ac-pv-body{white-space:pre-wrap;word-break:break-word;max-height:9em;overflow:hidden}',
        '.dsh-ac-pv-hint{margin-top:4px;font-size:10px;opacity:.55}',
        '@keyframes dsh-ac-fade{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}',
        '[' + FRESH_ATTR + '="1"]{animation:dsh-ac-fade .16s ease-out}',
        '[' + LINE_ATTR + '="1"]::after{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}',
        '@media (prefers-reduced-motion:reduce){[' + FRESH_ATTR + '="1"]{animation:none!important}}',
      ].join('');
      (document.head || document.documentElement).appendChild(tag);
    }

    /** 多面板（分屏/浮窗）时优先选「有可见行」的流，其次选条数最多的流。 */
    function findFlow() {
      const flows = document.querySelectorAll(FLOW_SEL);
      let best = null;
      let bestScore = -1;
      for (let i = 0; i < flows.length; i++) {
        const rows = flows[i].querySelectorAll(ITEM_SEL);
        let visible = 0;
        const probe = Math.min(rows.length, 8);
        for (let k = 0; k < probe; k += 1) {
          if (rows[k].getClientRects().length > 0) visible += 1;
        }
        const score = visible * 1000 + rows.length;
        if (score > bestScore) {
          best = flows[i];
          bestScore = score;
        }
      }
      if (best !== null) return best;
      const items = document.querySelectorAll(ITEM_SEL);
      if (items.length === 0) return null;
      return items[0].parentElement;
    }

    function groups(flow) {
      const all = flow.querySelectorAll(ITEM_SEL);
      const out = [];
      const byId = new Map();
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.closest(ITEM_SEL) !== el) continue;
        const id = el.getAttribute('data-chat-turn');
        if (!id) continue;
        let group = byId.get(id);
        if (group === undefined) {
          group = { id, items: [] };
          byId.set(id, group);
          out.push(group);
        }
        group.items.push(el);
      }
      return out;
    }

    function pick(group) {
      let process = null;
      for (let i = 0; i < group.items.length; i++) {
        const el = group.items[i];
        if (el.getAttribute('data-chat-flow-kind') !== 'turn-process') continue;
        if (process === null || el.querySelector('button[aria-expanded]') !== null) process = el;
      }
      let user = null;
      for (let i = 0; i < group.items.length; i++) {
        const el = group.items[i];
        if (el === process) continue;
        if (el.querySelector('[class*="_bubble"]') !== null) {
          user = el;
          break;
        }
      }
      if (user === null) {
        for (let i = 0; i < group.items.length; i++) {
          if (group.items[i] !== process) {
            user = group.items[i];
            break;
          }
        }
      }
      if (user === null) user = group.items[0];
      return {
        process,
        user,
        rest: group.items.filter(function (el) {
          return el !== user;
        }),
      };
    }

    function pad2(value) {
      return value < 10 ? '0' + value : String(value);
    }

    /** Optional time-zone override: window.__dshAccordion = { timeZone: 'Asia/Shanghai' }. */
    function timeZoneOf() {
      try {
        const cfg = window.__dshAccordion;
        return cfg && typeof cfg.timeZone === 'string' && cfg.timeZone ? cfg.timeZone : '';
      } catch (err) {
        return '';
      }
    }

    function fmtTime(value) {
      if (value === undefined || value === null) return '';
      let ms;
      if (value instanceof Date) ms = value.getTime();
      else if (typeof value === 'number') ms = value < 1e11 ? value * 1000 : value;
      else ms = new Date(String(value)).getTime();
      if (!isFinite(ms)) return '';
      const d = new Date(ms);
      if (isNaN(d.getTime())) return '';
      const zone = timeZoneOf();
      if (zone) {
        try {
          const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: zone, month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
          }).formatToParts(d);
          const pick = function (type) {
            for (let i = 0; i < parts.length; i++) {
              if (parts[i].type === type) return parts[i].value;
            }
            return '';
          };
          const out = pick('month') + '-' + pick('day') + ' ' + pick('hour') + ':' + pick('minute');
          if (/^[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$/.test(out)) return out;
        } catch (err) {
          // unknown zone or no Intl support (older WebView): fall through to local time
        }
      }
      return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
        pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    function fiberTime(el) {
      let fiber = null;
      const keys = Object.keys(el);
      for (let i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) {
          fiber = el[keys[i]];
          break;
        }
      }
      let depth = 0;
      while (fiber !== null && fiber !== undefined && depth < 40) {
        const props = fiber.memoizedProps;
        if (props !== null && typeof props === 'object') {
          if (props.node && props.node.data && props.node.data.time !== undefined) return props.node.data.time;
          if (props.time !== undefined && typeof props.time === 'number') return props.time;
        }
        fiber = fiber.return;
        depth += 1;
      }
      return undefined;
    }

    function clockText(user) {
      const clocks = user.querySelectorAll('[class*="_timeStart"],[class*="_timeEnd"]');
      for (let i = 0; i < clocks.length; i++) {
        const text = (clocks[i].textContent || '').trim();
        if (text) return text;
      }
      return '';
    }

    /** 原生时间文本归一化：完整日期压成 MM-DD HH:mm；只有时分就只显示时分（不编造日期）。 */
    function normalizeClock(text) {
      const value = String(text || '').trim();
      const full = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2})[:：](\d{2})/.exec(value);
      if (full !== null) {
        return pad2(Number(full[2])) + '-' + pad2(Number(full[3])) + ' ' +
          pad2(Number(full[4])) + ':' + full[5];
      }
      const hm = /^(\d{1,2})[:：](\d{2})/.exec(value);
      if (hm !== null) return pad2(Number(hm[1])) + ':' + hm[2];
      return value.length > 24 ? value.slice(0, 24) + '…' : value;
    }

    function stampOf(user, bubble) {
      const clock = clockText(user);
      const cached = stampCache.get(user);
      if (cached !== undefined && cached.clock === clock) return cached.stamp;
      const fromFiber = fmtTime(fiberTime(bubble !== null ? bubble : user));
      const stamp = fromFiber || normalizeClock(clock);
      stampCache.set(user, { clock, stamp });
      return stamp;
    }

    function summaryOf(bubble, fallback) {
      const source = bubble !== null ? bubble : fallback;
      if (source === null) return '';
      const raw = source.textContent || '';
      const cached = textCache.get(source);
      if (cached !== undefined && cached.raw === raw) return cached.text;
      let node = null;
      try {
        node = source.cloneNode(true);
      } catch (err) {
        node = null;
      }
      let text = raw;
      if (node !== null) {
        const junk = node.querySelectorAll('[class*="_actions"],[class*="_action"],[class*="_toolbar"]');
        for (let i = 0; i < junk.length; i++) {
          if (junk[i].parentNode !== null) junk[i].parentNode.removeChild(junk[i]);
        }
        text = node.textContent || '';
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (text.length > 180) text = text.slice(0, 180) + '…';
      textCache.set(source, { raw, text });
      return text;
    }

    function setAttr(el, name, value) {
      if (el.getAttribute(name) === value) return;
      stats.writes += 1;
      el.setAttribute(name, value);
    }

    /* ---- E：fork-tree 联动（当前会话是分叉时，在流顶部显示分叉徽标） ---- */
    /** 侧栏没有暴露 active 标记时，用文档标题（会话名）兜底识别当前行。 */
    function titleMatches(row) {
      const title = (document.title || '').replace(/\s+[\u2014\u2013-]\s+DeepSeek Harness.*$/, '').trim();
      if (title === '') return false;
      const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
      return text.indexOf(title) !== -1;
    }

    /** 会话标题（文档标题去掉产品后缀），用于分叉徽标文案。 */
    function forkTitle() {
      return (document.title || '').replace(/\s+[\u2014\u2013-]\s+DeepSeek Harness.*$/, '').trim();
    }

    function forkInfo() {
      if (CFG.forkchip !== true) return null;
      const rows = document.querySelectorAll('[data-ft-session]');
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const active =
          row.getAttribute('aria-current') === 'true' ||
          row.getAttribute('data-active') === 'true' ||
          row.querySelector('[aria-current="true"],[data-active="true"]') !== null ||
          titleMatches(row);
        if (!active) continue;
        const depth = Number(row.getAttribute('data-ft-depth') || 0);
        if (!(depth > 0)) return null;
        return { depth: depth, title: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), row: row };
      }
      return null;
    }

    function applyForkChip(flow) {
      let chip = flow.querySelector('.dsh-ac-fork');
      const info = forkInfo();
      if (info !== null && info.title) {
        const clean = forkTitle();
        if (clean !== '') info.title = clean;
      }
      if (info === null) {
        if (chip !== null) chip.parentNode.removeChild(chip);
        return;
      }
      if (chip === null) {
        chip = document.createElement('div');
        chip.className = 'dsh-ac-fork';
        chip.setAttribute('role', 'note');
        flow.insertBefore(chip, flow.firstChild);
      }
      const text = '↳ ' + t('fork') + ' · L' + info.depth + (info.title ? ' · ' + info.title : '');
      if (chip.textContent !== text) chip.textContent = text;
      chip.setAttribute('title', t('fork') + ' · L' + info.depth + ' · ' + info.title);
      if (flow.firstChild !== chip) flow.insertBefore(chip, flow.firstChild);
    }

    /* ---- G：无障碍播报 / 键盘导航 / 主题 ---------------------------------- */
    function ensureLive() {
      let live = document.getElementById('dsh-ac-live');
      if (live !== null) return live;
      live = document.createElement('div');
      live.id = 'dsh-ac-live';
      live.className = 'dsh-ac-live';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      document.body.appendChild(live);
      return live;
    }

    function announce(text) {
      try {
        const live = ensureLive();
        live.textContent = '';
        live.textContent = text;
      } catch (err) {
        /* 播报失败不影响功能 */
      }
    }

    function userRows() {
      return Array.prototype.slice.call(document.querySelectorAll('[data-ac-user="1"]'));
    }

    function navigate(delta) {
      const rows = userRows();
      if (rows.length === 0) return;
      let index = -1;
      const active = document.activeElement;
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i] === active || rows[i].contains(active)) {
          index = i;
          break;
        }
      }
      const next = index < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, index + delta));
      const row = rows[next];
      row.focus();
      if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
    }

    /* ---- C：搜索过滤 ------------------------------------------------------ */
    let query = '';
    let searchOpen = false;
    let matches = [];
    let matchIdx = 0;

    function ensureSearch() {
      let box = document.getElementById('dsh-ac-search');
      if (box !== null) return box;
      box = document.createElement('div');
      box.id = 'dsh-ac-search';
      box.className = 'dsh-ac-search';
      box.innerHTML =
        '<input type="search" class="dsh-ac-q" autocomplete="off" spellcheck="false" />' +
        '<span class="dsh-ac-count"></span>' +
        '<button type="button" class="dsh-ac-close" aria-label="Close">×</button>';
      document.body.appendChild(box);
      const input = box.querySelector('.dsh-ac-q');
      input.setAttribute('aria-label', t('searchLabel'));
      input.addEventListener('input', function () {
        query = String(input.value || '');
        matchIdx = 0;
        schedule();
      });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          focusMatch();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeSearch();
        }
        event.stopPropagation();
      });
      box.querySelector('.dsh-ac-close').addEventListener('click', closeSearch);
      return box;
    }

    function findSendButton() {
      const all = document.querySelectorAll('button');
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let best = null;
      for (let i = 0; i < all.length; i += 1) {
        const b = all[i];
        if (b.id === 'dsh-ac-find') continue;
        const r = b.getBoundingClientRect();
        if (r.width < 18 || r.width > 64 || r.height < 18 || r.height > 64) continue;
        if (r.top < vh * 0.6) continue;
        if (vw - r.right > 150) continue;
        if (best === null || r.right > best.right + 1 || (Math.abs(r.right - best.right) <= 1 && r.top > best.top)) best = r;
      }
      return best;
    }

    // 一次测量，写 CSS 变量；不参与逐帧路径。
    function placeFind() {
      const root = document.documentElement.style;
      const r = findSendButton();
      if (r === null) {
        root.setProperty('--ac-find-right', '26px');
        root.setProperty('--ac-find-bottom', '150px');
        root.setProperty('--ac-find-size', '28px');
        root.setProperty('--ac-q-right', '74px');
        root.setProperty('--ac-q-bottom', '150px');
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const size = Math.round(Math.min(34, Math.max(22, r.width)));
      const right = Math.round(vw - r.right);
      const bottom = Math.round(vh - r.top + 8);
      root.setProperty('--ac-find-right', right + 'px');
      root.setProperty('--ac-find-bottom', bottom + 'px');
      root.setProperty('--ac-find-size', size + 'px');
      root.setProperty('--ac-q-right', (right + size + 10) + 'px');
      root.setProperty('--ac-q-bottom', bottom + 'px');
    }

    function ensureFindButton() {
      let btn = document.getElementById('dsh-ac-find');
      if (CFG.search !== true) {
        if (btn !== null) btn.remove();
        return null;
      }
      if (btn === null) {
        btn = document.createElement('button');
        btn.id = 'dsh-ac-find';
        btn.type = 'button';
        btn.className = 'dsh-ac-find';
        btn.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (searchOpen) closeSearch();
          else openSearch();
        });
        document.body.appendChild(btn);
      }
      placeFind();
      btn.textContent = '🔍';
      btn.setAttribute('aria-label', t('searchLabel'));
      btn.setAttribute('aria-pressed', searchOpen ? 'true' : 'false');
      btn.title = t('search') + ' (Ctrl+Shift+K)';
      return btn;
    }

    function openSearch() {
      if (CFG.search !== true) return;
      const box = ensureSearch();
      box.style.display = 'flex';
      searchOpen = true;
      ensureFindButton();
      const input = box.querySelector('.dsh-ac-q');
      input.placeholder = t('search');
      // 真机：键盘打开后立刻 focus 会被应用抢回输入框，打字落不到搜索框里。
      // 先立即 focus 一次，再在下一拍补一次（preventScroll 防止把列表滚走）。
      const grab = function () {
        if (searchOpen !== true) return;
        try {
          input.focus({ preventScroll: true });
        } catch (err) {
          try { input.focus(); } catch (err2) { /* 老内核 */ }
        }
        if (typeof input.select === 'function') input.select();
      };
      grab();
      window.setTimeout(grab, 40);
      window.setTimeout(grab, 160);
      schedule();
    }

    function closeSearch() {
      const box = document.getElementById('dsh-ac-search');
      searchOpen = false;
      query = '';
      ensureFindButton();
      if (box !== null) {
        box.style.display = 'none';
        box.querySelector('.dsh-ac-q').value = '';
        box.querySelector('.dsh-ac-count').textContent = '';
      }
      schedule();
    }

    function focusMatch() {
      if (matches.length === 0) return;
      const id = matches[matchIdx % matches.length];
      matchIdx = (matchIdx + 1) % matches.length;
      expandedId = id;
      apply(true);
      const row = document.querySelector('[data-chat-turn="' + id + '"]');
      if (row !== null && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' });
    }

    /* ---- B：会话记忆 + 钉住 ---------------------------------------------- */
    const memStore = (function () {
      const fallback = new Map();
      function get(key) {
        try {
          return window.localStorage.getItem(key);
        } catch (err) {
          return fallback.has(key) ? fallback.get(key) : null;
        }
      }
      function set(key, value) {
        try {
          window.localStorage.setItem(key, value);
        } catch (err) {
          fallback.set(key, value);
        }
      }
      return { get, set };
    }());

    let pinned = new Set();
    let sigGen = 0;
    let memKey = '';
    let savedState = '';

    /** 侧栏当前会话的稳定标识：优先用 DOM 上的 id 属性，绝不靠会变的文字。 */
    function sessionIdOf() {
      try {
        const row = document.querySelector('[data-ft-session][aria-current="true"],[data-ft-session][data-active="true"]');
        if (row !== null) {
          const names = ['data-session-id', 'data-session', 'data-ft-session', 'data-id', 'id'];
          for (let i = 0; i < names.length; i += 1) {
            const v = row.getAttribute(names[i]);
            if (v !== null && String(v).length >= 6) return 'id:' + String(v);
          }
        }
      } catch (err) { /* 退回标题 */ }
      return '';
    }

    function sessionKey(flow) {
      const stable = sessionIdOf();
      if (stable !== '') return 'ac:' + stable;
      let title = '';
      try {
        const row = document.querySelector('[data-ft-session][aria-current="true"],[data-ft-session][data-active="true"]');
        if (row !== null) title = (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      } catch (err) {
        title = '';
      }
      if (title === '') {
        try { title = (document.title || '').replace(/\s+/g, ' ').trim().slice(0, 60); } catch (err2) { title = ''; }
      }
      // 绝不能把“第一行的文字”算进 key：往上滚 / 虚拟滚动 / 加载更早都会换掉首行，
      // key 跟着漂移 → 被当成“换了会话” → 展开状态被清空 + 按别的记忆恢复成另一条。
      let path = '';
      try {
        path = window.location.pathname || '';
      } catch (err) {
        path = '';
      }
      // 标题里可能带“3小时/刚刚/N 条”这类会随时间变的尾巴，必须剥掉，否则 key 会漂移。
      title = title.replace(/[\s·|]*(刚刚|\d+\s*(秒|分钟|分|小时|天|周|个月|年|s|m|h|d|min|sec|hr)(\s*(前|ago))?)/gi, ' ').replace(/\s+/g, ' ').trim();
      const seed = title + '|' + path;
      let hash = 5381;
      for (let i = 0; i < seed.length; i += 1) hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
      return 'ac:' + (hash >>> 0).toString(36);
    }

    function loadMem(key) {
      memKey = key;
      pinned = new Set();
      savedState = '';
      if (CFG.memory !== true) return null;
      let data = null;
      try {
        const raw = memStore.get('dsh-ac-mem:' + key);
        if (raw) data = JSON.parse(raw);
      } catch (err) {
        data = null;
      }
      if (data !== null && typeof data === 'object' && Array.isArray(data.pinned)) {
        for (let i = 0; i < data.pinned.length; i += 1) pinned.add(String(data.pinned[i]));
      }
      return data;
    }

    function saveMem() {
      if (CFG.memory !== true || !memKey) return;
      const snapshot = JSON.stringify({ expanded: expandedId, pinned: Array.from(pinned) });
      if (snapshot === savedState) return;
      savedState = snapshot;
      memStore.set('dsh-ac-mem:' + memKey, snapshot);
    }

    function isPinned(id) {
      return CFG.pin === true && pinned.has(id);
    }

    function togglePin(id) {
      if (CFG.pin !== true || !id) return;
      if (pinned.has(id)) pinned.delete(id);
      else pinned.add(id);
      const rendered = document.querySelectorAll('[data-chat-turn="' + id + '"]');
      for (let i = 0; i < rendered.length; i += 1) {
        if (pinned.has(id)) rendered[i].setAttribute(PIN_ATTR, '1');
        else rendered[i].removeAttribute(PIN_ATTR);
      }
      saveMem();
      apply(true);
    }

    let pinLayerEl = null;
    let pinLayerHost = null;
    const pinBtns = new Map();
    let pinHostNode = null;
    let pinHostSerial = 0;
    let chCache = { font: '', w: 0 };
    let measureCtx = null;

    function ctx2d() {
      if (measureCtx === null) measureCtx = document.createElement('canvas').getContext('2d');
      return measureCtx;
    }

    function fontOf(cs) {
      return (cs.fontStyle || 'normal') + ' ' + (cs.fontWeight || '400') + ' ' +
        (cs.fontSize || '12px') + ' ' + (cs.fontFamily || 'sans-serif');
    }

    /** 1 个字符宽（按字体缓存，避免每行重复 measureText）。 */
    function chWidthOf(font) {
      if (font === chCache.font && chCache.w > 0) return chCache.w;
      let w = 7;
      try {
        const ctx = ctx2d();
        ctx.font = font;
        w = ctx.measureText('0').width || 7;
      } catch (err) { w = 7; }
      chCache = { font, w };
      return w;
    }

    /** 从行往上找真正的滚动容器（flow 本身常常是 display:contents，没有盒子）。 */
    function scrollHostOf(el) {
      let node = el === null ? null : el.parentElement;
      while (node !== null && node !== document.body && node !== document.documentElement) {
        let cs = null;
        try { cs = window.getComputedStyle(node); } catch (err) { cs = null; }
        if (cs !== null && cs.overflowY !== 'visible' && cs.overflowY !== 'hidden') return node;
        node = node.parentElement;
      }
      return null;
    }

    /** 钉住层挂进滚动容器：随内容原生滚动，滚动时不需要任何 JS 重排。 */
    function pinLayer(host) {
      if (pinLayerEl === null) {
        pinLayerEl = document.createElement('div');
        pinLayerEl.className = 'dsh-ac-pinlayer';
      }
      if (pinLayerHost !== host || pinLayerEl.parentNode !== host) {
        pinLayerHost = host;
        while (pinLayerEl.firstChild !== null) pinLayerEl.removeChild(pinLayerEl.firstChild);
        pinBtns.clear();
        // 显式把父容器变成包含块：否则层的定位基准会落到更外层，和行坐标对不上（错位根因）。
        if (host !== document.body) {
          try {
            if (window.getComputedStyle(host).position === 'static') {
              host.style.position = 'relative';
              host.setAttribute('data-ac-pos', '1');
            }
            // 不要碰 overflow-anchor：应用自己设的值（多半是 none）才是它对滚动位置的控制权。
            // 强行改成 auto 会让浏览器在 React 整体重建列表时重挑锚点，
            // 锚点一丢就落到列表末尾 —— 表现就是“往上滚，页面突然弹到底部”，而且不留任何 scrollTop 写记录。
          } catch (err) { /* 拿不到样式就按现有包含块 */ }
        }
        host.appendChild(pinLayerEl);
      }
      return pinLayerEl;
    }

    const PIN_HALF = 11; // 按钮 22px 的一半

    /** 气泡里第一个可见字符的位置（client 坐标）；取不到就退回 padding 估算。 */
    function firstTextPoint(root) {
      try {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        let guard = 0;
        while (node !== null && guard < 200) {
          guard += 1;
          const text = String(node.nodeValue || '');
          if (text.replace(/\s+/g, '') !== '') {
            const rng = document.createRange();
            rng.setStart(node, 0);
            rng.setEnd(node, 1);
            const rect = rng.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { x: rect.left, y: rect.top + rect.height / 2 };
            }
          }
          node = walker.nextNode();
        }
      } catch (err) { /* 退回估算 */ }
      const cs = window.getComputedStyle(root);
      const r = root.getBoundingClientRect();
      return { x: r.left + (parseFloat(cs.paddingLeft) || 0), y: r.top + r.height / 2 };
    }

    /**
     * 钉住按钮落点（client 坐标）：渲染与点击热区共用这一套，避免两份公式各算各的。
     * 折叠行：摘要文字末尾 + 2 字符，行内垂直居中。
     * 展开行（钉住态同此）：正文第一个字符前方 2 字符，垂直对齐那一行文字（不是整块中心）。
     */
    function pinAnchor(user) {
      const row = user.getBoundingClientRect();
      if (!(row.width > 60 && row.height > 0)) return null;
      if (user.getAttribute(LINE_ATTR) === '1') {
        const cs = window.getComputedStyle(user, '::after');
        const font = fontOf(cs);
        // 摘要文字盒的左右内缩以样式为准（CSS 改了这里自动跟上，不再硬编码 104/62）
        const padL = parseFloat(cs.left);
        const padR = parseFloat(cs.right);
        const textL = row.left + (isFinite(padL) ? padL : 104);
        const textR = row.right - (isFinite(padR) ? padR : 62);
        let tw = 0;
        try {
          const ctx = ctx2d();
          ctx.font = font;
          tw = ctx.measureText(user.getAttribute(TEXT_ATTR) || '').width;
        } catch (err) { tw = 0; }
        const endX = Math.min(textL + tw, textR);
        // “隔一个字符”按图标边缘到文字算：半个按钮宽 + 1 字符
        return {
          x: Math.min(endX + chWidthOf(font) + PIN_HALF, row.right - 34),
          y: row.top + row.height / 2
        };
      }
      const bubble = user.querySelector('[class*="_bubble"]');
      const box = bubble === null ? user : bubble;
      const pt = firstTextPoint(box);
      const font = fontOf(window.getComputedStyle(box));
      return { x: pt.x - chWidthOf(font) - PIN_HALF, y: pt.y };
    }

    function pinHotspot(rowEl, clientX, clientY) {
      const pos = pinAnchor(rowEl);
      if (pos === null) return false;
      return Math.abs(clientX - pos.x) <= 13 && Math.abs(clientY - pos.y) <= 13;
    }

    /**
     * 位置与点击热区都来自 pinAnchor()：折叠行在摘要末尾 +2 字符，展开行在正文首字前 2 字符。
     * 性能：每轮"只读一批、再只写一批"（读写不交替 => 不触发逐行强制重排）。
     * 坐标是内容坐标系（不随滚动变化），所以不用视口筛选：筛掉再恢复反而会造成 📌 忽隐忽现地"跳"。
     */
    let pinFixRaf = 0;
    let pinFixTimer = 0;
    let lastPinFlow = null;
    let lastPinRows = null;

    function pinFixOnce() {
      const flow = lastPinFlow;
      const rows = lastPinRows;
      if (flow === null || rows === null || !flow.isConnected || CFG.pin !== true) return;
      if (rows.length > 0 && !rows[0].user.isConnected) return;
      syncPins(flow, rows);
    }

    /** 行位置会被后续布局再改一次（日期头/图片/流式增高），一帧后再校正一次，150ms 内再兜一次。 */
    function schedulePinFix() {
      if (pinFixRaf !== 0) window.cancelAnimationFrame(pinFixRaf);
      pinFixRaf = window.requestAnimationFrame(function () {
        pinFixRaf = 0;
        pinFixOnce();
      });
      if (pinFixTimer !== 0) window.clearTimeout(pinFixTimer);
      pinFixTimer = window.setTimeout(function () {
        pinFixTimer = 0;
        pinFixOnce();
      }, 120);
    }

    function syncPins(flow, rendered) {
      if (pinHostNode === null || !pinHostNode.isConnected) {
        pinHostNode = scrollHostOf(flow) || document.body;
        pinHostSerial += 1;
      } else if (pinHostNode === document.body) {
        // 首次可能在布局完成前退到了 body，之后认出真容器就升级（坐标每轮全量重算，安全）
        const real = scrollHostOf(flow);
        if (real !== null && real !== pinHostNode) {
          pinHostNode = real;
          pinHostSerial += 1;
        }
      }
      const host = pinHostNode;
      watchScroll(host);
      const layer = pinLayer(host);
      const isBody = host === document.body;
      const scrollTop = isBody ? (window.pageYOffset || 0) : (host.scrollTop || 0);
      const scrollLeft = isBody ? (window.pageXOffset || 0) : (host.scrollLeft || 0);
      let hTop = 0;
      let hLeft = 0;
      if (!isBody) {
        const hr = host.getBoundingClientRect();
        hTop = hr.top;
        hLeft = hr.left;
      }
      // 📌 落在气泡内部：给用户气泡补左侧内缩（位置公式不变，只是腾出空间）
      let padCh = 0;
      let padFallback = 0;
      for (let i = rendered.length - 1; i >= 0; i -= 1) {
        const probe = rendered[i].user.querySelector('[class*="_bubble"]');
        if (probe === null) continue;
        const w = chWidthOf(fontOf(window.getComputedStyle(probe)));
        if (w <= 0) continue;
        if (rendered[i].user.getAttribute(LINE_ATTR) === '1') {
          if (padFallback === 0) padFallback = w;
          continue;
        }
        padCh = w;
        break;
      }
      if (padCh === 0) padCh = padFallback;
      if (CFG.pin === true && padCh > 0) {
        const pad = Math.round(PIN_HALF * 2 + padCh + 4) + 'px';
        if (flow.getAttribute(PINBOX_ATTR) !== '1') flow.setAttribute(PINBOX_ATTR, '1');
        if (flow.style.getPropertyValue('--dsh-ac-pinpad') !== pad) flow.style.setProperty('--dsh-ac-pinpad', pad);
      } else if (flow.getAttribute(PINBOX_ATTR) !== null) {
        flow.removeAttribute(PINBOX_ATTR);
        flow.style.removeProperty('--dsh-ac-pinpad');
      }
      const keep = new Set();
      const plan = [];
      if (CFG.pin === true) {
        // 阶段一：只读
        for (let i = 0; i < rendered.length; i += 1) {
          const user = rendered[i].user;
          const id = user.getAttribute('data-chat-turn');
          if (id === null) continue;
          keep.add(id);
          const on = pinned.has(id);
          const pos = pinAnchor(user);
          if (pos === null) {
            plan.push({ id, on, show: false });
            continue;
          }
          plan.push({
            id: id,
            on: on,
            show: true,
            x: Math.round(pos.x - hLeft + scrollLeft),
            y: Math.round(pos.y - hTop + scrollTop)
          });
        }
        // 阶段二：只写
        for (let i = 0; i < plan.length; i += 1) {
          const item = plan[i];
          let btn = pinBtns.get(item.id);
          if (btn !== undefined && (!btn.isConnected || btn.parentNode !== layer)) {
            btn = undefined;
            pinBtns.delete(item.id);
          }
          if (btn === undefined) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dsh-ac-pin';
            btn.setAttribute('data-ac-for', item.id);
            layer.appendChild(btn);
            pinBtns.set(item.id, btn);
          }
          const glyph = item.on ? '📌' : '📍';
          if (btn.textContent !== glyph) btn.textContent = glyph;
          const flag = item.on ? '1' : '0';
          if (btn.getAttribute('data-ac-on') !== flag) {
            btn.setAttribute('data-ac-on', flag);
            btn.setAttribute('aria-pressed', item.on ? 'true' : 'false');
          }
          const label = item.on ? t('unpin') : t('pin');
          if (btn.getAttribute('aria-label') !== label) {
            btn.setAttribute('aria-label', label);
            btn.setAttribute('title', label);
          }
          const show = item.show;
          const want = show ? 'inline-flex' : 'none';
          if (btn.style.display !== want) btn.style.display = want;
          if (!show) continue;
          btn.style.left = item.x + 'px';
          btn.style.top = item.y + 'px';
        }
      }
      pinBtns.forEach(function (btn, id) {
        if (keep.has(id) && CFG.pin === true && btn.isConnected) return;
        if (btn.parentNode !== null) btn.parentNode.removeChild(btn);
        pinBtns.delete(id);
      });
    }

    /* ---- A：时间线（日期分组吸头 / 连接线 / hover 预览） ------------------ */
    let previewEl = null;
    let previewFor = null;

    function dayKeyOf(stamp) {
      const m = /^(\d{2})-(\d{2}) /.exec(stamp || '');
      return m === null ? 'u' : m[1] + '-' + m[2];
    }

    function dayLabel(key) {
      if (key === 'u') return t('earlier');
      const now = new Date();
      const today = pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
      const prev = new Date(now.getTime() - 86400000);
      const yesterday = pad2(prev.getMonth() + 1) + '-' + pad2(prev.getDate());
      if (key === today) return t('today');
      if (key === yesterday) return t('yesterday');
      return key;
    }

    /** 幂等：只在缺失/错位/文字过期时动 DOM，避免和 MutationObserver 互相触发。 */
    function applyDays(flow, rendered) {
      const existing = Array.prototype.slice.call(flow.querySelectorAll('[' + DAY_ATTR + ']'));
      if (CFG.timeline !== true) {
        for (let i = 0; i < existing.length; i += 1) existing[i].parentNode.removeChild(existing[i]);
        return;
      }
      const desired = [];
      let lastKey = null;
      for (let i = 0; i < rendered.length; i += 1) {
        const key = dayKeyOf(rendered[i].stamp);
        if (key === lastKey) continue;
        lastKey = key;
        desired.push({ key, label: dayLabel(key), before: rendered[i].user });
      }
      const used = [];
      for (let i = 0; i < desired.length; i += 1) {
        const want = desired[i];
        let node = null;
        for (let j = 0; j < existing.length; j += 1) {
          if (used.indexOf(existing[j]) >= 0) continue;
          if (existing[j].getAttribute(DAY_ATTR) === want.key) {
            node = existing[j];
            break;
          }
        }
        if (node === null) {
          node = document.createElement('div');
          node.className = 'dsh-ac-day';
          node.setAttribute(DAY_ATTR, want.key);
        }
        used.push(node);
        if (node.textContent !== want.label) node.textContent = want.label;
        // 行可能在 React 重渲染的瞬间被摘掉：这时 insertBefore 会抛 NotFoundError，
        // 整个 apply 会中断（半边折叠、标题丢失 => 视口跳动）。
        if (want.before.parentNode === flow && node.nextSibling !== want.before) {
          flow.insertBefore(node, want.before);
        }
        let visible = 0;
        for (let sib = node.nextSibling; sib !== null; sib = sib.nextSibling) {
          if (sib.nodeType === 1 && sib.hasAttribute(DAY_ATTR)) break;
          if (sib.nodeType !== 1) continue;
          if (sib.getAttribute(FILTER_ATTR) === '1') continue;
          visible += 1;
        }
        node.style.display = visible === 0 ? 'none' : '';
      }
      for (let i = 0; i < existing.length; i += 1) {
        const node = existing[i];
        if (used.indexOf(node) >= 0 || node.parentNode === null) continue;
        // 只在"它后面已经没有行"时才删：rendered 暂时不完整时不删，否则每轮删了又插 = 上下跳
        let next = node.nextSibling;
        while (next !== null && next.nodeType !== 1) next = next.nextSibling;
        const dangling = next === null || next.hasAttribute(DAY_ATTR) || next.parentNode !== flow;
        if (dangling) node.parentNode.removeChild(node);
      }
    }

    function ensurePreview() {
      if (previewEl !== null && document.body.contains(previewEl)) return previewEl;
      previewEl = document.createElement('div');
      previewEl.id = 'dsh-ac-preview';
      previewEl.className = 'dsh-ac-preview';
      previewEl.setAttribute('role', 'tooltip');
      document.body.appendChild(previewEl);
      return previewEl;
    }

    function showPreview(row) {
      if (CFG.timeline !== true) return;
      const stamp = row.getAttribute(TIME_ATTR) || '';
      const text = row.getAttribute(TEXT_ATTR) || '';
      const el = ensurePreview();
      el.textContent = '';
      const head = document.createElement('div');
      head.className = 'dsh-ac-pv-head';
      head.textContent = stamp;
      const body = document.createElement('div');
      body.className = 'dsh-ac-pv-body';
      body.textContent = text.length > 300 ? text.slice(0, 300) + '…' : text;
      const hint = document.createElement('div');
      hint.className = 'dsh-ac-pv-hint';
      hint.textContent = t('preview');
      el.appendChild(head);
      el.appendChild(body);
      el.appendChild(hint);
      el.style.display = 'block';
      const rect = row.getBoundingClientRect();
      const h = el.offsetHeight;
      el.style.left = Math.max(8, rect.left) + 'px';
      el.style.top = Math.max(8, rect.top - h - 6) + 'px';
      el.style.maxWidth = Math.max(240, Math.min(520, rect.width * 0.9)) + 'px';
    }

    function onOut(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const row = target.closest('[' + LINE_ATTR + '="1"]');
      if (row === null) return;
      const to = event.relatedTarget;
      if (to instanceof Element && row.contains(to)) return;
      previewPending = null;
      if (previewTimer !== 0) {
        window.clearTimeout(previewTimer);
        previewTimer = 0;
      }
      hidePreview();
    }

    let previewTimer = 0;
    let previewPending = null;

    function onOver(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const row = target.closest('[' + LINE_ATTR + '="1"]');
      if (row === null) {
        hidePreview();
        return;
      }
      // 滚动中（或刚停下）不弹预览：滚轮让行从指针下滑过也会触发 mouseover，
      // 那样会"打开一个鼠标指针停留的会话"——其实用户根本没想打开它。
      if (Date.now() < scrollQuietUntil) {
        DBG.counters.pvSupp += 1;
        hidePreview();
        return;
      }
      if (previewFor === row) return;
      DBG.counters.pv += 1;
      dbg('PV+ ' + row.getAttribute(TIME_ATTR));
      previewPending = row;
      if (previewTimer !== 0) window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(function () {
        previewTimer = 0;
        if (previewPending !== row) return;
        if (!row.isConnected || Date.now() < scrollQuietUntil) return;
        if (previewFor === row) return;
        previewFor = row;
        showPreview(row);
      }, 160);
    }

    function markFresh(el) {
      if (el.getAttribute(FRESH_ATTR) === '1') return;
      el.setAttribute(FRESH_ATTR, '1');
      setTimeout(function () {
        el.removeAttribute(FRESH_ATTR);
      }, 200);
    }

    let hiddenSince = 0;

    /**
     * 滚动静默期：滚轮/滚动进行中，任何"改内容高度"的操作（日期头插入/移除、折叠切换）
     * 都会让滚动的可视区跟着跳。滚动时只推迟 apply，等停下 160ms 再算一次。
     */
    let scrollQuietUntil = 0;
    let scrollWatched = null;
    let scrollWatchedHost = null;

    /** 从滚轮/按键的落点向上找“真的在滚”的容器：挂错层会导致静默期根本进不去。 */
    function adoptScroller(target) {
      let node = target instanceof Element ? target : null;
      let guard = 0;
      while (node !== null && guard < 14) {
        guard += 1;
        if (node.nodeType === 1) {
          try {
            if (node.scrollHeight - node.clientHeight > 8) {
              if (scrollWatchedHost !== node) {
                scrollWatchedHost = node;
                DBG.lastTop = node.scrollTop;
                DBG.lastY = null;
              }
              bindScrollers(node);
              return;
            }
          } catch (err) { /* 忽略 */ }
        }
        node = node.parentElement;
      }
    }

    function noteScroll(event) {
      DBG.counters.wheel += 1;
      if (event !== undefined && event !== null && event.target !== null) adoptScroller(event.target);
      const host = scrollWatchedHost;
      if (host !== null && host.isConnected) {
        const st = host.scrollTop;
        DBG.counters.scrollN += 1;
        if (DBG.lastTop !== null) {
          const d = st - DBG.lastTop;
          // 一次滚动里位移超过 220px 就算“跳”（滚轮一档通常 100~130px）
          if (Math.abs(d) > 220) {
            DBG.counters.jump += 1;
            dbg('JUMP ' + Math.round(DBG.lastTop) + '->' + Math.round(st));
          }
        }
        DBG.lastTop = st;
      }
      scrollQuietUntil = Date.now() + 160;
      if (typeof hidePreview === 'function') hidePreview();
    }

    /** 系统/应用语言变了：预览与按钮提示文字要跟着换（“随系统设置”）。 */
    function watchLang() {
      try {
        window.addEventListener('languagechange', function () { apply(true); }, { passive: true });
      } catch (err) {
        /* 老内核没有这个事件 */
      }
    }

    const scrollBound = new WeakSet();

    /** 找到所有“真的在滚”的祖先并逐个挂监听：只挂一个容器时经常会挂错层。 */
    function bindScrollers(el) {
      let node = el;
      let guard = 0;
      while (node !== null && node !== document.documentElement && guard < 12) {
        guard += 1;
        if (node.nodeType === 1 && !scrollBound.has(node)) {
          let scrollable = false;
          try {
            scrollable = node.scrollHeight - node.clientHeight > 8;
          } catch (err) { /* 忽略 */ }
          if (scrollable) {
            scrollBound.add(node);
            node.addEventListener('scroll', noteScroll, { passive: true });
            if (scrollWatchedHost === null) scrollWatchedHost = node;
          }
        }
        node = node.parentElement;
      }
    }

    let samplerOn = false;
    let chatScroller = null;
    let lastLayoutSig = '';
    let switchedNow = false;
    let lastForkSig = '';
    let applyDepth = 0;

    /**
     * 采样兜底：无论滚动发生在哪个容器（事件常常收不到），只要聊天区在视口里的位置变了，
     * 就认为“用户正在滚动”，进入静默期。顺带统计“跳”：一帧内位移 > 220px。
     */
    function startSampler() {
      if (samplerOn) return;
      samplerOn = true;
      let frame = 0;
      const tick = function () {
        frame += 1;
        if (frame % 3 === 0 && document.visibilityState === 'visible') {
          const host = scrollWatchedHost;
          if (host !== null && host.isConnected && applyDepth === 0) {
            const y = host.scrollTop;
            if (DBG.lastY === null || DBG.lastY === undefined) {
              DBG.lastY = y;
            } else {
              const d = y - DBG.lastY;
              if (Math.abs(d) > 1) {
                DBG.counters.sampled += 1;
                if (Math.abs(d) > 220) {
                  DBG.counters.jump += 1;
                  dbg('JUMP(' + Math.round(DBG.lastY) + '->' + Math.round(y) + ')');
                }
                // 采样到滚动但事件没来（合成滚动/惯性）：也要进静默期
                scrollQuietUntil = Date.now() + 160;
              }
              DBG.lastY = y;
            }
          }
        }
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    }

    function watchScroll(host) {
      if (scrollWatched === null) {
        scrollWatched = true;
        watchLang();
        startSampler();
        document.addEventListener('scroll', noteScroll, { passive: true, capture: true });
        window.addEventListener('wheel', noteScroll, { passive: true, capture: true });
        window.addEventListener('touchmove', noteScroll, { passive: true, capture: true });
        document.addEventListener('keydown', noteScroll, { passive: true, capture: true });
      }
      if (host !== null && host !== document.body) bindScrollers(host);
    }

    /** 只清“缓存”，保留 expandedId / 钉住：容器一时空掉不该把展开状态清成最新一条。 */
    function dropSeen() {
      // 只丢掉节点引用，**绝不丢掉 seenIds**：加载更早 / 虚拟滚动会让 flow 闪空一帧，
      // 一旦清空参照系，回来的列表就会被当成“首次渲染”或“换会话”，把展开目标改掉。
      seenNodes = [];
    }

    function resetState() {
      DBG.counters.reset += 1;
      dbg('RESET');
      expandedId = null;
      seenIds = [];
      seenNodes = [];
      disjointSince = 0;
      userFolded = false;
    }

    /** 任意一行有盒子就算视图可见：只看第一行会被我们自己折叠掉的节点误判。 */
    function hasVisibleRow(flow) {
      const rows = flow.querySelectorAll(ITEM_SEL);
      const limit = Math.min(rows.length, 40);
      for (let i = 0; i < limit; i++) {
        if (rows[i].getClientRects().length > 0) return true;
      }
      return false;
    }

    /** 新 id 集是旧集的前缀 = 尾部整段消失（换会话/整批替换）；虚拟滚动只会掐掉头部。 */
    function isAppend(prev, ids) {
      if (prev.length === 0 || ids.length <= prev.length) return false;
      for (let i = 0; i < prev.length; i++) {
        if (ids[i] !== prev[i]) return false;
      }
      return true;
    }

    /**
     * 决定当前唯一展开的轮次：
     *   整批替换（无交集）= 换会话 → 最新；新轮追加 → 最新；
     *   向上加载历史（交集仍在）= 保持；展开目标消失 → 最新。
     */
    function trackExpanded(list) {
      const ids = list.map(function (group) {
        return group.id;
      });
      if (ids.length === 0) return ids;
      const last = ids[ids.length - 1];
      const prev = seenIds;
      let overlap = false;
      for (let i = 0; i < ids.length; i++) {
        if (prev.indexOf(ids[i]) !== -1) {
          overlap = true;
          break;
        }
      }
      // 换会话 = 两次列表“完全不交集”（不是 key 变、也不是闪空），且这个状态持续一小段时间。
      // 首屏、加载更早、React 整批重建都会短暂不交集，靠时间窗把它们滤掉。
      const disjoint = !overlap && prev.length >= 2 && ids.length >= 2;
      if (disjoint) {
        if (disjointSince === 0) disjointSince = Date.now();
      } else {
        disjointSince = 0;
      }
      // 120ms ≈ 两帧：容器闪空在这一层已经被“0 行直接返回”挡住，整批重建也会带着旧 id 回来，
      // 只有真的换了会话才会持续“完全不交集”。
      // 再加一条：**必须停在底部**才算换会话。真换会话会落到底部的新最新一条；
      // 而“往上滚 + 加载更早”会让虚拟窗口整体换一批 id（看起来完全不交集），
      // 这时绝不能再改展开目标 —— 那就是“滚上去突然打开别的会话 / 滚动条跳”。
      let awayNow = 0;
      try {
        const sc = chatScrollerFor(flowRef) || scrollWatchedHost;
        if (sc !== null && sc.isConnected) {
          awayNow = Math.max(0, sc.scrollHeight - sc.scrollTop - sc.clientHeight);
        }
      } catch (err) { awayNow = 0; }
      // 最后一道锁：会话 key 真的变了才算换会话。
      // “加载更早”会把虚拟窗口整批换成另一批 id（看起来完全不交集、而且此刻可能正贴着底部），
      // 光靠结构判据分不开它和换会话；key 没变就一律当成同一会话内的窗口移动。
      const keyNow = sessionIdOf() || '';
      const keyMoved = keyNow !== '' && lastTrackKey !== '' && keyNow !== lastTrackKey;
      lastTrackKey = keyNow;
      const realSwitch = disjoint && Date.now() - disjointSince >= 120 && awayNow <= 48 &&
        (keyNow === '' || keyMoved);
      switchedNow = false;
      if (realSwitch) {
        // 真的换了会话（两次列表完全不交集）：回到“只展开最新一条”
        switchedNow = true;
        userFolded = false;
        expandedId = last;
        seenIds = ids;
        seenNodes = [];
        disjointSince = 0;
        for (let i = 0; i < list.length; i += 1) {
          for (let j = 0; j < list[i].items.length; j += 1) seenNodes.push(list[i].items[j]);
        }
        return ids;
      }
      // 展开目标只允许在两种情况下自动改变：还没有目标（且用户没主动收起）、新轮追加。
      // 其余一切 —— 虚拟滚动把行卸载、加载更早、React 整批重建、key 抖动、容器闪空 ——
      // 都必须保持不动。以前这里的 `!keepCurrent` / `isChopTail` 分支就是“收起最近一条、
      // 打开别的、视口上下跳”的直接来源：展开目标一旦被虚拟卸载，ids 里就找不到它。
      if (expandedId === null && userFolded !== true) {
        expandedId = last;
      } else if (isAppend(prev, ids)) {
        expandedId = last;
      }
      if (!disjoint) seenIds = ids;
      seenNodes = [];
      for (let i = 0; i < list.length; i += 1) {
        for (let j = 0; j < list[i].items.length; j += 1) seenNodes.push(list[i].items[j]);
      }
      return ids;
    }

    function apply(force) {
      applyDepth += 1;
      try {
        return applyInner(force);
      } finally {
        applyDepth -= 1;
      }
    }

    /** 真正在滚的容器：从一条“当前 DOM 里的行”向上找，避免拿到过期 flow 的祖先链。 */

    function chatScrollerFor(flow) {
      if (chatScroller !== null && chatScroller.isConnected && chatScroller.contains(flow)) return chatScroller;
      let probe = flow;
      try {
        const row = flow.querySelector('[data-chat-turn]');
        if (row !== null) probe = row;
      } catch (err) { /* 忽略 */ }
      let node = probe;
      let guard = 0;
      while (node !== null && guard < 24) {
        guard += 1;
        if (node.nodeType === 1) {
          try {
            if (node.scrollHeight - node.clientHeight > 8) {
              chatScroller = node;
              return node;
            }
          } catch (err) { /* 忽略 */ }
        }
        node = node.parentElement;
      }
      chatScroller = null;
      return null;
    }

    /** 会影响布局的那几件事（日期头）只在“语义签名”变化时才做。 */
    function layoutSignature(rendered, pinnedIds) {
      let sig = String(expandedId) + ':' + rendered.length;
      let day = null;
      for (let i = 0; i < rendered.length; i += 1) {
        const k = dayKeyOf(rendered[i].stamp);
        if (k === day) continue;
        day = k;
        sig += ' d' + k;
      }
      for (let i = 0; i < pinnedIds.length; i += 1) sig += ' p' + pinnedIds[i];
      return sig;
    }

    function applyInner(force) {
      // 滚动中：折叠/展开必须照做 —— 推迟只会让“新挂载的行先以全高画出来、下一帧才折”，
      // 流式输出每秒重渲染多次时高度就一涨一缩，右侧滚动条于是来回跳。
      // 只推迟“插/删日期头”这类成批改高度的动作，滚停后再补。
      const quietNow = force !== true && Date.now() < scrollQuietUntil;
      if (quietNow) {
        if (pinsSyncAllowed()) {
          try {
            if (lastPinFlow !== null && lastPinFlow.isConnected) syncPins(lastPinFlow, lastPinRows);
          } catch (err) { /* 覆盖层刷新失败不影响主流程 */ }
        }
        window.setTimeout(schedule, Math.min(400, scrollQuietUntil - Date.now() + 40));
      }
      ensureStyle();
      const flow = findFlow();
      if (flow === null || !flow.isConnected) {
        DBG.counters.rFlow += 1;
        dbg('Rflow');
        dropSeen();
        hiddenSince = 0;
        return 0;
      }
      flowRef = flow;
      const list = groups(flow);
      if (list.length === 0) {
        DBG.counters.rEmpty += 1;
        dbg('Rempty n=' + flow.children.length);
        dropSeen();
        hiddenSince = 0;
        return 0;
      }
      // 视图被隐藏（切会话/切面板）：保留状态并跳过渲染；隐藏超过 1.5s 后
      // 再次可见视为"重新打开会话"，回到只展开最新一条。
      if (!hasVisibleRow(flow)) {
        DBG.counters.noVis += 1;
        dbg('NOVIS');
        if (hiddenSince === 0) hiddenSince = Date.now();
        return 0;
      }
      if (hiddenSince !== 0 && Date.now() - hiddenSince > 1500) resetState();
      hiddenSince = 0;
      const beforeExpanded = expandedId;
      const key = sessionKey(flow);
      let restored = null;
      if (key !== memKey) {
        restored = loadMem(key);
        DBG.counters.keyChange += 1;
        dbg('KEY ' + String(memKey) + ' -> ' + String(key));
      }
      const ids = trackExpanded(list);
      // 记忆只在“真换会话”时恢复。同一个会话内滚动导致 key 抖动时，
      // 恢复旧记忆会把展开目标换成历史上某一条 —— 这正是“收起最新一条又打开别的”的来源。
      if (switchedNow && restored !== null && restored.expanded !== undefined &&
          restored.expanded !== null && ids.indexOf(String(restored.expanded)) !== -1) {
        expandedId = String(restored.expanded);
        DBG.counters.memRestore += 1;
      }
      if (!logged && list.length > 0) {
        logged = true;
        console.info('[auto-collapse] active: turns=' + list.length + ' expanded=' + expandedId);
      }
      DBG.counters.apply += 1;
      if (Date.now() < scrollQuietUntil) DBG.counters.applyDuringScroll += 1;
      if (DBG.lastExpanded !== expandedId) {
        if (DBG.lastExpanded !== null || expandedId !== null) {
          DBG.counters.flip += 1;
          dbg('FLIP ' + String(DBG.lastExpanded).slice(-6) + ' -> ' + String(expandedId).slice(-6));
        }
        DBG.lastExpanded = expandedId;
      }
      if (force !== true && beforeExpanded !== null && Date.now() < scrollQuietUntil &&
          ids.indexOf(beforeExpanded) !== -1 && expandedId !== beforeExpanded) {
        expandedId = beforeExpanded;
        DBG.counters.keepDuringScroll += 1;
      }
      const hWhole0 = flow.scrollHeight;
      const scroller = chatScrollerFor(flow) || scrollWatchedHost;
      stats.passes += 1;
      stats.rows += list.length;
      const rendered = [];
      for (let i = 0; i < list.length; i += 1) {
        const group = list[i];
        const expanded = group.id === expandedId || isPinned(group.id);
        const parts = pick(group);
        const user = parts.user;
        if (user === null) continue;
        const bubble = user.querySelector('[class*="_bubble"]');
        const stamp = stampOf(user, bubble);
        const body = expanded ? '' : (summaryOf(bubble, user) || '（无正文）');
        rendered.push({ user, stamp, body });
        const matched = query !== '' && !expanded && body.toLowerCase().indexOf(query.toLowerCase()) !== -1;
        if (query !== '' && !expanded) {
          setAttr(user, FILTER_ATTR, matched ? '0' : '1');
          if (matched) {
            setAttr(user, HIT_ATTR, '1');
            if (matches.indexOf(group.id) < 0) matches.push(group.id);
          } else {
            user.removeAttribute(HIT_ATTR);
          }
        } else {
          user.removeAttribute(FILTER_ATTR);
          user.removeAttribute(HIT_ATTR);
        }
        const sameRest = lastRest.get(user) === parts.rest[0];
        const head = (expanded ? '1' : '0') + '|' + stamp + '|' + body + '|' + parts.rest.length + '|' + sigGen;
        if (CFG.incremental !== false && sameRest && rowState.get(user) === head + '|1') {
          stats.skipped += 1;
          continue;
        }
        lastRest.set(user, parts.rest[0]);
        rowState.set(user, head + '|1');

        setAttr(user, USER_ATTR, '1');
        user.removeAttribute(HIDE_ATTR);
        setAttr(user, PIN_ATTR, isPinned(group.id) ? '1' : '0');
        setAttr(user, 'role', 'button');
        setAttr(user, 'tabindex', '0');
        setAttr(user, 'aria-expanded', expanded ? 'true' : 'false');
        const rowLabel = (t('turn') === '第' ? '第 ' + (i + 1) + ' 轮' : 'turn ' + (i + 1)) +
          (stamp ? ' · ' + stamp : '') + (body ? ' · ' + body.slice(0, 60) : '');
        setAttr(user, 'aria-label', rowLabel);
        if (expanded) {
          user.removeAttribute(LINE_ATTR);
          user.removeAttribute(TEXT_ATTR);
          user.removeAttribute(TIME_ATTR);
        } else {
          setAttr(user, LINE_ATTR, '1');
          if (stamp) setAttr(user, TIME_ATTR, stamp);
          else user.removeAttribute(TIME_ATTR);
          setAttr(user, TEXT_ATTR, body);
        }
        for (let j = 0; j < parts.rest.length; j += 1) {
          const el = parts.rest[j];
          if (expanded) {
            if (el.hasAttribute(HIDE_ATTR)) {
              el.removeAttribute(HIDE_ATTR);
              stats.writes += 1;
              markFresh(el);
            }
          } else {
            setAttr(el, HIDE_ATTR, '1');
          }
        }
      }
      if (query !== '') {
        const keep = [];
        for (let i = 0; i < rendered.length; i += 1) {
          const id = rendered[i].user.getAttribute('data-chat-turn');
          if (matches.indexOf(id) >= 0) keep.push(id);
        }
        matches = keep;
      } else {
        matches = [];
      }
      const countEl = document.querySelector('#dsh-ac-search .dsh-ac-count');
      if (countEl !== null) {
        countEl.textContent = query === '' ? '' : (matches.length === 0 ? t('noMatch') : (Math.min(matchIdx, matches.length - 1) + 1) + '/' + matches.length);
      }
      const daysBefore = flow.querySelectorAll('[' + DAY_ATTR + ']').length;
      const hBefore = flow.scrollHeight;
      const pinnedIds = [];
      pinned.forEach(function (id) { pinnedIds.push(id); });
      pinnedIds.sort();
      const layoutSig = layoutSignature(rendered, pinnedIds);
      const layoutSame = layoutSig === lastLayoutSig;
      lastLayoutSig = layoutSig;
      if (!layoutSame && !quietNow) applyDays(flow, rendered);
      const daysAfter = flow.querySelectorAll('[' + DAY_ATTR + ']').length;
      const hAfter = flow.scrollHeight;
      if (daysAfter > daysBefore) DBG.counters.daysAdd += daysAfter - daysBefore;
      if (daysAfter < daysBefore) DBG.counters.daysDel += daysBefore - daysAfter;
      if (hAfter !== hBefore) { DBG.counters.hChange += 1; dbg('H ' + hBefore + '->' + hAfter + ' exp=' + expandedId); }
      if (DBG.lastH !== 0 && hAfter !== DBG.lastH) { dbg('Hcum ' + DBG.lastH + '->' + hAfter); }
      DBG.lastH = hAfter;
      // 分叉徽标单独签名：它只在“有没有分叉/层级/标题”变化时才该动，
      // 但也不能被 layoutSame 一起跳过（否则会话切走之后徽标会赖着不走）。
      const forkInfoNow = forkInfo();
      const forkSig = forkInfoNow === null ? 'none' : ('L' + forkInfoNow.depth + '|' + String(forkInfoNow.title));
      if (forkSig !== lastForkSig) {
        lastForkSig = forkSig;
        applyForkChip(flow);
      }
      // 放在最后一次会改变行位置的 DOM 操作之后：日期头/分叉徽标会让所有行下移，
      // 先写坐标就会整体错位（真机"图标乱放"的根因之一）。
      if (!quietNow || pinsSyncAllowed()) syncPins(flow, rendered);
      lastPinFlow = flow;
      lastPinRows = rendered;
      schedulePinFix();
      saveMem();
      // 这里以前会 `scroller.scrollTop = st0 + delta` 做“事后抵账”。那一句就是
      // “页面不动但右侧滚动条在抖”的来源：插件每 pass 写一次 scrollTop，应用的滚动
      // 监听再回写一次，两边对着写 → 滚动条来回抽。现在插件对滚动位置**只读**，
      // 高度变化引起的视口位移交给浏览器原生滚动锚定（overflow-anchor:auto）。
      if (flow.scrollHeight !== hWhole0) {
        DBG.counters.hWhole += 1;
        dbg('HW ' + hWhole0 + '->' + flow.scrollHeight);
      }
      return list.length;
    }

    function toggle(el) {
      const id = el.getAttribute('data-chat-turn');
      if (!id) return;
      if (isPinned(id)) return;
      expandedId = expandedId === id ? null : id;
      userFolded = expandedId === null;
      apply(true);
      announce((expandedId === id ? t('expand') : t('collapse')) + ' · ' + id);
    }

    function onClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const pinBtn = target.closest('.dsh-ac-pin');
      if (pinBtn !== null) {
        event.preventDefault();
        event.stopPropagation();
        const id = pinBtn.getAttribute('data-ac-for');
        if (id) togglePin(id);
        return;
      }
      const pinRow = target.closest('[data-chat-turn]');
      if (CFG.pin === true && pinRow !== null && pinHotspot(pinRow, event.clientX, event.clientY)) {
        event.preventDefault();
        event.stopPropagation();
        const rowId = pinRow.getAttribute('data-chat-turn');
        if (rowId) togglePin(rowId);
        return;
      }
      if (target.closest('a,button') !== null) return;
      const line = target.closest('[' + LINE_ATTR + '="1"]');
      if (line !== null) {
        event.preventDefault();
        toggle(line);
        return;
      }
      const user = target.closest('[' + USER_ATTR + '="1"]');
      if (user === null) return;
      const selection = window.getSelection();
      if (selection !== null && String(selection).length > 0) return;
      toggle(user);
    }

    function onKeyDown(event) {
      const key = event.key;
      const lower = key === undefined ? '' : String(key).toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      // 注意：Ctrl+Shift+F 是 DSH 自带的查找/跳转面板（真机实测按下去弹的是应用的条），
      // 所以搜索改用 Ctrl+Alt+F；再留一个 Ctrl+Shift+K 备用（避开应用自带快捷键）。
      const searchKey = mod && ((event.altKey && lower === 'f') || (event.shiftKey && lower === 'k'));
      if (CFG.search === true && searchKey) {
        event.preventDefault();
        if (searchOpen) closeSearch();
        else openSearch();
        return;
      }
      if (key === 'Escape' && searchOpen) {
        event.preventDefault();
        closeSearch();
        return;
      }
      const el = event.target instanceof Element ? event.target : null;
      const typing = el !== null && (el.closest('input,textarea,select,[contenteditable="true"]') !== null);
      if (!typing && (key === 'j' || key === 'k')) {
        event.preventDefault();
        navigate(key === 'j' ? 1 : -1);
        return;
      }
      if (!typing && key === 'Escape') {
        event.preventDefault();
        expandedId = null;
        userFolded = true;      // 用户主动全收：下一次 apply 不许又把最新一条弹开
        apply(true);
        announce(t('collapse'));
        return;
      }
      if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('a,button') !== null) return;
      const row = target.closest('[' + USER_ATTR + '="1"]');
      if (row === null) return;
      event.preventDefault();
      toggle(row);
    }

    /** 预览气泡收尾（时间线特性关闭时为空操作）。 */
    let hidePreview = function () {
      if (previewEl !== null) previewEl.style.display = 'none';
      previewFor = null;
    };

    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        try {
          apply();
        } catch (err) {
          console.warn('[auto-collapse] apply failed', err);
        }
      });
    }

    /** 测试钩子：把“记住的上一批行 / 展开目标”清干净，模拟一次真·首屏。 */
    function forgetAll() {
      expandedId = null;
      seenIds = [];
      seenNodes = [];
      disjointSince = 0;
      userFolded = false;
      DBG.lastExpanded = null;
      lastLayoutSig = '';
    }

    function report() {
      const flow = findFlow();
      if (flow === null) return { flow: false, expandedId };
      return {
        flow: true,
        expandedId,
        turns: groups(flow).map(function (group) {
          const parts = pick(group);
          const bubble = parts.user === null ? null : parts.user.querySelector('[class*="_bubble"]');
          return {
            id: group.id,
            expanded: group.id === expandedId,
            stamp: parts.user === null ? '' : stampOf(parts.user, bubble),
            summary: parts.user === null ? '' : summaryOf(bubble, parts.user).slice(0, 60),
            items: group.items.length,
          };
        }),
      };
    }

    let observer = null;
    let flowRef = null;
    const IGNORE_SEL = '#dsh-ac-dbg,.dsh-ac-pinlayer,.dsh-ac-preview,#dsh-ac-search';

    /** 只关心聊天区里的变化（侧栏计时、状态栏、面板框架的抖动都不该触发重排）。 */
    function inChatTree(el) {
      const flow = flowRef;
      if (flow === null || !flow.isConnected) return true;
      if (flow === el || flow.contains(el)) return true;
      if (typeof el.contains === 'function' && el.contains(flow)) return true;
      return false;
    }

    /** 我们自己的写入会触发 observer：不过滤就会“apply -> 写 DOM -> apply”无限循环。 */
    function addsTurnRows(records) {
      for (let i = 0; i < records.length; i += 1) {
        const added = records[i].addedNodes;
        for (let j = 0; j < added.length; j += 1) {
          const n = added[j];
          if (!(n instanceof Element)) continue;
          if (n.matches('[data-chat-turn]') || n.closest('[data-chat-turn]') !== null) return true;
          if (n.querySelector('[data-chat-turn]') !== null) return true;
        }
      }
      return false;
    }

    function mutationMatters(records) {
      for (let i = 0; i < records.length; i += 1) {
        const tgt = records[i].target;
        if (!(tgt instanceof Element)) continue;
        if (tgt.closest(IGNORE_SEL) !== null) continue;
        if (tgt.hasAttribute(DAY_ATTR)) continue;
        if (inChatTree(tgt)) return true;
      }
      return false;
    }
    let timer = 0;
    let disposed = false;
    let lastSyncApply = 0;
    let lastPinSync = 0;

    // 📌 覆盖层的位置是内容坐标，滚动时本来就不该变；
    // 滚动中最多 90ms 量一次几何，滚停后的那次 apply 一定全量校正。
    function pinsSyncAllowed() {
      const now = Date.now();
      if (now < scrollQuietUntil && now - lastPinSync < 90) return false;
      lastPinSync = now;
      return true;
    }

    function stop() {
      disposed = true;
      started = false;
      if (timer) {
        clearInterval(timer);
        timer = 0;
      }
      if (observer !== null) {
        try {
          observer.disconnect();
        } catch (err) {
          /* 已断开 */
        }
        observer = null;
      }
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      hidePreview();
    }

    function start() {
      if (started) return;
      started = true;
      disposed = false;
      ensureStyle();
      applyTheme();
      ensureFindButton();
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('mouseover', onOver, true);
      document.addEventListener('mouseout', onOut, true);
      try {
        observer = new MutationObserver(function (records) {
          DBG.counters.mut += 1;
          if (!mutationMatters(records)) return;
          // 同步跑一次折叠（MutationObserver 回调是微任务，早于本帧绘制）：
          // 新挂载的过程行在这一帧就是折叠态，不会出现“先全高、后收缩”的高度抖动。
          if (applyDepth > 0) { schedule(); return; }
          const now = Date.now();
          if (now - lastSyncApply < 12) { schedule(); return; }
          // 滚动中只有“新增了轮次行”才值得立刻同步折叠（那是唯一会让行先高后低的情况）；
          // 流式输出改的是文本节点，视觉上高度不变，交给 rAF 节流即可。
          // 否则每来一次 delta 就在主线程跑一遍全表 apply，用户边滚边卡。
          if (Date.now() < scrollQuietUntil && !addsTurnRows(records)) { schedule(); return; }
          lastSyncApply = now;
          try {
            apply();
          } catch (err) {
            console.warn('[auto-collapse] sync apply failed', err);
            schedule();
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      } catch (err) {
        console.warn('[auto-collapse] observer unavailable', err);
      }
      window.addEventListener('resize', schedule);
      window.addEventListener('resize', placeFind);
      window.setTimeout(placeFind, 900);
      window.setTimeout(placeFind, 2600);
      timer = setInterval(schedule, 1500);
      setTimeout(schedule, 300);
      window.__acForget = forgetAll;
    window.__acReport = report;
      window.__acStop = stop;
      window.__acStart = start;
      window.__acConfig = function (next) {
        if (next !== null && typeof next === 'object') {
          CFG = Object.assign({}, CFG, next);
          sigGen += 1;
          try {
            window.localStorage.setItem(CFG_KEY, JSON.stringify(CFG));
          } catch (err) {
            /* 私密模式：只生效本次会话 */
          }
          ensureStyle();
          applyTheme();
          try {
            apply(true);
          } catch (err) {
            schedule();
          }
        }
        return Object.assign({}, CFG);
      };
      window.__acAnnounce = announce;
      window.__acSearch = function (open) {
        if (open === true) openSearch();
        else if (open === false) closeSearch();
        return { open: searchOpen, query };
      };
      window.__acDebug = { fmtTime: fmtTime, normalizeClock: normalizeClock, t: t, stats: stats, apply: apply, rowState: rowState };
      console.info('[auto-collapse] ready — window.__acReport() 查看结构诊断');
    }

    /* 内核兜底（2026-11-04）：长 / 压缩会话点「加载更早」到第 3–4 页后，会话视图重建抛
       `conversation Definition "system-message" withdrew materialized target "chat"`；
       该异常被订阅通知层吞掉，快照不再发布 → 画面停在旧内容，按钮看起来失效。
       修法：包住 system-message / request-prompt 的 buildViewNode——原实现返回 null 且该
       context 已有 chat 节点时，返回同一 key 且 `visibility:"hidden"`（错误信息要求的写法，
       也是核心 assistant-message Definition 同款）。未物化过的 context 仍返回 null。
       结构认不出就不动作；异常只 warn；不改配置、不改会话文件、不碰 app.asar。 */
    const GUARD_KINDS = ['system-message', 'request-prompt'];
    const GUARD_MARK = '__acWithdrawGuard';
    const guardSubscribed = new WeakSet();
    const guardState = { installed: [], hits: 0, active: false };
    let disposeHooked = false;

    function guardDefinition(kind, definition) {
      if (definition === null || typeof definition !== 'object') return false;
      if (typeof definition.buildViewNode !== 'function') return false;
      if (definition[GUARD_MARK] === true) return true;
      const original = definition.buildViewNode;
      definition.buildViewNode = function buildViewNode(context) {
        const node = original.call(this, context);
        if (node !== null && node !== void 0) return node;
        try {
          const map = context === null || context === void 0 ? void 0 : context.current;
          if (map === null || map === void 0 || typeof map.get !== 'function') return node;
          const current = map.get('chat');
          if (current === null || current === void 0 || typeof current !== 'object') return node;
          if (current.visibility === 'hidden') return current;
          guardState.hits += 1;
          return Object.assign({}, current, { visibility: 'hidden' });
        } catch (err) {
          return node;
        }
      };
      definition[GUARD_MARK] = true;
      if (guardState.installed.indexOf(kind) < 0) guardState.installed.push(kind);
      return true;
    }

    function guardRegistry(events) {
      if (events === null || typeof events !== 'object') return false;
      const definitions = events.definitions;
      if (definitions === null || definitions === void 0 || typeof definitions.get !== 'function') return false;
      let guarded = 0;
      for (let i = 0; i < GUARD_KINDS.length; i += 1) {
        try {
          if (guardDefinition(GUARD_KINDS[i], definitions.get(GUARD_KINDS[i]))) guarded += 1;
        } catch (err) {
          /* 保持内核原行为 */
        }
      }
      const complete = guarded === GUARD_KINDS.length;
      if (complete && guardState.active === false) {
        guardState.active = true;
        console.info('[auto-collapse] withdraw guard active');
      }
      return complete;
    }

    function installWithdrawGuard(ctx) {
      if (CFG.guard === false) return;
      try {
        let conversation = void 0;
        try {
          conversation = ctx === null || ctx === void 0 ? void 0 : ctx.uiConversation;
        } catch (err) {
          conversation = void 0;
        }
        if ((conversation === void 0 || conversation === null) && ctx !== null && ctx !== void 0 && typeof ctx.get === 'function') {
          try {
            conversation = ctx.get('uiConversation');
          } catch (err) {
            conversation = void 0;
          }
        }
        if (conversation === void 0 || conversation === null) {
          if (ctx !== null && ctx !== void 0 && typeof ctx.inject === 'function') {
            try {
              ctx.inject(['uiConversation'], function (child) {
                installWithdrawGuard(child);
              });
            } catch (err) {
              console.warn('[auto-collapse] withdraw guard inject failed', err);
            }
          }
          return;
        }
        const events = conversation.events;
        if (events === void 0 || events === null) return;
        guardRegistry(events);
        if (typeof events.subscribe === 'function' && !guardSubscribed.has(events)) {
          guardSubscribed.add(events);
          try {
            events.subscribe(function () {
              guardRegistry(events);
            });
          } catch (err) {
            guardSubscribed.delete(events);
          }
        }
        try {
          window.__acWithdrawGuard = guardState;
        } catch (err) {
          /* 诊断用，失败无妨 */
        }
      } catch (err) {
        console.warn('[auto-collapse] withdraw guard skipped', err);
      }
    }

    return {
      inject: [],
      apply(ctx) {
        try {
          start();
        } catch (err) {
          console.warn('[auto-collapse] start failed', err);
        }
        if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function' && !disposeHooked) {
          disposeHooked = true;
          try {
            ctx.effect(function () {
              return function () {
                stop();
              };
            });
          } catch (err) {
            disposeHooked = false;
          }
        }
        installWithdrawGuard(ctx);
      },
    };
  },
});
