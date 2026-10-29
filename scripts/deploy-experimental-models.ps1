# First rollout only. Run from the reviewed target checkout in Windows PowerShell 5.1.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$TargetCommit,
  [ValidateSet('LennartWeb')][string]$SiteServiceName = 'LennartWeb',
  [switch]$DirectGateway
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Checkout = 'C:\Projects\lentmiien-site'
$Parent = 'C:\ProgramData\Lentmiien'
$Root = 'C:\ProgramData\Lentmiien\ExperimentalModels'
$ProductionCommit = '3ef51e3e0b4cf1c1e6e00b5706ee6a4d67ec6d73'
$FeatureCommit = '3ee0d7969a6dcc5fa37c5383880cfcd9e37a3c19'
$Stage = 'prerequisites'
$Provisioned = $false
$Auth = $false
$Capability = $false
$Maintenance = $false
$Node = $null
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Invoke-GitChecked([string[]]$GitArguments) {
  $result = @(& git @GitArguments 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'git_check_failed' }
  return $result
}
function Assert-Source {
  if ((Invoke-GitChecked @('rev-parse', '--show-toplevel')).Replace('/', '\') -ine $Checkout) { throw 'checkout_mismatch' }
  if ((Invoke-GitChecked @('branch', '--show-current')) -cne 'main') { throw 'branch_mismatch' }
  if ((Invoke-GitChecked @('rev-parse', 'HEAD')) -cne $TargetCommit) { throw 'head_mismatch' }
  if (@(Invoke-GitChecked @('status', '--porcelain', '--untracked-files=all')).Count) { throw 'worktree_not_clean' }
  Invoke-GitChecked @('merge-base', '--is-ancestor', $TargetCommit, 'origin/main') | Out-Null
  Invoke-GitChecked @('merge-base', '--is-ancestor', $ProductionCommit, $TargetCommit) | Out-Null
  Invoke-GitChecked @('merge-base', '--is-ancestor', $FeatureCommit, $TargetCommit) | Out-Null
  Invoke-GitChecked @('diff', '--exit-code', $ProductionCommit, $TargetCommit, '--', 'package.json', 'package-lock.json') | Out-Null
  foreach ($operation in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) {
    $gitPath = Invoke-GitChecked @('rev-parse', '--git-path', $operation)
    if (Test-Path -LiteralPath $gitPath) { throw 'git_operation_in_progress' }
  }
}
function Assert-Acl([string]$Path, [switch]$AncestorOnly) {
  $arguments = @('-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'assert-gpt-image-acl.ps1'), '-StoragePath', $Path)
  if ($AncestorOnly) { $arguments += '-AncestorOnly' }
  & $PowerShell @arguments *> $null
  if ($LASTEXITCODE -ne 0) { throw 'acl_policy_failed' }
}
function Assert-Dedicated([string]$Path) {
  Assert-Acl $Path
  $acl = Get-Acl -LiteralPath $Path
  if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18', 'S-1-5-32-544')) { throw 'dedicated_owner_or_protection_drift' }
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 2) { throw 'dedicated_acl_drift' }
  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $rule = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })
    if ($rule.Count -ne 1 -or $rule[0].AccessControlType -ne 'Allow' -or $rule[0].IsInherited -or
        [int]$rule[0].FileSystemRights -ne 2032127 -or [int]$rule[0].InheritanceFlags -ne 3 -or [int]$rule[0].PropagationFlags -ne 0) { throw 'dedicated_acl_drift' }
  }
}
function Assert-ServiceConfiguration {
  $script:Node = $null # Do not launch even the failure logger until loader controls are excluded.
  $service = Get-CimInstance Win32_Service -Filter "Name='LennartWeb'"
  if ($null -eq $service -or $service.StartName -ne 'LocalSystem' -or $service.State -ne 'Running' -or
      $service.PathName.Trim('"') -ine 'C:\Services\LennartWeb\LennartWeb.exe') { throw 'service_configuration_drift' }
  # This is the known WinSW config, never a caller-supplied path. Do not print it.
  $settings = New-Object System.Xml.XmlReaderSettings
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $settings.MaxCharactersInDocument = 262144
  $reader = [System.Xml.XmlReader]::Create('C:\Services\LennartWeb\LennartWeb.xml', $settings)
  try { $xml = New-Object System.Xml.XmlDocument; $xml.XmlResolver = $null; $xml.Load($reader) } finally { $reader.Dispose() }
  if ($xml.SelectSingleNode('/service/id').InnerText -cne 'LennartWeb' -or
      $xml.SelectSingleNode('/service/workingdirectory').InnerText.TrimEnd('\', '/') -ine $Checkout -or
      $xml.SelectSingleNode('/service/arguments').InnerText -notmatch '^(?:app(?:\.js)?|"?C:\\Projects\\lentmiien-site\\app(?:\.js)?"?)$') { throw 'winsw_launch_drift' }
  $executable = $xml.SelectSingleNode('/service/executable').InnerText
  # Resolve only a literal node executable. No shells, expansion, preload or wrappers.
  if ($executable -in @('node', 'node.exe')) { $executable = (Get-Command node.exe -CommandType Application).Source }
  if (![System.IO.Path]::IsPathRooted($executable) -or [System.IO.Path]::GetFileName($executable) -ine 'node.exe' -or $executable.Contains('%')) { throw 'node_launcher_unknown' }
  foreach ($element in @('startarguments', 'prestart', 'poststart', 'extensions', 'download')) {
    if ($null -ne $xml.SelectSingleNode("/service/$element")) { throw 'winsw_launch_override' }
  }
  $configKeys = @('MING_ADMIN_TOKEN', 'EXPERIMENTAL_MODELS_STORAGE_ROOT', 'AI_GATEWAY_BASE_URL', 'EXPERIMENTAL_MODELS_TIMEOUT_MS', 'VUE_PATH', 'PORT')
  $controlKeys = @('NODE_OPTIONS')
  # dotenv 18 accepts both prefixes; either could select a different private file
  # or parsing/override behavior than the explicit read-only companion.
  foreach ($option in @('PATH', 'ENCODING', 'OVERRIDE', 'FAST', 'DEBUG', 'QUIET')) { $controlKeys += "DOTENV_$option"; $controlKeys += "DOTENV_CONFIG_$option" }
  # Enumerate presence separately from value so a defined empty entry is not lost.
  $machine = @{}; $operator = @{}
  foreach ($entry in [Environment]::GetEnvironmentVariables('Machine').GetEnumerator()) { $machine[$entry.Key] = $entry.Value }
  foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) { $operator[$entry.Key] = $entry.Value }
  foreach ($key in $controlKeys) {
    if ($machine.Contains($key) -or @($xml.SelectNodes('/service/env') | Where-Object { $_.GetAttribute('name') -ieq $key }).Count) { throw 'service_loader_control' }
    if ($operator.Contains($key)) { throw 'operator_loader_control' }
  }
  $registry = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\LennartWeb'
  if ($null -ne $registry.PSObject.Properties['Environment']) { throw 'service_environment_override' }
  $serviceEnv = @{ machine = @{}; winsw = @{} }
  foreach ($key in $configKeys) {
    if ($machine.Contains($key)) { $serviceEnv.machine[$key] = [string]$machine[$key] }
    $entries = @($xml.SelectNodes('/service/env') | Where-Object { $_.GetAttribute('name') -ieq $key })
    if ($entries.Count -gt 1 -or ($entries.Count -eq 1 -and !$entries[0].HasAttribute('value'))) { throw 'service_configuration_mismatch' }
    if ($entries.Count -eq 1) { $serviceEnv.winsw[$key] = $entries[0].GetAttribute('value') }
  }
  $script:Node = $executable
  $version = & $Node --version 2>$null
  if ($LASTEXITCODE -ne 0 -or $version -cne ('v' + (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).volta.node)) { throw 'node_version_mismatch' }
  # Privately compare literal service layers and the actual child environment to
  # dotenv.parse of the exact Site file, using the existing feature validators.
  # Base64 is pipe transport only: no values/hashes in arguments, output or files.
  $inputJson = $serviceEnv | ConvertTo-Json -Compress -Depth 3
  $inputBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($inputJson))
  $checked = Invoke-NodeCheck @('configuration') $inputBase64
  if ($checked.configurationMatched -ne $true) { throw 'service_configuration_mismatch' }
}
function Invoke-NodeCheck([string[]]$Arguments, [string]$PrivateInput = '') {
  if ($PrivateInput.Length) {
    $output = @($PrivateInput | & $Node (Join-Path $PSScriptRoot 'experimental-models-release-check.js') @Arguments 2>$null)
  } else {
    $output = @(& $Node (Join-Path $PSScriptRoot 'experimental-models-release-check.js') @Arguments 2>$null)
  }
  $exitCode = $LASTEXITCODE
  $result = ($output -join "`n") | ConvertFrom-Json
  if ($exitCode -ne 0) {
    $codes = @('invalid_private_configuration', 'operator_configuration_mismatch', 'service_configuration_mismatch',
      'operator_loader_control', 'service_loader_control', 'wrong_storage_root', 'invalid_health_port',
      'ming_auth_failed', 'ming_capability_missing', 'passive_gateway_failed', 'unsafe_storage_location',
      'storage_missing', 'site_health_timeout', 'lab_boot_failed', 'invalid_arguments', 'release_check_failed')
    if ($result.code -in $codes) { Write-Host ('CHECK: ' + $result.code) }
    if ($result.code -in @('operator_configuration_mismatch', 'service_configuration_mismatch', 'operator_loader_control', 'service_loader_control')) { throw $result.code }
    throw 'node_check_failed'
  }
  return $result
}
function Write-Receipt {
  param([ValidateSet('provisioned', 'healthy')][string]$Phase)
  Assert-Dedicated $Parent
  Assert-Dedicated $Root
  $state = (Get-Service -Name $SiteServiceName).Status.ToString()
  $receipt = [ordered]@{ sourceCommit = $TargetCommit; deploymentDateTime = [DateTime]::UtcNow.ToString('o'); rootProvisioned = $Provisioned; authStatus = $Auth; capability = $Capability; serviceState = $state }
  $file = Join-Path $Parent ('experimental-models-release-' + $Phase + '-' + [Guid]::NewGuid().ToString('N') + '.json')
  $stream = New-Object System.IO.FileStream($file, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try { $bytes = [Text.Encoding]::UTF8.GetBytes(($receipt | ConvertTo-Json -Compress)); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush() } finally { $stream.Dispose() }
}

try {
  if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion -lt [Version]'5.1') { throw 'windows_powershell_51_required' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'elevation_required' }
  if ($PSScriptRoot -ine (Join-Path $Checkout 'scripts')) { throw 'helper_checkout_mismatch' }
  Set-Location -LiteralPath $Checkout
  Assert-Source
  Assert-ServiceConfiguration
  if ((New-Object System.IO.DriveInfo('C')).DriveFormat -ne 'NTFS') { throw 'ntfs_required' }
  if ((Test-Path -LiteralPath $Parent) -or (Test-Path -LiteralPath $Root)) { throw 'existing_dedicated_folder_inspect_do_not_rerun' }
  Assert-Acl 'C:\ProgramData' -AncestorOnly
  $Stage = 'configuration_and_passive_gateway'
  $checkArgs = @('preflight')
  if ($DirectGateway) { $checkArgs += '--direct' }
  $checks = Invoke-NodeCheck $checkArgs
  $Auth = $checks.authStatus -eq $true
  $Capability = $checks.capability -eq $true
  if (!$Auth -or !$Capability) { throw 'gateway_prerequisite_failed' }
  Write-Host 'Prerequisites passed. Gateway/Ming must already be deployed separately; no inference was run.'
  $answer = Read-Host 'Type RELEASE to create ONLY C:\ProgramData\Lentmiien and ExperimentalModels with protected SYSTEM/Admins access, then restart ONLY LennartWeb at the checked target. Private .env edits complete; old lab requests drained; no other releases in progress'
  if ($answer -cne 'RELEASE') { Write-Host 'STOP: no folders created and no service interrupted.'; exit 2 }
  Assert-Source
  Assert-ServiceConfiguration
  # Re-read private input after the approval pause; no private values are emitted.
  $checks = Invoke-NodeCheck $checkArgs
  Assert-Acl 'C:\ProgramData' -AncestorOnly
  $Stage = 'create_protected_parent'
  # CreateDirectoryW applies the supplied descriptor at creation, creates only one
  # component and fails on ERROR_ALREADY_EXISTS. No create-then-Set-Acl window.
  # BA ownership is permitted by policy and needs no SeRestorePrivilege adjustment.
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ExperimentalModelsPrivateDirectory {
  [StructLayout(LayoutKind.Sequential)]
  private struct SecurityAttributes {
    public int Length;
    public IntPtr Descriptor;
    [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint size);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CreateDirectoryW(string path, ref SecurityAttributes attributes);
  [DllImport("kernel32.dll", ExactSpelling = true)]
  private static extern IntPtr LocalFree(IntPtr memory);
  public static void Create(string path) {
    if (path != @"C:\ProgramData\Lentmiien" && path != @"C:\ProgramData\Lentmiien\ExperimentalModels") throw new InvalidOperationException("path_denied");
    IntPtr descriptor;
    uint size;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW("O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)", 1, out descriptor, out size)) throw new InvalidOperationException("descriptor_failed");
    try {
      SecurityAttributes attributes = new SecurityAttributes();
      attributes.Length = Marshal.SizeOf(typeof(SecurityAttributes));
      attributes.Descriptor = descriptor;
      attributes.InheritHandle = false;
      if (!CreateDirectoryW(path, ref attributes)) throw new InvalidOperationException("create_failed_inspect_before_resume");
    } finally { LocalFree(descriptor); }
  }
}
'@ | Out-Null
  [ExperimentalModelsPrivateDirectory]::Create($Parent)
  Assert-Dedicated $Parent
  $Stage = 'create_protected_root'
  [ExperimentalModelsPrivateDirectory]::Create($Root)
  Assert-Dedicated $Root
  $Provisioned = $true
  $Stage = 'storage_location'
  Invoke-NodeCheck @('storage') | Out-Null
  Write-Receipt -Phase 'provisioned'
  Assert-Source
  Assert-ServiceConfiguration
  $Stage = 'maintenance_start'
  & $Node scripts/maintenance.js start 60 deployment *> $null
  if ($LASTEXITCODE -ne 0) { throw 'maintenance_start_failed' }
  $Maintenance = $true
  $Stage = 'restart_site'
  $restartAt = [DateTime]::UtcNow.ToString('o')
  # Bound the Restart-Service command itself as well as the Running wait. This
  # transient operator PowerShell job installs no task, service or SYSTEM shell.
  $restartJob = Start-Job -ScriptBlock { $ErrorActionPreference = 'Stop'; Restart-Service -Name 'LennartWeb' -ErrorAction Stop }
  try {
    if ($null -eq (Wait-Job -Job $restartJob -Timeout 60) -or $restartJob.State -ne 'Completed') { throw 'restart_timeout_or_failure' }
    Receive-Job -Job $restartJob -ErrorAction Stop *> $null
  } finally {
    if ($restartJob.State -in @('Running', 'NotStarted')) { Stop-Job -Job $restartJob }
    Remove-Job -Job $restartJob -Force
  }
  (Get-Service -Name $SiteServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
  $Stage = 'app_health_and_boot_log'
  $boot = Invoke-NodeCheck @('boot', $restartAt, $TargetCommit)
  if (!$boot.healthy) { throw 'app_health_failed' }
  if (!$boot.bootLogObserved) { Write-Host 'NOTICE: bounded boot log unavailable/incomplete; actual-context lab initialization remains a browser check.' }
  Assert-Dedicated $Parent
  Assert-Dedicated $Root
  if ((Get-Service -Name $SiteServiceName).Status -ne 'Running') { throw 'service_not_running' }
  Write-Receipt -Phase 'healthy'
  $Stage = 'maintenance_end'
  & $Node scripts/maintenance.js end *> $null
  if ($LASTEXITCODE -ne 0) { throw 'maintenance_end_failed' }
  $Maintenance = $false
  Write-Host "SUCCESS: source=$TargetCommit; storage protected; Ming auth=true; ephemeral capability=true; LennartWeb Running; /apphealth ready; maintenance ended."
  Write-Host 'NEXT: one combined admin browser check in the runbook. Clone quality and UI functionality remain unverified.'
} catch {
  # Never render exception text, native command output, XML, dotenv or HTTP bodies.
  $safeCodes = @('git_check_failed', 'checkout_mismatch', 'branch_mismatch', 'head_mismatch', 'worktree_not_clean',
    'git_operation_in_progress', 'acl_policy_failed', 'dedicated_owner_or_protection_drift', 'dedicated_acl_drift',
    'service_configuration_drift', 'winsw_launch_drift', 'node_launcher_unknown', 'winsw_launch_override',
    'operator_loader_control', 'service_loader_control', 'operator_configuration_mismatch', 'service_configuration_mismatch',
    'service_environment_override', 'node_version_mismatch', 'node_check_failed',
    'windows_powershell_51_required', 'elevation_required', 'helper_checkout_mismatch', 'ntfs_required',
    'existing_dedicated_folder_inspect_do_not_rerun', 'gateway_prerequisite_failed', 'path_denied', 'descriptor_failed',
    'create_failed_inspect_before_resume', 'maintenance_start_failed', 'restart_timeout_or_failure', 'app_health_failed',
    'service_not_running', 'maintenance_end_failed')
  $code = 'operator_operation_failed'
  if ($_.Exception.GetBaseException().Message -cin $safeCodes) { $code = $_.Exception.GetBaseException().Message }
  Write-Host "STOP: stage=$Stage; code=$code. Inspect C:\ProgramData\Lentmiien and ExperimentalModels if created; no automatic cleanup, ACL repair or rollback."
  if ($Maintenance) { Write-Host 'Maintenance was NOT ended (60-minute window expires automatically). Resolve restart/health before explicitly ending it.' }
  if ($null -ne $Node) {
    & $Node (Join-Path $PSScriptRoot 'experimental-models-release-check.js') failure $Stage *> $null
    if ($LASTEXITCODE -ne 0) { Write-Host 'NOTICE: safe failure logging unavailable; retain this stage message.' }
  }
  exit 1
}
