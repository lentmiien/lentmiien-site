const loadingOverlay = document.getElementById('modelPreviewLoading');
const errorOverlay = document.getElementById('modelPreviewError');
const errorMessage = document.getElementById('modelPreviewErrorMessage');
const canvas = document.getElementById('modelPreviewCanvas');

import('/js/model-previewer.js?v=2').catch((error) => {
  console.error('Unable to load the 3D model previewer.', error);
  if (loadingOverlay) loadingOverlay.hidden = true;
  if (errorMessage) {
    errorMessage.textContent = 'The 3D viewer code could not be loaded. Refresh the page and try again.';
  }
  if (errorOverlay) errorOverlay.hidden = false;
  canvas?.setAttribute('aria-busy', 'false');
});
