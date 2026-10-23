import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

for (const architecture of ['x64', 'arm64']) {
  test(`finds older C++ tools when newest Visual Studio is ineligible (${architecture})`, { skip: process.platform !== 'win32' }, t => {
    const folder = mkdtempSync(join(tmpdir(), 'store-tool-discovery-'));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    const installer = join(folder, 'Microsoft Visual Studio', 'Installer'); mkdirSync(installer, { recursive: true });
    // Substitute the external discovery service, preserving real PowerShell function execution.
    const rust = join(folder, 'vswhere.rs');
    writeFileSync(rust, 'fn main(){if std::env::args().any(|a|a=="-latest"){return;}println!("{}",std::env::var("FIXTURE_DUMPBIN").unwrap());}');
    execFileSync('rustc', ['--edition=2021', rust, '-o', join(installer, 'vswhere.exe')]);
    const older = join(folder, 'older-cpp-dumpbin.exe'); writeFileSync(older, 'discovered tool');
    const build = resolve(import.meta.dirname, 'msstore-build.ps1');
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    const script = join(folder, 'probe.ps1');
    writeFileSync(script, `$ErrorActionPreference='Stop'\n$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(build)},[ref]$null,[ref]$null)\n$function=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Find-Dumpbin'},$true)\nInvoke-Expression $function.Extent.Text\nfunction Get-Command { param($Name,$ErrorAction) return $null }\n[Environment]::SetEnvironmentVariable('ProgramFiles(x86)',${quote(folder)},'Process')\n$Architecture='${architecture}'\n$hostArchitecture='arm64'\n$result=Find-Dumpbin\nWrite-Output $result\n`);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { encoding: 'utf8', env: { ...process.env, FIXTURE_DUMPBIN: older } });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), older);
  });
}
