// Create a socket connection
const notice_socket = io();
window.socket = notice_socket;

(function setupChat5Notices() {
  let stylesInjected = false;

  function ensureStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const css = `
      #chat-notice-container {
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: min(92vw, 600px);
        z-index: 11000; /* above your modal 9999 */
        pointer-events: none; /* container ignores clicks; notices handle their own */
      }
      .chat-notice {
        background: #1f2937; /* slate-800 */
        color: #fff;
        border-radius: 8px;
        box-shadow: 0 8px 20px rgba(0,0,0,0.25);
        padding: 10px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity .2s ease, transform .2s ease;
        pointer-events: auto; /* clickable */
      }
      .chat-notice a.chat-notice-link {
        color: #fff;
        text-decoration: underline;
        font-weight: 600;
      }
      .chat-notice .chat-notice-title {
        margin-right: 6px;
      }
      .chat-notice button.chat-notice-close {
        background: transparent;
        border: 0;
        color: #fff;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }
    `;
    const style = document.createElement('style');
    style.id = 'chat-notice-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureContainer() {
    let c = document.getElementById('chat-notice-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'chat-notice-container';
      c.setAttribute('aria-live', 'polite'); // screen readers will announce politely
      document.body.appendChild(c);
    }
    return c;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function removeNotice(el) {
    if (!el) return;
    clearTimeout(el._timer);
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 200);
  }

  function showNotice({ id, title }) {
    // 1) Ignore if we’re already viewing this conversation
    const currentId = document.getElementById('id')?.textContent?.trim();
    if (String(id) === String(currentId)) return;

    ensureStyles();
    const container = ensureContainer();

    // 2) De-duplicate: if a notice for this id already exists, move it to top and reset timer
    const selectorSafeId = CSS && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/("|'|\\)/g, '\\$1');
    let existing = container.querySelector(`.chat-notice[data-id="${selectorSafeId}"]`);
    if (existing) {
      if (container.firstChild !== existing) container.prepend(existing);
      clearTimeout(existing._timer);
      existing._timer = setTimeout(() => removeNotice(existing), 10000);
      return;
    }

    // 3) Create notice
    const el = document.createElement('div');
    el.className = 'chat-notice';
    el.dataset.id = String(id);

    const safeTitle = escapeHtml(title || '(untitled)');
    const href = `/chat5/chat/${encodeURIComponent(String(id))}`;

    el.innerHTML = `
      <div class="chat-notice-body">
        <span class="chat-notice-title">${safeTitle}</span>
        <a class="chat-notice-link" href="${href}">Open</a>
      </div>
      <button class="chat-notice-close" aria-label="Dismiss">&times;</button>
    `;

    // Close button
    el.querySelector('.chat-notice-close')?.addEventListener('click', () => removeNotice(el));

    // Optional: clicking anywhere on the notice (except the close) opens the link
    el.addEventListener('click', (e) => {
      const isClose = (e.target.closest('.chat-notice-close') !== null);
      const isLink = (e.target.closest('a.chat-notice-link') !== null);
      if (!isClose && !isLink) {
        window.location.href = href;
      }
    });

    // 4) Insert at top and animate in
    container.prepend(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });

    // 5) Auto-hide after 5s
    el._timer = setTimeout(() => removeNotice(el), 10000);
  }

  // Hook up the socket event
  if (window.socket) {
    window.socket.on('chat5-notice', showNotice);
  } else {
    // If your socket is created elsewhere, you can call window.__chat5_showNotice later
    window.__chat5_showNotice = showNotice;
  }
})();