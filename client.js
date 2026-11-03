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

    const CHEVRON = 'url("data:image/svg+xml,' +
      '%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2712%27%20height=%2712%27' +
      '%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%23909090%27' +
      '%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27' +
      '%3E%3Cpolyline%20points=%279%206%2015%2012%209%2018%27/%3E%3C/svg%3E")';

    /** 当前会话说：唯一展开的 turnId；null = 全部折叠。 */
    let expandedId = null;
    /** 上一帧看到的 turnId 序列，用来判定「追加 / 消失 / 新会话」。 */
    let seenIds = [];
    /** 上一帧的聊天流容器，容器换人 = 换了会话视图。 */
    let flowRef = null;

    const textCache = new WeakMap();
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

        '@keyframes dsh-ac-fade{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}',
        '[' + FRESH_ATTR + '="1"]{animation:dsh-ac-fade .16s ease-out}',
        '[' + LINE_ATTR + '="1"]::after{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}',
        '@media (prefers-reduced-motion:reduce){[' + FRESH_ATTR + '="1"]{animation:none!important}}',
      ].join('');
      (document.head || document.documentElement).appendChild(tag);
    }

    function findFlow() {
      const flows = document.querySelectorAll(FLOW_SEL);
      let best = null;
      let bestCount = 0;
      for (let i = 0; i < flows.length; i++) {
        const count = flows[i].querySelectorAll(ITEM_SEL).length;
        if (count > bestCount) {
          best = flows[i];
          bestCount = count;
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
      else if (typeof value === 'number') ms = value < 1e12 ? value * 1000 : value;
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

    function stampOf(user, bubble) {
      const stamp = fmtTime(fiberTime(bubble !== null ? bubble : user));
      if (stamp) return stamp;
      const native = clockText(user);
      if (!native) return '';
      if (/^\d{1,2}[:：]\d{2}/.test(native)) {
        const now = new Date();
        return pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + ' ' + native;
      }
      return native;
    }

    function summaryOf(bubble, fallback) {
      const source = bubble !== null ? bubble : fallback;
      if (source === null) return '';
      const raw = source.textContent || '';
      const cached = textCache.get(source);
      if (cached !== undefined && cached.len === raw.length) return cached.text;
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
      textCache.set(source, { len: raw.length, text });
      return text;
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
      flowRef = null;
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
        if (!overlap) {
          expandedId = last;
        } else if (isAppend(prev, ids)) {
          expandedId = last;
        } else if (expandedId !== null && ids.indexOf(expandedId) === -1) {
          expandedId = last;
        }
      }
      flowRef = flow;
      seenIds = ids;
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
      trackExpanded(flow, list);
      if (!logged && list.length > 0) {
        logged = true;
        console.info('[auto-collapse] active: turns=' + list.length + ' expanded=' + expandedId);
      }
      for (let i = 0; i < list.length; i++) {
        const group = list[i];
        const expanded = group.id === expandedId;
        const parts = pick(group);
        const user = parts.user;
        if (user !== null) {
          user.setAttribute(USER_ATTR, '1');
          user.removeAttribute(HIDE_ATTR);
          if (expanded) {
            user.removeAttribute(LINE_ATTR);
            user.removeAttribute(TEXT_ATTR);
            user.removeAttribute(TIME_ATTR);
          } else {
            const bubble = user.querySelector('[class*="_bubble"]');
            user.setAttribute(LINE_ATTR, '1');
            const stamp = stampOf(user, bubble);
            if (stamp) user.setAttribute(TIME_ATTR, stamp);
            else user.removeAttribute(TIME_ATTR);
            const body = summaryOf(bubble, user);
            user.setAttribute(TEXT_ATTR, body || '（无正文）');
          }
        }
        for (let j = 0; j < parts.rest.length; j++) {
          const el = parts.rest[j];
          if (expanded) {
            if (el.hasAttribute(HIDE_ATTR)) {
              el.removeAttribute(HIDE_ATTR);
              markFresh(el);
            }
          } else {
            el.setAttribute(HIDE_ATTR, '1');
          }
        }
      }
      return list.length;
    }

    function toggle(el) {
      const id = el.getAttribute('data-chat-turn');
      if (!id) return;
      expandedId = expandedId === id ? null : id;
      apply();
    }

    function onClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
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

    function start() {
      if (started) return;
      started = true;
      ensureStyle();
      document.addEventListener('click', onClick, true);
      try {
        new MutationObserver(schedule).observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      } catch (err) {
        console.warn('[auto-collapse] observer unavailable', err);
      }
      setInterval(schedule, 1500);
      setTimeout(schedule, 300);
      window.__acReport = report;
      console.info('[auto-collapse] ready — window.__acReport() 查看结构诊断');
    }

    return {
      inject: [],
      apply() {
        try {
          start();
        } catch (err) {
          console.warn('[auto-collapse] start failed', err);
        }
      },
    };
  },
});
