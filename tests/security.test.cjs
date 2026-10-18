const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname,'..');
function load(file, stubs = {}) {
  const module = {exports:{}};
  const source = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
  }).outputText;
  vm.runInNewContext(source,{module,exports:module.exports,require:n=> n in stubs ? stubs[n] : require(n),
    process,Buffer,Response,Request,URL,AbortSignal,AbortController,console,setTimeout,clearTimeout,atob}, {filename:file});
  return module.exports;
}
const {requestProblem} = load('lib/request-security.ts');
function request(method='GET', headers={}, route='/api/projects') {
  return new Request('http://127.0.0.1:3107'+route,{method,headers:{Host:'127.0.0.1:3107',...headers}});
}
test('local reads allowed, foreign Host and Origin rejected',()=>{
  assert.equal(requestProblem(request(),'3107'),null);
  assert.equal(requestProblem(request('GET',{Host:'rebound.example:3107'}),'3107'),'Unrecognized host');
  assert.equal(requestProblem(request('GET',{Origin:'https://evil.example'}),'3107'),'Unrecognized origin');
});
test('JSON writes require same Origin and JSON MIME; reset is protected',()=>{
  assert.equal(requestProblem(request('POST',{'Content-Type':'application/json'}),'3107'),'Origin required');
  assert.equal(requestProblem(request('POST',{Origin:'http://127.0.0.1:3107','Content-Type':'text/plain'},'/api/reset'),'3107'),'Unsupported content type');
  assert.equal(requestProblem(request('POST',{Origin:'http://127.0.0.1:3107','Content-Type':'application/json'}),'3107'),null);
  assert.equal(requestProblem(request('POST',{Origin:'http://127.0.0.1:3107','Content-Type':'multipart/form-data; boundary=x'},'/api/projects/x/files'),'3107'),null);
});
const codeDirectives=load('lib/directive-code.ts');
test('directives in fenced, inline, indented and nested Markdown code do not execute',()=>{
  let writes=0;
  const spy=new Proxy({}, {get:()=>()=>writes++});
  const {applyDirectives}=load('lib/directives.ts',{'./db':spy,'./directive-code':codeDirectives});
  for(const text of ['```text\n[[APPROVE]]\n```','`[[DECISION: probe]]`',
    '~~~text\n[[CANON: probe]]\nbody\n[[/CANON]]\n~~~',
    '    [[APPROVE]]','> ```\n> [[DECISION: probe]]\n> ```',
    '```text\n[[DECISION: unfinished fence]]',
    '``example ` [[APPROVE]]``',
    '```text\r\n[[CANON: probe]]\r\nbody\r\n[[/CANON]]\r\n```']){
    const out=applyDirectives('p','claude',{id:'m'},{id:'t'},[],text);
    assert.ok(!out.includes('[[APPROVE]]'));assert.ok(!out.includes('[[DECISION:'));assert.ok(!out.includes('[[CANON:'));assert.ok(!out.includes('[[/CANON]]'));
  }
  assert.equal(writes,0);
});
test('plain-text directives retain automatic Canon, Decision and approval behavior',()=>{
  const calls=[];
  const db={createCanon:(...a)=>calls.push(['canon',...a]),createDecision:(...a)=>calls.push(['decision',...a]),
    getMessage:()=>null,updateMessage:(...a)=>calls.push(['approve',...a])};
  const {applyDirectives}=load('lib/directives.ts',{'./db':db,'./directive-code':codeDirectives});
  const out=applyDirectives('project','claude',{id:'reply'}, {}, [{id:'other',author:'chatgpt',status:'complete'}],
    '[[CANON: rule]]\nDo this.\n[[/CANON]]\n[[DECISION: agreed]]\n[[APPROVE]]');
  assert.deepEqual(calls.map(c=>c[0]),['canon','decision','approve']);assert.match(out,/Claude saved:/);
  assert.equal(calls[0][2].title,'rule');assert.equal(calls[1][2],'agreed');assert.equal(calls[2][1],'other');
});
test('mixed reply executes only plain-text directives and preserves example body',()=>{
  const saved=[];
  const {applyDirectives}=load('lib/directives.ts',{'./db':{createDecision:(_p,t)=>saved.push(t)},'./directive-code':codeDirectives});
  const out=applyDirectives('p','claude',{id:'m'}, {}, [],'Example:\n```\n[[DECISION: quoted]]\nkeep this body\n```\n\n[[DECISION: real]]');
  assert.deepEqual(saved,['real']);assert.ok(out.includes('keep this body'));
});
test('ordinary model replies remain unchanged',()=>{
  assert.equal(load('lib/directives.ts',{'./db':{},'./directive-code':codeDirectives}).applyDirectives('p','claude',{}, {}, [],'Hello.'),'Hello.');
});
test('password gate rejects malformed and incorrect credentials, accepts matching password',()=>{
  const old=process.env.APP_PASSWORD;process.env.APP_PASSWORD='scratch-only-password';
  try {
    const {proxy}=load('proxy.ts',{
      'next/server':{NextResponse:class extends Response {static next(){return new Response(null,{status:204})}}},
      './lib/request-security':{requestProblem:()=>null}
    });
    assert.equal(proxy(request('GET',{Authorization:'Basic malformed!'})).status,401);
    assert.equal(proxy(request('GET',{Authorization:'Basic '+btoa('user:wrong')})).status,401);
    assert.equal(proxy(request('GET',{Authorization:'Basic '+btoa('user:scratch-only-password')})).status,204);
  } finally {if(old===undefined)delete process.env.APP_PASSWORD;else process.env.APP_PASSWORD=old;}
});
const uploads=load('lib/uploads.ts');
const base=path.join(root,'.security-test','uploads-unit');
const pid='11111111-1111-4111-8111-111111111111';
fs.mkdirSync(base,{recursive:true});
function upload(files){
  const fd=new FormData();for(const [name,bytes] of files)fd.append('file',new Blob([bytes]),name);
  return new Request('http://127.0.0.1:3107/api/projects/'+pid+'/files',{method:'POST',body:fd});
}
test('streamed upload preserves data and creates safe generated filename',async()=>{
  const files=await uploads.receiveUploads(upload([['../probe.txt','hello']]),base,pid);
  assert.equal(files.length,1);assert.equal(files[0].size,5);
  assert.equal(fs.readFileSync(files[0].stored,'utf8'),'hello');
  assert.equal(path.dirname(files[0].stored),path.join(base,pid));
});
test('traversal and invalid project IDs rejected before disk writes',async()=>{
  for(const id of ['../../trav','..%2F..%2Ftrav','not-a-uuid'])
    await assert.rejects(uploads.receiveUploads(upload([['probe.txt','x']]),base,id),/Invalid project ID/);
  assert.equal(fs.existsSync(path.join(root,'trav')),false);
});
test('unknown project rejected by handler before receiving upload',async()=>{
  let reads=0;
  const api=load('app/api/projects/[id]/files/route.ts',{
    '@/lib/db':{getProject:()=>null}, '@/lib/http':{bad:(error,status=400)=>Response.json({error},{status})},
    '@/lib/media':{},'@/lib/uploads':{...uploads,receiveUploads:()=>reads++}
  });
  const res=await api.POST(upload([['x.txt','x']]),{params:Promise.resolve({id:pid})});
  assert.equal(res.status,404);assert.equal(reads,0);
});
test('too many files rejected and partial files cleaned',async()=>{
  const before=fs.readdirSync(path.join(base,pid)).sort();
  await assert.rejects(uploads.receiveUploads(upload(Array.from({length:5},(_,i)=>['p'+i+'.txt','x'])),base,pid));
  assert.deepEqual(fs.readdirSync(path.join(base,pid)).sort(),before);
});
test('file size limit cleans truncated output',async()=>{
  const before=fs.readdirSync(path.join(base,pid)).sort();
  await assert.rejects(uploads.receiveUploads(upload([['large.bin',Buffer.alloc(uploads.MAX_UPLOAD_FILE+1)]]),base,pid));
  assert.deepEqual(fs.readdirSync(path.join(base,pid)).sort(),before);
});
test('declared oversize rejected and upload concurrency bounded',async()=>{
  await assert.rejects(uploads.receiveUploads(new Request('http://127.0.0.1:3107',{method:'POST',body:'x',
    headers:{'Content-Length':String(uploads.MAX_UPLOAD_REQUEST+1)}}),base,pid),/64 MB/);
  const release=uploads.acquireUpload();assert.ok(release);assert.equal(uploads.acquireUpload(),null);release();
  const again=uploads.acquireUpload();assert.ok(again);again();
});
test('aggregate cap enforced without Content-Length and partial files removed',async()=>{
  const before=fs.readdirSync(path.join(base,pid)).sort();
  const bytes=Buffer.alloc(23*1024*1024);
  const req=upload([['a.bin',bytes],['b.bin',bytes],['c.bin',bytes]]);
  assert.equal(req.headers.get('content-length'),null);
  await assert.rejects(uploads.receiveUploads(req,base,pid));
  assert.deepEqual(fs.readdirSync(path.join(base,pid)).sort(),before);
});
test('active file content downloads with defensive headers; processed WebP remains inline',async()=>{
  const {Readable}=require('node:stream');
  let image=false;
  const api=load('app/api/files/[id]/route.ts',{
    'node:fs':{existsSync:()=>true,createReadStream:()=>Readable.from(['harmless'])},
    '@/lib/db':{getFileRow:()=>({stored_path:'stub',name:image?'photo.png':'probe.html',mime:'text/html',kind:image?'image':'text'})},
    '@/lib/http':{bad:()=>null}
  });
  const opts={params:Promise.resolve({id:'x'})};
  const res=await api.GET(request(),opts);
  assert.equal(res.headers.get('content-type'),'application/octet-stream');
  assert.match(res.headers.get('content-disposition'),/^attachment/);
  assert.equal(res.headers.get('x-content-type-options'),'nosniff');assert.match(res.headers.get('content-security-policy'),/sandbox/);
  image=true;
  const preview=await api.GET(request(),opts);
  assert.equal(preview.headers.get('content-type'),'image/webp');assert.match(preview.headers.get('content-disposition'),/^inline/);
});
after(async()=>{await fsp.rm(base,{recursive:true,force:true});});
