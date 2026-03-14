document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('receipt-history-filter-form');
  var select = document.getElementById('receipt-history-filter');
  var historyCard = document.querySelector('.history-card');

  if (!form || !select || !window.fetch) {
    return;
  }

  var activeRequest = null;

  var getPageUrl = function () {
    if (!select.value || select.value === 'last30') {
      return '/receipt';
    }
    return '/receipt?history=' + encodeURIComponent(select.value);
  };

  var setLoadingState = function (isLoading) {
    select.disabled = isLoading;
    if (historyCard) {
      historyCard.classList.toggle('is-loading', isLoading);
    }
  };

  var replaceHistoryMarkup = function (html) {
    var template = document.createElement('template');
    template.innerHTML = html.trim();

    var nextSummary = template.content.querySelector('#receipt-history-summary');
    var nextContent = template.content.querySelector('#receipt-history-content');
    var currentSummary = document.getElementById('receipt-history-summary');
    var currentContent = document.getElementById('receipt-history-content');

    if (!nextSummary || !nextContent || !currentSummary || !currentContent) {
      throw new Error('History markup was incomplete.');
    }

    currentSummary.replaceWith(nextSummary);
    currentContent.replaceWith(nextContent);
  };

  var updateHistory = async function () {
    var partialUrl = form.dataset.partialUrl || '/receipt/history';
    var params = new URLSearchParams();

    if (select.value) {
      params.set('history', select.value);
    }

    if (activeRequest) {
      activeRequest.abort();
    }

    var requestController = new AbortController();
    activeRequest = requestController;
    setLoadingState(true);

    try {
      var response = await fetch(partialUrl + '?' + params.toString(), {
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        },
        signal: requestController.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to load history.');
      }

      replaceHistoryMarkup(await response.text());
      window.history.replaceState({}, '', getPageUrl());
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      window.location.assign(getPageUrl());
    } finally {
      if (activeRequest === requestController) {
        activeRequest = null;
        setLoadingState(false);
      }
    }
  };

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    updateHistory();
  });

  select.addEventListener('change', function () {
    updateHistory();
  });
});
