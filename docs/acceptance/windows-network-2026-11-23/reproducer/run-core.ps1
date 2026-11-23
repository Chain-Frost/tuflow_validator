$ErrorActionPreference='Stop'
$acceptRoot=$PSScriptRoot
$env:PATH="$acceptRoot\node-v22.23.0-win-x64;$env:PATH"
$networkRoot=Join-Path 'T:\temp' ('tpv-acceptance-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $networkRoot | Out-Null
$mapping=Get-SmbMapping -LocalPath 'T:'
$uncRoot=$mapping.RemotePath+'\temp\'+(Split-Path $networkRoot -Leaf)
@{mapped=$networkRoot;unc=$uncRoot;local=$acceptRoot} | ConvertTo-Json | Set-Content "$acceptRoot\evidence\fixture-locations-private.json"
$env:TPV_BENCHMARK_SAMPLES='19'
Remove-Item Env:\TPV_SYNTHETIC_IO_MS -ErrorAction SilentlyContinue
foreach($name in @('d1','before','d2')){
 if($name -ne 'd1'){New-Item -ItemType Directory "$acceptRoot\$name\scripts\benchmarks" -Force | Out-Null;Copy-Item "$acceptRoot\d1\scripts\benchmarks\core-baseline.cjs" "$acceptRoot\$name\scripts\benchmarks\core-baseline.cjs"}
 $env:TPV_SOURCE_SHA=(git -C "$acceptRoot\$name" rev-parse HEAD)
 $env:TPV_VSIX_PATH="$acceptRoot\$name.vsix"
 git -C "$acceptRoot\$name" archive --format=zip -o "$acceptRoot\evidence\source-$name.zip" HEAD
 foreach($storage in @('local','mapped','unc')){
  $env:TPV_BENCHMARK_FIXTURE_PARENT=switch($storage){local{$acceptRoot} mapped{$networkRoot} unc{$uncRoot}}
  $env:TPV_STORAGE_LABEL="$storage; same Windows workstation; real remote SMB for mapped/unc; no cache flush"
  $env:TPV_BENCHMARK_NETWORK_EVIDENCE=if($storage -eq 'local'){'local NTFS'}else{'Get-SmbMapping remote non-loopback server resolved to distinct LAN IPv4; private environment record'}
  $env:TPV_BENCHMARK_OUTPUT="$acceptRoot\evidence\core-$name-$storage.json"
  node "$acceptRoot\$name\scripts\benchmarks\core-baseline.cjs" *> "$acceptRoot\evidence\core-$name-$storage.log"
  if($LASTEXITCODE -ne 0){throw "Benchmark failed $name $storage"}
 }
}
foreach($storage in @('local','mapped','unc')){node "$acceptRoot\d2\scripts\benchmarks\compare-core.cjs" "$acceptRoot\evidence\core-before-$storage.json" "$acceptRoot\evidence\core-d2-$storage.json" *> "$acceptRoot\evidence\comparison-$storage.txt";if($LASTEXITCODE -ne 0){throw "Comparison failed $storage"}}
