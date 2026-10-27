const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { spawnSync } = require('child_process');
const {
  CLOUDFLARED_VERSION_OPTIONS,
  cloudflaredInstallShell,
  cloudflaredRelease,
} = require('../../services/runpodCloudflaredCatalog');
const { cloudflareGatewayStartArgs } = require('../../services/runpodPodManager');
const { buildArtifactServerShell } = require('../../services/runpodModelArtifactCatalog');

describe('Runpod Cloudflare Tunnel releases', () => {
  test.each(CLOUDFLARED_VERSION_OPTIONS)('both starters use the pinned %s release', (version) => {
    const release = cloudflaredRelease(version);
    for (const script of [
      JSON.parse(cloudflareGatewayStartArgs(version)).cmd[0],
      buildArtifactServerShell(undefined, { cloudflaredVersion: version }),
    ]) {
      expect(script).toContain(release.url);
      expect(script).toContain(release.sha256);
      expect(spawnSync('/bin/bash', ['-n'], { input: script, encoding: 'utf8' }))
        .toMatchObject({ status: 0, stderr: '' });
    }
  });

  test.each(['latest', 'toString', '__proto__', '2026.10.4; id', '', null, {}, ['2026.10.4']])(
    'rejects unsupported or malformed versions: %p', (version) => {
      expect(() => cloudflareGatewayStartArgs(version)).toThrow('supported Cloudflare Tunnel version');
      expect(() => buildArtifactServerShell(undefined, { cloudflaredVersion: version }))
        .toThrow('supported Cloudflare Tunnel version');
    }
  );

  test.each(['missing', 'matching', 'outdated', 'corrupt download', 'failed download'])(
    'installs safely with a %s binary', (scenario) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runpod-cloudflared-test-'));
      try {
        const binary = path.join(dir, 'cloudflared');
        const downloaded = path.join(dir, 'downloaded');
        const continued = path.join(dir, 'continued');
        const expected = 'verified cloudflared fixture';
        const checksum = createHash('sha256').update(expected).digest('hex');
        if (scenario !== 'missing') {
          fs.writeFileSync(binary, scenario === 'matching' ? expected : 'old binary', { mode: 0o555 });
        }
        // Real shell/checksum/move behavior with local download/package-manager stubs.
        const install = cloudflaredInstallShell()
          .replace('/usr/local/bin/cloudflared', binary)
          .replace(cloudflaredRelease().sha256, checksum);
        const script = `set -Eeuo pipefail
apt-get() { :; }
curl() {
  touch '${downloaded}'
  ${scenario === 'failed download' ? 'return 22' : ':'}
  printf '%s' '${scenario === 'corrupt download' ? 'corrupt binary' : expected}' > '${binary}.download'
}
${install}
touch '${continued}'`;
        const result = spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
        const failed = scenario === 'corrupt download' || scenario === 'failed download';
        expect(result.status === 0).toBe(!failed);
        expect(fs.existsSync(continued)).toBe(!failed);
        expect(fs.existsSync(downloaded)).toBe(scenario !== 'matching');
        expect(fs.readFileSync(binary, 'utf8')).toBe(failed ? 'old binary' : expected);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
