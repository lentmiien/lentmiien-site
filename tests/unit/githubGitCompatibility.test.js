const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { simpleGit } = require('simple-git');
const GitHubService = require('../../services/githubService');

describe('GitHub browsing with the installed simple-git package', () => {
  let directory;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'github-git-compatibility-'));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('loads the service and supports cloning and pulling repository contents', async () => {
    const source = path.join(directory, 'source');
    const destination = path.join(directory, 'clone');
    await fs.mkdir(source);
    const git = simpleGit(source);
    await git.init(['--initial-branch=main']);
    await git.addConfig('user.name', 'Compatibility Test');
    await git.addConfig('user.email', 'compatibility@example.invalid');
    await fs.writeFile(path.join(source, 'README.md'), 'First revision\n');
    await git.add('README.md');
    await git.commit('Add fixture', { '--no-gpg-sign': null });

    await simpleGit().clone(source, destination);
    const service = new GitHubService();
    expect(await service.loadFolderStructure(destination, destination)).toEqual([
      expect.objectContaining({ name: 'README.md', type: 'file' }),
    ]);

    await fs.writeFile(path.join(source, 'README.md'), 'Second revision\n');
    await git.add('README.md');
    await git.commit('Update fixture', { '--no-gpg-sign': null });
    await simpleGit(destination).pull('origin', 'main');
    expect(await fs.readFile(path.join(destination, 'README.md'), 'utf8')).toBe('Second revision\n');
  });

  test('rejects unsafe configuration includes before invoking Git', async () => {
    await expect(simpleGit(directory).raw([
      '-c', 'include.path=untrusted-config', 'status',
    ])).rejects.toThrow('Configuring include.path is not permitted');
  });
});
