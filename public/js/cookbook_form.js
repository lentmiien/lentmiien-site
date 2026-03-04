(function () {
  const ready = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  };

  ready(() => {
    const copyButton = document.getElementById('copyLegacyKnowledge');
    const markdownSource = document.getElementById('legacyMarkdownSource');
    if (!copyButton) {
      return;
    }

    copyButton.addEventListener('click', async () => {
      const markdown = markdownSource ? markdownSource.value : '';
      if (!markdown) return;

      try {
        await navigator.clipboard.writeText(markdown);
        const originalText = copyButton.textContent;
        copyButton.textContent = 'Copied';
        setTimeout(() => {
          copyButton.textContent = originalText;
        }, 1200);
      } catch (error) {
        copyButton.textContent = 'Copy failed';
      }
    });
  });
})();
