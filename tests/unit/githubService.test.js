const path = require('path');

jest.mock('axios', () => ({ get: jest.fn() }));

jest.mock('simple-git', () => {
  const instances = [];
  const mockSimpleGit = jest.fn((dir) => {
    const instance = {
      clone: jest.fn().mockResolvedValue(),
      pull: jest.fn().mockResolvedValue()
    };
    instances.push({ dir, instance });
    return instance;
  });
  mockSimpleGit.__instances = instances;
  mockSimpleGit.__reset = () => { instances.length = 0; };
  return mockSimpleGit;
});

jest.mock('fs', () => ({
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  existsSync: jest.fn(),
  readFileSync: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

const createDirent = (name, isDir) => ({
  name,
  isDirectory: () => isDir
});

describe('GitHubService', () => {
  let axios;
  let fs;
  let simpleGit;
  let logger;
  let GitHubService;
  let service;
  let serviceDir;
  let tempDir;

  beforeEach(() => {
    jest.resetModules();
    process.env.GITHUB_TOKEN = 'test-token';

    axios = require('axios');
    fs = require('fs');
    simpleGit = require('simple-git');
    simpleGit.__reset();
    logger = require('../../utils/logger');
    GitHubService = require('../../services/githubService');
    service = new GitHubService();

    const modulePath = require.resolve('../../services/githubService');
    serviceDir = path.dirname(modulePath);
    tempDir = path.join(serviceDir, '..', 'github-repos');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getRepoList fetches paginated repos and caches result', async () => {
    axios.get
      .mockResolvedValueOnce({
        data: [
          { full_name: 'lentmiien/repo-one', name: 'repo-one', description: 'first', html_url: 'url1', private: false, stargazers_count: 1, forks_count: 2 }
        ],
        headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' }
      })
      .mockResolvedValueOnce({
        data: [
          { full_name: 'someoneelse/repo-two' },
          { full_name: 'lentmiien/repo-three', name: 'repo-three', description: 'third', html_url: 'url3', private: true, stargazers_count: 3, forks_count: 4 }
        ],
        headers: {}
      });

    const result = await service.getRepoList(true);

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.get).toHaveBeenNthCalledWith(1, 'https://api.github.com/user/repos', expect.objectContaining({
      params: expect.objectContaining({ page: 1, per_page: 100, visibility: 'all' })
    }));
    expect(axios.get).toHaveBeenNthCalledWith(2, 'https://api.github.com/user/repos', expect.objectContaining({
      params: expect.objectContaining({ page: 2 })
    }));
    expect(result).toEqual([
      { name: 'repo-one', description: 'first', url: 'url1', private: false, stars: 1, forks: 2 },
      { name: 'repo-three', description: 'third', url: 'url3', private: true, stars: 3, forks: 4 }
    ]);

    axios.get.mockClear();
    const cached = await service.getRepoList();
    expect(axios.get).not.toHaveBeenCalled();
    expect(cached).toEqual(result);
  });

  test('getRepoList logs and rethrows axios errors', async () => {
    const error = new Error('api down');
    axios.get.mockRejectedValue(error);

    await expect(service.getRepoList(true)).rejects.toThrow('api down');
    expect(logger.error).toHaveBeenCalledWith('Error fetching repositories:', 'api down');
  });

  test('loadFolderStructure recursively builds file tree', async () => {
    const repoDir = path.join(tempDir, 'demo');
    const srcDir = path.join(repoDir, 'src');

    fs.readdirSync.mockImplementation((targetPath) => {
      if (targetPath === repoDir) {
        return [
          createDirent('.git', true),
          createDirent('src', true),
          createDirent('README.md', false)
        ];
      }
      if (targetPath === srcDir) {
        return [createDirent('index.js', false)];
      }
      throw new Error(`Unexpected path: ${targetPath}`);
    });

    fs.statSync.mockImplementation((targetPath) => {
      if (targetPath.endsWith('README.md')) return { size: 10 };
      if (targetPath.endsWith('index.js')) return { size: 20 };
      return { size: 0 };
    });

    const tree = await service.loadFolderStructure(repoDir, repoDir);

    expect(tree).toEqual([
      {
        name: 'src',
        path: 'src',
        size: 0,
        type: 'dir',
        content: [
          {
            name: 'index.js',
            path: path.join('src', 'index.js'),
            size: 20,
            type: 'file',
            content: null
          }
        ]
      },
      {
        name: 'README.md',
        path: 'README.md',
        size: 10,
        type: 'file',
        content: null
      }
    ]);
  });

  test('getRepositoryContents clones repository when missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const loadSpy = jest.spyOn(service, 'loadFolderStructure').mockResolvedValue(['structure']);

    const result = await service.getRepositoryContents('sample');

    const firstInstance = simpleGit.__instances[0].instance;
    const repoDir = path.join(tempDir, 'sample');

    expect(fs.existsSync).toHaveBeenCalledWith(repoDir);
    expect(firstInstance.clone).toHaveBeenCalledWith('https://github.com/lentmiien/sample.git', repoDir);
    expect(logger.notice).toHaveBeenCalledWith(`Repository cloned: ${repoDir}`);
    expect(loadSpy).toHaveBeenCalledWith(repoDir, repoDir);
    expect(result).toEqual(['structure']);
  });

  test('getRepositoryContents skips cloning when repo exists', async () => {
    fs.existsSync.mockReturnValue(true);
    const loadSpy = jest.spyOn(service, 'loadFolderStructure').mockResolvedValue(['structure']);

    const result = await service.getRepositoryContents('sample');

    const firstInstance = simpleGit.__instances[0].instance;
    expect(firstInstance.clone).not.toHaveBeenCalled();
    expect(logger.notice).toHaveBeenCalledWith(expect.stringContaining('Repository already exists'));
    expect(result).toEqual(['structure']);
  });

  test('updateRepositoryContents pulls latest and returns tree', async () => {
    const loadSpy = jest.spyOn(service, 'loadFolderStructure').mockResolvedValue(['tree']);

    const result = await service.updateRepositoryContents('sample', 'develop');

    const repoDir = path.join(tempDir, 'sample');
    const pullInstance = simpleGit.__instances.find((entry) => entry.dir === repoDir)?.instance;

    expect(pullInstance).toBeDefined();
    expect(pullInstance.pull).toHaveBeenCalledWith('origin', 'develop');
    expect(loadSpy).toHaveBeenCalledWith(repoDir, repoDir);
    expect(result).toEqual(['tree']);
  });

  test('getFileContent reads text files and returns null for binaries', async () => {
    fs.readFileSync.mockReturnValue('file contents');

    const text = await service.getFileContent('repo', 'README.md');
    expect(fs.readFileSync).toHaveBeenCalledWith(path.join(tempDir, 'repo', 'README.md'), { encoding: 'utf8', flag: 'r' });
    expect(text).toBe('file contents');

    fs.readFileSync.mockClear();
    const binary = await service.getFileContent('repo', 'image.png');
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(binary).toBeNull();
  });

  test('getFileContent logs and rethrows read errors', async () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error('read failed');
    });

    await expect(service.getFileContent('repo', 'README.md')).rejects.toThrow('read failed');
    expect(logger.error).toHaveBeenCalledWith('Error fetching file content:', 'read failed');
  });
});
