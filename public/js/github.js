const filestructure = document.getElementById('filestructure');
const filecontent = document.getElementById('filecontent');
const filepath = document.getElementById('filepath');
let repo = '';
const cache = {};

const content_type = {
  "js": "javascript",
  "py": "python",
  "pug": "pug",
  "json": "json",
};

const lv = [
  "",
  ">",
  ">>",
  ">>>",
  ">>>>",
  ">>>>>",
  ">>>>>>",
  ">>>>>>>",
  ">>>>>>>>",
  ">>>>>>>>>",
  ">>>>>>>>>>",
];
function CreateFolderSelect(level, data) {
  let output = "";
  data.forEach(d => {
    if (d.type === "dir") {
      output += `<optgroup label="${lv[level]}${d.name}"></optgroup>`;
      output += CreateFolderSelect(level+1, d.content);
    } else {
      output += `<option value="${d.path.split('\\').join('/')}">${lv[level]}${d.name}</option>`;
    }
  });
  return output;
}

async function SelectRepository(e) {
  repo = e.value;
  if (!repo) {
    filestructure.innerHTML = '';
    filecontent.innerHTML = '';
    filepath.innerText = '';
    return;
  }
  if (!(repo in cache)) {
    const resp = await fetch(`/mypage/getfolder?repo=${repo}`);
    const json = await resp.json();
    json.sort(sorter);
    cache[repo] = json;
  }
  filecontent.innerHTML = '';
  filepath.innerText = '';
  RenderTree();
}

async function RefreshRepository() {
  const e = document.getElementById('repository');
  repo = e.value;
  if (!repo) {
    filestructure.innerHTML = '';
    filecontent.innerHTML = '';
    filepath.innerText = '';
    return;
  }
  const resp = await fetch(`/mypage/updatefolder?repo=${repo}`);
  const json = await resp.json();
  json.sort(sorter);
  cache[repo] = json;
  filecontent.innerHTML = '';
  filepath.innerText = '';
  RenderTree();
}

function SaveToCache(input, data, path) {
  data.forEach(d => {
    if (d.path === path) {
      d.content = input;
      return;
    } else {
      if (d.type === "dir") {
        return SaveToCache(input, d.content, path);
      } else {
        return;
      }
    }
  });
}

function LoadCacheFileData(data, path) {
  let output = null;
  for (let i = 0; i < data.length; i++) {
    if (data[i].path === path) {
      output = data[i].content;
      break;
    } else {
      if (data[i].type === "dir") {
        output = LoadCacheFileData(data[i].content, path);
        if (output) break;
      }
    }
  }
  return output;
}

let current_file_data = "";

async function LoadFile(e) {
  const path = e.value;
  if (repo.length === 0 || !(repo in cache)) {
    filestructure.innerHTML = '';
    filecontent.innerHTML = '';
    filepath.innerText = '';
    return;
  }

  // Check cache
  let c_data = LoadCacheFileData(cache[repo], path);

  if (!c_data) {
    // User clicks on a file in the displayed folder structure
    // If file content hasn't been loaded then load and save to cache
    //  - Load: Send GET request to '/mypage/getfile' -> return file data
    const response = await fetch(`/mypage/getfile?repo=${repo}&path=${path}`);
    const json = await response.json();
    SaveToCache(json.data, cache[repo], path);
    c_data = json.data;
  }

  // Display file data
  filecontent.innerHTML = `<pre>${c_data}</pre>`;
  filepath.innerText = path;
  current_file_data = c_data;
}

function CopyFile() {
  const ext = filepath.innerText.split(".")[1];
  const copy_buffer = `### File: ${filepath.innerText}\n\`\`\`${ext in content_type ? content_type[ext] : ""}\n${current_file_data}\n\`\`\``;
  Copy(copy_buffer);
}

// Recursively build a <ul> tree with checkboxes for files
function CreateFolderTree(data) {
  let html = '<ul class="list-unstyled">';
  data.forEach(item => {
    if (item.type === 'dir') {
      html += `<li><strong>📁 ${item.name}</strong>${CreateFolderTree(item.content)}</li>`;
    } else {
      // file
      // use the normalized path with forward‑slashes
      const cleanPath = item.path.split('\\').join('/');
      html += `
        <li>
          <label style="cursor:pointer">
            <input type="checkbox" 
                   class="file-checkbox" 
                   value="${cleanPath}">
            🗎 ${item.name}
          </label>
        </li>`;
    }
  });
  html += '</ul>';
  return html;
}

// call this after you fill cache[repo]
function RenderTree() {
  filestructure.innerHTML = CreateFolderTree(cache[repo] || []);
}

async function CopySelectedFiles() {
  if (!repo || !(repo in cache)) return;
  // gather all checked file checkboxes
  const boxes = filestructure.querySelectorAll('input.file-checkbox:checked');
  if (boxes.length === 0) {
    alert('No files selected');
    return;
  }

  let markdown = '';

  for (let cb of boxes) {
    const path = cb.value;
    // 1) try to get from cache
    let content = LoadCacheFileData(cache[repo], path);
    // 2) if not in cache, fetch it
    if (!content) {
      const resp = await fetch(`/mypage/getfile?repo=${repo}&path=${encodeURIComponent(path)}`);
      const json = await resp.json();
      content = json.data;
      SaveToCache(content, cache[repo], path);
    }
    const ext = path.split('.').pop();
    const lang = content_type[ext] || '';
    // build markdown snippet
    markdown += `### File: ${path}\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
  }

  Copy(markdown);
  alert('Copied ' + boxes.length + ' files to clipboard');
}

/****
 * Copy helper
 */
function Copy(text) {
  // Copy to clipboard
  function listener(e) {
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  }
  document.addEventListener('copy', listener);
  document.execCommand('copy');
  document.removeEventListener('copy', listener);
}

function sorter(a, b) {
  // dirs first, then alpha
  if (a.type === 'dir' && b.type === 'file') return -1;
  if (a.type === 'file' && b.type === 'dir') return 1;
  return a.name.localeCompare(b.name);
}
