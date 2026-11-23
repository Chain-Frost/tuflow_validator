param([string]$EvidenceRoot='E:\temp\tpv-smb-investigation-20261123')
$samples=[System.Collections.Generic.List[object]]::new()
while(-not (Test-Path -LiteralPath "$EvidenceRoot\sampling-stop")) {
 $processes=@(Get-CimInstance Win32_Process -Filter "Name='Code.exe'")
 $owned=@($processes | Where-Object { $_.CommandLine -like "*$EvidenceRoot*" -or $_.CommandLine -like '*tpv-smb-investigation-20261123*' } | Select-Object -ExpandProperty ProcessId)
 for($i=0;$i -lt 5;$i++) { $owned=@($owned)+@($processes | Where-Object {$_.ParentProcessId -in $owned} | Select-Object -ExpandProperty ProcessId); $owned=@($owned | Sort-Object -Unique) }
 foreach($ownedId in $owned) { $proc=Get-Process -Id $ownedId -ErrorAction SilentlyContinue; if($proc) { $samples.Add([pscustomobject]@{time=(Get-Date -Format o);pid=$proc.Id;cpuSeconds=$proc.CPU;handles=$proc.HandleCount;workingSet=$proc.WorkingSet64;privateBytes=$proc.PrivateMemorySize64}) } }
 $samples | Export-Csv -LiteralPath "$EvidenceRoot\resource-samples.csv" -NoTypeInformation
 Start-Sleep -Seconds 2
}
