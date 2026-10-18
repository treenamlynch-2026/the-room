/** Run against an isolated MOCK_AGENTS=1 server, never a user's working data. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const origin='http://127.0.0.1:3107';
const results=[];
const write=(route,body,extra={})=>fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
async function check(name,fn){await fn();results.push({name,passed:true});console.log('PASS '+name);}
(async()=>{
const health=await (await fetch(origin+'/api/health')).json();assert.equal(health.mock,true,'Only run on mock server');
await check('foreign Origin text/plain POST rejected without creating project',async()=>{
  const res=await write('/api/projects',{name:'must-not-exist'},{Origin:'https://evil.example','Content-Type':'text/plain'});assert.equal(res.status,403);
});
await check('foreign Host read rejected (rebinding defense)',async()=>{
  const status=await new Promise((resolve,reject)=>{const r=http.get(origin+'/api/projects',{headers:{Host:'evil.example:3107'}},s=>{s.resume();resolve(s.statusCode)});r.on('error',reject)});
  assert.equal(status,403);
});
await check('missing Origin and text/plain same-origin writes rejected',async()=>{
  let r=await fetch(origin+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"name":"no-origin"}'});assert.equal(r.status,403);
  r=await write('/api/projects',{name:'bad-type'},{'Content-Type':'text/plain'});assert.equal(r.status,403);
});
let pid;
await check('normal project creation still works',async()=>{const r=await write('/api/projects',{name:'Security regression scratch'});assert.equal(r.status,200);pid=(await r.json()).id;});
await check('encoded traversal upload rejected',async()=>{
  const fd=new FormData();fd.append('file',new Blob(['harmless']),'probe.txt');
  const r=await fetch(origin+'/api/projects/..%2F..%2Ftrav/files',{method:'POST',headers:{Origin:origin},body:fd});assert.equal(r.status,400);
});
await check('unknown project upload rejected',async()=>{
  const fd=new FormData();fd.append('file',new Blob(['harmless']),'probe.txt');
  const r=await fetch(origin+'/api/projects/11111111-1111-4111-8111-111111111111/files',{method:'POST',headers:{Origin:origin},body:fd});assert.equal(r.status,404);
});
await check('HTML upload is attachment with sandbox, not an active page',async()=>{
  const fd=new FormData();fd.append('file',new Blob(['<!doctype html><script>window.harmlessProbe=true</script>'],{type:'text/html'}),'probe.html');
  const r=await fetch(origin+`/api/projects/${pid}/files`,{method:'POST',headers:{Origin:origin},body:fd});assert.equal(r.status,200);
  const id=(await r.json()).files[0].id;
  const file=await fetch(origin+'/api/files/'+id);assert.equal(file.status,200);
  assert.equal(file.headers.get('content-type'),'application/octet-stream');assert.match(file.headers.get('content-disposition'),/^attachment/);
  assert.equal(file.headers.get('x-content-type-options'),'nosniff');assert.match(file.headers.get('content-security-policy'),/sandbox/);await file.text();
});
await check('image upload keeps safe server-decoded preview usable',async()=>{
  const png=await require('sharp')({create:{width:1,height:1,channels:3,background:'#000000'}}).png().toBuffer();
  const fd=new FormData();fd.append('file',new Blob([png],{type:'image/png'}),'plain-pixel.png');
  const r=await fetch(origin+`/api/projects/${pid}/files`,{method:'POST',headers:{Origin:origin},body:fd});assert.equal(r.status,200);
  const id=(await r.json()).files[0].id;const file=await fetch(origin+'/api/files/'+id);
  assert.equal(file.headers.get('content-type'),'image/webp');assert.match(file.headers.get('content-disposition'),/^inline/);await file.arrayBuffer();
});
const fixture=path.join(__dirname,'..','.security-test','plain-test.mp4');
if(fs.existsSync(fixture))await check('plain test video is processed in mock mode without transcription calls',async()=>{
  const fd=new FormData();fd.append('file',new Blob([fs.readFileSync(fixture)],{type:'video/mp4'}),'plain-test.mp4');
  const r=await fetch(origin+`/api/projects/${pid}/files`,{method:'POST',headers:{Origin:origin},body:fd});
  assert.equal(r.status,200);const b=await r.json();assert.equal(b.files[0].kind,'video');assert.match(b.files[0].note,/frames/);
});
await check('two-model mock message completes and persists',async()=>{
  const r=await write(`/api/projects/${pid}/send`,{content:'Harmless security regression check.',agents:['chatgpt','claude']});assert.equal(r.status,200);await r.text();
  const s=await (await fetch(origin+'/api/projects/'+pid)).json();const answers=s.messages.filter(m=>m.author==='claude'||m.author==='chatgpt');assert.equal(answers.length,2);assert.ok(answers.every(m=>m.status==='complete'));
  const approve=await fetch(origin+'/api/messages/'+answers[0].id,{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"approved":true}'});
  assert.equal(approve.status,200);assert.equal((await approve.json()).approvedBy,'Human');
});
await check('human Canon and Decision controls still work',async()=>{
  assert.equal((await write(`/api/projects/${pid}/canon`,{title:'Human rule',body:'Harmless',priority:2})).status,200);
  assert.equal((await write(`/api/projects/${pid}/decisions`,{text:'Human decision'})).status,200);
});
await check('mock reply preserves automatic plain-text saving',async()=>{
  const before=await (await fetch(origin+'/api/projects/'+pid)).json();
  const r=await write(`/api/projects/${pid}/send`,{content:'[[DECISION: automatic mock decision]]',agents:['claude']});assert.equal(r.status,200);await r.text();
  const after=await (await fetch(origin+'/api/projects/'+pid)).json();
  assert.equal(after.decisions.length,before.decisions.length+1);assert.ok(after.decisions.some(d=>d.text==='automatic mock decision'));
});
await check('inline code directive echoed by mock reply cannot save a decision',async()=>{
  const before=await (await fetch(origin+'/api/projects/'+pid)).json();
  const r=await write(`/api/projects/${pid}/send`,{content:'Example: `[[DECISION: quoted mock example]]`',agents:['claude']});assert.equal(r.status,200);await r.text();
  const after=await (await fetch(origin+'/api/projects/'+pid)).json();assert.equal(after.decisions.length,before.decisions.length);
});
await check('cross-origin reset rejected, local reset works, diagnostics omit key characters',async()=>{
  assert.equal((await write('/api/reset',{abort:true},{Origin:'https://evil.example'})).status,403);
  const r=await write('/api/reset',{probe:false});assert.equal(r.status,200);const b=await r.json();assert.equal(b.keys.chatgpt.tail,null);assert.equal(b.keys.claude.tail,null);
});
fs.writeFileSync(path.join(__dirname,'..','.security-test','http-results.json'),JSON.stringify({mock:true,results},null,2));
console.log(`${results.length} HTTP checks passed; no provider calls made.`);
})().catch(e=>{console.error(e);process.exitCode=1});
