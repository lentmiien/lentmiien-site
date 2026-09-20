const fs = require('fs');
const path = require('path');

function validRevision(value) {
  return typeof value === 'string' && /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

// Windows service accounts may lack git.exe on PATH. Resolve only local Git
// metadata, including packed refs and worktrees, without invoking a shell.
function readGitRevision(root) {
  const read = filename => {
    try {
      if (fs.statSync(filename).size > 1024 * 1024) return null;
      return fs.readFileSync(filename, 'utf8').trim();
    } catch { return null; }
  };
  let gitDirectory = path.join(root, '.git');
  const pointer = read(gitDirectory);
  if (pointer?.startsWith('gitdir: ')) gitDirectory = path.resolve(root, pointer.slice(8));
  const head = read(path.join(gitDirectory, 'HEAD'));
  if (validRevision(head)) return validRevision(head);
  const ref = head?.startsWith('ref: ') ? head.slice(5) : null;
  if (!ref || !/^refs\/[a-zA-Z0-9_./-]+$/.test(ref) || ref.split('/').some(part => !part || part === '.' || part === '..')) return null;
  const common = read(path.join(gitDirectory, 'commondir'));
  const commonDirectory = common ? path.resolve(gitDirectory, common) : gitDirectory;
  const loose = validRevision(read(path.join(commonDirectory, ref)));
  if (loose) return loose;
  const packed = read(path.join(commonDirectory, 'packed-refs'));
  const line = packed?.split(/\r?\n/).find(entry => entry.endsWith(` ${ref}`));
  return validRevision(line?.split(' ')[0]);
}

module.exports = { validRevision, readGitRevision };
