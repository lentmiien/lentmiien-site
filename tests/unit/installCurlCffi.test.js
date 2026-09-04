const {
  getRuntimeName,
  isSafeArchiveEntry,
  validateVersion,
} = require('../../scripts/install-curl-cffi');

describe('curl-cffi runtime installer', () => {
  test('maps the current supported runtime to an upstream archive name', () => {
    expect(getRuntimeName()).toMatch(/^(x86_64|aarch64|arm64|arm-linux-gnueabihf|riscv64|i386|i686)-(linux-gnu|macos|win32)$/);
  });

  test('accepts release versions and rejects values that could alter the download URL', () => {
    expect(validateVersion('v1.5.6')).toBe('v1.5.6');
    expect(() => validateVersion('../v1.5.6')).toThrow('invalid libcurl runtime version');
  });

  test('rejects archive entries that escape the extraction directory', () => {
    expect(isSafeArchiveEntry('bin/libcurl-impersonate.dll')).toBe(true);
    expect(isSafeArchiveEntry('../outside.dll')).toBe(false);
    expect(isSafeArchiveEntry('/absolute/outside.dll')).toBe(false);
    expect(isSafeArchiveEntry('bin/../../outside.dll')).toBe(false);
  });
});
