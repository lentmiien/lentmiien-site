const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
const storage = require('../../services/gptImageStorageService');
const run = promisify(execFile);
// Opt in with a trusted, writable parent; ordinary Windows TEMP may have
// additional ACL principals and is deliberately rejected by storage validation.
const windowsDescribe = process.platform === 'win32' && process.env.GPT_IMAGE_WINDOWS_TEST_DIR ? describe : describe.skip;
windowsDescribe('Windows private media ACL validation', () => {
  let parent, root, originalRoot;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const ps = command => run(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 20000 });
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  beforeEach(async () => {
    parent = await fs.mkdtemp(path.join(process.env.GPT_IMAGE_WINDOWS_TEST_DIR, 'gpt-acl-'));
    root = path.join(parent, 'media');
    await ps(`$ErrorActionPreference='Stop'; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($sid); foreach($s in @($sid.Value,'S-1-5-18','S-1-5-32-544')) { $id=New-Object System.Security.Principal.SecurityIdentifier($s); $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))) }; Set-Acl -LiteralPath ${quote(parent)} -AclObject $acl; New-Item -ItemType Directory -Path ${quote(root)} | Out-Null; Set-Acl -LiteralPath ${quote(root)} -AclObject $acl`);
    originalRoot = process.env.GPT_IMAGE_STORAGE_DIR;
    process.env.GPT_IMAGE_STORAGE_DIR = root;
  }, 30000);
  afterEach(async () => {
    if (originalRoot === undefined) delete process.env.GPT_IMAGE_STORAGE_DIR;
    else process.env.GPT_IMAGE_STORAGE_DIR = originalRoot;
    await fs.rm(parent, { recursive: true, force: true });
  });
  test('probes an owner-only tree without leaving files', async () => {
    await expect(storage.initializeStorage()).resolves.toBe(true);
    expect(await fs.readdir(root)).toEqual([]);
  }, 30000);
  test.each(['ReadAndExecute', 'Modify'])('rejects untrusted root %s access', async rights => {
    await ps(`$acl=Get-Acl -LiteralPath ${quote(root)}; $sid=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545'); $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'${rights}','ContainerInherit,ObjectInherit','None','Allow'))); Set-Acl -LiteralPath ${quote(root)} -AclObject $acl`);
    await expect(storage.assertStorageReady()).rejects.toMatchObject({ status: 503 });
    expect(await fs.readdir(root)).toEqual([]);
  }, 30000);
  test('rejects an ancestor granting child deletion despite protected media ACL', async () => {
    await ps(`$acl=Get-Acl -LiteralPath ${quote(parent)}; $sid=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545'); $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'DeleteSubdirectoriesAndFiles','Allow'))); Set-Acl -LiteralPath ${quote(parent)} -AclObject $acl`);
    await expect(storage.assertStorageReady()).rejects.toMatchObject({ status: 503 });
  }, 30000);
});
