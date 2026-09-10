param([Parameter(Mandatory = $true)][string]$StoragePath)
$ErrorActionPreference = 'Stop'
try {
  $trusted = @(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
    'S-1-5-18', 'S-1-5-32-544',
    'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
  )
  $current = [System.IO.Path]::GetFullPath($StoragePath)
  $isRoot = $true
  while ($true) {
    $item = Get-Item -LiteralPath $current -Force
    if (!$item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe directory' }
    $acl = Get-Acl -LiteralPath $current
    $descriptor = New-Object System.Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorSddlForm('All'))
    if ($null -eq $descriptor.DiscretionaryAcl) { throw 'Unrestricted access' }
    if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'Untrusted owner' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -in $trusted) { continue }
      # Inherit-only entries do not authorize replacement of this ancestor.
      # The media root must also have no untrusted grants to future children.
      if (!$isRoot -and ($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly)) { continue }
      # Ancestors may permit creating siblings (as Windows volume roots do),
      # but must not permit deleting children, deleting this directory or ACL/owner changes.
      $dangerous = 64 -bor 65536 -bor 262144 -bor 524288 -bor 268435456
      if ($isRoot -or ([int]$rule.FileSystemRights -band $dangerous)) { throw 'Untrusted access' }
    }
    $parent = [System.IO.Directory]::GetParent($current)
    if ($null -eq $parent) { break }
    $current = $parent.FullName
    $isRoot = $false
  }
  exit 0
} catch {
  # Do not emit paths, identities or raw PowerShell errors.
  exit 1
}
