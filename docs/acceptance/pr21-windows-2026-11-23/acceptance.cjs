const fs=require('fs'),path=require('path'),v=require('vscode'),{performance:p}=require('perf_hooks');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async()=>{
const dir=fs.mkdtempSync(path.join(process.env.TPV_HOST_PARENT,'case-'));
const r={environment:{vscode:v.version,node:process.version,pid:process.pid,storage:process.env.TPV_STORAGE_LABEL},checks:[],resources:[],closeEvents:[],jitter:[]};
const uri=n=>v.Uri.file(path.join(dir,n)),file=(n,s)=>{fs.mkdirSync(path.dirname(uri(n).fsPath),{recursive:true});fs.writeFileSync(uri(n).fsPath,s)};
const view=n=>v.languages.getDiagnostics(uri(n)).filter(d=>d.source==='TUFLOW Path Validator').map(d=>({code:typeof d.code==='object'?d.code.value:d.code,message:d.message,target:typeof d.code==='object'?d.code.target?.fsPath:undefined,line:d.range.start.line}));
const has=(n,c)=>view(n).some(d=>d.code===c);
const check=(name,status,details)=>{r.checks.push({name,status,details});fs.writeFileSync(process.env.TPV_HOST_OUTPUT+'.progress',JSON.stringify({name,status,completed:r.checks.length,details},null,2))};
const wait=async pred=>{const start=p.now();while(p.now()-start<6000){if(pred())return true;await pause(25)}return false};
const change=async(name,action,pred,names=['Run_v01.tcf'])=>{await pause(550);const t=p.now();let events=0;const sub=v.languages.onDidChangeDiagnostics(e=>{if(e.uris.some(u=>names.some(n=>u.toString()===uri(n).toString())))events++});try{await action();const ok=await wait(()=>events>0&&pred());check(name,ok?'PASS':'FAIL',{ms:p.now()-t,events,snapshots:Object.fromEntries(names.map(n=>[n,view(n)]))});return ok}finally{sub.dispose()}};
const open=async n=>{const d=await v.workspace.openTextDocument(uri(n));await v.window.showTextDocument(d,{preview:false});return d};
const edit=async(d,text)=>{const e=new v.WorkspaceEdit();e.replace(d.uri,new v.Range(d.positionAt(0),d.positionAt(d.getText().length)),text);if(!await v.workspace.applyEdit(e))throw Error('edit rejected')};
let dm,beat;const cs=v.workspace.onDidCloseTextDocument(d=>{if(d.fileName.toLowerCase().startsWith(dir.toLowerCase()))r.closeEvents.push(path.relative(dir,d.fileName))});
const snap=label=>r.resources.push({label,time:new Date().toISOString(),memory:process.memoryUsage(),activeHandlesProxy:process._getActiveHandles().length,trackedDirectories:dm?[...dm.getTrackedWatchDirectories()].map(x=>x.replace(dir,'<fixture>')):[],openFixtureDocuments:v.workspace.textDocuments.filter(d=>d.fileName.toLowerCase().startsWith(dir.toLowerCase())).length});
try{
file('geom_v01.tgc','!clean\n');file('Run_v01.tcf','Geometry Control File == geom_v01.tgc\n');
const ext=v.extensions.getExtension('Chain-Frost.tuflow-path-validator');r.environment.extensionPath=ext.extensionPath;const root=await open('Run_v01.tcf');await ext.activate();dm=require(path.join(ext.extensionPath,'out/diagnostics.js'));await pause(1800);snap('settled');
let tick=p.now();beat=setInterval(()=>{const t=p.now();r.jitter.push(Math.max(0,t-tick-20));tick=t},20);
await change('sibling-create',()=>file('geom_v02.tgc','!new\n'),()=>has('Run_v01.tcf','TPV022'));
const diag=v.languages.getDiagnostics(root.uri).find(d=>(typeof d.code==='object'?d.code.value:d.code)==='TPV022');
if(diag){const actions=await v.commands.executeCommand('vscode.executeCodeActionProvider',root.uri,diag.range,v.CodeActionKind.QuickFix.value);const fix=actions.find(a=>a.title==='Update to latest version (TUFLOW)');const edits=fix?.edit?.entries().flatMap(([u,es])=>es.map(e=>({uri:u.fsPath,text:e.newText})));check('quick-fix-target',edits?.some(e=>e.text==='geom_v02.tgc')?'PASS':'FAIL',edits)}else check('quick-fix-target','BLOCKED','No version diagnostic');
await change('sibling-rename-away',()=>fs.renameSync(uri('geom_v02.tgc').fsPath,uri('other.txt').fsPath),()=>!has('Run_v01.tcf','TPV022'));
await change('sibling-rename-back',()=>fs.renameSync(uri('other.txt').fsPath,uri('geom_v02.tgc').fsPath),()=>has('Run_v01.tcf','TPV022'));
await change('sibling-delete',()=>fs.unlinkSync(uri('geom_v02.tgc').fsPath),()=>!has('Run_v01.tcf','TPV022'));
for(let i=0;i<20;i++){
await change('cycle-'+i+'-create',()=>file('geom_v02.tgc','!new\n'),()=>has('Run_v01.tcf','TPV022'));
await change('cycle-'+i+'-rename-away',()=>fs.renameSync(uri('geom_v02.tgc').fsPath,uri('other.txt').fsPath),()=>!has('Run_v01.tcf','TPV022'));
await change('cycle-'+i+'-rename-back',()=>fs.renameSync(uri('other.txt').fsPath,uri('geom_v02.tgc').fsPath),()=>has('Run_v01.tcf','TPV022'));
await change('cycle-'+i+'-delete',()=>fs.unlinkSync(uri('geom_v02.tgc').fsPath),()=>!has('Run_v01.tcf','TPV022'));
const ds=view('Run_v01.tcf');if(new Set(ds.map(d=>JSON.stringify(d))).size!==ds.length)check('cycle-'+i+'-duplicates','FAIL',ds);
if(i%5===4)snap('cycle-'+i);
}
file('layer_v01.csv','sentinel\n');file('layer_v02.csv','sentinel\n');file('alternate.tgc','Read GIS Mat == layer_v01.csv\n');
await change('unsaved-root-new-graph',()=>edit(root,'Geometry Control File == alternate.tgc\n'),()=>has('alternate.tgc','TPV022')&&has('Run_v01.tcf','TPV002'),['Run_v01.tcf','alternate.tgc']);
const dirty=view('alternate.tgc');await root.save();await pause(650);check('unsaved-equals-saved',JSON.stringify(dirty)===JSON.stringify(view('alternate.tgc'))?'PASS':'FAIL',{dirty,saved:view('alternate.tgc')});
for(const suffix of ['tgc','trd','payload']){
const n='dirty.'+suffix;file(n,'!clean\n');await edit(root,(suffix==='tgc'?'Geometry Control File':'Read File')+' == '+n+'\n');await root.save();await pause(650);const child=await open(n);
await change('dirty-'+suffix+'-missing',()=>edit(child,'Read GIS Mat == dirty_missing.csv\n'),()=>has(n,'TPV001')&&has('Run_v01.tcf','TPV002'),['Run_v01.tcf',n]);
await change('dirty-'+suffix+'-clean',()=>edit(child,'!clean again\n'),()=>!has(n,'TPV001')&&!has('Run_v01.tcf','TPV002'),['Run_v01.tcf',n]);
await child.save();await v.commands.executeCommand('workbench.action.closeActiveEditor');await pause(600);check('save-close-'+suffix,!has('Run_v01.tcf','TPV002')?'PASS':'FAIL',{isClosed:child.isClosed,diagnostics:view('Run_v01.tcf')});
await change('disk-after-close-'+suffix,()=>file(n,'Read GIS Mat == disk_missing.csv\n'),()=>has('Run_v01.tcf','TPV002'),['Run_v01.tcf',n]);
}
file('present.csv','sentinel\n');await edit(root,'Read GIS Mat == present.csv\n');await root.save();await pause(1200);
await change('valid-delete',()=>fs.unlinkSync(uri('present.csv').fsPath),()=>has('Run_v01.tcf','TPV001'));
await change('missing-recreate',()=>file('present.csv','sentinel\n'),()=>!has('Run_v01.tcf','TPV001'));
file('shared/context.trd','Read GIS Mat == <<DIR>>/present.csv\n');file('a/present.csv','sentinel\n');
file('RootA.tcf','Set Variable DIR == a\nRead File == shared/context.trd\n');file('RootB.tcf','Set Variable DIR == b\nRead File == shared/context.trd\n');
const a=await open('RootA.tcf'),b=await open('RootB.tcf');await pause(1500);
check('multi-root-static-TRD',!has('RootA.tcf','TPV002')&&has('RootB.tcf','TPV002')&&has('shared/context.trd','TPV001')?'PASS':'FAIL',{a:view('RootA.tcf'),b:view('RootB.tcf'),child:view('shared/context.trd')});
await change('shared-child-clears-only-B',()=>file('b/present.csv','sentinel\n'),()=>!has('RootA.tcf','TPV002')&&!has('RootB.tcf','TPV002'),['RootA.tcf','RootB.tcf','shared/context.trd']);
await change('shared-child-restores-only-B',()=>fs.unlinkSync(uri('b/present.csv').fsPath),()=>!has('RootA.tcf','TPV002')&&has('RootB.tcf','TPV002'),['RootA.tcf','RootB.tcf','shared/context.trd']);
await v.commands.executeCommand('workbench.action.closeAllEditors');await pause(1000);snap('after-tabs-close');
check('actual-root-document-close',a.isClosed&&b.isClosed?'PASS':'BLOCKED',{aClosed:a.isClosed,bClosed:b.isClosed,closeEvents:r.closeEvents});
await open('RootA.tcf');await open('RootB.tcf');await pause(650);check('roots-reopen',!has('RootA.tcf','TPV002')&&has('RootB.tcf','TPV002')?'PASS':'FAIL',{a:view('RootA.tcf'),b:view('RootB.tcf')});
await edit(root,'Mystery Command == unknown_missing.csv\nRead GIS Mat == runtime_<<~s1~>>_<<~e1~>>.csv\nIf Scenario == Test\nRead GIS Mat == conditional_missing.csv\nEnd If\nGeometry Control File == geom_v01.tgc\n');await root.save();await pause(1000);
const neg=view('Run_v01.tcf');check('negative-semantics',neg.filter(d=>d.code==='TPV001').length===1&&neg.some(d=>d.code==='TPV001'&&d.message.includes('conditional_missing'))&&!has('Run_v01.tcf','TPV022')?'PASS':'FAIL',neg);
await pause(650);let unrelatedEvents=0;const sub=v.languages.onDidChangeDiagnostics(e=>{if(e.uris.some(u=>u.toString()===root.uri.toString()))unrelatedEvents++});const before=view('Run_v01.tcf');file('unrelated.txt','unrelated\n');await pause(1500);sub.dispose();check('unrelated-file',unrelatedEvents===0&&JSON.stringify(before)===JSON.stringify(view('Run_v01.tcf'))?'PASS':'FAIL',{events:unrelatedEvents});
snap('final-open');await v.commands.executeCommand('workbench.action.closeAllEditors');await pause(1200);snap('final-tabs-closed');
}catch(e){r.failure=String(e.stack||e)}finally{clearInterval(beat);cs.dispose();try{await v.commands.executeCommand('workbench.action.closeAllEditors');fs.rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:250});await pause(2000);snap('after-fixture-delete')}catch(e){r.cleanupError=String(e)}r.fixturesRemoved=!fs.existsSync(dir);fs.writeFileSync(process.env.TPV_HOST_OUTPUT,JSON.stringify(r,null,2))}
};
