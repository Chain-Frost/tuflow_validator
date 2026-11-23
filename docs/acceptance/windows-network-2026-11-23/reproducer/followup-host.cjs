const fs=require('fs'),path=require('path'),v=require('vscode'),{performance:p}=require('perf_hooks');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const view=u=>v.languages.getDiagnostics(u).filter(d=>d.source==='TUFLOW Path Validator').map(d=>({code:d.code,message:d.message,line:d.range.start.line}));
exports.run=async()=>{
 const dir=fs.mkdtempSync(path.join(process.env.TPV_HOST_PARENT,'tpv-followup-'));const output=process.env.TPV_HOST_OUTPUT;
 const r={environment:{pid:process.pid,vscode:v.version,node:process.version},checks:[],samples:{wideEdits:[]},closeEvents:[],snapshots:{},heartbeat:[]};
 const check=(name,passed,detail)=>r.checks.push({name,status:passed?'passed':'failed',detail});
 const wait=async(fn,ms=10000)=>{const t=p.now();while(p.now()-t<ms){if(fn())return true;await pause(25);}return false;};
 const file=(name,text)=>{const f=path.join(dir,name);fs.writeFileSync(f,text);return v.Uri.file(f);};
 const sub=v.workspace.onDidCloseTextDocument(d=>{if(d.fileName.startsWith(dir))r.closeEvents.push(path.basename(d.fileName));});let beat;
 try{
 const u=file('Runtime_v01.tcf','If Scenario == Test\nRead GIS Mat == conditional_missing.shp\nEnd If\nRead GIS Mat == runtime_<<~s1~>>_<<~e1~>>.shp\n');
 let doc=await v.workspace.openTextDocument(u);await v.window.showTextDocument(doc,{preview:false});
 check('firstDiagnostic',await wait(()=>view(u).some(d=>d.code==='TPV001')));r.snapshots.runtime=view(u);
 check('conditionalMissing',view(u).some(d=>d.code==='TPV001'&&d.message.includes('conditional_missing')));
 check('runtimeTokensUnevaluated',!view(u).some(d=>d.code==='TPV001'&&d.message.includes('runtime_')));
 let lines=[];for(let i=0;i<120;i++){file('inc_'+i+'.trd','Read GIS Mat == missing_'+i+'.shp\n');lines.push('Read File == inc_'+i+'.trd');}file('shared.trd','!shared\n');for(let i=0;i<32;i++)lines.push('Read File == shared.trd');lines.push('!wide:A');
 const wide=file('Wide_v01.tcf',lines.join('\n')+'\n');const start=p.now();const wd=await v.workspace.openTextDocument(wide);await v.window.showTextDocument(wd,{preview:false});check('wideFirst',await wait(()=>view(wide).filter(d=>d.code==='TPV002').length===120,20000));r.samples.wideFirstMs=p.now()-start;
 let last=p.now();beat=setInterval(()=>{const n=p.now();r.heartbeat.push(Math.max(0,n-last-10));last=n;},10);
 for(let i=0;i<19;i++){
  await pause(550);const offset=wd.getText().indexOf('!wide:')+6;let events=0;const s=v.languages.onDidChangeDiagnostics(e=>{if(e.uris.some(x=>x.toString()===wide.toString()))events++;});const edit=new v.WorkspaceEdit();edit.replace(wide,new v.Range(wd.positionAt(offset),wd.positionAt(offset+1)),i%2?'A':'B');const t=p.now();await v.workspace.applyEdit(edit);const ok=await wait(()=>events>0);s.dispose();r.samples.wideEdits.push({elapsedMs:p.now()-t,event:ok,childSummaries:view(wide).filter(d=>d.code==='TPV002').length});
 }
 clearInterval(beat);await wd.save();await pause(800);await v.commands.executeCommand('workbench.action.closeAllEditors');await pause(1200);
 r.snapshots.afterTabClose={docClosed:doc.isClosed,wideClosed:wd.isClosed,events:[...r.closeEvents],diagnostics:view(u)};
 const deletion=new v.WorkspaceEdit();deletion.deleteFile(u);deletion.deleteFile(wide);check('deleteThroughEditor',await v.workspace.applyEdit(deletion));
 const closed=await wait(()=>doc.isClosed&&wd.isClosed,6000);await pause(1000);
 r.snapshots.afterDelete={docClosed:doc.isClosed,wideClosed:wd.isClosed,events:[...r.closeEvents],diagnostics:view(u),wideDiagnostics:view(wide)};
 r.actualCloseAcceptance=closed?((view(u).length===0&&view(wide).length===0)?'passed':'failed'):'blocked';
 r.resources={memory:process.memoryUsage(),activeHandlesProxy:process._getActiveHandles().length,activeRequestsProxy:process._getActiveRequests().length};
 }catch(e){r.failure=String(e.stack||e);}finally{clearInterval(beat);sub.dispose();try{await v.commands.executeCommand('workbench.action.closeAllEditors');fs.rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:250});}catch(e){r.cleanupError=String(e);}r.fixturesRemoved=!fs.existsSync(dir);fs.writeFileSync(output,JSON.stringify(r,null,2));}
};
