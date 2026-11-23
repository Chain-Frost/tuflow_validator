const path=require('path'),fs=require('fs');
const base=__dirname;
const {runTests}=require(path.join(base,'d2/node_modules/@vscode/test-electron'));
(async()=>{
 const name=process.argv[2],storage=process.argv[3];
 delete process.env.ELECTRON_RUN_AS_NODE;
 await runTests({vscodeExecutablePath:'C:/Program Files/Microsoft VS Code/Code.exe',extensionDevelopmentPath:path.join(base,'probe'),extensionTestsPath:path.join(base,'native-host.cjs'),launchArgs:['--user-data-dir',path.join(base,'profiles',name+'-'+storage),'--extensions-dir',path.join(base,'installed',name),'--disable-gpu','--skip-welcome','--skip-release-notes','--disable-workspace-trust'],extensionTestsEnv:{TPV_HOST_PARENT:process.env.TPV_HOST_PARENT,TPV_STORAGE_LABEL:storage,TPV_HOST_OUTPUT:path.join(base,'evidence','host-'+name+'-'+storage+'.json')}});
})().catch(e=>{console.error(e);process.exitCode=1;});
