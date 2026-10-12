// ==UserScript==
// @name         arXiv PDF 重命名下载
// @namespace    https://github.com/pluiefox/tampermonkey-scripts
// @version      1.3.0
// @description  在 arXiv 论文页面通过可拖动的悬浮按钮下载指定版本 PDF
// @match        https://arxiv.org/abs/*
// @match        https://www.arxiv.org/abs/*
// @grant        GM_xmlhttpRequest
// @connect      arxiv.org
// @connect      www.arxiv.org
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const ID_PATTERN = /^(\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})(?:v(\d+))?$/i;
  const POSITION_KEY = 'arxiv-pdf-renamer-position-v1';
  const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
  const POSITION_MARGIN = 12;
  const DOCK_SIZE = 46;
  const LABEL_MAX_WIDTH = 360;
  const DONE_RESET_MS = 4000;
  const ERROR_RESET_MS = 6500;

  function getAbsIdentifier(pathname) {
    const match = pathname.match(/^\/abs\/(.+?)\/?$/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  const pathId = getAbsIdentifier(window.location.pathname);
  const idMatch = pathId.match(ID_PATTERN);
  if (!idMatch) return;

  const paperId = idMatch[1];
  const requestedVersion = idMatch[2] ? Number(idMatch[2]) : null;

  function getHistoryVersions() {
    const history = document.querySelector('.submission-history');
    if (!history) return [];

    const versions = Array.from(history.textContent.matchAll(/\bv(\d+)\b/gi), (match) => Number(match[1]));
    return Array.from(new Set(versions.filter((version) => Number.isInteger(version) && version > 0)));
  }

  function getPaperTitle() {
    const citationTitle = document.querySelector('meta[name="citation_title"]')?.content?.trim();
    if (citationTitle) return citationTitle;

    const titleHeading = document.querySelector('h1.title');
    if (titleHeading) {
      const clone = titleHeading.cloneNode(true);
      clone.querySelectorAll('.descriptor').forEach((element) => element.remove());
      const title = clone.textContent.replace(/^\s*Title:\s*/i, '').replace(/\s+/g, ' ').trim();
      if (title) return title;
    }

    return document.title.replace(/^\[[^\]]+\]\s*/, '').replace(/\s*[—-]\s*arXiv.*$/i, '').trim() || 'Untitled';
  }

  function sanitizeFilenamePart(value) {
    return value
      .replace(FORBIDDEN_FILENAME_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[. ]+|[. ]+$/g, '')
      .trim();
  }

  const historyVersions = getHistoryVersions();
  const latestVersion = historyVersions.length ? historyVersions[historyVersions.length - 1] : null;
  const selectedVersion = requestedVersion === null ? latestVersion : requestedVersion;
  const paperTitle = getPaperTitle();
  const safePaperId = sanitizeFilenamePart(paperId).replace(/\s+/g, '-');
  const safeTitle = sanitizeFilenamePart(paperTitle) || 'Untitled';
  const filename = `${safePaperId}v${selectedVersion || ''} ${safeTitle}.pdf`;
  const pdfUrl = selectedVersion
    ? `https://arxiv.org/pdf/${paperId}v${selectedVersion}`
    : '';

  const host = document.createElement('div');
  host.id = 'arxiv-pdf-renamer-host';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
      color-scheme: light;
      font-family: "Lucida Grande", Helvetica, Arial, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; }
    .dock {
      position: fixed;
      width: ${DOCK_SIZE}px;
      height: ${DOCK_SIZE}px;
      pointer-events: auto;
      touch-action: none;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .pill {
      position: absolute;
      top: 0;
      right: 0;
      display: flex;
      align-items: center;
      height: ${DOCK_SIZE}px;
      justify-content: flex-end;
      width: ${DOCK_SIZE}px;
      overflow: hidden;
      padding: 0 ${DOCK_SIZE - 2}px 0 0;
      border: 1px solid #8f1515;
      border-radius: ${DOCK_SIZE / 2}px;
      color: #fff;
      background: #b31b1b;
      box-shadow: 0 2px 8px rgba(60, 10, 10, .25);
      cursor: pointer;
      /* Collapse: let the text fade first, then close the pill with a short delay. */
      transition: width .3s cubic-bezier(.4, 0, .2, 1) .08s, background-color .2s ease, box-shadow .25s ease;
    }
    .dock.expand-right .pill { right: auto; left: 0; justify-content: flex-start; padding: 0 0 0 ${DOCK_SIZE - 2}px; }
    .dock:hover .pill,
    .dock:focus-within .pill,
    .dock:not([data-state="idle"]) .pill {
      width: var(--pill-width, ${DOCK_SIZE}px);
      box-shadow: 0 4px 14px rgba(60, 10, 10, .28);
      transition: width .38s cubic-bezier(.22, 1, .36, 1), background-color .2s ease, box-shadow .25s ease;
    }
    .dock:hover .pill { background: #9f1818; }
    .dock[data-state="error"] .pill { background: #7d1212; }
    .dock.is-dragging .pill { cursor: grabbing; transition: none; }
    .label {
      flex: none;
      max-width: ${LABEL_MAX_WIDTH - DOCK_SIZE}px;
      padding: 0 8px 0 16px;
      overflow: hidden;
      font-size: 13px;
      line-height: 1;
      white-space: nowrap;
      text-overflow: ellipsis;
      opacity: 0;
      transform: translateX(10px);
      transition: opacity .14s ease, transform .2s ease;
    }
    .dock.expand-right .label { padding: 0 16px 0 8px; transform: translateX(-10px); }
    .dock:hover .label,
    .dock:focus-within .label,
    .dock:not([data-state="idle"]) .label {
      opacity: 1;
      transform: none;
      transition: opacity .24s ease .1s, transform .36s cubic-bezier(.22, 1, .36, 1) .06s;
    }
    .label b { font-weight: 700; }
    .fab {
      position: absolute;
      inset: 3px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 0;
      border-radius: 50%;
      color: #b31b1b;
      background: #fff;
      cursor: pointer;
      font: inherit;
      transition: color .2s ease, transform .25s cubic-bezier(.22, 1, .36, 1);
    }
    .dock:hover .fab { transform: scale(1.06); }
    .dock.is-dragging .fab { transform: scale(1); }
    .fab:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .dock.is-dragging .fab { cursor: grabbing; }
    .dock[data-state="done"] .fab { color: #2e7d32; }
    .fab svg { grid-area: 1 / 1; width: 18px; height: 18px; }
    .fab .ring {
      position: absolute;
      inset: -3px;
      width: ${DOCK_SIZE}px;
      height: ${DOCK_SIZE}px;
      opacity: 0;
    }
    .dock[data-state="busy"] .fab { cursor: progress; }
    .dock[data-state="busy"] .ring { opacity: 1; animation: spin 1s linear infinite; }
    .icon { display: none; }
    .dock[data-state="idle"] .icon-download,
    .dock[data-state="busy"] .icon-download,
    .dock[data-state="done"] .icon-done,
    .dock[data-state="error"] .icon-error { display: block; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
    }
  `;
  shadow.appendChild(style);

  const versionLabel = selectedVersion ? `${paperId}v${selectedVersion}` : paperId;
  const idleLabel = `<b>${escapeHtml(versionLabel)}</b>`;

  const dock = document.createElement('div');
  dock.className = 'dock';
  dock.dataset.state = 'idle';
  dock.innerHTML = `
    <div class="pill">
      <span class="label" role="status" aria-live="polite">${idleLabel}</span>
    </div>
    <button class="fab" type="button">
      <svg class="ring" viewBox="0 0 ${DOCK_SIZE} ${DOCK_SIZE}" fill="none" aria-hidden="true">
        <circle cx="${DOCK_SIZE / 2}" cy="${DOCK_SIZE / 2}" r="${DOCK_SIZE / 2 - 1.5}" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-dasharray="36 200" />
      </svg>
      <svg class="icon icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14" />
      </svg>
      <svg class="icon icon-done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
      <svg class="icon icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
        <path d="M12 6v8m0 4h.01" />
      </svg>
    </button>
  `;
  shadow.appendChild(dock);

  const label = dock.querySelector('.label');
  const fab = dock.querySelector('.fab');
  fab.setAttribute('aria-label', selectedVersion
    ? `下载 arXiv 论文 ${paperId} 第 ${selectedVersion} 版 PDF`
    : `下载 arXiv 论文 ${paperId} PDF`);

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  // Width cannot transition to auto, so size the pill from the label's natural width.
  function updatePillWidth() {
    dock.style.setProperty('--pill-width', `${label.offsetWidth + DOCK_SIZE}px`);
  }
  updatePillWidth();

  let resetTimer = 0;
  function setState(state, html = idleLabel, title = '', resetAfter = 0) {
    window.clearTimeout(resetTimer);
    dock.dataset.state = state;
    label.innerHTML = html;
    label.title = title;
    updatePillWidth();
    if (state === 'busy') fab.setAttribute('aria-busy', 'true');
    else fab.removeAttribute('aria-busy');
    if (resetAfter) resetTimer = window.setTimeout(() => setState('idle'), resetAfter);
  }

  function showError(message) {
    setState('error', escapeHtml(message), message, ERROR_RESET_MS);
  }

  function clampPosition(left, top) {
    const maxLeft = Math.max(POSITION_MARGIN, window.innerWidth - DOCK_SIZE - POSITION_MARGIN);
    const maxTop = Math.max(POSITION_MARGIN, window.innerHeight - DOCK_SIZE - POSITION_MARGIN);
    return {
      left: Math.min(Math.max(POSITION_MARGIN, left), maxLeft),
      top: Math.min(Math.max(POSITION_MARGIN, top), maxTop)
    };
  }

  function applyPosition(left, top, persist = false) {
    const position = clampPosition(left, top);
    dock.style.left = `${position.left}px`;
    dock.style.top = `${position.top}px`;
    // Expand towards whichever side has room for the label.
    dock.classList.toggle('expand-right', position.left + DOCK_SIZE < LABEL_MAX_WIDTH);
    if (persist) {
      try {
        window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
      } catch (_error) {
        // Local storage may be unavailable in private browsing or restricted contexts.
      }
    }
    return position;
  }

  function loadPosition() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(POSITION_KEY) || 'null');
      if (stored && Number.isFinite(stored.left) && Number.isFinite(stored.top)) {
        return applyPosition(stored.left, stored.top);
      }
    } catch (_error) {
      // Fall back to the default corner when saved state is unavailable or invalid.
    }
    return applyPosition(window.innerWidth - DOCK_SIZE - 24, window.innerHeight - DOCK_SIZE - 24);
  }

  let position = loadPosition();
  let dragStart = null;
  let dragged = false;
  let suppressClick = false;

  dock.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    dragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.left,
      top: position.top
    };
    dragged = false;
    dock.setPointerCapture(event.pointerId);
  });

  dock.addEventListener('pointermove', (event) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return;
    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;
    if (!dragged && Math.hypot(deltaX, deltaY) < 5) return;
    dragged = true;
    dock.classList.add('is-dragging');
    position = applyPosition(dragStart.left + deltaX, dragStart.top + deltaY);
  });

  const finishDrag = (event) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return;
    if (dragged) {
      position = applyPosition(position.left, position.top, true);
      suppressClick = true;
      window.setTimeout(() => { suppressClick = false; }, 350);
    }
    dragStart = null;
    dock.classList.remove('is-dragging');
  };

  dock.addEventListener('pointerup', finishDrag);
  dock.addEventListener('pointercancel', finishDrag);
  window.addEventListener('resize', () => {
    position = applyPosition(position.left, position.top, true);
  });

  function startDownload() {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (dock.dataset.state === 'busy') return;

    if (!selectedVersion || !pdfUrl) {
      showError('无法识别论文版本，请确认页面中有 Submission history');
      return;
    }

    if (!historyVersions.length) {
      showError('页面中没有可识别的 Submission history 版本记录');
      return;
    }

    if (requestedVersion !== null && !historyVersions.includes(requestedVersion)) {
      showError(`Submission history 中没有 ${paperId}v${requestedVersion}`);
      return;
    }

    if (typeof GM_xmlhttpRequest !== 'function') {
      showError('下载功能不可用，请检查 Tampermonkey 是否启用了此脚本');
      return;
    }

    setState('busy', '正在下载…', filename);

    try {
      GM_xmlhttpRequest({
        url: pdfUrl,
        method: 'GET',
        responseType: 'blob',
        onerror: (error) => {
          const reason = error && error.error ? `（${error.error}）` : '';
          showError(`下载失败，请检查网络或 Tampermonkey 权限${reason}`);
        },
        ontimeout: () => {
          showError('下载超时，请稍后重试');
        },
        onload: (response) => {
          const blob = response.response;
          const isBlobLike = blob && typeof blob.size === 'number' && typeof blob.slice === 'function';
          if (response.status < 200 || response.status >= 300 || !isBlobLike) {
            showError(`下载失败：arXiv 返回 HTTP ${response.status || '未知状态'}`);
            return;
          }

          try {
            const blobUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = blobUrl;
            anchor.download = filename;
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
            setState('done', `已保存为 ${escapeHtml(filename)}`, filename, DONE_RESET_MS);
          } catch (error) {
            showError(`无法保存论文：${error && error.message ? error.message : '浏览器未能启动文件保存'}`);
          }
        }
      });
    } catch (error) {
      showError(`无法启动下载：${error && error.message ? error.message : '请检查 Tampermonkey 设置'}`);
    }
  }

  // Pointer capture retargets clicks to the dock, so listen there rather than on the fab.
  dock.addEventListener('click', startDownload);
})();
