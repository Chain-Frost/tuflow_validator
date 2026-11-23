const fs=require('fs'),path=require('path');
const base=__dirname,old='C:/Users/<USER>/AppData/Local/Temp/tpv-acceptance-20261123';
const {runTests}=require(old+'/d2/node_modules/@vscode/test-electron');
(async()=>{const storage=process.argv[2],mode=process.argv[3]||'workspace';const loc=JSON.parse(fs.readFileSync(base+'/locations-private.json'));
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({vscodeExecutablePath:'C:/Program Files/Microsoft VS Code/Code.exe',extensionDevelopmentPath:base+'/probe',extensionTestsPath:base+(mode==='workspace'?'/acceptance.cjs':mode==='lifecycle'?'/lifecycle.cjs':'/notify.cjs'),launchArgs:[...(mode!=='notify'?[loc[storage]]:[]),'--user-data-dir',base+'/profiles/'+storage+'-'+mode,'--extensions-dir',base+'/installed','--disable-gpu','--disable-workspace-trust','--skip-welcome','--skip-release-notes'],extensionTestsEnv:{TPV_HOST_PARENT:loc[storage],TPV_STORAGE_LABEL:storage,TPV_HOST_OUTPUT:base+'/'+storage+'-'+mode+'.json'}});
})().catch(e=>{console.error(e);process.exitCode=1});
