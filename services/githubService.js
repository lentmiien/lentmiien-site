const axios = require('axios');

// GitHub Personal Access Token
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

class GitHubService {
  constructor() {
  }

  async getRepoList() {
    try {
      const response = await axios.get('https://api.github.com/users/lentmiien/repos', {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
  
      const repositories = response.data.map(repo => ({
        name: repo.name,
        description: repo.description,
        url: repo.html_url,
        stars: repo.stargazers_count,
        forks: repo.forks_count
      }));
  
      return repositories;
    } catch (error) {
      console.error('Error fetching repositories:', error.message);
      return [];
    }
  }
}

module.exports = GitHubService;
