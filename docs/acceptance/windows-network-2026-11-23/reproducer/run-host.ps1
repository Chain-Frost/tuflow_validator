$ErrorActionPreference='Stop'
$acceptRoot=$PSScriptRoot
$env:PATH="$acceptRoot\node-v22.23.0-win-x64;$env:PATH"
$loc=Get-Content "$acceptRoot\evidence\fixture-locations-private.json" | ConvertFrom-Json
foreach($storage in @('local','mapped','unc')){
 $env:TPV_HOST_PARENT=$loc.$storage
 $proc=Start-Process -FilePath "$acceptRoot\node-v22.23.0-win-x64\node.exe" -ArgumentList @("$acceptRoot\launch-host.cjs",'d2',$storage) -PassThru -WindowStyle Hidden -RedirectStandardOutput "$acceptRoot\evidence\host-d2-$storage.stdout.log" -RedirectStandardError "$acceptRoot\evidence\host-d2-$storage.stderr.log"
 $samples=[System.Collections.Generic.List[object]]::new()
 while(-not $proc.HasExited){
  $processes=@(Get-CimInstance Win32_Process -Filter "Name='Code.exe'")
  $owned=@($processes | Where-Object { $_.CommandLine -like "*$acceptRoot*" } | Select-Object -ExpandProperty ProcessId)
  for($i=0;$i -lt 4;$i++){$owned=@($owned)+@($processes | Where-Object { $_.ParentProcessId -in $owned } | Select-Object -ExpandProperty ProcessId);$owned=@($owned | Sort-Object -Unique)}
  foreach($idValue in $owned){$p=Get-Process -Id $idValue -ErrorAction SilentlyContinue;if($p){$samples.Add([pscustomobject]@{time=(Get-Date -Format o);pid=$p.Id;handleCount=$p.HandleCount;workingSetBytes=$p.WorkingSet64;privateMemoryBytes=$p.PrivateMemorySize64;cpuSeconds=$p.CPU})}}
  Start-Sleep -Seconds 2;$proc.Refresh()
 }
 $samples | Export-Csv "$acceptRoot\evidence\os-handles-d2-$storage.csv" -NoTypeInformation
 $samples | ConvertTo-Json -Depth 4 | Set-Content "$acceptRoot\evidence\os-handles-d2-$storage.json"
 if($proc.ExitCode -ne 0){Write-Output "Host launcher exit $($proc.ExitCode) $storage"}
}
