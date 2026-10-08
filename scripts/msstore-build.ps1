[CmdletBinding()]
param(
    [string]$RuntimePath = $env:WEBVIEW2_FIXED_RUNTIME,
    [switch]$Check,
    [switch]$CompileOnly,
    [ValidatePattern("^[a-fA-F0-9]{40}$")]
    [string]$CertificateThumbprint,
    [string]$SdkBin
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot -Parent
$target = 'x86_64-pc-windows-msvc'

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
function Find-Sdk {
    if ($SdkBin) {
        $candidate = (Resolve-Path -LiteralPath $SdkBin).Path
        if (!(Test-Path -LiteralPath (Join-Path $candidate 'makeappx.exe'))) { throw 'SdkBin does not contain makeappx.exe' }
        return $candidate
    }
    $base = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $folders = Get-ChildItem -LiteralPath $base -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending
    foreach ($folder in $folders) {
        $candidate = Join-Path $folder.FullName 'x64'
        if (Test-Path -LiteralPath (Join-Path $candidate 'makeappx.exe')) { return $candidate }
    }
    throw 'Install the Windows SDK with MakeAppx.exe'
}
function Find-Dumpbin {
    $command = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (!(Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio C++ build tools (dumpbin.exe)' }
    $matches = @(& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'VC\Tools\MSVC\**\bin\Hostx64\x64\dumpbin.exe')
    if ($LASTEXITCODE -ne 0 -or !$matches.Count) { throw 'Cannot locate x64 dumpbin.exe' }
    return $matches[-1]
}

Push-Location $repo
$oldFlags = [Environment]::GetEnvironmentVariable('CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS', 'Process')
try {
    foreach ($tool in @('node', 'npm.cmd', 'cargo', 'rustup')) { Get-Command $tool -ErrorAction Stop | Out-Null }
    $app = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    $tauri = Get-Content -LiteralPath 'src-tauri\tauri.conf.json' -Raw | ConvertFrom-Json
    $cargoText = Get-Content -LiteralPath 'src-tauri\Cargo.toml' -Raw
    if ($app.version -ne $tauri.version -or $cargoText -notmatch ('(?m)^version\s*=\s*"' + [regex]::Escape($app.version) + '"\s*$')) { throw 'App, Tauri and Cargo versions disagree' }
    $sdk = Find-Sdk
    $dumpbin = Find-Dumpbin
    $os = [Environment]::OSVersion.Version
    $tested = "$($os.Major).$($os.Minor).$($os.Build).0"
    if (!$CompileOnly) {
        if (!$RuntimePath) { throw 'Supply -RuntimePath pointing to an extracted Microsoft Fixed Version x64 WebView2 runtime' }
        $RuntimePath = (Resolve-Path -LiteralPath $RuntimePath).Path
        $runtimeExe = Join-Path $RuntimePath 'msedgewebview2.exe'
        if (!(Test-Path -LiteralPath $runtimeExe -PathType Leaf)) { throw 'RuntimePath must directly contain msedgewebview2.exe' }
        $signature = Get-AuthenticodeSignature -LiteralPath $runtimeExe
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'WebView2 must have a valid Microsoft Authenticode signature' }
        $runtimeVersion = (Get-Item -LiteralPath $runtimeExe).VersionInfo.FileVersion
    }
    if ($CertificateThumbprint) {
        $cert = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint"
        $identity = Get-Content -LiteralPath 'packaging\msix\store.json' -Raw | ConvertFrom-Json
        if (!$cert.HasPrivateKey -or $cert.Subject -ne $identity.publisher -or $cert.NotAfter -le (Get-Date)) { throw 'Test signing certificate must be valid, have a private key, and match the Store Publisher exactly' }
        if (!(Test-Path -LiteralPath (Join-Path $sdk 'signtool.exe'))) { throw 'SdkBin does not contain signtool.exe' }
    }
    Write-Host "Target: $target; Windows: $tested; SDK: $sdk"
    if ($Check) { Write-Host 'Preflight passed'; return }
    # Explicit target keeps crt-static off host build scripts and proc macros.
    [Environment]::SetEnvironmentVariable('CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS', '-C target-feature=+crt-static', 'Process')
    Invoke-Checked 'rustup' @('target', 'add', $target)
    Invoke-Checked 'npm.cmd' @('run', 'tauri', '--', 'build', '--config', 'src-tauri/tauri.msstore.conf.json', '--target', $target, '--no-bundle', '--', '--locked')
    $binary = Join-Path $repo "src-tauri\target\$target\release\lyrical-sync.exe"
    if (!(Test-Path -LiteralPath $binary)) { throw 'Expected release executable was not produced' }
    $dependencyReport = @(& $dumpbin /DEPENDENTS $binary)
    if ($LASTEXITCODE -ne 0) { throw 'PE dependency inspection failed' }
    if (($dependencyReport -join "`n") -match '(?i)\b(vcruntime\d+\w*|msvcp\d+\w*|msvcr\d+\w*|WebView2Loader)\.dll') { throw 'Executable depends on an unbundled CRT/WebView2 DLL; static linking is required' }
    if ($CompileOnly) { Write-Host "Compile verified: $binary"; return }
    $run = Join-Path $repo ('artifacts\msix\' + $app.version + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $run | Out-Null
    $stage = Join-Path $run 'stage'
    $json = @(& node 'scripts/msix-stage.mjs' --config 'packaging/msix/store.json' --app-version $app.version --binary $binary --runtime $RuntimePath --assets 'src-tauri/icons' --stage $stage --max-version-tested $tested)
    if ($LASTEXITCODE -ne 0) { throw 'MSIX staging validation failed' }
    $inventory = ($json -join "`n") | ConvertFrom-Json
    $inventory | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $run 'payload.json') -Encoding UTF8
    $package = Join-Path $run "LyricalSync_$($inventory.version)_x64.msix"
    Invoke-Checked (Join-Path $sdk 'makeappx.exe') @('pack', '/d', $stage, '/p', $package, '/no')
    $unpacked = Join-Path $run 'unpacked'
    Invoke-Checked (Join-Path $sdk 'makeappx.exe') @('unpack', '/p', $package, '/d', $unpacked, '/no')
    foreach ($file in $inventory.files) {
        $path = Join-Path $unpacked $file.path
        if (!(Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Unpacked payload differs: $($file.path)" }
    }
    [xml]$manifest = Get-Content -LiteralPath (Join-Path $unpacked 'AppxManifest.xml') -Raw
    if ($manifest.Package.Identity.Name -ne $inventory.identity.name -or $manifest.Package.Identity.Publisher -ne $inventory.identity.publisher -or $manifest.Package.Identity.Version -ne $inventory.version -or $manifest.Package.Identity.ProcessorArchitecture -ne 'x64') { throw 'Unpacked package identity differs' }
    # Preserve the unsigned Store artifact; test signing is optional and separate.
    if ($CertificateThumbprint) {
        $signed = Join-Path $run "LyricalSync_$($inventory.version)_x64_test.msix"
        Copy-Item -LiteralPath $package -Destination $signed
        Invoke-Checked (Join-Path $sdk 'signtool.exe') @('sign', '/fd', 'SHA256', '/sha1', $CertificateThumbprint, $signed)
        Invoke-Checked (Join-Path $sdk 'signtool.exe') @('verify', '/pa', $signed)
    }
    $sourceInfo = $null
    if (Test-Path -LiteralPath (Join-Path $repo '.git')) {
        $sourceInfo = [ordered]@{ commit = (& git rev-parse HEAD); workingTree = @(& git status --short) }
    } elseif (Test-Path -LiteralPath (Join-Path $repo 'build-source.json')) {
        $sourceInfo = Get-Content -LiteralPath (Join-Path $repo 'build-source.json') -Raw | ConvertFrom-Json
    }
    $tools = [ordered]@{ node = (& node --version); cargo = (& cargo --version); rustc = (& rustc --version); tauriCli = (Get-Content -LiteralPath 'node_modules\@tauri-apps\cli\package.json' -Raw | ConvertFrom-Json).version; makeappx = (Get-Item -LiteralPath (Join-Path $sdk 'makeappx.exe')).VersionInfo.FileVersion }
    $record = [ordered]@{ source = $sourceInfo; tools = $tools; appVersion = $app.version; packageVersion = $inventory.version; maxVersionTested = $tested; runtimeVersion = $runtimeVersion; runtimeExecutableSha256 = (Get-FileHash -LiteralPath $runtimeExe -Algorithm SHA256).Hash; sdk = $sdk; packageSha256 = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash; dependencies = $dependencyReport; payload = $inventory }
    $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $run 'build-record.json') -Encoding UTF8
    Write-Host "MSIX verified: $package"
    Write-Host 'Store upload, certificate trust, installation, upgrade and WACK are separate release steps.'
} finally {
    [Environment]::SetEnvironmentVariable('CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS', $oldFlags, 'Process')
    Pop-Location
}
