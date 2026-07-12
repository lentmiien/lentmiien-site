// Set action button
let currentEvent = null;
function setActionButton(text, func) {
  actionBtn.innerText = text;
  actionBtn.style.cursor = 'pointer';
  actionBtn.disabled = false;
  if (currentEvent) {
    actionBtn.removeEventListener('click', currentEvent);
  }
  actionBtn.addEventListener('click', func);
  currentEvent = func;
}
setActionButton('Know top', KnowledgeTop);

function KnowledgeTop() {
  open('/chat4/knowledgelist', '_self');
}

function CopyKnowledge(e) {
  navigator.clipboard.writeText(`# ${e.dataset.title}\n\n${e.dataset.content}`);
}

async function AutoTagRecipe(e) {
  e.disabled = true;
  // POST: /chat4/generateTagsForRecipe
  // BODY: title, content
  const response = await fetch('/chat4/generateTagsForRecipe', {
    method: 'POST', // *GET, POST, PUT, DELETE, etc.
    mode: 'cors', // no-cors, *cors, same-origin
    cache: 'no-cache', // no-cache, reload, force-cache, only-if-cached
    credentials: 'same-origin', // include, *same-origin, omit
    headers: {
      'Content-Type': 'application/json',
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: 'follow', // manual, *follow, error
    referrerPolicy: 'no-referrer', // no-referrer, *no-referrer-when-downgrade, origin, strict-origin, unsafe-url
    body: JSON.stringify({title: e.dataset.title, content: e.dataset.content}),
  });
  const data = await response.json();
  document.getElementById('k_tags').value = data.response.split('\n').join('').split('```').join('');
}

function wrapKnowledgeTables(root) {
  root.querySelectorAll('table').forEach((table) => {
    if (table.parentElement && table.parentElement.classList.contains('knowledge-table-wrap')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'knowledge-table-wrap';
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Scrollable table');
    wrapper.tabIndex = 0;
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

function prepareMermaidDiagrams(root) {
  return Array.from(root.querySelectorAll('pre > code.language-mermaid')).map((codeBlock) => {
    const source = codeBlock.textContent.trim();
    const figure = document.createElement('figure');
    const diagram = document.createElement('div');

    figure.className = 'knowledge-mermaid-figure';
    diagram.className = 'knowledge-mermaid';
    diagram.setAttribute('role', 'img');
    diagram.setAttribute('aria-label', `${source.split(/\s/, 1)[0] || 'Mermaid'} diagram`);
    diagram.textContent = source;
    figure.appendChild(diagram);
    codeBlock.parentElement.replaceWith(figure);

    return { diagram, figure, source };
  });
}

function showMermaidError({ diagram, figure, source }) {
  const notice = document.createElement('p');
  const pre = document.createElement('pre');
  const code = document.createElement('code');

  figure.classList.add('knowledge-mermaid-figure--error');
  notice.className = 'knowledge-render-notice';
  notice.textContent = 'This Mermaid diagram could not be rendered. Showing its source instead.';
  code.className = 'language-mermaid';
  code.textContent = source;
  pre.appendChild(code);
  diagram.replaceWith(notice, pre);
}

async function renderMermaidDiagrams(diagrams) {
  if (diagrams.length === 0) return;

  let mermaid;
  try {
    const mermaidModule = await import('/vendor/mermaid/mermaid.esm.min.mjs');
    mermaid = mermaidModule.default;
  } catch {
    diagrams.forEach(showMermaidError);
    return;
  }

  if (!mermaid || typeof mermaid.run !== 'function') {
    diagrams.forEach(showMermaidError);
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    flowchart: {
      htmlLabels: false,
      useMaxWidth: true,
    },
    themeVariables: {
      darkMode: true,
      background: '#171A20',
      primaryColor: '#20242A',
      primaryBorderColor: '#FF6A1F',
      primaryTextColor: '#E8ECF2',
      secondaryColor: '#1B2026',
      secondaryBorderColor: '#FFC247',
      secondaryTextColor: '#E8ECF2',
      tertiaryColor: '#0E0F13',
      tertiaryBorderColor: '#2B313C',
      tertiaryTextColor: '#C1C7D3',
      lineColor: '#C1C7D3',
      textColor: '#E8ECF2',
      titleColor: '#FFC247',
      mainBkg: '#20242A',
      nodeBorder: '#FF6A1F',
      clusterBkg: '#171A20',
      clusterBorder: '#2B313C',
      edgeLabelBackground: '#171A20',
      fontFamily: "'Segoe UI', 'Inter', system-ui, sans-serif",
    },
  });

  for (const entry of diagrams) {
    try {
      await mermaid.run({ nodes: [entry.diagram], suppressErrors: true });
      if (!entry.diagram.querySelector('svg')) showMermaidError(entry);
    } catch {
      showMermaidError(entry);
    }
  }
}

function enhanceKnowledgeContent() {
  const knowledgeContent = document.getElementById('knowledgeContent');
  if (!knowledgeContent) return;

  wrapKnowledgeTables(knowledgeContent);
  renderMermaidDiagrams(prepareMermaidDiagrams(knowledgeContent));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enhanceKnowledgeContent);
} else {
  enhanceKnowledgeContent();
}
