const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const tls = require('tls');
const tar = require('tar');

const CERTIFICATE_URL = 'https://curl.se/ca/cacert.pem';
const RELEASE_BASE_URL = 'https://github.com/lexiforest/curl-impersonate/releases/download';
const SYSTEM_CERTIFICATE_MARKER = '# System certificates appended by lentmiien-site';

const ARCH_NAMES = {
  x64: 'x86_64',
  arm64: process.platform === 'linux' ? 'aarch64' : 'arm64',
  arm: 'arm-linux-gnueabihf',
  riscv64: 'riscv64',
  i386: 'i386',
  ia32: 'i686',
};

const PLATFORM_NAMES = {
  linux: 'linux-gnu',
  darwin: 'macos',
  win32: 'win32',
};

const LIBRARY_CANDIDATES = {
  linux: ['libcurl-impersonate.so'],
  darwin: ['libcurl-impersonate.4.dylib', 'libcurl-impersonate.dylib'],
  win32: ['bin/libcurl-impersonate.dll', 'bin/libcurl.dll'],
};

async function ensureCurlCffiRuntime() {
  const packageRoot = findCurlCffiPackageRoot();
  const config = JSON.parse(await fs.readFile(path.join(packageRoot, 'libcurl.config.json'), 'utf8'));
  const version = validateVersion(config.version);
  const runtimeName = getRuntimeName();
  const libsDirectory = path.join(packageRoot, 'libs');
  const runtimeDirectory = path.join(libsDirectory, `${runtimeName}_${version}`);
  const certificatePath = path.join(libsDirectory, 'cacert.pem');

  await fs.mkdir(libsDirectory, { recursive: true });
  const hasRuntime = await hasRuntimeLibrary(runtimeDirectory);
  const hasCertificates = await isNonEmptyFile(certificatePath);
  if (hasRuntime && hasCertificates) {
    await appendSystemCertificates(certificatePath);
    verifyCurlCffiLoads();
    return;
  }

  console.log(`Installing curl-cffi runtime ${version} for ${runtimeName}...`);
  const archiveName = `libcurl-impersonate-${version}.${runtimeName}.tar.gz`;
  const archiveUrl = `${RELEASE_BASE_URL}/${version}/${archiveName}`;
  const workDirectory = path.join(libsDirectory, `.install-${process.pid}-${Date.now()}`);
  const archivePath = path.join(workDirectory, archiveName);
  const extractedDirectory = path.join(workDirectory, 'runtime');
  const certificateTempPath = path.join(workDirectory, 'cacert.pem');

  try {
    await fs.mkdir(extractedDirectory, { recursive: true });

    if (!hasRuntime) {
      await downloadFile(archiveUrl, archivePath, 1024 * 1024);
      await tar.x({
        file: archivePath,
        cwd: extractedDirectory,
        strict: true,
        filter: isSafeArchiveEntry,
      });
      if (!await hasRuntimeLibrary(extractedDirectory)) {
        throw new Error(`The ${archiveName} archive did not contain the expected runtime library.`);
      }
      await fs.rm(runtimeDirectory, { recursive: true, force: true });
      await fs.rename(extractedDirectory, runtimeDirectory);
    }

    if (!hasCertificates) {
      await downloadFile(CERTIFICATE_URL, certificateTempPath, 1024);
      await fs.rm(certificatePath, { force: true });
      await fs.rename(certificateTempPath, certificatePath);
    }
    await appendSystemCertificates(certificatePath);
  } catch (error) {
    throw new Error(
      `Could not install the curl-cffi runtime: ${error.message}. `
      + 'Check network and certificate settings, then run `npm run install:curl-cffi` again.',
      { cause: error },
    );
  } finally {
    await fs.rm(workDirectory, { recursive: true, force: true });
  }

  verifyCurlCffiLoads();
  console.log('curl-cffi runtime installed.');
}

function findCurlCffiPackageRoot() {
  try {
    return path.resolve(path.dirname(require.resolve('curl-cffi')), '..');
  } catch (error) {
    throw new Error('curl-cffi is not installed. Run `npm ci` before running the scraper.', {
      cause: error,
    });
  }
}

function verifyCurlCffiLoads() {
  try {
    require('curl-cffi');
  } catch (error) {
    throw new Error(
      `curl-cffi still cannot initialize after installing its runtime: ${error.message}. `
      + 'Reinstall dependencies with `npm ci` and retry.',
      { cause: error },
    );
  }
}

function validateVersion(value) {
  if (typeof value !== 'string' || !/^v\d+\.\d+\.\d+$/.test(value)) {
    throw new Error('curl-cffi has an invalid libcurl runtime version. Reinstall dependencies with `npm ci`.');
  }
  return value;
}

function getRuntimeName() {
  const architecture = ARCH_NAMES[process.arch];
  const platform = PLATFORM_NAMES[process.platform];
  if (!architecture || !platform || !LIBRARY_CANDIDATES[process.platform]) {
    throw new Error(`curl-cffi does not support ${process.platform}/${process.arch}.`);
  }
  return `${architecture}-${platform}`;
}

async function hasRuntimeLibrary(directory) {
  const candidates = LIBRARY_CANDIDATES[process.platform] || [];
  for (const candidate of candidates) {
    if (await isNonEmptyFile(path.join(directory, candidate))) {
      return true;
    }
  }
  return false;
}

async function isNonEmptyFile(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isSafeArchiveEntry(entryPath) {
  const normalized = path.posix.normalize(String(entryPath).replace(/\\/g, '/'));
  return normalized !== '..'
    && !normalized.startsWith('../')
    && !path.posix.isAbsolute(normalized);
}

async function downloadFile(url, destination, minimumBytes) {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
    await assertMinimumFileSize(destination, minimumBytes);
    return;
  } catch (nodeError) {
    await fs.rm(destination, { force: true });
    console.warn(`Node could not download ${new URL(url).hostname}: ${nodeError.message}`);
    console.warn('Retrying with the operating system curl certificate store...');
  }

  const executable = process.platform === 'win32' ? 'curl.exe' : 'curl';
  await spawnCommand(executable, [
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    '--output',
    destination,
    url,
  ]);
  await assertMinimumFileSize(destination, minimumBytes);
}

async function assertMinimumFileSize(filePath, minimumBytes) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile() || stats.size < minimumBytes) {
    throw new Error(`Downloaded file was unexpectedly small (${stats.size} bytes).`);
  }
}

async function appendSystemCertificates(certificatePath) {
  const currentBundle = await fs.readFile(certificatePath, 'utf8');
  if (currentBundle.includes(SYSTEM_CERTIFICATE_MARKER)) {
    return;
  }

  const systemCertificates = await readSystemCertificates();
  if (!systemCertificates.includes('-----BEGIN CERTIFICATE-----')) {
    return;
  }

  await fs.appendFile(
    certificatePath,
    `\n${SYSTEM_CERTIFICATE_MARKER}\n${systemCertificates.trim()}\n`,
    'utf8',
  );
}

async function readSystemCertificates() {
  if (typeof tls.getCACertificates === 'function') {
    return tls.getCACertificates('system').join('\n');
  }

  const configuredPaths = [
    process.env.NODE_EXTRA_CA_CERTS,
    process.env.SSL_CERT_FILE,
    '/etc/ssl/certs/ca-certificates.crt',
    '/etc/pki/tls/certs/ca-bundle.crt',
    '/etc/ssl/cert.pem',
  ].filter(Boolean);
  for (const configuredPath of configuredPaths) {
    try {
      const contents = await fs.readFile(configuredPath, 'utf8');
      if (contents.includes('-----BEGIN CERTIFICATE-----')) {
        return contents;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  if (process.platform === 'win32') {
    return exportWindowsRootCertificates();
  }

  return '';
}

async function exportWindowsRootCertificates() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$certificates = @(Get-ChildItem 'Cert:\\CurrentUser\\Root') + @(Get-ChildItem 'Cert:\\LocalMachine\\Root')",
    '$certificates | Sort-Object Thumbprint -Unique | ForEach-Object {',
    "  '-----BEGIN CERTIFICATE-----'",
    '  [Convert]::ToBase64String($_.RawData, [Base64FormattingOptions]::InsertLineBreaks)',
    "  '-----END CERTIFICATE-----'",
    '}',
  ].join('; ');
  return spawnAndCollect('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
}

function spawnCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
    });
  });
}

function spawnAndCollect(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString('utf8'));
        return;
      }
      reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
    });
  });
}

if (require.main === module) {
  ensureCurlCffiRuntime().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ensureCurlCffiRuntime,
  getRuntimeName,
  isSafeArchiveEntry,
  validateVersion,
};
