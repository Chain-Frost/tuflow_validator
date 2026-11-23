const fs=require('fs'),path=require('path'),v=require('vscode');const pause=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async()=>{
const dir=fs.mkdtempSync(path.join(process.env.TPV_HOST_PARENT,'lifecycle-'));const r={storage:process.env.TPV_STORAGE_LABEL,pid:process.pid,samples:[],closeEvents:[]};
const u=n=>v.Uri.file(path.join(dir,n));const view=n=>v.languages.getDiagnostics(u(n)).filter(d=>d.source==='TUFLOW Path Validator').map(d=>({code:typeof d.code==='object'?d.code.value:d.code,message:d.message}));
r.identity={uri:u('A.tcf').toString(),fsPath:u('A.tcf').fsPath};
const sub=v.workspace.onDidCloseTextDocument(d=>{if(d.fileName.toLowerCase().startsWith(dir.toLowerCase()))r.closeEvents.push(path.basename(d.fileName))});
let dm;const sample=(label,docs=[])=>r.samples.push({label,time:new Date().toISOString(),trackedDirectories:dm?[...dm.getTrackedWatchDirectories()]:[],registeredDocuments:v.workspace.textDocuments.filter(d=>d.fileName.toLowerCase().startsWith(dir.toLowerCase())).map(d=>path.basename(d.fileName)),docs:docs.map(d=>({name:path.basename(d.fileName),isClosed:d.isClosed})),memory:process.memoryUsage(),a:view('A.tcf'),b:view('B.tcf')});
try{
fs.writeFileSync(u('child.payload').fsPath,'Read GIS Mat == missing.csv\n');for(const n of ['A.tcf','B.tcf'])fs.writeFileSync(u(n).fsPath,'Read File == child.payload\n');
const ext=v.extensions.getExtension('Chain-Frost.tuflow-path-validator');await ext.activate();
fs.writeFileSync(u('original_v02.tgc').fsPath,'!clean\n');fs.writeFileSync(u('other_v02.tgc').fsPath,'Read GIS Mat == layer_v01.csv\n');fs.writeFileSync(u('layer_v01.csv').fsPath,'sentinel\n');fs.writeFileSync(u('layer_v02.csv').fsPath,'sentinel\n');fs.writeFileSync(u('Run_v02.tcf').fsPath,'Geometry Control File == original_v02.tgc\n');
const ud=await v.workspace.openTextDocument(u('Run_v02.tcf'));await v.window.showTextDocument(ud);await pause(1000);const ue=new v.WorkspaceEdit();ue.replace(ud.uri,new v.Range(ud.positionAt(0),ud.positionAt(ud.getText().length)),'Geometry Control File == other_v02.tgc\n');const ut=Date.now();await v.workspace.applyEdit(ue);while(Date.now()-ut<6000&&!view('other_v02.tgc').some(d=>d.code==='TPV022'))await pause(25);r.unsaved={dirty:ud.isDirty,ms:Date.now()-ut,root:view('Run_v02.tcf'),child:view('other_v02.tgc')};await ud.save();await pause(700);r.unsaved.savedRoot=view('Run_v02.tcf');r.unsaved.savedChild=view('other_v02.tgc');r.unsaved.pass=r.unsaved.dirty&&r.unsaved.child.some(d=>d.code==='TPV022')&&JSON.stringify(r.unsaved.child)===JSON.stringify(r.unsaved.savedChild)&&JSON.stringify(r.unsaved.root)===JSON.stringify(r.unsaved.savedRoot);
await v.commands.executeCommand('workbench.action.closeAllEditors');const ux=new v.WorkspaceEdit();ux.deleteFile(ud.uri);await v.workspace.applyEdit(ux);await pause(1200);
for(let i=0;i<20;i++){
const docs=[];for(const n of ['A.tcf','B.tcf']){const d=await v.workspace.openTextDocument(u(n));docs.push(d);await v.window.showTextDocument(d,{preview:false});const e=new v.WorkspaceEdit();e.replace(d.uri,new v.Range(d.positionAt(0),d.positionAt(d.getText().length)),'Read File == child.payload\n!switch '+i+'\n');await v.workspace.applyEdit(e);await d.save()}
await pause(600);await v.commands.executeCommand('workbench.action.closeAllEditors');await pause(500);sample('cycle-'+i,docs);
}
const d=await v.workspace.openTextDocument(u('B.tcf'));const e=new v.WorkspaceEdit();e.deleteFile(d.uri);await v.workspace.applyEdit(e);await pause(2000);sample('delete-B',[d]);r.realClose=d.isClosed&&r.closeEvents.includes('B.tcf');r.otherRootRetained=view('A.tcf').some(d=>d.code==='TPV002');
fs.writeFileSync(u('B.tcf').fsPath,'Read File == child.payload\n');const reopened=await v.workspace.openTextDocument(u('B.tcf'));await v.window.showTextDocument(reopened);await pause(650);sample('recreated-B',[reopened]);
await v.commands.executeCommand('workbench.action.closeAllEditors');const e2=new v.WorkspaceEdit();for(const n of ['A.tcf','B.tcf'])e2.deleteFile(u(n));await v.workspace.applyEdit(e2);await pause(2000);sample('roots-deleted');r.nativeWatcherCount='not observable through VS Code API';
}catch(e){r.failure=String(e.stack||e)}finally{sub.dispose();try{await v.commands.executeCommand('workbench.action.closeAllEditors');fs.rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:250})}catch(e){r.cleanupError=String(e)}r.fixturesRemoved=!fs.existsSync(dir);fs.writeFileSync(process.env.TPV_HOST_OUTPUT,JSON.stringify(r,null,2))}
};

