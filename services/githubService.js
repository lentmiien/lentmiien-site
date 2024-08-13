const axios = require('axios');

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
        const response = await axios.get('https://api.github.com/users/lentmiien/repos', {
          params: {
            type: 'all', // This will fetch both public and private repositories
            visibility: 'all', // 'visibility=all' should be default but ensure it's specified
            per_page: 100,  // Max allowed per page
            page: page
          },
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
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
}

module.exports = GitHubService;
