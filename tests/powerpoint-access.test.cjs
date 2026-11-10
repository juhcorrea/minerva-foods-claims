'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/powerpoint.js'),'utf8');
// Run the actual download and access checks; only deck generation and DOM download are mocked.
const access=source.slice(source.indexOf('  function cancelled()'),source.indexOf('  function imageData('));
const download=source.slice(source.indexOf('  async function download('),source.indexOf('  const api={revision:'));
function harness(sessions,{onWrite}={}){
 const calls=[],downloads=[];let writes=0;
 const document={body:{append(){}},createElement(){return{style:{},click(){downloads.push(this.download);},remove(){}};}};
 const context={generation:0,global:{MINERVA_HOSTED:true,document,fetch:async(url,options)=>{calls.push({url,options});const session=sessions[Math.min(calls.length-1,sessions.length-1)];return{ok:true,json:async()=>session};}},document,URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}},setTimeout(){},officialLogo:async()=>null,officialCover:async()=>null,buildResults:()=>({write:async()=>{writes++;onWrite?.(context);return{};}}),IDS:['summary'],EXPORT_REVISION:'synthetic'};
 vm.createContext(context);vm.runInContext(access+download,context);
 return{calls,downloads,get writes(){return writes;},run:()=>context.download({data:{},visualIds:['summary'],year:2026,month:1},'results')};
}
for(const role of ['admin','editor','reviewer','viewer'])test('approved '+role+' can export PowerPoint without a write permission or mutation',async()=>{
 const h=harness([{approved:true,role}]);const result=await h.run();assert.equal(h.writes,1);assert.equal(h.downloads.length,1);assert.equal(result.slideCount,1);assert.equal(h.calls.length,2);assert(h.calls.every(call=>call.url==='/api/session'&&call.options.credentials==='same-origin'&&!call.options.method));
});
test('unapproved reviewer cannot generate or download a PowerPoint',async()=>{
 const h=harness([{approved:false,role:'reviewer'}]);await assert.rejects(h.run,/acesso mudou/);assert.equal(h.writes,0);assert.equal(h.downloads.length,0);
});
test('reviewer access revoked during generation prevents the final download',async()=>{
 const h=harness([{approved:true,role:'reviewer'},{approved:false,role:'reviewer'}]);await assert.rejects(h.run,/acesso mudou/);assert.equal(h.writes,1);assert.equal(h.downloads.length,0);
});
test('session generation change during PowerPoint creation cancels the download',async()=>{
 const h=harness([{approved:true,role:'reviewer'}],{onWrite:context=>context.generation++});await assert.rejects(h.run,/acesso mudou/);assert.equal(h.downloads.length,0);assert.equal(h.calls.length,1);
});
