$ErrorActionPreference='Stop'
$acceptRoot=$PSScriptRoot
$nodeExe='C:\Users\<USER>\AppData\Local\Temp\tpv-acceptance-20261123\node-v22.23.0-win-x64\node.exe'
foreach($mode in @('lifecycle')){
foreach($storage in @('local','unc','mapped')){
 $proc=Start-Process -FilePath $nodeExe -ArgumentList @("$acceptRoot\launch.cjs",$storage,$mode) -PassThru -WindowStyle Hidden -RedirectStandardOutput "$acceptRoot\$storage-$mode.stdout.log" -RedirectStandardError "$acceptRoot\$storage-$mode.stderr.log"
 $samples=[System.Collections.Generic.List[object]]::new()
 while(-not $proc.HasExited){
  $processes=@(Get-CimInstance Win32_Process -Filter "Name='Code.exe'")
  $owned=@($processes | Where-Object { $_.CommandLine -like "*$acceptRoot*" } | Select-Object -ExpandProperty ProcessId)
  for($i=0;$i -lt 4;$i++){$owned=@($owned)+@($processes | Where-Object { $_.ParentProcessId -in $owned } | Select-Object -ExpandProperty ProcessId);$owned=@($owned | Sort-Object -Unique)}
  foreach($idValue in $owned){$p=Get-Process -Id $idValue -ErrorAction SilentlyContinue;if($p){$samples.Add([pscustomobject]@{time=(Get-Date -Format o);pid=$p.Id;handleCount=$p.HandleCount;workingSetBytes=$p.WorkingSet64;privateMemoryBytes=$p.PrivateMemorySize64;cpuSeconds=$p.CPU})}}
  Start-Sleep -Seconds 2;$proc.Refresh()
 }
 $samples | Export-Csv "$acceptRoot\handles-$storage-$mode.csv" -NoTypeInformation
 Write-Output "$storage $mode exit=$($proc.ExitCode)"
}
}

