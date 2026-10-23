[CmdletBinding()]
param(
    [ValidateSet("x64", "arm64")]
    [string]$Architecture = "x64",
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
$Architecture = $Architecture.ToLowerInvariant()
$target = if ($Architecture -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
$rustFlagsName = 'CARGO_TARGET_' + $target.Replace('-', '_').ToUpperInvariant() + '_RUSTFLAGS'
$hostArchitecture = if (@($env:PROCESSOR_ARCHITEW6432, $env:PROCESSOR_ARCHITECTURE) -contains 'ARM64') { 'arm64' } else { 'x64' }

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
function Find-Sdk {
    if ($SdkBin) {
        $candidate = (Resolve-Path -LiteralPath $SdkBin).Path
        if (!(Test-Path -LiteralPath (Join-Path $candidate 'makeappx.exe')) -or !(Test-Path -LiteralPath (Join-Path $candidate 'mt.exe'))) { throw 'SdkBin must contain makeappx.exe and mt.exe' }
        return $candidate
    }
    $base = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $folders = Get-ChildItem -LiteralPath $base -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending
    foreach ($folder in $folders) {
        foreach ($hostTool in @($hostArchitecture, 'x64') | Select-Object -Unique) {
            $candidate = Join-Path $folder.FullName $hostTool
            if ((Test-Path -LiteralPath (Join-Path $candidate 'makeappx.exe')) -and (Test-Path -LiteralPath (Join-Path $candidate 'mt.exe'))) { return $candidate }
        }
    }
    throw 'Install the Windows SDK with MakeAppx.exe'
}
function Find-Dumpbin {
    $command = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (!(Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio C++ build tools (dumpbin.exe)' }
    foreach ($hostTool in @($hostArchitecture, 'x64') | Select-Object -Unique) {
        foreach ($toolTarget in @($Architecture, 'x64') | Select-Object -Unique) {
            $toolMatches = @(& $vswhere -latest -products '*' -find "VC\Tools\MSVC\**\bin\Host$hostTool\$toolTarget\dumpbin.exe")
            if ($LASTEXITCODE -eq 0 -and $toolMatches.Count) { return $toolMatches[-1] }
        }
    }
    throw 'Cannot locate a compatible dumpbin.exe in Visual Studio C++ build tools'
}

Push-Location $repo
$oldFlags = [Environment]::GetEnvironmentVariable($rustFlagsName, 'Process')
try {
    Invoke-Checked 'node' @('scripts/check-notices.mjs')
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
        if (!$RuntimePath) { throw 'Supply -RuntimePath pointing to an extracted Microsoft Fixed Version WebView2 runtime matching -Architecture' }
        $RuntimePath = (Resolve-Path -LiteralPath $RuntimePath).Path
        $runtimeExe = Join-Path $RuntimePath 'msedgewebview2.exe'
        if (!(Test-Path -LiteralPath $runtimeExe -PathType Leaf)) { throw 'RuntimePath must directly contain msedgewebview2.exe' }
        Invoke-Checked 'node' @('scripts/windows-pe.mjs', $runtimeExe, $Architecture)
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
    [Environment]::SetEnvironmentVariable($rustFlagsName, '-C target-feature=+crt-static', 'Process')
    Invoke-Checked 'rustup' @('target', 'add', $target)
    Invoke-Checked 'npm.cmd' @('run', 'tauri', '--', 'build', '--config', 'src-tauri/tauri.msstore.conf.json', '--target', $target, '--no-bundle', '--', '--locked')
    $binary = Join-Path $repo "src-tauri\target\$target\release\lyrical-sync.exe"
    if (!(Test-Path -LiteralPath $binary)) { throw 'Expected release executable was not produced' }
    Invoke-Checked 'node' @('scripts/windows-pe.mjs', $binary, $Architecture)
    $embeddedManifest = [IO.Path]::GetTempFileName()
    try {
        Invoke-Checked (Join-Path $sdk 'mt.exe') @("-inputresource:$binary;#1", "-out:$embeddedManifest")
        [xml]$assembly = Get-Content -LiteralPath $embeddedManifest -Raw
        $expectedAssembly = if ($Architecture -eq 'arm64') { 'arm64' } else { 'amd64' }
        if ($assembly.assembly.assemblyIdentity.processorArchitecture -ne $expectedAssembly) { throw 'Embedded Windows assembly architecture differs from target' }
    } finally {
        Remove-Item -LiteralPath $embeddedManifest -ErrorAction SilentlyContinue
    }
    $dependencyReport = @(& $dumpbin /DEPENDENTS $binary)
    if ($LASTEXITCODE -ne 0) { throw 'PE dependency inspection failed' }
    if (($dependencyReport -join "`n") -match '(?i)\b(vcruntime\d+\w*|msvcp\d+\w*|msvcr\d+\w*|WebView2Loader)\.dll') { throw 'Executable depends on an unbundled CRT/WebView2 DLL; static linking is required' }
    if ($CompileOnly) { Write-Host "Compile verified: $binary"; return }
    $run = Join-Path $repo ('artifacts\msix\' + $app.version + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $run | Out-Null
    $stage = Join-Path $run 'stage'
    $json = @(& node 'scripts/msix-stage.mjs' --config 'packaging/msix/store.json' --app-version $app.version --binary $binary --runtime $RuntimePath --assets 'src-tauri/icons' --stage $stage --max-version-tested $tested --architecture $Architecture)
    if ($LASTEXITCODE -ne 0) { throw 'MSIX staging validation failed' }
    $inventory = ($json -join "`n") | ConvertFrom-Json
    $inventory | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $run 'payload.json') -Encoding UTF8
    $package = Join-Path $run "LyricalSync_$($inventory.version)_$Architecture.msix"
    Invoke-Checked (Join-Path $sdk 'makeappx.exe') @('pack', '/d', $stage, '/p', $package, '/no')
    $unpacked = Join-Path $run 'unpacked'
    Invoke-Checked (Join-Path $sdk 'makeappx.exe') @('unpack', '/p', $package, '/d', $unpacked, '/no')
    foreach ($file in $inventory.files) {
        $path = Join-Path $unpacked $file.path
        if (!(Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Unpacked payload differs: $($file.path)" }
    }
    [xml]$manifest = Get-Content -LiteralPath (Join-Path $unpacked 'AppxManifest.xml') -Raw
    if ($manifest.Package.Identity.Name -ne $inventory.identity.name -or $manifest.Package.Identity.Publisher -ne $inventory.identity.publisher -or $manifest.Package.Identity.Version -ne $inventory.version -or $manifest.Package.Identity.ProcessorArchitecture -ne $Architecture) { throw 'Unpacked package identity differs' }
    # Preserve the unsigned Store artifact; test signing is optional and separate.
    if ($CertificateThumbprint) {
        $signed = Join-Path $run "LyricalSync_$($inventory.version)_$($Architecture)_test.msix"
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
    $record = [ordered]@{ architecture = $Architecture; source = $sourceInfo; tools = $tools; appVersion = $app.version; packageVersion = $inventory.version; maxVersionTested = $tested; runtimeVersion = $runtimeVersion; runtimeExecutableSha256 = (Get-FileHash -LiteralPath $runtimeExe -Algorithm SHA256).Hash; sdk = $sdk; packageSha256 = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash; dependencies = $dependencyReport; payload = $inventory }
    $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $run 'build-record.json') -Encoding UTF8
    Write-Host "MSIX verified: $package"
    Write-Host 'Store upload, certificate trust, installation, upgrade and WACK are separate release steps.'
} finally {
    [Environment]::SetEnvironmentVariable($rustFlagsName, $oldFlags, 'Process')
    Pop-Location
}
