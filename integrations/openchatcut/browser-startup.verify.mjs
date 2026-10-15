import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const source=JSON.parse(readFileSync('.cache/openchatcut-runtime.json','utf8')).source;
const require=createRequire(path.join(source,'package.json'));
const renderer=path.dirname(require.resolve('@remotion/renderer'));
const {makeBrowserRunner}=require(path.join(renderer,'browser/BrowserRunner.js'));
const base=path.resolve('.cache/video-editor-qa/browser-startup');mkdirSync(base,{recursive:true});
const dir=mkdtempSync(path.join(base,'run-')),pidFile=path.join(dir,'pid');
const script=path.join(dir,'slow-browser.cjs');
writeFileSync(script,`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
let pid;
try {
  await assert.rejects(makeBrowserRunner({executablePath:process.execPath,processArguments:[script],userDataDir:dir,logLevel:'error',indent:false,timeout:2000}),/Timed out/);
  pid=Number(readFileSync(pidFile,'utf8'));
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},'a failed browser launch must not leave its process running');
  console.log('Browser startup timeout cleans up the spawned process');
} finally {
  if(!pid){try{pid=Number(readFileSync(pidFile,'utf8'));}catch{}}
  if(pid){try{process.kill(pid);}catch{}}
}
