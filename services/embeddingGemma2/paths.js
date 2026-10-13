const path = require('path');

function paths(platform = process.platform) { return platform === 'win32' ? path.win32 : path.posix; }
function samePath(a, b, platform = process.platform) {
  const p = paths(platform);
  const normalize = value => platform === 'win32' ? p.normalize(value).toLowerCase() : p.normalize(value);
  return normalize(a) === normalize(b);
}
function contains(root, target, platform = process.platform) {
  const p = paths(platform);
  const relative = p.relative(root, target);
  return relative === '' || (!p.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${p.sep}`));
}
function storageRoot(root, publicRoot, platform = process.platform) {
  const p = paths(platform);
  if (typeof root !== 'string' || !p.isAbsolute(root) || /[\x00-\x1f]/.test(root)) throw new Error('Pilot storage must be absolute');
  if (platform === 'win32') {
    // Local drive only: no UNC, device namespace, ADS, drive-relative or ambiguous components.
    if (!/^[a-z]:[\\/]/i.test(root) || /[:<>"|?*]/.test(root.slice(2)) || root.slice(3).split(/[\\/]/).some(part => !part || /[. ]$/.test(part) || part === '..' || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part) || part.includes('~'))) throw new Error('Unsafe Windows pilot storage path');
  } else if (root.split('/').some(part => part === '..' || part === '.')) throw new Error('Unsafe pilot storage path');
  const normalized = p.resolve(root);
  if (samePath(normalized, p.parse(normalized).root, platform) || contains(publicRoot, normalized, platform) || contains(normalized, publicRoot, platform)) throw new Error('Pilot media must be private');
  return normalized;
}
module.exports = { paths, samePath, contains, storageRoot };
