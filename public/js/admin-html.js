(function () {
  const fileNameInput = document.getElementById('fileName');
  const uploadFileNameInput = document.getElementById('uploadFileName');
  const htmlContentTextarea = document.getElementById('htmlContent');
  const statusEl = document.querySelector('[data-admin-html-status]');

  function setStatus(type, message) {
    if (!statusEl) {
      return;
    }
    if (!message) {
      statusEl.hidden = true;
      statusEl.removeAttribute('data-state');
      statusEl.textContent = '';
      return;
    }
    statusEl.hidden = false;
    statusEl.dataset.state = type;
    statusEl.textContent = message;
  }

  function applyFilename(name) {
    if (!name) {
      return;
    }
    if (fileNameInput) {
      fileNameInput.value = name;
    }
    if (uploadFileNameInput) {
      uploadFileNameInput.value = name;
    }
    setStatus('info', `${name} inserted into the forms.`);
  }

  function attachFilenameButtons() {
    document.querySelectorAll('[data-action="apply-filename"]').forEach((button) => {
      button.addEventListener('click', () => {
        const fileName = button.getAttribute('data-filename');
        if (!fileName) {
          return;
        }
        applyFilename(fileName);
      });
    });
  }

  function attachHtmlLoaders() {
    document.querySelectorAll('[data-action="load-html"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const fileName = button.getAttribute('data-filename');
        const source = button.getAttribute('data-source');

        if (!fileName || !source) {
          return;
        }

        try {
          button.disabled = true;
          setStatus('info', `Loading ${fileName}...`);

          const response = await fetch(`${source}?t=${Date.now()}`, {
            credentials: 'same-origin',
            headers: {
              Accept: 'text/html, text/plain;q=0.9, */*;q=0.8',
            },
          });

          if (!response.ok) {
            throw new Error(`Unexpected status ${response.status}`);
          }

          const html = await response.text();
          applyFilename(fileName);

          if (htmlContentTextarea) {
            htmlContentTextarea.value = html;
            htmlContentTextarea.focus();
          }

          setStatus('success', `${fileName} loaded into the editor.`);
        } catch (error) {
          console.error('Failed to load HTML file', error);
          setStatus('error', `Failed to load ${fileName}. Please try again.`);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  attachFilenameButtons();
  attachHtmlLoaders();
})();
