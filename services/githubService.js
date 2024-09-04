const axios = require('axios');
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tempDir = path.join(os.tmpdir(), 'github-repos');
const git = simpleGit();

// GitHub Personal Access Token
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

class GitHubService {
  constructor() {
    this.repoList = [];
  }

  async getRepoList(forceRefresh = false) {
    if (this.repoList.length === 0 || forceRefresh) {
      let page = 1;
      let allRepos = [];
      let hasNextPage = true;
      
      while (hasNextPage) {
        try {
          const response = await axios.get('https://api.github.com/user/repos', {
            params: {
              visibility: 'all', // 'visibility=all' should be default but ensure it's specified
              per_page: 100,  // Max allowed per page
              page: page
            },
            headers: {
              'Authorization': `token ${GITHUB_TOKEN}`,
              'User-Agent': 'lentmiien',
              'Accept': 'application/vnd.github.v3+json'
            }
          });
          
          const repositories = response.data.filter(d => d.full_name.indexOf("lentmiien") === 0).map(repo => ({
            name: repo.name,
            description: repo.description,
            url: repo.html_url,
            private: repo.private,
            stars: repo.stargazers_count,
            forks: repo.forks_count
          }));
          
          allRepos = allRepos.concat(repositories);
          
          // Check if there's a next page
          const linkHeader = response.headers.link;
          hasNextPage = linkHeader && linkHeader.includes('rel="next"');
          page++;
        } catch (error) {
          console.error('Error fetching repositories:', error.message);
          throw error;
        }
      }
      
      this.repoList = allRepos;
    }

    return this.repoList;
  }

  // Load folder structure of 'repoDir'
  async loadFolderStructure(repoDir, currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    const result = [];

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(repoDir, fullPath);
      
      if (entry.isDirectory()) {
        if (entry.name !== ".git") {
          result.push({
            name: entry.name,
            path: relativePath,
            size: 0,
            type: 'dir',
            content: await this.loadFolderStructure(repoDir, fullPath)
          });
        }
      } else {
        const stats = fs.statSync(fullPath);
        result.push({
          name: entry.name,
          path: relativePath,
          size: stats.size,
          type: 'file',
          content: null
        });
      }
    }

    return result;
  };

  async getRepositoryContents(repoName) {
    const repoDir = path.join(tempDir, repoName);
    try {
      if (!fs.existsSync(repoDir)) {
        await git.clone(`https://github.com/lentmiien/${repoName}.git`, repoDir);
        console.log(`Repository cloned: ${repoDir}`);
      } else {
        console.log(`Repository already exists: ${repoDir}`);
      }

      return await this.loadFolderStructure(repoDir, repoDir);
    } catch (error) {
      console.error('Error fetching repository contents:', error.message);
      throw error;
    }
  }

  async updateRepositoryContents(repoName, branch = 'main') {
    try {
      const repoDir = path.join(tempDir, repoName);
      const git = simpleGit(repoDir);
      await git.pull('origin', branch);
      return await this.loadFolderStructure(repoDir, repoDir);
    } catch (error) {
      console.error('Error pulling repository contents:', error.message);
      throw error;
    }
  }

  async getFileContent(repoName, filePath) {
    const fullPath = path.join(tempDir, repoName, filePath);
    try {
      // Check if it's a text-based file
      const textBasedExtensions = ['.txt', '.md', '.js', '.py', '.html', '.css', '.json', '.csv', '.xml', '.yml', '.ini', '.cfg', '.pug', '.gitignore'];
      const fileExtension = '.' + filePath.split('.').pop().toLowerCase();
  
      if (textBasedExtensions.includes(fileExtension)) {
        // It's a text-based file, so we can decode the content
        const content = fs.readFileSync(fullPath, { encoding: 'utf8', flag: 'r' });
        return content;
      } else {
        // It's not a text-based file
        return null;
      }
    } catch (error) {
      console.error('Error fetching file content:', error.message);
      throw error;
    }
  }
}

module.exports = GitHubService;
