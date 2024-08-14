const axios = require('axios');
const fs = require('fs');

// GitHub Personal Access Token
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

class GitHubService {
  constructor() {
  }

  async getRepoList() {
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

        const repositories = response.data.map(repo => ({
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

    return allRepos;
  }

  async getRepositoryContents(repoName, path = '') {
    try {
      const response = await axios.get(`https://api.github.com/repos/lentmiien/${repoName}/contents/${path}`, {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'User-Agent': 'lentmiien',
          'Accept': 'application/vnd.github.v3+json'
        }
      });
  
      return response.data;
    } catch (error) {
      console.error('Error fetching repository contents:', error.message);
      throw error;
    }
  }

  async getFileContent(repoName, filePath) {
    try {
      const response = await axios.get(`https://api.github.com/repos/lentmiien/${repoName}/contents/${filePath}`, {
        headers: {
          'Authorization': `token ${process.env.GITHUB_TOKEN}`,
          'User-Agent': 'lentmiien',
          'Accept': 'application/vnd.github.v3+json'
        }
      });
  
      // Check if it's a text-based file
      const textBasedExtensions = ['.txt', '.md', '.js', '.py', '.html', '.css', '.json', '.csv', '.xml', '.yml', '.ini', '.cfg', '.pug', '.gitignore'];
      const fileExtension = '.' + filePath.split('.').pop().toLowerCase();
  
      if (textBasedExtensions.includes(fileExtension)) {
        // It's a text-based file, so we can decode the content
        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
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
