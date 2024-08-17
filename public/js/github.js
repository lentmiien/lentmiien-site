const filestructure = document.getElementById('filestructure');
const filecontent = document.getElementById('filecontent');
const filepath = document.getElementById('filepath');
let repo = '';
const cache = {};

function CreateFolderDisplay(level, data) {
  let output = "";
  data.forEach(d => {
    if (d.type === "dir") {
      if (d.loaded) {
        output += `<div><button class="btn btn-link" style="padding-left:${level*10}px;">(${d.name})</button></div>`;
        output += CreateFolderDisplay(level+1, d.content);
      } else {
        output += `<div><button class="btn btn-link" style="padding-left:${level*10}px;" onclick="LoadFolder('${d.path}')">(+${d.name})</button></div>`;
      }
    } else {
      output += `<div><button class="btn btn-link" style="padding-left:${level*10}px;" onclick="LoadFile('${d.path}')">${d.name}</button></div>`;
    }
  });
  return output;
}

async function SelectRepository(e) {
  // User select a repository from a select box
  repo = e.value;
  if (repo.length === 0) {
    filestructure.innerHTML = '';
    filecontent.innerHTML = '';
    filepath.innerText = '';
    return;
  }

  // Create or load cache entry
  if (!(repo in cache)) {
    // Create: Send GET request to '/mypage/getfolder' -> return file structure of top folder
    const response = await fetch(`/mypage/getfolder?repo=${repo}&path=`);
    const json = await response.json();
    const structured_data = json.map(d => {return {name:d.name, path:d.path, size:d.size, type:d.type, loaded:false, content:null}})
    structured_data.sort((a,b) => {
      if (a.type === 'dir' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'dir') return 1;
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    });
    cache[repo] = structured_data;
  }

  // Display folder structure currently saved in cache
  filestructure.innerHTML = CreateFolderDisplay(0, cache[repo]);
  filecontent.innerHTML = '';
  filepath.innerText = '';
}

function SaveToCache(input, data, path) {
  data.forEach(d => {
    if (d.path === path) {
      d.loaded = true;
      d.content = input;
      return;
    } else {
      if (d.type === "dir") {
        if (d.loaded) {
          return SaveToCache(input, d.content, path);
        } else {
          return;
        }
      } else {
        return;
      }
    }
  });
}

async function LoadFolder(path) {
  if (repo.length === 0 || !(repo in cache)) {
    filestructure.innerHTML = '';
    filecontent.innerHTML = '';
    filepath.innerText = '';
    return;
  }

  // User clicks on a folder in the displayed folder structure
  // If folder content hasn't been loaded then load and save to cache
  //  - Load: Send GET request to '/mypage/getfolder' -> return file structure of folder
  const response = await fetch(`/mypage/getfolder?repo=${repo}&path=${path}`);
  const json = await response.json();
  const structured_data = json.map(d => {return {name:d.name, path:d.path, size:d.size, type:d.type, loaded:false, content:null}})
  structured_data.sort((a,b) => {
    if (a.type === 'dir' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'dir') return 1;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
  SaveToCache(structured_data, cache[repo], path);

  // Display updated folder structure currently saved in cache
  filestructure.innerHTML = CreateFolderDisplay(0, cache[repo]);
  filecontent.innerHTML = '';
  filepath.innerText = '';
}

function LoadCacheFileData(data, path) {
  let output = null;
  for (let i = 0; i < data.length; i++) {
    if (data[i].path === path) {
      output = data[i].content;
      break;
    } else {
      if (data[i].type === "dir" && data[i].loaded) {
        output = LoadCacheFileData(data[i].content, path);
        if (output) break;
      }
    }
  }
  return output;
}

async function LoadFile(path) {
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
}

const content_type = {
  "js": "javascript",
  "py": "python",
  "pug": "pug",
  "json": "json",
};
function CopyFile() {
  const f = filecontent.innerHTML.split("<pre>")[1].split("</pre>")[0];
  const ext = filepath.innerText.split(".")[1];

  const copy_buffer = `### File: ${filepath.innerText}\n\`\`\`${ext in content_type ? content_type[ext] : ""}\n${f}\n\`\`\``;
  Copy(copy_buffer);
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
