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
    const DAY_ATTR = 'data-ac-day';

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
      },
      en: {
        pin: 'Pin', unpin: 'Unpin', search: 'Search prompts', searchHint: 'Type to filter · Enter next · Esc close',
        noMatch: 'No match', today: 'Today', yesterday: 'Yesterday', earlier: 'Earlier', preview: 'Click to expand',
        fork: 'Fork', turns: 'turns', searchLabel: 'Filter folded turns by prompt text', pinLabel: 'Pin this turn so new messages keep it open',
      },
    };

    function lang() {
      if (CFG.i18n === 'zh' || CFG.i18n === 'en') return CFG.i18n;
      try {
        return /^zh/i.test(window.navigator.language || '') ? 'zh' : 'en';
      } catch (err) {
        return 'zh';
      }
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

        '[' + LINE_ATTR + '="1"]::before{content:attr(' + TIME_ATTR + ');position:absolute;',
        '  left:8px;top:50%;transform:translateY(-50%);width:86px;text-align:center;',
        '  font-size:11px;line-height:18px;border-radius:999px;white-space:nowrap;',
        '  font-variant-numeric:tabular-nums;letter-spacing:.02em;',
        '  color:var(--dsw-alias-label-tertiary,#9aa0a6);',
        '  background:rgba(127,127,127,.16);pointer-events:none}',
        '[' + LINE_ATTR + '="1"]:not([' + TIME_ATTR + '])::before{content:none}',

        '[' + LINE_ATTR + '="1"]::after{content:attr(' + TEXT_ATTR + ');position:absolute;',
        '  left:104px;right:28px;top:50%;transform:translateY(-50%);',
        '  font-size:.92em;line-height:1.5em;white-space:nowrap;overflow:hidden;',
        '  text-overflow:ellipsis;color:var(--dsw-alias-label-secondary,#c9c9c9)}',
        '[' + LINE_ATTR + '="1"]:not([' + TIME_ATTR + '])::after{left:12px}',

        '[' + LINE_ATTR + '="1"]:hover{background-color:rgba(127,127,127,.10)}',
        '[' + LINE_ATTR + '="1"]:hover::after{color:var(--dsw-alias-label-primary,#fff)}',
        '[' + LINE_ATTR + '="1"]:active{background-color:rgba(127,127,127,.18)}',

        '[data-ac-user="1"]{position:relative}',
        '.dsh-ac-pin{position:absolute;right:2px;top:50%;transform:translateY(-50%);width:20px;height:20px;',
        '  display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:6px;',
        '  font-size:11px;line-height:1;cursor:pointer;opacity:.42;background:transparent;',
        '  color:inherit;transition:opacity .12s ease,background-color .12s ease}',
        '.dsh-ac-pin:hover{opacity:1;background:rgba(127,127,127,.18)}',
        '[data-ac-pinned="1"] .dsh-ac-pin{opacity:1}',
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
    let memKey = '';
    let savedState = '';

    function sessionKey(flow) {
      let title = '';
      try {
        const row = document.querySelector('[data-ft-session][aria-current="true"],[data-ft-session][data-active="true"]');
        if (row !== null) title = (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      } catch (err) {
        title = '';
      }
      const first = flow.querySelector('[data-chat-turn]');
      const head = first !== null ? (first.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      let path = '';
      try {
        path = window.location.pathname || '';
      } catch (err) {
        path = '';
      }
      const seed = title + '|' + head + '|' + path;
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
      apply();
    }

    function ensurePinButton(user) {
      if (CFG.pin !== true) {
        const old = user.querySelector('.dsh-ac-pin');
        if (old !== null) old.parentNode.removeChild(old);
        return;
      }
      let btn = user.querySelector('.dsh-ac-pin');
      if (btn === null) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dsh-ac-pin';
        user.appendChild(btn);
      }
      const id = user.getAttribute('data-chat-turn');
      const on = pinned.has(id);
      if (btn.getAttribute('aria-pressed') !== (on ? 'true' : 'false')) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = on ? '📌' : '📌';
        btn.setAttribute('aria-label', on ? t('unpin') : t('pin'));
        btn.setAttribute('title', on ? t('unpin') : t('pin'));
      }
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
        if (node.nextSibling !== want.before) flow.insertBefore(node, want.before);
      }
      for (let i = 0; i < existing.length; i += 1) {
        if (used.indexOf(existing[i]) < 0 && existing[i].parentNode !== null) {
          existing[i].parentNode.removeChild(existing[i]);
        }
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
      hidePreview();
    }

    function onOver(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const row = target.closest('[' + LINE_ATTR + '="1"]');
      if (row === null) {
        hidePreview();
        return;
      }
      if (previewFor === row) return;
      previewFor = row;
      showPreview(row);
    }

    function markFresh(el) {
      if (el.getAttribute(FRESH_ATTR) === '1') return;
      el.setAttribute(FRESH_ATTR, '1');
      setTimeout(function () {
        el.removeAttribute(FRESH_ATTR);
      }, 200);
    }

    let hiddenSince = 0;

    function resetState() {
      expandedId = null;
      seenIds = [];
      seenNodes = [];
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
    function trackExpanded(flow, list) {
      const ids = list.map(function (group) {
        return group.id;
      });
      if (ids.length === 0) return ids;
      const last = ids[ids.length - 1];
      const prev = seenIds;
      const prevNodes = seenNodes;
      let replaced = false;
      if (prevNodes.length > 0) {
        replaced = true;
        for (let i = 0; i < prevNodes.length; i += 1) {
          if (flow !== null && flow.contains(prevNodes[i])) {
            replaced = false;
            break;
          }
        }
      }
      if (prev.length === 0) {
        expandedId = last;
      } else {
        let overlap = false;
        for (let i = 0; i < ids.length; i++) {
          if (prev.indexOf(ids[i]) !== -1) {
            overlap = true;
            break;
          }
        }
        if (replaced || !overlap) {
          expandedId = last;
        } else if (isAppend(prev, ids)) {
          expandedId = last;
        } else if (expandedId !== null && ids.indexOf(expandedId) === -1) {
          expandedId = last;
        }
      }
      seenIds = ids;
      seenNodes = [];
      for (let i = 0; i < list.length; i += 1) {
        for (let j = 0; j < list[i].items.length; j += 1) seenNodes.push(list[i].items[j]);
      }
      return ids;
    }

    function apply() {
      ensureStyle();
      const flow = findFlow();
      if (flow === null) {
        resetState();
        hiddenSince = 0;
        return 0;
      }
      const list = groups(flow);
      if (list.length === 0) {
        resetState();
        hiddenSince = 0;
        return 0;
      }
      // 视图被隐藏（切会话/切面板）：保留状态并跳过渲染；隐藏超过 1.5s 后
      // 再次可见视为"重新打开会话"，回到只展开最新一条。
      if (!hasVisibleRow(flow)) {
        if (hiddenSince === 0) hiddenSince = Date.now();
        return 0;
      }
      if (hiddenSince !== 0 && Date.now() - hiddenSince > 1500) resetState();
      hiddenSince = 0;
      const key = sessionKey(flow);
      let restored = null;
      if (key !== memKey) restored = loadMem(key);
      const ids = trackExpanded(flow, list);
      if (restored !== null && restored.expanded !== undefined && restored.expanded !== null &&
          ids.indexOf(String(restored.expanded)) !== -1) {
        expandedId = String(restored.expanded);
      }
      if (!logged && list.length > 0) {
        logged = true;
        console.info('[auto-collapse] active: turns=' + list.length + ' expanded=' + expandedId);
      }
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
        const sameRest = lastRest.get(user) === parts.rest[0];
        const head = (expanded ? '1' : '0') + '|' + stamp + '|' + body + '|' + parts.rest.length;
        if (CFG.incremental !== false && sameRest && rowState.get(user) === head + '|1') {
          stats.skipped += 1;
          continue;
        }
        lastRest.set(user, parts.rest[0]);
        rowState.set(user, head + '|1');

        setAttr(user, USER_ATTR, '1');
        user.removeAttribute(HIDE_ATTR);
        ensurePinButton(user);
        setAttr(user, PIN_ATTR, isPinned(group.id) ? '1' : '0');
        setAttr(user, 'role', 'button');
        setAttr(user, 'tabindex', '0');
        setAttr(user, 'aria-expanded', expanded ? 'true' : 'false');
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
      applyDays(flow, rendered);
      saveMem();
      return list.length;
    }

    function toggle(el) {
      const id = el.getAttribute('data-chat-turn');
      if (!id) return;
      if (isPinned(id)) return;
      expandedId = expandedId === id ? null : id;
      apply();
    }

    function onClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const pinBtn = target.closest('.dsh-ac-pin');
      if (pinBtn !== null) {
        event.preventDefault();
        event.stopPropagation();
        const owner = pinBtn.closest('[data-chat-turn]');
        if (owner !== null) togglePin(owner.getAttribute('data-chat-turn'));
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
    let timer = 0;
    let disposed = false;

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
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('mouseover', onOver, true);
      document.addEventListener('mouseout', onOut, true);
      try {
        observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      } catch (err) {
        console.warn('[auto-collapse] observer unavailable', err);
      }
      timer = setInterval(schedule, 1500);
      setTimeout(schedule, 300);
      window.__acReport = report;
      window.__acStop = stop;
      window.__acStart = start;
      window.__acConfig = function (next) {
        if (next !== null && typeof next === 'object') {
          CFG = Object.assign({}, CFG, next);
          try {
            window.localStorage.setItem(CFG_KEY, JSON.stringify(CFG));
          } catch (err) {
            /* 私密模式：只生效本次会话 */
          }
          ensureStyle();
          schedule();
        }
        return Object.assign({}, CFG);
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
