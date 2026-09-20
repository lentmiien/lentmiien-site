const fs = require('fs');
const os = require('os');
const path = require('path');
const { validRevision, readGitRevision } = require('../../utils/runtimeRevision');

describe('runtime revision fallback when git is unavailable', () => {
  let root;
  const sha = 'abcdef01'.repeat(5);
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-revision-test-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(relative, content) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }

  test('reads a loose branch and a detached checkout', () => {
    write('.git/HEAD', 'ref: refs/heads/main\n');
    write('.git/refs/heads/main', sha);
    expect(readGitRevision(root)).toBe(sha);
    write('.git/HEAD', sha);
    expect(readGitRevision(root)).toBe(sha);
  });
  test('reads packed branch refs through a worktree common directory', () => {
    write('.git', 'gitdir: shared/worktrees/current');
    write('shared/worktrees/current/HEAD', 'ref: refs/heads/main');
    write('shared/worktrees/current/commondir', '../..');
    write('shared/packed-refs', `# pack-refs\n${sha} refs/heads/main\n`);
    expect(readGitRevision(root)).toBe(sha);
  });
  test('rejects malformed revisions and ref paths and tolerates missing metadata', () => {
    expect(validRevision('secret deployment value')).toBeNull();
    expect(validRevision('a'.repeat(41))).toBeNull();
    expect(readGitRevision(root)).toBeNull();
    write('.git/HEAD', 'ref: refs/../../other-file');
    expect(readGitRevision(root)).toBeNull();
  });
});
