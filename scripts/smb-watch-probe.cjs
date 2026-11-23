// Run in a disposable, isolated VS Code Extension Host; never point at a model.
const fs = require('fs'), path = require('path'), v = require('vscode');
const pause = ms => new Promise(r => setTimeout(r, ms));
exports.run = async () => {
 const dir = fs.mkdtempSync(path.join(process.env.TPV_PARENT, 'probe-'));
 const r = {time: new Date().toISOString(), fixture: dir, vscode: v.version, node: process.version,
  workspace: v.workspace.workspaceFolders?.map(x => x.uri.toString()) || [], registrations: [], events: [], snapshots: [], resources: []};
 const watchers = [], listeners = [];
 const snap = label => r.resources.push({label, time: new Date().toISOString(), cpu: process.cpuUsage(), memory: process.memoryUsage(), handlesProxy: process._getActiveHandles().length});
 try {
  fs.writeFileSync(path.join(dir, 'geom_v01.tgc'), '!clean\n');
  fs.writeFileSync(path.join(dir, 'Run_v01.tcf'), 'Geometry Control File == geom_v01.tgc\n');
  const u = v.Uri.file(path.join(dir, 'Run_v01.tcf'));
  const view = () => v.languages.getDiagnostics(u).map(d => ({code: typeof d.code === 'object' ? d.code.value : d.code, message: d.message}));
  await v.window.showTextDocument(await v.workspace.openTextDocument(u), {preview: false});
  const ext = v.extensions.getExtension('Chain-Frost.tuflow-path-validator');
  await ext.activate(); r.extensionPath = ext.extensionPath;
  // Sequential requests avoid letting a successful recursive watcher feed a
  // failing nonrecursive watcher through VS Code's global uncorrelated stream.
  for (const pattern of (process.env.TPV_SIMPLE_ONLY ? ['string-star'] : ['string-star', 'uri-star', 'uri-recursive'])) {
   const glob = pattern === 'uri-recursive' ? '**/*' : '*';
   const base = pattern === 'string-star' ? dir : v.Uri.file(dir);
   r.registrations.push({pattern, base: String(base), glob, time: new Date().toISOString()});
   const w = v.workspace.createFileSystemWatcher(new v.RelativePattern(base, glob)); watchers.push(w);
   const ls = ['Create', 'Change', 'Delete'].map(kind => w['onDid' + kind](uri => r.events.push({pattern, kind, uri: uri.toString(), time: new Date().toISOString()})));
   listeners.push(...ls); await pause(2000); snap(pattern + '-before');
   try {const nw = fs.watch(dir, (kind, name) => r.events.push({pattern, native: true, kind, name})); nw.on('error', e => {r.events.push({pattern, nativeError: String(e)});}); watchers.push({dispose: () => nw.close()});} catch(e) {r.events.push({pattern, nativeError: String(e)});}
   for (let cycle = 0; cycle < 2; cycle++) {
    for (const action of ['create', 'rename-away', 'rename-back', 'delete']) {
     const before = r.events.length, start = Date.now();
     const sibling = path.join(dir, 'geom_v02.tgc'), other = path.join(dir, 'other.txt');
     if(process.env.TPV_SIMPLE_ONLY) {
      require('child_process').execFileSync(process.env.TPV_MUTATION_NODE, ['-e', "const fs=require('fs');const [a,s,o]=process.argv.slice(1);if(a==='create')fs.writeFileSync(s,'!new\\n');if(a==='rename-away')fs.renameSync(s,o);if(a==='rename-back')fs.renameSync(o,s);if(a==='delete')fs.unlinkSync(s);", action, sibling, other], {windowsHide: true});
      r.mutationsInSeparateProcess = true;
     } else {
      if (action === 'create') fs.writeFileSync(sibling, '!new\n');
      if (action === 'rename-away') fs.renameSync(sibling, other);
      if (action === 'rename-back') fs.renameSync(other, sibling);
      if (action === 'delete') fs.unlinkSync(sibling);
     }
     await pause(900);
     r.snapshots.push({pattern, cycle, action, time: new Date().toISOString(), elapsedMs: Date.now()-start, apiEvents: r.events.slice(before).filter(e => e.pattern === pattern && e.uri), diagnostics: view()});
    }
   }
   snap(pattern + '-after'); ls.forEach(x => x.dispose()); w.dispose(); await pause(1000);
  }
  // Explicit reanalysis is a diagnostic-computation control only.
  fs.writeFileSync(path.join(dir, 'geom_v02.tgc'), '!new\n'); await pause(1000);
  r.beforeExplicitRefresh = view();
  await v.workspace.getConfiguration('tuflowValidator').update('diagnosticLevel', 'warning', v.ConfigurationTarget.Global);
  await pause(800); r.afterExplicitRefresh = view();
 } catch(e) {r.error = String(e.stack || e);} finally {
  listeners.forEach(x => x.dispose()); watchers.forEach(x => x.dispose());
  await v.commands.executeCommand('workbench.action.closeAllEditors');
  fs.rmSync(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  r.fixtureRemoved = !fs.existsSync(dir); snap('disposed');
  fs.writeFileSync(process.env.TPV_OUTPUT, JSON.stringify(r, null, 2));
 }
};
