// Checksums from https://github.com/cloudflare/cloudflared/releases/tag/<version>.
const DEFAULT_CLOUDFLARED_VERSION = '2026.10.4';
const CLOUDFLARED_RELEASES = Object.freeze({
  '2026.10.4': 'ae5e8add7884b0531d66bbca4570d1de491ff6da51e4ebe7eb160cdf241d9e42',
  '2026.8.3': 'f29324fe934d1e100617484c78deef803c4dc2cd351d645bbde42e96b4fccc5e',
});
const CLOUDFLARED_VERSION_PATTERN = /^20[0-9]{2}\.(?:[1-9]|1[0-2])\.(?:0|[1-9][0-9]{0,3})$/u;
const CLOUDFLARED_SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_CLOUDFLARED_RELEASES = 50;
const CLOUDFLARED_VERSION_OPTIONS = Object.freeze(Object.keys(CLOUDFLARED_RELEASES));

function cloudflaredRelease(version = DEFAULT_CLOUDFLARED_VERSION, sha256) {
  const checksum = sha256 === undefined && typeof version === 'string'
    && Object.hasOwn(CLOUDFLARED_RELEASES, version) ? CLOUDFLARED_RELEASES[version] : sha256;
  if (typeof version !== 'string' || !CLOUDFLARED_VERSION_PATTERN.test(version)
    || typeof checksum !== 'string' || !CLOUDFLARED_SHA256_PATTERN.test(checksum)) {
    const error = new TypeError('Choose a supported Cloudflare Tunnel version.');
    error.code = 'RUNPOD_INPUT_INVALID';
    error.status = 400;
    throw error;
  }
  return {
    version,
    url: `https://github.com/cloudflare/cloudflared/releases/download/${version}/cloudflared-linux-amd64`,
    sha256: checksum,
  };
}

function cloudflaredInstallShell(version, sha256) {
  const release = cloudflaredRelease(version, sha256);
  return `cloudflared=/usr/local/bin/cloudflared
cloudflared_url='${release.url}'
cloudflared_sha256='${release.sha256}'
if [ ! -x "$cloudflared" ] || ! printf '%s  %s\\n' "$cloudflared_sha256" "$cloudflared" | sha256sum -c - >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ca-certificates curl >/dev/null
  curl --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 180 --max-filesize 104857600 --retry 2 --max-redirs 5 -fsSLo "$cloudflared.download" "$cloudflared_url"
  printf '%s  %s\\n' "$cloudflared_sha256" "$cloudflared.download" | sha256sum -c - >/dev/null
  chmod 0555 "$cloudflared.download"
  mv -f "$cloudflared.download" "$cloudflared"
fi`;
}

module.exports = {
  CLOUDFLARED_VERSION_PATTERN,
  CLOUDFLARED_SHA256_PATTERN,
  MAX_CLOUDFLARED_RELEASES,
  CLOUDFLARED_VERSION_OPTIONS,
  DEFAULT_CLOUDFLARED_VERSION,
  cloudflaredInstallShell,
  cloudflaredRelease,
};
