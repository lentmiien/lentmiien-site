(function () {
  const page = document.querySelector('.ask-lennart-page');
  if (!page) return;

  page.querySelectorAll('[data-pending-prompt]').forEach((prompt) => {
    if (!window.marked?.parse || !window.DOMPurify?.sanitize) return;
    try {
      // Match the text-only allowlist and link policy in codexTranscriptPresentation.
      // Sanitize untrusted Markdown after conversion, before attaching any HTML.
      const content = window.DOMPurify.sanitize(window.marked.parse(prompt.textContent, { gfm: true }), {
        ALLOWED_TAGS: [
          'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
        ],
        ALLOWED_ATTR: ['href', 'title', 'start'],
        ALLOW_ARIA_ATTR: false,
        ALLOW_DATA_ATTR: false,
        RETURN_DOM_FRAGMENT: true,
      });
      content.querySelectorAll('a').forEach((link) => {
        const href = link.getAttribute('href') || '';
        const local = /^\/(?!\/)/.test(href) && !/[\\\u0000-\u0020\u007f]/.test(href);
        let external = false;
        try {
          const url = new URL(href);
          external = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
            && !/[\\\u0000-\u0020\u007f]/.test(href);
        } catch (_) { /* Relative or invalid URL. */ }
        if (local || external) {
          link.setAttribute('rel', 'noopener noreferrer nofollow');
          if (external) link.setAttribute('target', '_blank');
        } else {
          link.removeAttribute('href');
        }
      });
      content.querySelectorAll('pre').forEach((block) => {
        block.tabIndex = 0;
        block.setAttribute('role', 'region');
        block.setAttribute('aria-label', 'Code block');
      });
      prompt.replaceChildren(content);
      prompt.classList.add('ask-lennart-prompt--rendered');
    } catch (_) {
      // Keep the escaped, readable source if a renderer fails; refresh/forms still work.
    }
  });

  const refreshMs = Number.parseInt(page.dataset.autoRefreshMs, 10);
  if (!Number.isFinite(refreshMs) || refreshMs < 5000) return;

  let dirty = false;
  document.querySelectorAll('[data-human-response-input]').forEach((input) => {
    input.addEventListener('input', () => {
      dirty = true;
    });
  });

  const handle = window.setInterval(() => {
    if (document.hidden || dirty || document.activeElement?.matches('[data-human-response-input]')) {
      return;
    }
    window.location.reload();
  }, refreshMs);

  window.addEventListener('beforeunload', () => window.clearInterval(handle), { once: true });
}());
