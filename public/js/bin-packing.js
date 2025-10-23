(function () {
  'use strict';

  var ready = function (fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  };

  var SAMPLE_CSV = [
    'id,w,d,h,weight,qty',
    'widget-a,400,300,250,5.5,3',
    'widget-b,250,200,150,3.1,2',
    'widget-c,180,160,140,2.6,1'
  ].join('\n');

  var HEADER_ALIASES = {
    id: ['id', 'itemid', 'sku', 'name'],
    w: ['w', 'width', 'x', 'dimx'],
    d: ['d', 'depth', 'y', 'dimy', 'length'],
    h: ['h', 'height', 'z', 'dimz'],
    weight: ['weight', 'mass', 'kg'],
    qty: ['qty', 'quantity', 'count', 'q'],
  };

  var REQUIRED_KEYS = ['id', 'w', 'd', 'h', 'weight', 'qty'];

  var formatNumber = function (value, digits) {
    if (!Number.isFinite(value)) {
      return '0';
    }
    return Number(value).toLocaleString('en-US', {
      maximumFractionDigits: typeof digits === 'number' ? digits : 2,
    });
  };

  var normalizeKey = function (key) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
  };

  var splitCsvLine = function (line) {
    var result = [];
    var current = '';
    var inQuotes = false;

    for (var i = 0; i < line.length; i += 1) {
      var char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  };

  var mapHeaders = function (headerRow) {
    var mapping = {};
    headerRow.forEach(function (rawValue, index) {
      var normalized = normalizeKey(rawValue);
      Object.keys(HEADER_ALIASES).forEach(function (key) {
        if (mapping[key] !== undefined) {
          return;
        }
        if (HEADER_ALIASES[key].indexOf(normalized) >= 0) {
          mapping[key] = index;
        }
      });
    });
    return mapping;
  };

  var parseItems = function (text) {
    var rows = text.split(/\r?\n/).filter(function (line) {
      return line.trim().length > 0;
    });

    if (!rows.length) {
      return { items: [], errors: [], totalWeight: 0 };
    }

    var headerCells = splitCsvLine(rows[0]);
    var mapping = mapHeaders(headerCells);
    var missing = REQUIRED_KEYS.filter(function (key) {
      return mapping[key] === undefined;
    });

    if (missing.length) {
      return {
        items: [],
        errors: ['Missing required column(s): ' + missing.join(', ') + '.'],
        totalWeight: 0,
      };
    }

    var items = [];
    var errors = [];
    var totalWeight = 0;

    rows.slice(1).forEach(function (row, rowIndex) {
      if (row.trim().length === 0) {
        return;
      }

      var cells = splitCsvLine(row);
      var lineNumber = rowIndex + 2;

      var rawId = cells[mapping.id] || '';
      var id = rawId.trim();
      if (!id) {
        errors.push('Row ' + lineNumber + ': Item ID is required.');
        return;
      }

      var width = Number(cells[mapping.w]);
      var depth = Number(cells[mapping.d]);
      var height = Number(cells[mapping.h]);
      var weight = Number(cells[mapping.weight]);
      var qty = Number(cells[mapping.qty] || 1);

      if (!Number.isFinite(width) || width <= 0) {
        errors.push('Row ' + lineNumber + ': Width must be a positive number.');
        return;
      }
      if (!Number.isFinite(depth) || depth <= 0) {
        errors.push('Row ' + lineNumber + ': Depth must be a positive number.');
        return;
      }
      if (!Number.isFinite(height) || height <= 0) {
        errors.push('Row ' + lineNumber + ': Height must be a positive number.');
        return;
      }
      if (!Number.isFinite(weight) || weight < 0) {
        errors.push('Row ' + lineNumber + ': Weight must be zero or more.');
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        errors.push('Row ' + lineNumber + ': Quantity must be at least 1.');
        return;
      }

      var normalizedQty = Math.round(qty);
      if (normalizedQty !== qty) {
        errors.push('Row ' + lineNumber + ': Quantity rounded to nearest whole number.');
      }

      items.push({
        id: id,
        w: width,
        d: depth,
        h: height,
        weight: weight,
        qty: normalizedQty,
      });
      totalWeight += weight * normalizedQty;
    });

    return { items: items, errors: errors, totalWeight: totalWeight };
  };

  ready(function () {
    var form = document.getElementById('binPackForm');
    if (!form) {
      return;
    }

    var fileInput = document.getElementById('itemsFile');
    var textarea = document.getElementById('itemsTextarea');
    var parseErrorsEl = document.querySelector('[data-parse-errors]');
    var tableBody = document.querySelector('[data-item-table]');
    var uniqueCountEl = document.querySelector('[data-unique-count]');
    var totalCountEl = document.querySelector('[data-total-count]');
    var totalWeightEl = document.querySelector('[data-total-weight]');
    var algorithmSelect = document.getElementById('algorithm');
    var bruteNoteEl = document.querySelector('[data-bruteforce-note]');
    var submitBtn = document.getElementById('binPackSubmit');
    var statusEl = document.querySelector('[data-request-status]');
    var outputEl = document.getElementById('binPackOutput');
    var metaSummaryEl = document.querySelector('[data-meta-summary]');
    var metaAlgorithmEl = document.querySelector('[data-meta-algorithm]');
    var metaContainerEl = document.querySelector('[data-meta-container]');
    var metaItemsEl = document.querySelector('[data-meta-items]');
    var sampleBtn = document.querySelector('[data-fill-sample]');
    var clearBtn = document.querySelector('[data-clear-items]');

    var state = {
      items: [],
      totalWeight: 0,
    };

    var setStatus = function (message, tone) {
      if (!statusEl) {
        return;
      }

      statusEl.textContent = message || '';
      statusEl.classList.remove('bin-pack__status--info', 'bin-pack__status--error', 'bin-pack__status--success');

      if (!message) {
        return;
      }
      if (tone === 'error') {
        statusEl.classList.add('bin-pack__status--error');
      } else if (tone === 'success') {
        statusEl.classList.add('bin-pack__status--success');
      } else {
        statusEl.classList.add('bin-pack__status--info');
      }
    };

    var renderErrors = function (errors) {
      if (!parseErrorsEl) {
        return;
      }
      parseErrorsEl.innerHTML = '';
      parseErrorsEl.classList.remove('is-visible');

      if (!errors || !errors.length) {
        return;
      }

      parseErrorsEl.classList.add('is-visible');
      errors.forEach(function (error) {
        var li = document.createElement('li');
        li.textContent = error;
        parseErrorsEl.appendChild(li);
      });
    };

    var updateAlgorithmAvailability = function (totalCount) {
      if (!algorithmSelect) {
        return;
      }
      var bruteOption = algorithmSelect.querySelector('option[value="bruteforce"]');
      if (!bruteOption) {
        return;
      }

      if (!Number.isFinite(totalCount) || totalCount <= 0) {
        bruteOption.disabled = true;
        if (bruteNoteEl) {
          bruteNoteEl.textContent = 'Load items to evaluate algorithm options.';
        }
        if (algorithmSelect.value === 'bruteforce') {
          algorithmSelect.value = 'laff';
        }
        return;
      }

      if (totalCount >= 8) {
        bruteOption.disabled = true;
        if (algorithmSelect.value === 'bruteforce') {
          algorithmSelect.value = 'laff';
        }
        if (bruteNoteEl) {
          bruteNoteEl.textContent = 'Bruteforce requires fewer than 8 total items. Current total: ' + totalCount + '.';
        }
      } else {
        bruteOption.disabled = false;
        if (bruteNoteEl) {
          bruteNoteEl.textContent = 'Bruteforce available. Current total items: ' + totalCount + '.';
        }
      }
    };

    var renderPreview = function () {
      if (!tableBody) {
        return;
      }

      tableBody.innerHTML = '';

      if (!state.items.length) {
        var emptyRow = document.createElement('tr');
        emptyRow.className = 'bin-pack__table-empty';
        var emptyCell = document.createElement('td');
        emptyCell.colSpan = 4;
        emptyCell.textContent = 'Items will appear here after parsing the CSV.';
        emptyRow.appendChild(emptyCell);
        tableBody.appendChild(emptyRow);
      } else {
        state.items.forEach(function (item) {
          var row = document.createElement('tr');
          var idCell = document.createElement('td');
          idCell.textContent = item.id;
          row.appendChild(idCell);

          var sizeCell = document.createElement('td');
          sizeCell.textContent = formatNumber(item.w, 0) + ' x ' + formatNumber(item.d, 0) + ' x ' + formatNumber(item.h, 0) + ' mm';
          row.appendChild(sizeCell);

          var weightCell = document.createElement('td');
          weightCell.textContent = formatNumber(item.weight) + ' kg';
          row.appendChild(weightCell);

          var qtyCell = document.createElement('td');
          qtyCell.textContent = String(item.qty);
          row.appendChild(qtyCell);

          tableBody.appendChild(row);
        });
      }

      var uniqueIds = new Set();
      var totalCount = 0;
      state.items.forEach(function (item) {
        uniqueIds.add(item.id);
        totalCount += item.qty;
      });

      if (uniqueCountEl) {
        uniqueCountEl.textContent = String(uniqueIds.size);
      }
      if (totalCountEl) {
        totalCountEl.textContent = String(totalCount);
      }
      if (totalWeightEl) {
        totalWeightEl.textContent = formatNumber(state.totalWeight);
      }

      updateAlgorithmAvailability(totalCount);
    };

    var applyParseResult = function (result) {
      state.items = result.items || [];
      state.totalWeight = result.totalWeight || 0;
      renderErrors(result.errors);
      renderPreview();
    };

    var parseFromTextarea = function () {
      var value = textarea ? textarea.value : '';
      if (!value || !value.trim()) {
        state.items = [];
        state.totalWeight = 0;
        renderErrors([]);
        renderPreview();
        return;
      }
      var result = parseItems(value);
      applyParseResult(result);
    };

    var readFile = function (file) {
      if (!file) {
        return;
      }

      var reader = new FileReader();
      reader.onload = function (event) {
        var text = event.target && event.target.result ? String(event.target.result) : '';
        if (textarea) {
          textarea.value = text;
        }
        parseFromTextarea();
      };
      reader.onerror = function () {
        setStatus('Failed to read the CSV file.', 'error');
      };
      reader.readAsText(file);
    };

    var resetResults = function () {
      if (outputEl) {
        outputEl.innerHTML = '';
        var placeholder = document.createElement('p');
        placeholder.className = 'bin-pack__placeholder';
        placeholder.textContent = 'No packing requests submitted yet.';
        outputEl.appendChild(placeholder);
      }
      if (metaSummaryEl) {
        metaSummaryEl.hidden = true;
      }
    };

    var renderMeta = function (meta, payload, totalCount) {
      if (!metaSummaryEl || !metaAlgorithmEl || !metaContainerEl || !metaItemsEl) {
        return;
      }

      if (!meta) {
        metaSummaryEl.hidden = true;
        return;
      }

      metaAlgorithmEl.textContent = meta.algorithm || (payload && payload.algorithm) || '--';

      if (payload && payload.container) {
        var container = payload.container;
        var parts = [
          container.id || meta.containerId || 'container',
          '(' + formatNumber(container.w, 0) + ' x ' + formatNumber(container.d, 0) + ' x ' + formatNumber(container.h, 0) + ' mm',
          'empty ' + formatNumber(container.emptyWeight) + ' kg',
          'max ' + formatNumber(container.maxLoadWeight) + ' kg)',
        ];
        metaContainerEl.textContent = parts.join(' ');
      } else if (meta.containerId) {
        metaContainerEl.textContent = meta.containerId;
      } else {
        metaContainerEl.textContent = '--';
      }

      var countValue = meta.totalItemCount;
      if (!Number.isFinite(countValue) && Number.isFinite(totalCount)) {
        countValue = totalCount;
      }
      metaItemsEl.textContent = Number.isFinite(countValue) ? String(countValue) : '--';

      metaSummaryEl.hidden = false;
    };

    var createElement = function (tag, className, text) {
      var element = document.createElement(tag);
      if (className) {
        element.className = className;
      }
      if (text) {
        element.textContent = text;
      }
      return element;
    };

    var renderResult = function (data) {
      if (!outputEl) {
        return;
      }

      outputEl.innerHTML = '';

      if (!data) {
        var empty = createElement('p', 'bin-pack__placeholder', 'No result returned from the API.');
        outputEl.appendChild(empty);
        return;
      }

      var summaryCard = createElement('div', 'bin-pack__result-card');
      var summaryHeader = createElement('div', 'bin-pack__result-header');
      summaryHeader.appendChild(createElement('div', 'bin-pack__result-title', 'Summary'));
      summaryHeader.appendChild(createElement('div', 'bin-pack__result-subtitle', data.success === false ? 'Failed' : 'Completed'));
      summaryCard.appendChild(summaryHeader);

      var summaryBody = createElement('div', 'bin-pack__result-body');
      var summaryGrid = createElement('div', 'bin-pack__summary');

      var used = Number.isFinite(data.containersUsed) ? data.containersUsed : (Array.isArray(data.pallets) ? data.pallets.length : 0);
      summaryGrid.appendChild(createElement('div', null, 'Containers used: ' + used));

      if (typeof data.note === 'string' && data.note.trim()) {
        var note = createElement('p', 'bin-pack__note', data.note);
        summaryBody.appendChild(note);
      }

      summaryBody.appendChild(summaryGrid);
      summaryCard.appendChild(summaryBody);
      outputEl.appendChild(summaryCard);

      if (Array.isArray(data.pallets) && data.pallets.length) {
        data.pallets.forEach(function (pallet, index) {
          var card = createElement('div', 'bin-pack__result-card');
          var header = createElement('div', 'bin-pack__result-header');
          var titleText = 'Container ' + (pallet.containerId || pallet.id || (index + 1));
          header.appendChild(createElement('div', 'bin-pack__result-title', titleText));
          header.appendChild(createElement('div', 'bin-pack__result-subtitle', 'Index ' + (Number.isFinite(pallet.index) ? pallet.index : index)));
          card.appendChild(header);

          var body = createElement('div', 'bin-pack__result-body');
          var summaryInfo = createElement('div', 'bin-pack__summary');
          summaryInfo.appendChild(createElement('div', null, 'Size: ' + formatNumber(pallet.w, 0) + ' x ' + formatNumber(pallet.d, 0) + ' x ' + formatNumber(pallet.h, 0) + ' mm'));
          body.appendChild(summaryInfo);

          if (Array.isArray(pallet.placements) && pallet.placements.length) {
            var placementList = createElement('ul', 'bin-pack__placement-list');
            pallet.placements.forEach(function (placement) {
              var item = createElement('li', 'bin-pack__placement');
              var strong = createElement('strong', null, placement.itemId || 'Item');
              item.appendChild(strong);
              var detail = [
                'origin (' + formatNumber(placement.x, 0) + ', ' + formatNumber(placement.y, 0) + ', ' + formatNumber(placement.z, 0) + ') mm',
                'size ' + formatNumber(placement.w, 0) + ' x ' + formatNumber(placement.d, 0) + ' x ' + formatNumber(placement.h, 0) + ' mm',
                'rotation ' + (placement.rotation || 'default'),
              ].join(' | ');
              item.appendChild(createElement('span', null, ' ' + detail));
              placementList.appendChild(item);
            });
            body.appendChild(placementList);
          } else {
            body.appendChild(createElement('p', 'bin-pack__placeholder', 'No placements returned for this container.'));
          }

          card.appendChild(body);
          outputEl.appendChild(card);
        });
      }

      if (Array.isArray(data.notPlaced) && data.notPlaced.length) {
        var notPlacedCard = createElement('div', 'bin-pack__result-card');
        var notPlacedHeader = createElement('div', 'bin-pack__result-header');
        notPlacedHeader.appendChild(createElement('div', 'bin-pack__result-title', 'Not placed'));
        notPlacedCard.appendChild(notPlacedHeader);

        var notPlacedList = createElement('ul', 'bin-pack__not-placed');
        data.notPlaced.forEach(function (entry) {
          var listItem = createElement('li', 'bin-pack__not-placed-item');
          var reason = entry.reason ? ' - ' + entry.reason : '';
          listItem.textContent = (entry.itemId || 'Item') + ' x ' + String(entry.count || 0) + reason;
          notPlacedList.appendChild(listItem);
        });

        notPlacedCard.appendChild(notPlacedList);
        outputEl.appendChild(notPlacedCard);
      }
    };

    var collectPayload = function () {
      var errors = [];
      var containerId = (form.elements.containerId && form.elements.containerId.value || '').trim();
      var width = Number(form.elements.containerWidth && form.elements.containerWidth.value);
      var depth = Number(form.elements.containerDepth && form.elements.containerDepth.value);
      var height = Number(form.elements.containerHeight && form.elements.containerHeight.value);
      var emptyWeight = Number(form.elements.containerEmptyWeight && form.elements.containerEmptyWeight.value);
      var maxLoadWeight = Number(form.elements.containerMaxLoadWeight && form.elements.containerMaxLoadWeight.value);

      if (!containerId) errors.push('Container ID is required.');
      if (!Number.isFinite(width) || width <= 0) errors.push('Container width must be greater than 0.');
      if (!Number.isFinite(depth) || depth <= 0) errors.push('Container depth must be greater than 0.');
      if (!Number.isFinite(height) || height <= 0) errors.push('Container height must be greater than 0.');
      if (!Number.isFinite(emptyWeight) || emptyWeight < 0) errors.push('Empty weight must be zero or more.');
      if (!Number.isFinite(maxLoadWeight) || maxLoadWeight < 0) errors.push('Max load weight must be zero or more.');

      if (!state.items.length) {
        errors.push('Add at least one item to run the packing request.');
      }

      var algorithm = algorithmSelect ? algorithmSelect.value : 'laff';

      var payload = {
        algorithm: algorithm || 'laff',
        container: {
          id: containerId,
          w: width,
          d: depth,
          h: height,
          emptyWeight: emptyWeight,
          maxLoadWeight: maxLoadWeight,
        },
        items: state.items.map(function (item) {
          return {
            id: item.id,
            w: item.w,
            d: item.d,
            h: item.h,
            weight: item.weight,
            qty: item.qty,
          };
        }),
      };

      return { payload: payload, errors: errors };
    };

    var handleSubmit = function (event) {
      event.preventDefault();

      setStatus('', null);

      var collected = collectPayload();
      if (collected.errors.length) {
        setStatus(collected.errors.join(' '), 'error');
        return;
      }

      var payload = collected.payload;
      var totalCount = state.items.reduce(function (sum, item) {
        return sum + item.qty;
      }, 0);

      if (payload.algorithm === 'bruteforce' && totalCount >= 8) {
        setStatus('Bruteforce algorithm is limited to fewer than 8 total items.', 'error');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Running...';
      }

      setStatus('Submitting packing request...', 'info');

      fetch('/binpacking/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
        .then(function (response) {
          if (!response.ok) {
            return response.json().catch(function () {
              return null;
            }).then(function (body) {
              var message = body && body.message ? body.message : 'The bin packing request failed.';
              throw new Error(message);
            });
          }
          return response.json();
        })
        .then(function (data) {
          if (!data || data.success === false) {
            var message = data && data.message ? data.message : 'The bin packing service returned an error.';
            setStatus(message, 'error');
          } else {
            setStatus('Packing completed successfully.', 'success');
          }
          renderMeta(data && data.meta, payload, totalCount);
          renderResult(data && data.data);
        })
        .catch(function (error) {
          setStatus(error.message || 'The bin packing request failed.', 'error');
          resetResults();
        })
        .finally(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Run packing';
          }
        });
    };

    if (fileInput) {
      fileInput.addEventListener('change', function (event) {
        var file = event.target && event.target.files ? event.target.files[0] : null;
        if (file) {
          readFile(file);
        }
      });
    }

    if (textarea) {
      textarea.addEventListener('input', parseFromTextarea);
    }

    if (sampleBtn && textarea) {
      sampleBtn.addEventListener('click', function () {
        textarea.value = SAMPLE_CSV;
        parseFromTextarea();
      });
    }

    if (clearBtn && textarea) {
      clearBtn.addEventListener('click', function () {
        textarea.value = '';
        if (fileInput) {
          fileInput.value = '';
        }
        parseFromTextarea();
        resetResults();
        setStatus('', null);
      });
    }

    form.addEventListener('submit', handleSubmit);
    resetResults();
  });
})();
