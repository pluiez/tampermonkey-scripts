// ==UserScript==
// @name         arXiv PDF 重命名下载
// @namespace    https://github.com/pluiefox/tampermonkey-scripts
// @version      1.2.1
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
  const POSITION_KEY = 'arxiv-floating-pdf-position-v1';
  const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
  const POSITION_MARGIN = 12;

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
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; }
    .download-button {
      position: fixed;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 220px;
      padding: 9px 12px;
      border: 1px solid #dcdee4;
      border-radius: 6px;
      color: #343640;
      text-align: left;
      cursor: grab;
      user-select: none;
      touch-action: none;
      pointer-events: auto;
      background: #fff;
      box-shadow: 0 3px 10px rgba(36, 38, 50, .09);
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
      animation: button-enter .55s cubic-bezier(.2, .85, .3, 1.25) both;
      -webkit-tap-highlight-color: transparent;
    }
    .download-button:hover {
      transform: translateY(-2px);
      border-color: #c4c7d0;
      box-shadow: 0 5px 14px rgba(36, 38, 50, .13);
    }
    .download-button:active { transform: translateY(0) scale(.98); }
    .download-button:focus-visible { outline: 3px solid rgba(85, 89, 103, .28); outline-offset: 3px; }
    .download-button.is-dragging { cursor: grabbing; transform: scale(1.02); transition: box-shadow .15s ease; }
    .download-button.is-busy .icon-wrap { animation: icon-bob .9s ease-in-out infinite; }
    .icon-wrap {
      display: grid;
      width: 38px;
      height: 38px;
      flex: 0 0 38px;
      place-items: center;
      border: 1px solid #dcdfe5;
      border-radius: 4px;
      color: #fff;
      background: linear-gradient(145deg, #858997, #41434e);
      box-shadow: 0 2px 5px rgba(45, 47, 57, .16);
    }
    .icon-wrap svg { width: 21px; height: 21px; }
    .button-copy { display: grid; gap: 3px; min-width: 0; }
    .button-title { font-size: 14px; line-height: 1.2; font-weight: 650; letter-spacing: .005em; }
    .button-version { color: #777b86; font-size: 11px; line-height: 1.2; font-weight: 500; }
    .button-grip { display: grid; margin-left: auto; color: #999da8; }
    .button-grip svg { width: 12px; height: 18px; }
    .toast-stack {
      position: fixed;
      top: auto;
      right: 14px;
      bottom: 20vh;
      display: grid;
      gap: 10px;
      width: min(380px, calc(100vw - 28px));
      pointer-events: none;
    }
    .toast {
      position: relative;
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr) 22px;
      align-items: start;
      gap: 12px;
      overflow: hidden;
      padding: 10px 12px 12px;
      border: 1px solid rgba(255, 255, 255, .78);
      border-radius: 17px;
      background: rgba(255, 255, 255, .91);
      box-shadow: 0 14px 40px rgba(26, 31, 66, .16), 0 2px 8px rgba(26, 31, 66, .06);
      color: #24253b;
      pointer-events: auto;
      transition: translate .28s cubic-bezier(.2, .8, .2, 1);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      animation: toast-in .35s cubic-bezier(.2, .8, .2, 1) both;
    }
    .toast.is-leaving { animation: toast-out .24s ease both; }
    .toast-icon {
      display: grid;
      width: 32px;
      height: 32px;
      place-items: center;
      border-radius: 13px;
      color: #5145cf;
      background: linear-gradient(145deg, #eeedff, #e5f5ff);
    }
    .toast[data-kind="success"] .toast-icon { color: #13835f; background: #e4f8ef; }
    .toast[data-kind="error"] .toast-icon { color: #bd3d4a; background: #fff0f0; }
    .toast-icon svg { width: 18px; height: 18px; }
    .toast-copy { display: grid; gap: 3px; min-width: 0; padding-top: 1px; }
    .toast-title { color: #25263c; font-size: 13px; line-height: 1.25; font-weight: 750; }
    .toast-message { overflow: hidden; color: #686a7d; font-size: 12px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
    .toast-close {
      display: grid;
      width: 22px;
      height: 22px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      color: #999bad;
      background: transparent;
      font: inherit;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }
    .toast-close:hover { color: #45465c; background: #f0f0f5; }
    .toast-progress {
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      height: 3px;
      transform-origin: left;
      background: linear-gradient(90deg, #7566f4, #49b9e8);
      animation: toast-progress var(--toast-duration) linear forwards;
    }
    .toast[data-kind="success"] .toast-progress { background: linear-gradient(90deg, #1ca879, #6bd4ab); }
    .toast[data-kind="error"] .toast-progress { background: linear-gradient(90deg, #e05d68, #ffb07b); }
    @keyframes button-enter { from { opacity: 0; transform: translateY(18px) scale(.92); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @keyframes icon-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
    @keyframes toast-in { from { opacity: 0; transform: translate3d(18px, -8px, 0) scale(.97); } to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); } }
    @keyframes toast-out { to { opacity: 0; transform: translate3d(16px, -4px, 0) scale(.98); } }
    @keyframes toast-progress { to { transform: scaleX(0); } }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; }
    }
  `;
  shadow.appendChild(style);

  const toastStack = document.createElement('div');
  toastStack.className = 'toast-stack';
  toastStack.setAttribute('aria-live', 'polite');
  toastStack.setAttribute('aria-atomic', 'false');
  shadow.appendChild(toastStack);

  const button = document.createElement('button');
  button.className = 'download-button';
  button.type = 'button';
  button.setAttribute('aria-label', selectedVersion
    ? `下载 arXiv 论文 ${paperId} 第 ${selectedVersion} 版 PDF`
    : `下载 arXiv 论文 ${paperId} PDF`);
  button.innerHTML = `
    <span class="icon-wrap" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" />
      </svg>
    </span>
    <span class="button-copy">
      <span class="button-title">Download</span>
      <span class="button-version">${escapeHtml(selectedVersion ? `${paperId}v${selectedVersion}` : paperId)}</span>
    </span>
    <span class="button-grip" aria-hidden="true">
      <svg viewBox="0 0 12 18" fill="currentColor"><circle cx="3" cy="3" r="1.25"/><circle cx="9" cy="3" r="1.25"/><circle cx="3" cy="9" r="1.25"/><circle cx="9" cy="9" r="1.25"/><circle cx="3" cy="15" r="1.25"/><circle cx="9" cy="15" r="1.25"/></svg>
    </span>
  `;
  shadow.appendChild(button);

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function showToast(kind, title, message, duration = 4800) {
    const icons = {
      info: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z"/><path d="M12 10.8v5.1m0-8.1h.01"/>',
      success: '<path d="m5.5 12.2 4.1 4.1 9-9"/>',
      error: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z"/><path d="m9 9 6 6m0-6-6 6"/>'
    };
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.kind = kind;
    toast.style.setProperty('--toast-duration', `${duration}ms`);
    toast.innerHTML = `
      <span class="toast-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[kind]}</svg></span>
      <span class="toast-copy"><span class="toast-title">${escapeHtml(title)}</span><span class="toast-message">${escapeHtml(message)}</span></span>
      <button class="toast-close" type="button" aria-label="关闭通知">×</button>
      <span class="toast-progress" aria-hidden="true"></span>
    `;

    const captureToastPositions = () => new Map(
      Array.from(toastStack.children, (item) => [item, item.getBoundingClientRect().top])
    );
    const animateToastReflow = (previousPositions) => {
      for (const item of toastStack.children) {
        const previousTop = previousPositions.get(item);
        if (previousTop === undefined) continue;
        const deltaY = previousTop - item.getBoundingClientRect().top;
        if (Math.abs(deltaY) < 1) continue;
        item.style.translate = `0px ${deltaY}px`;
      }
      void toastStack.offsetHeight;
      requestAnimationFrame(() => {
        for (const item of toastStack.children) {
          if (previousPositions.has(item)) item.style.translate = '0px 0px';
        }
      });
    };

    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      toast.classList.add('is-leaving');
      window.setTimeout(() => {
        const previousPositions = captureToastPositions();
        toast.remove();
        animateToastReflow(previousPositions);
      }, 260);
    };
    toast.querySelector('.toast-close').addEventListener('click', remove);
    const previousPositions = captureToastPositions();
    toastStack.appendChild(toast);
    animateToastReflow(previousPositions);
    window.setTimeout(remove, duration);
  }

  function clampPosition(left, top) {
    const bounds = button.getBoundingClientRect();
    const maxLeft = Math.max(POSITION_MARGIN, window.innerWidth - bounds.width - POSITION_MARGIN);
    const maxTop = Math.max(POSITION_MARGIN, window.innerHeight - bounds.height - POSITION_MARGIN);
    return {
      left: Math.min(Math.max(POSITION_MARGIN, left), maxLeft),
      top: Math.min(Math.max(POSITION_MARGIN, top), maxTop)
    };
  }

  function applyPosition(left, top, persist = false) {
    const position = clampPosition(left, top);
    button.style.left = `${position.left}px`;
    button.style.top = `${position.top}px`;
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
    return applyPosition(window.innerWidth - 218, window.innerHeight - 91);
  }

  let position = loadPosition();
  let dragStart = null;
  let dragged = false;
  let suppressClick = false;

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    dragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.left,
      top: position.top
    };
    dragged = false;
    button.setPointerCapture(event.pointerId);
  });

  button.addEventListener('pointermove', (event) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return;
    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;
    if (!dragged && Math.hypot(deltaX, deltaY) < 5) return;
    dragged = true;
    button.classList.add('is-dragging');
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
    button.classList.remove('is-dragging');
  };

  button.addEventListener('pointerup', finishDrag);
  button.addEventListener('pointercancel', finishDrag);
  window.addEventListener('resize', () => {
    position = applyPosition(position.left, position.top, true);
  });

  let downloadInProgress = false;
  button.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (downloadInProgress) return;

    if (!selectedVersion || !pdfUrl) {
      showToast('error', '无法识别论文版本', '请确认页面中包含 Submission history 后重试。', 6000);
      return;
    }

    if (!historyVersions.length) {
      showToast('error', '无法读取版本历史', '页面中没有可识别的 Submission history 版本记录。', 6000);
      return;
    }

    if (requestedVersion !== null && !historyVersions.includes(requestedVersion)) {
      showToast('error', '找不到指定版本', `Submission history 中没有 ${paperId}v${requestedVersion}。`, 6000);
      return;
    }

    if (typeof GM_xmlhttpRequest !== 'function') {
      showToast('error', '下载功能不可用', '请检查 Tampermonkey 是否已启用此脚本及下载权限。', 6000);
      return;
    }

    downloadInProgress = true;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    showToast('info', '开始下载论文', filename, 5200);

    try {
      GM_xmlhttpRequest({
        url: pdfUrl,
        method: 'GET',
        responseType: 'blob',
        onerror: (error) => {
          downloadInProgress = false;
          button.classList.remove('is-busy');
          button.removeAttribute('aria-busy');
          const reason = error && error.error ? `（${error.error}）` : '';
          showToast('error', '下载失败', `请检查网络或 Tampermonkey 权限${reason}。`, 6500);
        },
        ontimeout: () => {
          downloadInProgress = false;
          button.classList.remove('is-busy');
          button.removeAttribute('aria-busy');
          showToast('error', '下载超时', '网络请求超时，请稍后重试。', 6500);
        },
        onload: (response) => {
          const resetDownloadState = () => {
            downloadInProgress = false;
            button.classList.remove('is-busy');
            button.removeAttribute('aria-busy');
          };

          const blob = response.response;
          const isBlobLike = blob && typeof blob.size === 'number' && typeof blob.slice === 'function';
          if (response.status < 200 || response.status >= 300 || !isBlobLike) {
            resetDownloadState();
            showToast('error', '下载失败', `arXiv 返回了无效响应（HTTP ${response.status || '未知'}）。`, 6500);
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
            resetDownloadState();
            showToast('success', '论文下载完成', `${filename} · PDF 数据已接收并交给浏览器保存。`, 5600);
          } catch (error) {
            resetDownloadState();
            showToast('error', '无法保存论文', error && error.message ? error.message : '浏览器未能启动文件保存。', 6500);
          }
        }
      });
    } catch (error) {
      downloadInProgress = false;
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
      showToast('error', '无法启动下载', error && error.message ? error.message : '请检查 Tampermonkey 设置。', 6500);
    }
  });
})();
