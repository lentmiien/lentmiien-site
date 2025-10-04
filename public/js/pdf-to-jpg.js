(function () {
  'use strict';

  var ready = function (fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  };

  ready(function () {
    var panels = Array.prototype.slice.call(document.querySelectorAll('[data-converter-panel]'));
    var mq = window.matchMedia('(max-width: 767.98px)');

    var setOpenState = function (panel, toggle, shouldOpen) {
      if (!panel || !toggle) {
        return;
      }

      if (shouldOpen) {
        panel.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
        panel.dataset.userOpened = '1';
      } else {
        panel.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        delete panel.dataset.userOpened;
      }
    };

    var sync = function () {
      panels.forEach(function (panel) {
        var toggle = panel.querySelector('[data-panel-toggle]');
        if (!toggle) {
          return;
        }

        if (mq.matches) {
          if (!panel.dataset.userOpened) {
            setOpenState(panel, toggle, false);
          }
        } else {
          setOpenState(panel, toggle, true);
        }
      });
    };

    panels.forEach(function (panel) {
      var toggle = panel.querySelector('[data-panel-toggle]');
      if (!toggle) {
        return;
      }

      toggle.addEventListener('click', function () {
        var nowOpen = !panel.classList.contains('is-open');
        setOpenState(panel, toggle, nowOpen);
      });

      var fileInput = panel.querySelector('input[type="file"]');
      if (!fileInput) {
        return;
      }

      var form = fileInput.closest('form');
      var submitBtn = form ? form.querySelector('[data-submit-btn]') : null;

      var openPanel = function () {
        setOpenState(panel, toggle, true);
      };

      fileInput.addEventListener('focus', openPanel);
      fileInput.addEventListener('change', function () {
        openPanel();
        if (!form) {
          return;
        }

        if (fileInput.files && fileInput.files.length) {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.classList.add('is-busy');
          }

          if (!form.dataset.submitted) {
            form.dataset.submitted = '1';
            form.submit();
          }
        }
      });
    });

    sync();

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync);
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(sync);
    }

    var viewer = document.querySelector('[data-image-viewer]');
    if (!viewer) {
      return;
    }

    var viewerContent = viewer.querySelector('.image-viewer__content');
    var viewerImg = viewer.querySelector('[data-viewer-img]');
    var viewerLabel = viewer.querySelector('[data-viewer-label]');
    var viewerClose = viewer.querySelector('[data-viewer-close]');
    var activeTrigger = null;

    var isVisible = function () {
      return viewer.classList.contains('is-visible');
    };

    var openViewer = function (src, label, trigger) {
      if (!src || !viewerImg) {
        return;
      }

      activeTrigger = trigger || null;
      viewerImg.setAttribute('src', src);
      viewerImg.setAttribute('alt', label || 'Converted PDF page');

      if (viewerLabel) {
        viewerLabel.textContent = label || '';
      }

      viewer.classList.add('is-visible');
      viewer.setAttribute('aria-hidden', 'false');
      document.body.classList.add('viewer-open');

      if (viewerClose) {
        viewerClose.focus();
      }
    };

    var closeViewer = function () {
      if (!isVisible()) {
        return;
      }

      viewer.classList.remove('is-visible');
      viewer.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('viewer-open');

      if (viewerImg) {
        viewerImg.removeAttribute('src');
        viewerImg.removeAttribute('alt');
      }

      if (viewerLabel) {
        viewerLabel.textContent = '';
      }

      if (activeTrigger && typeof activeTrigger.focus === 'function') {
        activeTrigger.focus();
      }

      activeTrigger = null;
    };

    if (viewerContent) {
      viewerContent.addEventListener('click', function (event) {
        event.stopPropagation();
      });
    }

    viewer.addEventListener('click', function () {
      closeViewer();
    });

    if (viewerClose) {
      viewerClose.addEventListener('click', function (event) {
        event.preventDefault();
        closeViewer();
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeViewer();
      }
    });

    var triggers = Array.prototype.slice.call(document.querySelectorAll('[data-viewer-src]'));
    triggers.forEach(function (trigger) {
      var handleOpen = function (event) {
        if (event) {
          event.preventDefault();
        }
        var src = trigger.getAttribute('data-viewer-src');
        var label = trigger.getAttribute('data-viewer-label') || trigger.getAttribute('alt');
        openViewer(src, label, trigger);
      };

      trigger.addEventListener('click', handleOpen);

      trigger.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          handleOpen(event);
        }
      });
    });
  });
})();
