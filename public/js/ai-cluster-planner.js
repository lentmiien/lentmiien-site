(() => {
  const bootstrapEl = document.getElementById('cluster-planner-bootstrap');
  const app = document.getElementById('cluster-planner-app');

  if (!bootstrapEl || !app) {
    return;
  }

  let bootstrap;
  try {
    bootstrap = JSON.parse(bootstrapEl.textContent || '{}');
  } catch (error) {
    app.innerHTML = '<div class="empty-state">Unable to parse planner bootstrap data.</div>';
    return;
  }

  const TAB_STORAGE_KEY = 'aiClusterPlannerTab';

  const state = {
    data: bootstrap,
    activeTab: resolveInitialTab(bootstrap.tabs || []),
    hardwareFilter: {
      role: 'all',
      category: 'all',
      q: '',
    },
    inventoryFilter: {
      status: 'all',
      q: '',
    },
    flash: null,
    flashTimer: null,
    flashToken: 0,
  };

  function resolveInitialTab(tabs) {
    const validTabIds = new Set(Array.isArray(tabs) ? tabs.map((tab) => tab.id) : []);
    const hashTab = String(window.location.hash || '').replace(/^#/, '');
    let storedTab = '';

    try {
      storedTab = window.localStorage.getItem(TAB_STORAGE_KEY) || '';
    } catch (error) {
      storedTab = '';
    }

    if (hashTab && validTabIds.has(hashTab)) {
      return hashTab;
    }
    if (storedTab && validTabIds.has(storedTab)) {
      return storedTab;
    }
    return 'overview';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function formatDateTime(value) {
    if (!value) {
      return 'n/a';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  function truncate(value, maxLength = 34) {
    const stringValue = String(value || '').trim();
    if (stringValue.length <= maxLength) {
      return stringValue;
    }
    return `${stringValue.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  function getRoleInfo(roleKey) {
    return state.data.roleInfo && state.data.roleInfo[roleKey]
      ? state.data.roleInfo[roleKey]
      : null;
  }

  function getStatusInfo(status) {
    return state.data.resourceStatusInfo && state.data.resourceStatusInfo[status]
      ? state.data.resourceStatusInfo[status]
      : { label: status || 'Unknown', className: 'status-offline' };
  }

  function getNodeTypeMap() {
    return Array.isArray(state.data.nodeTypes)
      ? state.data.nodeTypes.reduce((acc, nodeType) => {
        acc[nodeType.key] = nodeType;
        return acc;
      }, {})
      : {};
  }

  function getNodeTypeByKey(key) {
    return getNodeTypeMap()[key] || null;
  }

  function getInventoryItemById(id) {
    return Array.isArray(state.data.inventory)
      ? state.data.inventory.find((item) => item.id === id)
      : null;
  }

  function getInventoryItemsForNodeType(nodeType) {
    if (!nodeType || !Array.isArray(state.data.inventory)) {
      return [];
    }
    return state.data.inventory.filter((item) => {
      if (item.nodeTypeKey === nodeType.key) {
        return true;
      }
      return Array.isArray(item.roles) && item.roles.includes(nodeType.code);
    });
  }

  function getPrimaryInventoryForNodeType(nodeTypeKey) {
    if (!Array.isArray(state.data.inventory)) {
      return null;
    }
    const inventory = state.data.inventory.filter((item) => item.nodeTypeKey === nodeTypeKey);
    if (!inventory.length) {
      return null;
    }
    inventory.sort((a, b) => safeNumber(a.order) - safeNumber(b.order));
    return inventory[0];
  }

  function getHardwareForRoles(roles) {
    if (!Array.isArray(state.data.hardwareCatalog)) {
      return [];
    }
    return state.data.hardwareCatalog.filter((item) => Array.isArray(item.roles) && item.roles.some((role) => roles.includes(role)));
  }

  function roleChip(roleKey, long = false) {
    const info = getRoleInfo(roleKey);
    if (!info) {
      return '';
    }
    const text = long ? `${escapeHtml(info.label)} — ${escapeHtml(info.name)}` : escapeHtml(info.label);
    return `<span class="chip ${escapeHtml(info.className)}">${text}</span>`;
  }

  function statusChip(status) {
    const info = getStatusInfo(status);
    return `<span class="status-chip ${escapeHtml(info.className)}">${escapeHtml(info.label)}</span>`;
  }

  function renderList(items, ordered = false) {
    const tag = ordered ? 'ol' : 'ul';
    const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!safeItems.length) {
      return '<div class="empty-state">No entries yet.</div>';
    }
    return `<${tag} class="clean">${safeItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
  }

  function renderSoftwarePills(items) {
    const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!safeItems.length) {
      return '<div class="empty-state">No items yet.</div>';
    }
    return `<div>${safeItems.map((item) => `<span class="soft-pill">${escapeHtml(item)}</span>`).join('')}</div>`;
  }

  function renderSpecTable(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    return `
      <table class="spec-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Minimum</th>
            <th>Recommended</th>
            <th>Ideal / ceiling</th>
          </tr>
        </thead>
        <tbody>
          ${safeRows.map((row) => `
            <tr>
              <th>${escapeHtml(row.metric)}</th>
              <td>${escapeHtml(row.min)}</td>
              <td>${escapeHtml(row.rec)}</td>
              <td>${escapeHtml(row.ideal)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderRoleCheckboxes(formName, selectedRoles = [], contextId = 'ctx') {
    return `
      <div class="checkbox-grid">
        ${Object.keys(state.data.roleInfo || {}).map((roleKey) => {
          const info = getRoleInfo(roleKey);
          const checkboxId = `${contextId}-${formName}-${roleKey}`;
          const checked = selectedRoles.includes(roleKey) ? 'checked' : '';
          return `
            <label class="checkbox-item" for="${escapeHtml(checkboxId)}">
              <input id="${escapeHtml(checkboxId)}" type="checkbox" name="${escapeHtml(formName)}" value="${escapeHtml(roleKey)}" ${checked}>
              <span>${escapeHtml(info.label)} — ${escapeHtml(info.name)}</span>
            </label>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderRangeEditorRows(ranges = []) {
    const safeRanges = Array.isArray(ranges) && ranges.length ? ranges : [{ metric: '', min: '', rec: '', ideal: '' }];
    return safeRanges.map((range) => `
      <tr>
        <td><input type="text" name="rangeMetric" value="${escapeHtml(range.metric || '')}" placeholder="Metric"></td>
        <td><input type="text" name="rangeMin" value="${escapeHtml(range.min || '')}" placeholder="Minimum"></td>
        <td><input type="text" name="rangeRec" value="${escapeHtml(range.rec || '')}" placeholder="Recommended"></td>
        <td><input type="text" name="rangeIdeal" value="${escapeHtml(range.ideal || '')}" placeholder="Ideal"></td>
        <td>
          <button type="button" class="action-btn danger ghost" data-action="remove-range-row">Remove</button>
        </td>
      </tr>
    `).join('');
  }

  function renderInventoryCards(items, options = {}) {
    const { compact = false, editable = false } = options;
    if (!Array.isArray(items) || !items.length) {
      return '<div class="empty-state">No resources matched the current filters.</div>';
    }

    return `
      <div class="inventory-grid">
        ${items.map((item) => {
          const nodeType = getNodeTypeByKey(item.nodeTypeKey);
          const title = item.shortName ? `${item.shortName} — ${item.name}` : item.name;
          return `
            <article class="inventory-card subcard ${compact ? 'compact' : ''}">
              <div class="section-head">
                <div>
                  <h4>${escapeHtml(title)}</h4>
                  <div class="meta">
                    ${escapeHtml(nodeType ? nodeType.title : 'Unmapped resource')}
                    ${item.hostname ? ` · ${escapeHtml(item.hostname)}` : ''}
                  </div>
                </div>
                <div class="chips">
                  ${statusChip(item.status)}
                  ${(Array.isArray(item.roles) ? item.roles : []).map((role) => roleChip(role)).join('')}
                </div>
              </div>
              <p>${escapeHtml(item.summary || 'No summary yet.')}</p>
              <div class="inventory-meta">
                ${item.location ? `<div><strong>Location:</strong> ${escapeHtml(item.location)}</div>` : ''}
                ${item.homeLanAddress ? `<div class="resource-addr"><strong>Home LAN:</strong> ${escapeHtml(item.homeLanAddress)}</div>` : ''}
                ${item.fabricAddress ? `<div class="resource-addr"><strong>AI fabric:</strong> ${escapeHtml(item.fabricAddress)}</div>` : ''}
              </div>
              ${Array.isArray(item.specs) && item.specs.length ? `
                <ul class="key-specs">
                  ${item.specs.map((spec) => `<li><strong>${escapeHtml(spec.label)}:</strong> ${escapeHtml(spec.value)}</li>`).join('')}
                </ul>
              ` : ''}
              ${Array.isArray(item.notes) && item.notes.length ? `
                <ul class="small-list">
                  ${item.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}
                </ul>
              ` : ''}
              ${editable ? `
                <div class="card-links">
                  <button type="button" class="action-btn secondary" data-action="edit-inventory" data-id="${escapeHtml(item.id)}">Edit</button>
                  <button type="button" class="action-btn danger" data-action="delete-inventory" data-id="${escapeHtml(item.id)}">Delete</button>
                </div>
              ` : ''}
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderHardwareCards(items, options = {}) {
    const { editable = false } = options;
    if (!Array.isArray(items) || !items.length) {
      return '<div class="empty-state">No hardware examples matched the current filters.</div>';
    }

    return `
      <div class="hardware-grid">
        ${items.map((item) => `
          <article class="hardware-card subcard">
            <div class="section-head">
              <div>
                <h4>${escapeHtml(item.name)}</h4>
                <div class="meta">${escapeHtml(item.category)} · ${escapeHtml(item.vendor)}</div>
              </div>
              <div class="chips">
                ${(Array.isArray(item.roles) ? item.roles : []).map((role) => roleChip(role)).join('')}
              </div>
            </div>
            <p>${escapeHtml(item.summary)}</p>
            <ul class="key-specs">
              ${(Array.isArray(item.specs) ? item.specs : []).map((spec) => `<li>${escapeHtml(spec)}</li>`).join('')}
            </ul>
            ${item.why ? `<p class="note"><strong>Why it fits:</strong> ${escapeHtml(item.why)}</p>` : ''}
            <div class="card-links">
              ${item.source ? `<a href="${escapeHtml(item.source)}" target="_blank" rel="noopener noreferrer">Official source ↗</a>` : ''}
              ${editable ? `<button type="button" class="action-btn secondary" data-action="edit-hardware" data-id="${escapeHtml(item.id)}">Edit</button>` : ''}
              ${editable ? `<button type="button" class="action-btn danger" data-action="delete-hardware" data-id="${escapeHtml(item.id)}">Delete</button>` : ''}
            </div>
          </article>
        `).join('')}
      </div>
    `;
  }

  function hardwareMatchesRole(item, role) {
    if (role === 'all') {
      return true;
    }
    if (role === 'infra') {
      return Array.isArray(item.roles) && item.roles.some((entry) => ['N', 'F', 'P'].includes(entry));
    }
    return Array.isArray(item.roles) && item.roles.includes(role);
  }

  function renderTopMetrics() {
    const counts = state.data.counts && state.data.counts.inventory ? state.data.counts.inventory : {};
    return `
      <section class="top-metrics">
        <div class="metric-card subcard">
          <strong>${escapeHtml(counts.total || 0)}</strong>
          <div class="note">Tracked resources</div>
        </div>
        <div class="metric-card subcard">
          <strong>${escapeHtml(counts.online || 0)}</strong>
          <div class="note">Online right now</div>
        </div>
        <div class="metric-card subcard">
          <strong>${escapeHtml(counts.planned || 0)}</strong>
          <div class="note">Planned local items</div>
        </div>
        <div class="metric-card subcard">
          <strong>${escapeHtml(counts.cloud || 0)}</strong>
          <div class="note">Cloud-backed capacity roles</div>
        </div>
      </section>
    `;
  }

  function renderOverviewSvg() {
    const g1 = getPrimaryInventoryForNodeType('g1');
    const s = getPrimaryInventoryForNodeType('s');
    const w = getPrimaryInventoryForNodeType('w');
    const x = getPrimaryInventoryForNodeType('x');
    const n = getPrimaryInventoryForNodeType('n');
    const f = getPrimaryInventoryForNodeType('f');
    const u = getPrimaryInventoryForNodeType('u');

    const g1Short = truncate(g1?.shortName || 'G1');
    const sShort = truncate(s?.shortName || 'S1');
    const wShort = truncate(w?.shortName || 'W1');
    const xShort = truncate(x?.shortName || 'X1-cloud');
    const nShort = truncate(n?.shortName || 'N1');
    const fShort = truncate(f?.shortName || 'F1');
    const uShort = truncate(u?.shortName || 'U1');

    return `
      <section class="cluster-card svg-panel">
        <svg class="hero-svg" viewBox="0 0 1440 800" role="img" aria-label="Overview diagram of the home AI fabric">
          <defs>
            <marker id="plannerArrowA" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="rgba(103,232,249,.85)"></path>
            </marker>
            <marker id="plannerArrowB" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="rgba(186,143,255,.75)"></path>
            </marker>
            <linearGradient id="plannerG1Grad" x1="0" x2="1">
              <stop offset="0%" stop-color="rgba(87,200,255,.18)"></stop>
              <stop offset="100%" stop-color="rgba(255,159,67,.15)"></stop>
            </linearGradient>
          </defs>

          <rect x="16" y="16" width="1408" height="768" rx="28" fill="rgba(8,12,18,.42)" stroke="rgba(255,255,255,.06)"></rect>

          <text x="44" y="54" class="svg-title">Home AI Fabric — conceptual layout</text>
          <text x="44" y="79" class="svg-sub">Solid nodes/links = near-term or current. Dashed nodes/links = future local expansion. Purple cloud = remote capacity / offsite services.</text>

          <rect x="42" y="110" width="396" height="620" rx="22" class="svg-group-home"></rect>
          <text x="66" y="145" class="svg-group-label">Home / User Network</text>
          <text x="66" y="168" class="svg-sub">Internet access, personal devices, shared LAN, and the normal home path</text>

          <rect x="500" y="110" width="898" height="620" rx="22" class="svg-group-ai"></rect>
          <text x="525" y="145" class="svg-group-label">Private AI Fabric</text>
          <text x="525" y="168" class="svg-sub">Compute, storage, orchestration, and direct east-west traffic</text>

          <path class="svg-cloud" d="M110 218
            c0 -28 22 -50 52 -50
            c20 0 37 9 47 24
            c7 -5 16 -8 25 -8
            c26 0 47 19 50 43
            c20 2 36 19 36 40
            c0 23 -18 41 -41 41
            h-140
            c-31 0 -56 -24 -56 -54
            c0 -18 9 -34 27 -46z"></path>
          <text x="126" y="234" class="svg-node-label">Internet</text>
          <text x="120" y="254" class="svg-node-small">remote access / upstream</text>

          <rect x="92" y="340" width="150" height="82" rx="18" class="svg-node"></rect>
          <text x="121" y="372" class="svg-node-label">Home Router</text>
          <text x="116" y="393" class="svg-node-small">normal LAN / internet edge</text>

          <rect x="272" y="340" width="126" height="82" rx="18" class="svg-node"></rect>
          <text x="300" y="372" class="svg-node-label">Devices</text>
          <text x="293" y="393" class="svg-node-small">laptop / phone / browser</text>

          <rect x="82" y="530" width="332" height="100" rx="18" class="svg-node"></rect>
          <text x="115" y="568" class="svg-node-label">Home NAS / Shared Storage</text>
          <text x="115" y="591" class="svg-node-small">authoritative data, backups, model archives</text>
          <text x="115" y="610" class="svg-node-small">home access + optional AI-fabric path</text>

          <rect x="432" y="298" width="180" height="126" rx="20" fill="url(#plannerG1Grad)" stroke="rgba(255,159,67,.55)" stroke-width="2.2"></rect>
          <text x="486" y="338" class="svg-node-label">${escapeHtml(g1Short)}</text>
          <text x="458" y="361" class="svg-node-small">Gateway / Control bridge</text>
          <text x="455" y="382" class="svg-node-small">routing, queues, auth, metrics</text>
          <text x="450" y="401" class="svg-node-small">dual-homed ingress boundary</text>

          <rect x="448" y="472" width="150" height="84" rx="18" class="svg-node future"></rect>
          <text x="500" y="504" class="svg-node-label">${escapeHtml(uShort)}</text>
          <text x="470" y="527" class="svg-node-small">utility sidecar / helper tier</text>

          <rect x="832" y="220" width="200" height="88" rx="18" class="svg-node"></rect>
          <text x="905" y="253" class="svg-node-label">${escapeHtml(fShort)}</text>
          <text x="860" y="276" class="svg-node-small">AI fabric switch / fast LAN</text>

          <rect x="560" y="360" width="190" height="98" rx="18" class="svg-node"></rect>
          <text x="632" y="396" class="svg-node-label">${escapeHtml(sShort)}</text>
          <text x="594" y="419" class="svg-node-small">interactive / low latency</text>
          <text x="590" y="438" class="svg-node-small">chat / coding / fast tools</text>

          <rect x="810" y="360" width="190" height="98" rx="18" class="svg-node"></rect>
          <text x="882" y="396" class="svg-node-label">${escapeHtml(wShort)}</text>
          <text x="854" y="419" class="svg-node-small">daily worker / throughput tier</text>
          <text x="853" y="438" class="svg-node-small">inference / agents / pipelines</text>

          <rect x="1060" y="360" width="190" height="98" rx="18" class="svg-node future"></rect>
          <text x="1130" y="396" class="svg-node-label">W2+</text>
          <text x="1090" y="419" class="svg-node-small">future workers</text>
          <text x="1082" y="438" class="svg-node-small">repeatable scale-out nodes</text>

          <rect x="560" y="560" width="190" height="98" rx="18" class="svg-node"></rect>
          <text x="632" y="596" class="svg-node-label">${escapeHtml(nShort)}</text>
          <text x="602" y="619" class="svg-node-small">authoritative storage path</text>
          <text x="594" y="638" class="svg-node-small">datasets / archives / artifacts</text>

          <rect x="810" y="560" width="190" height="98" rx="18" class="svg-node future"></rect>
          <text x="872" y="596" class="svg-node-label">${escapeHtml(xShort)}</text>
          <text x="839" y="619" class="svg-node-small">capacity role / giant-fit jobs</text>
          <text x="848" y="638" class="svg-node-small">local later, cloud first now</text>

          <path class="svg-cloud" d="M1160 560
            c0 -26 20 -47 47 -47
            c18 0 33 8 43 21
            c8 -5 16 -7 25 -7
            c23 0 43 17 47 39
            c18 1 33 17 33 37
            c0 20 -16 36 -36 36
            h-129
            c-28 0 -51 -22 -51 -49
            c0 -17 9 -31 21 -40z"></path>
          <text x="1187" y="582" class="svg-node-label">External</text>
          <text x="1176" y="603" class="svg-node-small">X-cloud / offsite backup / burst</text>

          <path d="M185 309 L167 340" class="svg-home-link"></path>
          <path d="M242 381 L272 381" class="svg-home-link"></path>
          <path d="M167 422 L167 530" class="svg-home-link"></path>
          <path d="M242 381 C322 381 377 372 432 360" class="svg-home-link"></path>
          <path d="M414 584 C470 584 510 609 560 609" class="svg-home-link"></path>

          <path d="M612 360 C688 318 762 286 832 264" class="svg-ai-link" marker-end="url(#plannerArrowA)"></path>
          <path d="M522 424 L522 472" class="svg-future-link"></path>
          <path d="M832 264 C760 304 722 326 690 360" class="svg-ai-link"></path>
          <path d="M932 308 L932 360" class="svg-ai-link"></path>
          <path d="M866 308 C788 390 718 500 654 560" class="svg-ai-link"></path>
          <path d="M1000 409 L1060 409" class="svg-future-link"></path>
          <path d="M905 458 L905 560" class="svg-future-link"></path>
          <path d="M1000 609 C1085 609 1135 609 1180 609" class="svg-remote-link" marker-end="url(#plannerArrowB)"></path>
          <path d="M612 330 C735 240 1035 226 1180 252" class="svg-remote-link" opacity=".58"></path>

          <text x="432" y="290" class="svg-sub">dual-homed bridge</text>
        </svg>

        <div class="legend">
          <span class="legend-line"><span class="swatch solid"></span> core local paths / current nodes</span>
          <span class="legend-line"><span class="swatch future"></span> future / optional local expansion</span>
          <span class="legend-line"><span class="swatch remote"></span> external resources / burst capacity</span>
        </div>
      </section>
    `;
  }

  function renderOverview() {
    const nearTerm = state.data.framework && state.data.framework.nearTermDeployment
      ? state.data.framework.nearTermDeployment
      : [];
    const snapshotItems = Array.isArray(state.data.inventory) ? state.data.inventory.slice(0, 4) : [];

    return `
      <div class="overview-wrap">
        ${renderTopMetrics()}
        ${renderOverviewSvg()}

        <section class="grid-2">
          <div class="cluster-card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Near-term</div>
                <h2>Suggested starting deployment shape</h2>
              </div>
            </div>
            ${renderList(nearTerm, true)}
            <div class="callout" style="margin-top:16px;">
              This keeps the first local <strong>X</strong> node optional. Start with G1 + S + W + NAS + a 10GbE fabric,
              and use remote capacity for giant-fit work until the logs justify local spend.
            </div>
          </div>

          <div class="cluster-card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Snapshot</div>
                <h2>Current resource inventory snapshot</h2>
                <p class="lead">This pulls from the inventory table, so it reflects the editable planner state rather than the old inline sample objects.</p>
              </div>
            </div>
            ${renderInventoryCards(snapshotItems, { compact: true, editable: false })}
          </div>
        </section>
      </div>
    `;
  }

  function renderFramework() {
    const framework = state.data.framework || {};

    return `
      <section class="cluster-card">
        <div class="section-head">
          <div>
            <div class="eyebrow">Framework</div>
            <h2>Core metrics, routing logic, and planning knobs</h2>
            <p class="lead">
              This page treats the ranges as a planning framework, not sacred truths. Node-type details are editable below on each role page,
              so the bigger topology can stay stable while the concrete specs evolve.
            </p>
          </div>
        </div>

        <div class="metric-grid">
          ${(framework.metrics || []).map((metric) => `
            <div class="subcard">
              <h3><code>${escapeHtml(metric.term)}</code> — ${escapeHtml(metric.title)}</h3>
              <p class="note">${escapeHtml(metric.text)}</p>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="cluster-card">
        <div class="section-head">
          <div>
            <div class="eyebrow">Routing</div>
            <h2>Queue classes and preferred routing order</h2>
          </div>
        </div>

        <div class="grid-3">
          ${(framework.queues || []).map((queue) => `
            <div class="subcard">
              <h3><code>${escapeHtml(queue.name)}</code></h3>
              <p><strong>Default route:</strong> ${escapeHtml(queue.route)}</p>
              <p class="note"><strong>Typical use:</strong></p>
              ${renderList(queue.use)}
              <p class="note"><strong>Policy note:</strong> ${escapeHtml(queue.note)}</p>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="grid-2">
        <div class="cluster-card">
          <div class="section-head">
            <div>
              <div class="eyebrow">Baseline</div>
              <h2>Editable planning knobs for this phase</h2>
            </div>
          </div>
          ${renderSpecTable(framework.baselineKnobs || [])}
        </div>

        <div class="cluster-card">
          <div class="section-head">
            <div>
              <div class="eyebrow">Auto-mapping</div>
              <h2>Role classification rules</h2>
            </div>
          </div>
          ${renderList(framework.classificationRules || [])}
          <div class="callout alt" style="margin-top:16px;">
            A healthy cluster thinks in <strong>roles</strong>, <strong>capabilities</strong>, and <strong>routing policy</strong> — not just hostnames.
          </div>
        </div>
      </section>

      <section class="cluster-card">
        <div class="section-head">
          <div>
            <div class="eyebrow">Software groups</div>
            <h2>Rough software stack groups for the system</h2>
          </div>
        </div>

        <div class="software-grid">
          ${(framework.softwareGroups || []).map((group) => `
            <div class="subcard">
              <h3>${escapeHtml(group.title)}</h3>
              ${renderSoftwarePills(group.items)}
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderInventoryForm() {
    const nodeTypes = Array.isArray(state.data.nodeTypes) ? state.data.nodeTypes : [];
    return `
      <section class="cluster-card form-card">
        <div class="section-head">
          <div>
            <div class="eyebrow">Edit inventory</div>
            <h2>Add or update a tracked resource</h2>
            <p class="lead">Use one line per spec in the format <code>Label: value</code>. Notes are one line per entry.</p>
          </div>
        </div>

        <form id="inventoryForm">
          <input type="hidden" name="id" value="">
          <div class="form-grid">
            <div class="field">
              <label for="inventoryShortName">Resource code</label>
              <input id="inventoryShortName" type="text" name="shortName" placeholder="S1-01">
            </div>
            <div class="field span-2">
              <label for="inventoryName">Name</label>
              <input id="inventoryName" type="text" name="name" placeholder="Current AI desktop" required>
            </div>
            <div class="field">
              <label for="inventoryOrder">Sort order</label>
              <input id="inventoryOrder" type="number" name="order" value="0" step="1">
            </div>

            <div class="field span-2">
              <label for="inventoryNodeType">Node type</label>
              <select id="inventoryNodeType" name="nodeTypeKey">
                <option value="">Unmapped</option>
                ${nodeTypes.map((nodeType) => `<option value="${escapeHtml(nodeType.key)}">${escapeHtml(nodeType.code)} — ${escapeHtml(nodeType.title)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="inventoryStatus">Status</label>
              <select id="inventoryStatus" name="status">
                ${Object.keys(state.data.resourceStatusInfo || {}).map((status) => `
                  <option value="${escapeHtml(status)}" ${status === 'planned' ? 'selected' : ''}>${escapeHtml(state.data.resourceStatusInfo[status].label)}</option>
                `).join('')}
              </select>
            </div>
            <div class="field">
              <label for="inventoryHostname">Hostname</label>
              <input id="inventoryHostname" type="text" name="hostname" placeholder="s1-01">
            </div>

            <div class="field span-2">
              <label>Roles</label>
              ${renderRoleCheckboxes('roles', [], 'inventory')}
            </div>
            <div class="field">
              <label for="inventoryLocation">Location</label>
              <input id="inventoryLocation" type="text" name="location" placeholder="Desk">
            </div>
            <div class="field">
              <label for="inventoryHomeLanAddress">Home LAN</label>
              <input id="inventoryHomeLanAddress" type="text" name="homeLanAddress" placeholder="192.168.x.x">
            </div>

            <div class="field">
              <label for="inventoryFabricAddress">AI fabric address</label>
              <input id="inventoryFabricAddress" type="text" name="fabricAddress" placeholder="10.x.x.x">
            </div>

            <div class="field span-4">
              <label for="inventorySummary">Summary</label>
              <textarea id="inventorySummary" name="summary" placeholder="Short description of the resource and why it exists."></textarea>
            </div>

            <div class="field span-2">
              <label for="inventorySpecs">Specs</label>
              <textarea id="inventorySpecs" name="specs" placeholder="CPU: 16 cores&#10;RAM: 128 GB&#10;GPU: 32 GB VRAM"></textarea>
              <div class="editor-help">One line per spec. Use <code>Label: value</code>.</div>
            </div>

            <div class="field span-2">
              <label for="inventoryNotes">Notes</label>
              <textarea id="inventoryNotes" name="notes" placeholder="One note per line"></textarea>
            </div>
          </div>

          <div class="action-row">
            <span class="editor-help">Inventory changes save directly to MongoDB.</span>
            <div class="inline-actions">
              <button type="button" class="action-btn ghost" data-action="reset-inventory-form">Reset</button>
              <button type="submit" class="action-btn">Save Resource</button>
            </div>
          </div>
        </form>
      </section>
    `;
  }

  function renderInventoryPage() {
    const counts = state.data.counts && state.data.counts.inventory ? state.data.counts.inventory : {};
    const filter = state.inventoryFilter;

    return `
      ${renderTopMetrics()}

      <section class="cluster-card">
        <div class="section-head">
          <div>
            <div class="eyebrow">Inventory</div>
            <h2>Current resources and planned units</h2>
            <p class="lead">Track what already exists, what is planned, and how each resource maps onto the cluster roles.</p>
          </div>
          <div class="chips">
            <span class="status-pill"><strong>Tracked:</strong> ${escapeHtml(counts.total || 0)}</span>
            <span class="status-pill"><strong>Online:</strong> ${escapeHtml(counts.online || 0)}</span>
            <span class="status-pill"><strong>Planned:</strong> ${escapeHtml(counts.planned || 0)}</span>
          </div>
        </div>

        <div class="controls">
          <div class="filter-bar">
            ${['all', 'online', 'planned', 'cloud', 'offline', 'maintenance', 'retired'].map((status) => {
              const label = status === 'all'
                ? 'All'
                : escapeHtml(getStatusInfo(status).label);
              const activeClass = filter.status === status ? 'active' : '';
              return `<button type="button" class="filter-btn ${activeClass}" data-inventory-status="${escapeHtml(status)}">${label}</button>`;
            }).join('')}
          </div>

          <div class="search-grow">
            <input id="inventorySearch" type="search" placeholder="Search resources, roles, addresses, notes, or specs…" value="${escapeHtml(filter.q)}">
          </div>
        </div>

        <div id="inventoryResults"></div>
      </section>

      ${renderInventoryForm()}
    `;
  }

  function renderNodeSection(nodeType, options = {}) {
    const { showHardware = true, extraCallout = '' } = options;
    const relatedInventory = getInventoryItemsForNodeType(nodeType);
    const relatedHardware = getHardwareForRoles(Array.isArray(nodeType.hardwareRoles) ? nodeType.hardwareRoles : []);

    return `
      <section class="cluster-card">
        <div class="section-head">
          <div>
            <div class="eyebrow">${escapeHtml(nodeType.code)}</div>
            <h2>${escapeHtml(nodeType.title)}</h2>
            <p class="lead">${escapeHtml(nodeType.summary)}</p>
          </div>
          <div class="chips">
            ${roleChip(nodeType.code, true)}
          </div>
        </div>

        <div class="grid-2">
          <div class="subcard">
            <h3>Spec ranges</h3>
            ${renderSpecTable(nodeType.ranges)}
          </div>

          <div class="stack">
            <div class="subcard">
              <h3>Typical workloads</h3>
              ${renderList(nodeType.workloads)}
            </div>

            <div class="subcard">
              <h3>Policy</h3>
              ${renderList(nodeType.policy)}
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="subcard">
            <h3>Suggested software groups</h3>
            ${renderSoftwarePills(nodeType.software)}
          </div>

          <div class="subcard">
            <h3>What not to optimize for</h3>
            ${renderList(nodeType.avoid)}
          </div>
        </div>

        <div class="subcard">
          <h3>Current inventory mapped to this role</h3>
          <p class="note">This section is sourced from the inventory table, so it reflects your tracked resources and planned nodes.</p>
          ${renderInventoryCards(relatedInventory, { compact: true, editable: false })}
        </div>

        ${showHardware ? `
          <div class="subcard" style="margin-top:16px;">
            <h3>Relevant hardware examples</h3>
            <p class="note">These are examples of platforms or components that fit this role — not mandatory full builds.</p>
            ${renderHardwareCards(relatedHardware, { editable: false })}
          </div>
        ` : ''}

        ${extraCallout || ''}

        <details class="editor-panel">
          <summary>Edit node type</summary>
          <div class="editor-body">
            <form class="node-type-form" data-id="${escapeHtml(nodeType.id)}">
              <div class="form-grid">
                <div class="field span-2">
                  <label>Title</label>
                  <input type="text" name="title" value="${escapeHtml(nodeType.title)}" required>
                </div>
                <div class="field">
                  <label>Role code</label>
                  <input type="text" value="${escapeHtml(nodeType.code)}" readonly>
                </div>
                <div class="field">
                  <label>Tab group</label>
                  <input type="text" value="${escapeHtml(nodeType.tabId)}" readonly>
                </div>

                <div class="field span-4">
                  <label>Summary</label>
                  <textarea name="summary">${escapeHtml(nodeType.summary)}</textarea>
                </div>

                <div class="field span-2">
                  <label>Typical workloads</label>
                  <textarea name="workloads">${escapeHtml((nodeType.workloads || []).join('\n'))}</textarea>
                  <div class="editor-help">One line per workload.</div>
                </div>
                <div class="field span-2">
                  <label>Policy</label>
                  <textarea name="policy">${escapeHtml((nodeType.policy || []).join('\n'))}</textarea>
                  <div class="editor-help">One line per policy entry.</div>
                </div>

                <div class="field span-2">
                  <label>Avoid</label>
                  <textarea name="avoid">${escapeHtml((nodeType.avoid || []).join('\n'))}</textarea>
                  <div class="editor-help">One line per caution.</div>
                </div>
                <div class="field span-2">
                  <label>Suggested software groups</label>
                  <textarea name="software">${escapeHtml((nodeType.software || []).join('\n'))}</textarea>
                  <div class="editor-help">One line per software item.</div>
                </div>

                <div class="field span-4">
                  <label>Hardware catalog role matching</label>
                  ${renderRoleCheckboxes('hardwareRoles', nodeType.hardwareRoles || [], `node-type-${nodeType.id}`)}
                </div>

                <div class="field span-4">
                  <label>Spec ranges</label>
                  <table class="range-editor">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Minimum</th>
                        <th>Recommended</th>
                        <th>Ideal</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${renderRangeEditorRows(nodeType.ranges)}
                    </tbody>
                  </table>
                  <div class="inline-actions" style="margin-top:12px;">
                    <button type="button" class="action-btn ghost" data-action="add-range-row">Add range row</button>
                  </div>
                </div>
              </div>

              <div class="action-row">
                <span class="editor-help">Node type changes save directly to MongoDB.</span>
                <div class="inline-actions">
                  <button type="submit" class="action-btn">Save Node Type</button>
                </div>
              </div>
            </form>
          </div>
        </details>
      </section>
    `;
  }

  function renderNodePage(nodeKeys, options = {}) {
    return nodeKeys.map((key) => {
      const nodeType = getNodeTypeByKey(key);
      if (!nodeType) {
        return '';
      }
      return renderNodeSection(nodeType, typeof options[key] === 'object' ? options[key] : {});
    }).join('');
  }

  function renderX() {
    return `
      <div class="callout">
        <strong>Important:</strong> in this framework, X is allowed to be <strong>cloud-backed first</strong>. The local X node is the easiest place to overspend,
        so the role exists before the hardware exists.
      </div>
      ${renderNodePage(['x'])}
    `;
  }

  function renderHardwareForm() {
    return `
      <section class="cluster-card form-card">
        <div class="section-head">
          <div>
            <div class="eyebrow">Edit catalog</div>
            <h2>Add or update hardware ideas</h2>
            <p class="lead">Catalog entries automatically flow into the relevant node-type pages via role matching.</p>
          </div>
        </div>

        <form id="hardwareForm">
          <input type="hidden" name="id" value="">
          <div class="form-grid">
            <div class="field span-2">
              <label for="hardwareName">Name</label>
              <input id="hardwareName" type="text" name="name" placeholder="AMD Radeon AI PRO R9700" required>
            </div>
            <div class="field">
              <label for="hardwareVendor">Vendor</label>
              <input id="hardwareVendor" type="text" name="vendor" placeholder="AMD">
            </div>
            <div class="field">
              <label for="hardwareCategoryInput">Category</label>
              <input id="hardwareCategoryInput" type="text" name="category" placeholder="GPU">
            </div>

            <div class="field">
              <label for="hardwareOrder">Sort order</label>
              <input id="hardwareOrder" type="number" name="order" value="0" step="1">
            </div>
            <div class="field span-3">
              <label>Mapped roles</label>
              ${renderRoleCheckboxes('roles', [], 'hardware')}
            </div>

            <div class="field span-2">
              <label for="hardwareSource">Official source URL</label>
              <input id="hardwareSource" type="url" name="source" placeholder="https://example.com/specs">
            </div>
            <div class="field span-2">
              <label for="hardwareSummary">Summary</label>
              <textarea id="hardwareSummary" name="summary" placeholder="Short description of the part or platform."></textarea>
            </div>

            <div class="field span-2">
              <label for="hardwareWhy">Why it fits</label>
              <textarea id="hardwareWhy" name="why" placeholder="Why it is interesting for this planner."></textarea>
            </div>
            <div class="field span-2">
              <label for="hardwareSpecs">Key specs</label>
              <textarea id="hardwareSpecs" name="specs" placeholder="32 GB VRAM&#10;PCIe 5.0&#10;10GbE onboard"></textarea>
              <div class="editor-help">One line per spec.</div>
            </div>
          </div>

          <div class="action-row">
            <span class="editor-help">Hardware additions/deletions will immediately affect the role pages after refresh.</span>
            <div class="inline-actions">
              <button type="button" class="action-btn ghost" data-action="reset-hardware-form">Reset</button>
              <button type="submit" class="action-btn">Save Hardware</button>
            </div>
          </div>
        </form>
      </section>
    `;
  }

  function renderHardwarePageShell() {
    const categories = ['all', ...Array.from(new Set((state.data.hardwareCatalog || []).map((item) => item.category).filter(Boolean))).sort()];

    return `
      <section class="cluster-card">
        <div class="section-head">
          <div>
            <div class="eyebrow">Catalog</div>
            <h2>Current hardware examples mapped to node roles</h2>
            <p class="lead">
              These are examples that fit the framework — not a mandatory bill of materials.
              The add/edit form below writes to the catalog table, and the role pages reuse the same data.
            </p>
          </div>
        </div>

        <div class="controls">
          <div class="filter-bar" id="hardwareRoleFilters">
            ${[
              ['all', 'All'],
              ['G1', 'G1'],
              ['U', 'U'],
              ['S', 'S'],
              ['W', 'W'],
              ['X', 'X'],
              ['infra', 'N / F / P'],
            ].map(([role, label]) => {
              const activeClass = state.hardwareFilter.role === role ? 'active' : '';
              return `<button type="button" class="filter-btn ${activeClass}" data-hardware-role="${escapeHtml(role)}">${escapeHtml(label)}</button>`;
            }).join('')}
          </div>

          <div class="search-grow">
            <input id="hardwareSearch" type="search" placeholder="Search hardware, vendor, category, or keywords…" value="${escapeHtml(state.hardwareFilter.q)}">
          </div>

          <div style="min-width:220px;">
            <select id="hardwareCategory">
              ${categories.map((category) => `
                <option value="${escapeHtml(category)}" ${state.hardwareFilter.category === category ? 'selected' : ''}>
                  ${escapeHtml(category === 'all' ? 'All categories' : category)}
                </option>
              `).join('')}
            </select>
          </div>
        </div>

        <div id="hardwareResults"></div>
      </section>

      ${renderHardwareForm()}
    `;
  }

  function renderPage(tabId) {
    switch (tabId) {
      case 'overview':
        return renderOverview();
      case 'framework':
        return renderFramework();
      case 'inventory':
        return renderInventoryPage();
      case 'g1u':
        return renderNodePage(['g1', 'u']);
      case 's':
        return renderNodePage(['s']);
      case 'w':
        return renderNodePage(['w']);
      case 'x':
        return renderX();
      case 'infra':
        return renderNodePage(['n', 'f', 'p'], {
          p: {
            showHardware: false,
            extraCallout: `
              <div class="muted-box" style="margin-top:16px;">
                A practical home rule: put <strong>G1 + N + the AI-fabric switch</strong> on UPS first. Everything else can be a second-order problem.
              </div>
            `,
          },
        });
      case 'hardware':
        return renderHardwarePageShell();
      default:
        return renderOverview();
    }
  }

  function renderApp() {
    const counts = state.data.counts || {};
    const inventoryCounts = counts.inventory || {};

    app.innerHTML = `
      <header class="topbar">
        <div class="title-wrap">
          <h1>${escapeHtml(state.data.title || 'Home AI Fabric Planner')}</h1>
          <p>${escapeHtml(state.data.subtitle || '')}</p>
        </div>
        <div class="status-pills">
          <span class="status-pill"><strong>Version:</strong> ${escapeHtml(state.data.versionLabel || 'db-backed')}</span>
          <span class="status-pill"><strong>Updated:</strong> ${escapeHtml(formatDateTime(state.data.generatedAt))}</span>
          <span class="status-pill"><strong>Inventory:</strong> ${escapeHtml(inventoryCounts.total || 0)} items</span>
          <span class="status-pill"><strong>Catalog:</strong> ${escapeHtml(counts.hardwareCatalog || 0)} entries</span>
          <span class="status-pill"><strong>Bias:</strong> modular over monolithic</span>
        </div>
      </header>

      ${state.flash ? `<div class="app-notice ${escapeHtml(state.flash.type)}">${escapeHtml(state.flash.message)}</div>` : ''}

      <nav class="tabs" aria-label="Planner tabs">
        ${(state.data.tabs || []).map((tab) => `
          <button
            type="button"
            class="tab-btn ${state.activeTab === tab.id ? 'active' : ''}"
            data-tab="${escapeHtml(tab.id)}"
            aria-selected="${state.activeTab === tab.id ? 'true' : 'false'}">
            ${escapeHtml(tab.label)}
          </button>
        `).join('')}
      </nav>

      <main id="clusterPlannerContent" class="cluster-main">
        ${renderPage(state.activeTab)}
      </main>

      <footer class="footer-note">
        Inventory, node type specs, and the hardware catalog are editable and stored in MongoDB. The overview and framework explanations stay aligned with the original sample page.
      </footer>
    `;

    applyTabSideEffects();
  }

  function applyTabSideEffects() {
    if (state.activeTab === 'inventory') {
      applyInventoryFilters();
    }
    if (state.activeTab === 'hardware') {
      applyHardwareFilters();
    }
  }

  function setActiveTab(tabId) {
    const validTabIds = new Set((state.data.tabs || []).map((tab) => tab.id));
    state.activeTab = validTabIds.has(tabId) ? tabId : 'overview';
    window.location.hash = state.activeTab;
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, state.activeTab);
    } catch (error) {
    }
    renderApp();
  }

  function setFlash(type, message) {
    state.flash = {
      type,
      message,
    };
    state.flashToken += 1;
    const token = state.flashToken;
    renderApp();

    window.clearTimeout(state.flashTimer);
    state.flashTimer = window.setTimeout(() => {
      if (token !== state.flashToken) {
        return;
      }
      state.flash = null;
      const notice = app.querySelector('.app-notice');
      if (notice) {
        notice.remove();
      }
    }, 4200);
  }

  async function fetchJson(url, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    const config = Object.assign({}, options, { headers });
    if (config.body != null && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await window.fetch(url, config);
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = { message: text };
      }
    }
    if (!response.ok) {
      throw new Error(payload.message || `Request failed (${response.status})`);
    }
    return payload;
  }

  async function refreshState(successMessage) {
    const nextState = await fetchJson('/ai-cluster-planner/api/state');
    state.data = nextState;
    if (successMessage) {
      setFlash('success', successMessage);
      return;
    }
    renderApp();
  }

  function parseLines(value) {
    return String(value || '')
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function parseKeyValueLines(value) {
    return parseLines(value).map((line) => {
      const separatorIndex = line.includes('|')
        ? line.indexOf('|')
        : line.indexOf(':');
      if (separatorIndex < 0) {
        return null;
      }
      const label = line.slice(0, separatorIndex).trim();
      const specValue = line.slice(separatorIndex + 1).trim();
      if (!label || !specValue) {
        return null;
      }
      return {
        label,
        value: specValue,
      };
    }).filter(Boolean);
  }

  function getCheckedValues(form, name) {
    return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
  }

  function applyInventoryFilters() {
    const resultsEl = document.getElementById('inventoryResults');
    if (!resultsEl) {
      return;
    }

    const q = state.inventoryFilter.q.trim().toLowerCase();
    const filtered = (state.data.inventory || []).filter((item) => {
      const statusOk = state.inventoryFilter.status === 'all' || item.status === state.inventoryFilter.status;
      const haystack = [
        item.shortName,
        item.name,
        item.summary,
        item.hostname,
        item.location,
        item.homeLanAddress,
        item.fabricAddress,
        ...(item.roles || []),
        ...((item.specs || []).flatMap((spec) => [spec.label, spec.value])),
        ...(item.notes || []),
      ].join(' ').toLowerCase();
      const qOk = !q || haystack.includes(q);
      return statusOk && qOk;
    });

    resultsEl.innerHTML = renderInventoryCards(filtered, { compact: false, editable: true });
  }

  function applyHardwareFilters() {
    const resultsEl = document.getElementById('hardwareResults');
    if (!resultsEl) {
      return;
    }

    const q = state.hardwareFilter.q.trim().toLowerCase();
    const filtered = (state.data.hardwareCatalog || []).filter((item) => {
      const roleOk = hardwareMatchesRole(item, state.hardwareFilter.role);
      const categoryOk = state.hardwareFilter.category === 'all' || item.category === state.hardwareFilter.category;
      const haystack = [
        item.name,
        item.vendor,
        item.category,
        item.summary,
        item.why,
        ...(item.specs || []),
        ...(item.roles || []),
      ].join(' ').toLowerCase();
      const qOk = !q || haystack.includes(q);
      return roleOk && categoryOk && qOk;
    });

    resultsEl.innerHTML = renderHardwareCards(filtered, { editable: true });
  }

  function resetInventoryForm() {
    const form = document.getElementById('inventoryForm');
    if (!form) {
      return;
    }
    form.reset();
    const idField = form.querySelector('input[name="id"]');
    if (idField) {
      idField.value = '';
    }
    const statusField = form.querySelector('select[name="status"]');
    if (statusField) {
      statusField.value = 'planned';
    }
  }

  function resetHardwareForm() {
    const form = document.getElementById('hardwareForm');
    if (!form) {
      return;
    }
    form.reset();
    const idField = form.querySelector('input[name="id"]');
    if (idField) {
      idField.value = '';
    }
  }

  function populateCheckboxGroup(form, name, values = []) {
    const selected = new Set(values);
    Array.from(form.querySelectorAll(`input[name="${name}"]`)).forEach((input) => {
      input.checked = selected.has(input.value);
    });
  }

  function populateInventoryForm(id) {
    const form = document.getElementById('inventoryForm');
    const item = getInventoryItemById(id);
    if (!form || !item) {
      return;
    }

    form.querySelector('input[name="id"]').value = item.id || '';
    form.querySelector('input[name="shortName"]').value = item.shortName || '';
    form.querySelector('input[name="name"]').value = item.name || '';
    form.querySelector('select[name="nodeTypeKey"]').value = item.nodeTypeKey || '';
    form.querySelector('select[name="status"]').value = item.status || 'planned';
    form.querySelector('input[name="hostname"]').value = item.hostname || '';
    form.querySelector('input[name="location"]').value = item.location || '';
    form.querySelector('input[name="homeLanAddress"]').value = item.homeLanAddress || '';
    form.querySelector('input[name="fabricAddress"]').value = item.fabricAddress || '';
    form.querySelector('input[name="order"]').value = safeNumber(item.order);
    form.querySelector('textarea[name="summary"]').value = item.summary || '';
    form.querySelector('textarea[name="specs"]').value = (item.specs || []).map((spec) => `${spec.label}: ${spec.value}`).join('\n');
    form.querySelector('textarea[name="notes"]').value = (item.notes || []).join('\n');
    populateCheckboxGroup(form, 'roles', item.roles || []);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function populateHardwareForm(id) {
    const form = document.getElementById('hardwareForm');
    const item = Array.isArray(state.data.hardwareCatalog)
      ? state.data.hardwareCatalog.find((entry) => entry.id === id)
      : null;

    if (!form || !item) {
      return;
    }

    form.querySelector('input[name="id"]').value = item.id || '';
    form.querySelector('input[name="name"]').value = item.name || '';
    form.querySelector('input[name="vendor"]').value = item.vendor || '';
    form.querySelector('input[name="category"]').value = item.category || '';
    form.querySelector('input[name="source"]').value = item.source || '';
    form.querySelector('input[name="order"]').value = safeNumber(item.order);
    form.querySelector('textarea[name="summary"]').value = item.summary || '';
    form.querySelector('textarea[name="why"]').value = item.why || '';
    form.querySelector('textarea[name="specs"]').value = (item.specs || []).join('\n');
    populateCheckboxGroup(form, 'roles', item.roles || []);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function collectInventoryFormPayload(form) {
    return {
      id: form.querySelector('input[name="id"]').value.trim() || undefined,
      shortName: form.querySelector('input[name="shortName"]').value.trim(),
      name: form.querySelector('input[name="name"]').value.trim(),
      nodeTypeKey: form.querySelector('select[name="nodeTypeKey"]').value.trim(),
      status: form.querySelector('select[name="status"]').value.trim(),
      hostname: form.querySelector('input[name="hostname"]').value.trim(),
      location: form.querySelector('input[name="location"]').value.trim(),
      homeLanAddress: form.querySelector('input[name="homeLanAddress"]').value.trim(),
      fabricAddress: form.querySelector('input[name="fabricAddress"]').value.trim(),
      order: safeNumber(form.querySelector('input[name="order"]').value),
      summary: form.querySelector('textarea[name="summary"]').value.trim(),
      specs: parseKeyValueLines(form.querySelector('textarea[name="specs"]').value),
      notes: parseLines(form.querySelector('textarea[name="notes"]').value),
      roles: getCheckedValues(form, 'roles'),
    };
  }

  function collectHardwareFormPayload(form) {
    return {
      id: form.querySelector('input[name="id"]').value.trim() || undefined,
      name: form.querySelector('input[name="name"]').value.trim(),
      vendor: form.querySelector('input[name="vendor"]').value.trim(),
      category: form.querySelector('input[name="category"]').value.trim(),
      source: form.querySelector('input[name="source"]').value.trim(),
      order: safeNumber(form.querySelector('input[name="order"]').value),
      summary: form.querySelector('textarea[name="summary"]').value.trim(),
      why: form.querySelector('textarea[name="why"]').value.trim(),
      specs: parseLines(form.querySelector('textarea[name="specs"]').value),
      roles: getCheckedValues(form, 'roles'),
    };
  }

  function collectNodeTypePayload(form) {
    const rangeRows = Array.from(form.querySelectorAll('tbody tr')).map((row) => ({
      metric: row.querySelector('input[name="rangeMetric"]').value.trim(),
      min: row.querySelector('input[name="rangeMin"]').value.trim(),
      rec: row.querySelector('input[name="rangeRec"]').value.trim(),
      ideal: row.querySelector('input[name="rangeIdeal"]').value.trim(),
    })).filter((row) => row.metric);

    return {
      title: form.querySelector('input[name="title"]').value.trim(),
      summary: form.querySelector('textarea[name="summary"]').value.trim(),
      workloads: parseLines(form.querySelector('textarea[name="workloads"]').value),
      policy: parseLines(form.querySelector('textarea[name="policy"]').value),
      avoid: parseLines(form.querySelector('textarea[name="avoid"]').value),
      software: parseLines(form.querySelector('textarea[name="software"]').value),
      hardwareRoles: getCheckedValues(form, 'hardwareRoles'),
      ranges: rangeRows,
    };
  }

  function appendRangeRow(form) {
    const tbody = form.querySelector('tbody');
    if (!tbody) {
      return;
    }
    tbody.insertAdjacentHTML('beforeend', renderRangeEditorRows([{ metric: '', min: '', rec: '', ideal: '' }]));
  }

  async function handleInventorySubmit(form) {
    const payload = collectInventoryFormPayload(form);
    try {
      await fetchJson('/ai-cluster-planner/api/inventory', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await refreshState(payload.id ? 'Inventory item updated.' : 'Inventory item added.');
      resetInventoryForm();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function handleHardwareSubmit(form) {
    const payload = collectHardwareFormPayload(form);
    try {
      await fetchJson('/ai-cluster-planner/api/hardware', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await refreshState(payload.id ? 'Hardware entry updated.' : 'Hardware entry added.');
      resetHardwareForm();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function handleNodeTypeSubmit(form) {
    const payload = collectNodeTypePayload(form);
    const id = form.dataset.id;
    try {
      await fetchJson(`/ai-cluster-planner/api/node-type/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await refreshState('Node type updated.');
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function handleInventoryDelete(id) {
    if (!window.confirm('Delete this inventory item?')) {
      return;
    }
    try {
      await fetchJson(`/ai-cluster-planner/api/inventory/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      await refreshState('Inventory item deleted.');
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function handleHardwareDelete(id) {
    if (!window.confirm('Delete this hardware catalog entry?')) {
      return;
    }
    try {
      await fetchJson(`/ai-cluster-planner/api/hardware/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      await refreshState('Hardware entry deleted.');
    } catch (error) {
      window.alert(error.message);
    }
  }

  app.addEventListener('click', (event) => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) {
      state.flash = null;
      setActiveTab(tabButton.dataset.tab);
      return;
    }

    const inventoryStatusButton = event.target.closest('[data-inventory-status]');
    if (inventoryStatusButton) {
      state.inventoryFilter.status = inventoryStatusButton.dataset.inventoryStatus || 'all';
      applyInventoryFilters();
      Array.from(app.querySelectorAll('[data-inventory-status]')).forEach((button) => {
        button.classList.toggle('active', button === inventoryStatusButton);
      });
      return;
    }

    const hardwareRoleButton = event.target.closest('[data-hardware-role]');
    if (hardwareRoleButton) {
      state.hardwareFilter.role = hardwareRoleButton.dataset.hardwareRole || 'all';
      applyHardwareFilters();
      Array.from(app.querySelectorAll('[data-hardware-role]')).forEach((button) => {
        button.classList.toggle('active', button === hardwareRoleButton);
      });
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    if (action === 'edit-inventory') {
      populateInventoryForm(actionButton.dataset.id);
      return;
    }
    if (action === 'delete-inventory') {
      void handleInventoryDelete(actionButton.dataset.id);
      return;
    }
    if (action === 'reset-inventory-form') {
      resetInventoryForm();
      return;
    }
    if (action === 'edit-hardware') {
      populateHardwareForm(actionButton.dataset.id);
      return;
    }
    if (action === 'delete-hardware') {
      void handleHardwareDelete(actionButton.dataset.id);
      return;
    }
    if (action === 'reset-hardware-form') {
      resetHardwareForm();
      return;
    }
    if (action === 'add-range-row') {
      const form = actionButton.closest('form');
      if (form) {
        appendRangeRow(form);
      }
      return;
    }
    if (action === 'remove-range-row') {
      const row = actionButton.closest('tr');
      const tbody = row ? row.parentElement : null;
      if (row && tbody && tbody.children.length > 1) {
        row.remove();
      }
    }
  });

  app.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    if (form.id === 'inventoryForm') {
      event.preventDefault();
      void handleInventorySubmit(form);
      return;
    }
    if (form.id === 'hardwareForm') {
      event.preventDefault();
      void handleHardwareSubmit(form);
      return;
    }
    if (form.classList.contains('node-type-form')) {
      event.preventDefault();
      void handleNodeTypeSubmit(form);
    }
  });

  app.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.id === 'inventorySearch') {
      state.inventoryFilter.q = target.value || '';
      applyInventoryFilters();
      return;
    }
    if (target.id === 'hardwareSearch') {
      state.hardwareFilter.q = target.value || '';
      applyHardwareFilters();
    }
  });

  app.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.id === 'hardwareCategory') {
      state.hardwareFilter.category = target.value || 'all';
      applyHardwareFilters();
    }
  });

  window.addEventListener('hashchange', () => {
    const tabId = String(window.location.hash || '').replace(/^#/, '');
    if (tabId && tabId !== state.activeTab) {
      setActiveTab(tabId);
    }
  });

  renderApp();
})();
