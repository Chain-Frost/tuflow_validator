const fs = require('fs'), path = require('path'), v = require('vscode');
const pause = ms => new Promise(r => setTimeout(r, ms));
exports.run = async () => {
 const dir = fs.mkdtempSync(path.join(process.env.TPV_PARENT, 'depth-'));
 const events = [], owned = [];
 const r = {fixture: dir, time: new Date().toISOString(), events, registrations: [], vscode: v.version};
 try {
  fs.mkdirSync(path.join(dir, 'unrelated/deep'), {recursive: true});
  for(const pattern of ['**/*', '*/unmatchable-control-file.tgc']) {
   const w = v.workspace.createFileSystemWatcher(new v.RelativePattern(v.Uri.file(dir), pattern));
   owned.push(w, w.onDidCreate(u => events.push({pattern, uri: u.toString(), time: new Date().toISOString()})));
   r.registrations.push({pattern, time: new Date().toISOString()});
  }
  await pause(2000);
  fs.writeFileSync(path.join(dir, 'unrelated/deep/unreferenced.txt'), '!disposable\n');
  await pause(1200);
  try {
   const nw = fs.watch(dir, {recursive: true}, (event, name) => events.push({nativeRecursive: true, event, name}));
   owned.push({dispose: () => nw.close()}); nw.on('error', e => {r.nativeRecursiveError = String(e);});
  } catch(e) {r.nativeRecursiveError = String(e);}
  await pause(1200);
 } catch(e) {r.error = String(e.stack || e);} finally {
  owned.forEach(x => x.dispose()); await pause(500);
  fs.rmSync(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  r.fixtureRemoved = !fs.existsSync(dir);
  fs.writeFileSync(process.env.TPV_OUTPUT, JSON.stringify(r, null, 2));
 }
};
