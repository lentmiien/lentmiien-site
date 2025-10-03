(function () {
  const container = document.querySelector('.tmp-files');
  if (!container) {
    return;
  }

  const maxSizeMB = Number(container.dataset.maxSize || 10);
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  const form = document.getElementById('uploadForm');
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');
  const browseButton = document.getElementById('browseButton');
  const statusMessage = document.getElementById('statusMessage');
  const filesContainer = document.getElementById('filesContainer');
  const refreshButton = document.getElementById('refreshButton');

  function setStatus(message, status) {
    statusMessage.textContent = message || '';
    statusMessage.classList.remove('tmp-files__status--success', 'tmp-files__status--error');
    if (status === 'success') {
      statusMessage.classList.add('tmp-files__status--success');
    } else if (status === 'error') {
      statusMessage.classList.add('tmp-files__status--error');
    }
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) {
      return '';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }

    const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
  }

  function formatDate(isoString) {
    if (!isoString) {
      return '';
    }
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const datePart = date.toLocaleDateString();
    const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${datePart} ${timePart}`;
  }

  function renderFiles(files) {
    filesContainer.innerHTML = '';

    if (!files || files.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'tmp-files__empty';
      emptyItem.textContent = 'No files yet.';
      filesContainer.appendChild(emptyItem);
      return;
    }

    files.forEach((file) => {
      const item = document.createElement('li');
      item.className = 'tmp-files__item';

      const info = document.createElement('div');
      info.className = 'tmp-files__item-info';

      const name = document.createElement('p');
      name.className = 'tmp-files__item-name';
      name.textContent = file.displayName || file.name;

      const meta = document.createElement('span');
      meta.className = 'tmp-files__item-meta';
      meta.textContent = `${formatBytes(file.size)} | ${formatDate(file.modifiedAt)}`;

      info.appendChild(name);
      info.appendChild(meta);

      const actions = document.createElement('div');
      const downloadLink = document.createElement('a');
      downloadLink.className = 'btn btn-outline-primary btn-sm';
      downloadLink.href = `/tmp-files/download/${encodeURIComponent(file.name)}`;
      downloadLink.textContent = 'Download';
      downloadLink.setAttribute('download', file.displayName || file.name);

      actions.appendChild(downloadLink);

      item.appendChild(info);
      item.appendChild(actions);
      filesContainer.appendChild(item);
    });
  }

  async function fetchFiles() {
    try {
      const response = await fetch('/tmp-files/files', {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        throw new Error('Failed to load file list.');
      }
      const payload = await response.json();
      renderFiles(payload.files || []);
    } catch (error) {
      setStatus(error.message || 'Unable to load files.', 'error');
    }
  }

  async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/tmp-files/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || 'Upload failed.');
      }

      await response.json();
      setStatus('Upload complete.', 'success');
      form.reset();
      fetchFiles();
    } catch (error) {
      setStatus(error.message || 'Upload failed.', 'error');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const [file] = fileInput.files;
    if (!file) {
      setStatus('Please choose a file to upload.', 'error');
      return;
    }

    if (file.size > maxSizeBytes) {
      setStatus(`File is larger than ${maxSizeMB}MB.`, 'error');
      return;
    }

    setStatus('Uploading...');
    uploadFile(file);
  });

  browseButton.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      setStatus(`${fileInput.files[0].name} ready to upload.`, 'success');
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (eventName === 'drop') {
        const transfer = event.dataTransfer;
        const files = transfer && transfer.files ? Array.from(transfer.files) : [];
        if (files.length > 0) {
          if (typeof DataTransfer !== 'undefined') {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(files[0]);
            fileInput.files = dataTransfer.files;
            form.dispatchEvent(new Event('submit', { cancelable: true }));
          } else {
            setStatus('Drag-and-drop is not supported in this browser. Please use the Browse button.', 'error');
          }
        }
      }
      dropZone.classList.remove('is-dragover');
    });
  });

  refreshButton.addEventListener('click', () => {
    fetchFiles();
  });

  fetchFiles();
})();