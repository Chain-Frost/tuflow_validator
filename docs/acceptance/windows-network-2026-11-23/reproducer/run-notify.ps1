$acceptRoot=$PSScriptRoot
$env:PATH="$acceptRoot\node-v22.23.0-win-x64;$env:PATH"
$loc=Get-Content "$acceptRoot\evidence\fixture-locations-private.json" | ConvertFrom-Json
foreach($name in @('before','d2')){foreach($storage in @('local','mapped','unc')){foreach($workspace in @('empty','workspace')){
 $env:TPV_HOST_PARENT=$loc.$storage
 node "$acceptRoot\launch-notify.cjs" $name $storage $workspace *> "$acceptRoot\evidence\notify-$name-$storage-$workspace.log"
}}}
