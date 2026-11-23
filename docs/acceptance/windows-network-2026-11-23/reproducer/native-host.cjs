const fs=require('fs'),path=require('path'),crypto=require('crypto'),v=require('vscode'),{performance:p}=require('perf_hooks');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const view=u=>v.languages.getDiagnostics(u).filter(d=>d.source==='TUFLOW Path Validator').map(d=>({code:typeof d.code==='object'?d.code.value:d.code,message:d.message,severity:d.severity,line:d.range.start.line,source:d.source}));
exports.run=async()=>{
 const parent=process.env.TPV_HOST_PARENT, dir=fs.mkdtempSync(path.join(parent,'tpv-native-host-'));
 const r={environment:{vscode:v.version,node:process.version,pid:process.pid,storage:process.env.TPV_STORAGE_LABEL,extensionPath:null,cacheCleared:false},samples:{},checks:[],snapshots:{},resources:[],closeEvents:[],integrity:[]};
 const snapshot=label=>r.resources.push({label,time:new Date().toISOString(),pid:process.pid,memory:process.memoryUsage(),cpu:process.cpuUsage(),activeHandlesProxy:process._getActiveHandles().length,activeRequestsProxy:process._getActiveRequests().length});
 const check=(name,pass,details)=>r.checks.push({name,status:pass?'passed':'failed',details});
 const file=(name,text)=>{const f=path.join(dir,name);fs.writeFileSync(f,text);return f;};
 const uri=name=>v.Uri.file(path.join(dir,name));
 const record=(name,ms)=>{(r.samples[name]??=[]).push(ms);};
 const wait=async(u,pred,timeout=10000)=>{const start=p.now();while(p.now()-start<timeout){if(pred(view(u)))return true;await pause(25);}return false;};
 const change=async(name,u,action,pred)=>{await pause(550);const start=p.now();let events=0;const sub=v.languages.onDidChangeDiagnostics(e=>{if(e.uris.some(x=>x.toString()===u.toString()))events++;});try{await action();const ok=await wait(u,d=>events>0&&pred(d));record(name,p.now()-start);check(name,ok,{events,diagnostics:view(u)});return ok;}finally{sub.dispose();}};
 const closeSub=v.workspace.onDidCloseTextDocument(d=>{if(d.fileName.startsWith(dir))r.closeEvents.push({file:path.basename(d.fileName),time:new Date().toISOString()});});
 let beat;const jitter=[];
 try{
 file('existing.shp','synthetic physical existence sentinel\n');file('geom_v01.tgc','Read GIS Mat == existing.shp\n!child:A\n');
 const body='Geometry Control File == geom_v01.tgc\nIf Scenario == Test\nRead GIS Mat == conditional_missing.shp\nEnd If\nRead GIS Mat == runtime_~s1~_~e1~.shp\n!edit:A\n';
 file('Run_v01.tcf',body); const root=uri('Run_v01.tcf'), child=uri('geom_v01.tgc');
 const before=hash(fs.readFileSync(path.join(dir,'existing.shp')));snapshot('before-open');
 const ext=v.extensions.getExtension('Chain-Frost.tuflow-path-validator');r.environment.extensionPath=ext.extensionPath;
 const start=p.now();const doc=await v.workspace.openTextDocument(root);await v.window.showTextDocument(doc,{preview:false});await ext.activate();
 check('firstValidation',await wait(root,d=>d.some(x=>x.code==='TPV001')));record('firstValidation',p.now()-start);r.snapshots.initial=view(root);
 check('conditionalMissing',view(root).some(d=>d.code==='TPV001'&&d.message.includes('conditional_missing')));
 check('runtimeTokensUnevaluated',!view(root).some(d=>d.code==='TPV001'&&d.message.includes('runtime_')));
 await pause(1000);snapshot('settled-open');let tick=p.now();beat=setInterval(()=>{const n=p.now();jitter.push(Math.max(0,n-tick-10));tick=n;},10);
 async function edit(d,marker,char){const offset=d.getText().indexOf(marker)+marker.length;const e=new v.WorkspaceEdit();e.replace(d.uri,new v.Range(d.positionAt(offset),d.positionAt(offset+1)),char);if(!await v.workspace.applyEdit(e))throw Error('applyEdit rejected');}
 for(let i=0;i<19;i++)await change('dirtyRootEdit',root,()=>edit(doc,'!edit:',i%2?'A':'B'),d=>d.some(x=>x.code==='TPV001'));
 const cd=await v.workspace.openTextDocument(child);await v.window.showTextDocument(cd,{preview:false});
 for(let i=0;i<19;i++)await change('dirtyIncludedChildEdit',root,()=>edit(cd,'!child:',i%2?'A':'B'),d=>d.some(x=>x.code==='TPV001'));
 await doc.save();await cd.save();await pause(1000);snapshot('after-edits');
 await change('siblingCreate',root,()=>file('geom_v02.tgc','!new version\n'),d=>d.some(x=>x.code==='TPV022'));
 await change('siblingRenameAway',root,()=>fs.renameSync(path.join(dir,'geom_v02.tgc'),path.join(dir,'unrelated.txt')),d=>!d.some(x=>x.code==='TPV022'));
 await change('siblingRenameBack',root,()=>fs.renameSync(path.join(dir,'unrelated.txt'),path.join(dir,'geom_v02.tgc')),d=>d.some(x=>x.code==='TPV022'));
 await change('siblingDelete',root,()=>fs.unlinkSync(path.join(dir,'geom_v02.tgc')),d=>!d.some(x=>x.code==='TPV022'));
 await change('childDiskEdit',root,()=>fs.writeFileSync(path.join(dir,'geom_v01.tgc'),'Read GIS Mat == child_missing.shp\n'),d=>d.some(x=>x.code==='TPV002'));
 await change('missingCreate',root,()=>file('conditional_missing.shp','synthetic\n'),d=>!d.some(x=>x.code==='TPV001'&&x.message.includes('conditional_missing')));
 await change('missingDelete',root,()=>fs.unlinkSync(path.join(dir,'conditional_missing.shp')),d=>d.some(x=>x.code==='TPV001'&&x.message.includes('conditional_missing')));
 const cfg=v.workspace.getConfiguration('tuflowValidator');
 await change('settingsDisable',root,()=>cfg.update('diagnosticLevel','none',v.ConfigurationTarget.Global),d=>d.length===0);
 await change('settingsEnable',root,()=>cfg.update('diagnosticLevel','hint',v.ConfigurationTarget.Global),d=>d.some(x=>x.code==='TPV001'));
 r.snapshots.final=view(root);await pause(1000);snapshot('before-tab-close');await v.commands.executeCommand('workbench.action.closeAllEditors');await pause(1500);snapshot('after-tab-close');
 r.tabClose={rootIsClosed:doc.isClosed,childIsClosed:cd.isClosed,rootRegistered:v.workspace.textDocuments.includes(doc),diagnostics:view(root),events:[...r.closeEvents]};
 r.integrity.push({file:'existing.shp',before,after:hash(fs.readFileSync(path.join(dir,'existing.shp')))});
 }catch(e){r.failure=String(e.stack||e);}finally{clearInterval(beat);closeSub.dispose();r.heartbeatJitterMs=jitter;try{await v.commands.executeCommand('workbench.action.closeAllEditors');fs.rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:250});}catch(e){r.cleanupError=String(e);}r.fixturesRemoved=!fs.existsSync(dir);fs.writeFileSync(process.env.TPV_HOST_OUTPUT,JSON.stringify(r,null,2));}
};
