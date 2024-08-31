require('dotenv').config();

const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tempDir = path.join(os.tmpdir(), 'github-repos');
const git = simpleGit();

async function cloneRepo(owner, repo) {
  const repoDir = path.join(tempDir, repo);

  if (!fs.existsSync(repoDir)) {
    await git.clone(`https://github.com/${owner}/${repo}.git`, repoDir);
    console.log(`Repository cloned: ${repoDir}`);
  } else {
    console.log(`Repository already exists: ${repoDir}`);
  }
}

cloneRepo('lentmiien', 'pi-monitor');
