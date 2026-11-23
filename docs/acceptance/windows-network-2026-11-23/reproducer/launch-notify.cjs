const path=require('path'),fs=require('fs'),base=__dirname;
const {runTests}=require(path.join(base,'d2/node_modules/@vscode/test-electron'));
(async()=>{const name=process.argv[2],storage=process.argv[3],workspace=process.argv[4]==='workspace';delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({vscodeExecutablePath:'C:/Program Files/Microsoft VS Code/Code.exe',extensionDevelopmentPath:path.join(base,'probe'),extensionTestsPath:path.join(base,'notify-host.cjs'),launchArgs:[...(workspace?[process.env.TPV_HOST_PARENT]:[]),'--user-data-dir',path.join(base,'profiles',name+'-notify-'+storage+'-'+workspace),'--extensions-dir',path.join(base,'installed',name),'--disable-gpu','--disable-workspace-trust'],extensionTestsEnv:{TPV_HOST_PARENT:process.env.TPV_HOST_PARENT,TPV_HOST_OUTPUT:path.join(base,'evidence','notify-'+name+'-'+storage+'-'+workspace+'.json')}});
})().catch(e=>{console.error(e);process.exitCode=1;});
