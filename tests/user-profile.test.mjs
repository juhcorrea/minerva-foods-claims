import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createApiHandler} from '../worker/backend.js';
import {USER_PROFILE_PREFIX,USER_PROFILE_AVATAR_BYTES,USER_PROFILE_BODY_BYTES,readUserProfile,saveUserProfile} from '../worker/user-profile.js';

const require=createRequire(import.meta.url),engine=require('../dist/engine.js');
const origin='https://claims.example.test',epoch=Date.parse('2026-11-16T12:00:00Z');
const tokens={owner:Buffer.alloc(32,31).toString('base64url'),developer:Buffer.alloc(32,32).toString('base64url')};
const hash=value=>createHash('sha256').update(value).digest('hex');
class MemoryBucket{
 objects=new Map();serial=0;conflict=false;beforeGet=null;
 async get(key){await this.beforeGet?.(key);const item=this.objects.get(key);return item?{etag:item.etag,json:async()=>JSON.parse(item.text)}:null;}
 async head(key){const item=this.objects.get(key);return item?{etag:item.etag}:null;}
 async put(key,text,options={}){const old=this.objects.get(key);if(this.conflict&&key.startsWith(USER_PROFILE_PREFIX)){this.conflict=false;return null;}if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const item={etag:'etag-'+(++this.serial),text:String(text),options};this.objects.set(key,item);return{etag:item.etag};}
 async delete(key){this.objects.delete(key);}
}
const environment=()=>({BUCKET:new MemoryBucket(),ADMIN_LINK_HASHES:JSON.stringify([{id:'owner',name:'Admin Example',email:'admin-a@example.test',tokenHash:hash(tokens.owner)},{id:'developer',name:'Technical Example',email:'admin-b@example.test',tokenHash:hash(tokens.developer)}])});
const handler=createApiHandler({engine,now:()=>epoch});
function request(path,cookie,{method='GET',body,headers={},csrf=true}={}){const h=new Headers(headers);if(cookie)h.set('cookie',cookie);if(!['GET','HEAD'].includes(method)&&csrf){h.set('origin',origin);h.set('content-type','application/json');h.set('x-minerva-request','1');}return new Request(origin+path,{method,headers:h,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});}
async function call(env,path,cookie,options={},api=handler){const response=await api(request(path,cookie,options),env);return {status:response.status,body:await response.json(),headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const login=(env,id='owner')=>call(env,'/api/auth/exchange',null,{method:'POST',body:{token:tokens[id]}});
const values=(changes={})=>({name:'Pessoa Exemplo',employeeId:'EX-123',jobTitle:'Analista',department:'Logística',unit:'Unidade Exemplo',avatarDataUrl:'',keepMenuOpen:false,...changes});
const put=(env,cookie,profile=values(),revision=null)=>call(env,'/api/profile/self',cookie,{method:'PUT',body:{revision,profile}});
const profileKeys=env=>[...env.BUCKET.objects.keys()].filter(key=>key.startsWith(USER_PROFILE_PREFIX));
async function member(env,admin,role='viewer'){
 const asked=await call(env,'/api/auth/request',null,{method:'POST',body:{name:'Pessoa '+role,email:role+'@example.test'}});
 await call(env,'/api/members/'+asked.body.userId+'/approve',admin,{method:'POST',body:{}});
 if(role!=='viewer')await call(env,'/api/members/'+asked.body.userId+'/role',admin,{method:'POST',body:{role}});
 return asked;
}
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const jpeg='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,2,255,217]).toString('base64');
const webp='data:image/webp;base64,'+Buffer.from('RIFF\x0c\x00\x00\x00WEBPVP8 \x00\x00\x00\x00','binary').toString('base64');

test('self profile defaults are private, read-only and use the authenticated identity',async()=>{
 const env=environment(),admin=await login(env),before=env.BUCKET.objects.size;
 const result=await call(env,'/api/profile/self',admin.cookie);
 assert.equal(result.status,200);assert.deepEqual(result.body.profile,values({name:'Admin Example',employeeId:'',jobTitle:'',department:'',unit:'',keepMenuOpen:true}));
 assert.deepEqual(result.body.identity,{userId:'owner',email:'admin-a@example.test',role:'admin'});assert.equal(result.body.revision,null);assert.equal(result.body.updatedAt,null);assert.equal(env.BUCKET.objects.size,before);
 assert.match(result.headers.get('cache-control'),/private, no-store/);assert.equal(result.headers.get('access-control-allow-origin'),null);
});

test('saving profile persists across handler instances without mutating authorization or audit names',async()=>{
 const env=environment(),admin=await login(env),acl=env.BUCKET.objects.get('private/access-v3.json').text;
 const saved=await put(env,admin.cookie,values({name:'  Outro Nome  ',avatarDataUrl:png}));
 assert.equal(saved.status,200);assert.equal(saved.body.profile.name,'Outro Nome');assert.equal(saved.body.updatedAt,new Date(epoch).toISOString());assert.match(saved.body.revision,/^[a-f0-9-]{36}$/);
 const fresh=createApiHandler({engine,now:()=>epoch});assert.deepEqual((await call(env,'/api/profile/self',admin.cookie,{},fresh)).body,saved.body);
 assert.equal(env.BUCKET.objects.get('private/access-v3.json').text,acl);
 const session=await call(env,'/api/session',admin.cookie);assert.equal(session.body.name,'Admin Example');assert.equal(session.body.role,'admin');assert.equal(session.body.email,'admin-a@example.test');
 assert.equal(profileKeys(env).length,1);assert.match(profileKeys(env)[0],/^private\/user-profiles-v1\/[a-f0-9]{64}\.json$/);assert(!profileKeys(env)[0].includes('Outro'));assert(!profileKeys(env)[0].includes('example.test'));
 const cleared=await put(env,admin.cookie,values(),saved.body.revision);assert.equal(cleared.status,200);assert.equal(cleared.body.profile.avatarDataUrl,'');
});

test('approved roles can edit only their own profile; anonymous, pending and revoked users cannot',async()=>{
 const env=environment(),admin=await login(env);
 for(const method of ['GET','PUT'])assert.equal((await call(env,'/api/profile/self',null,{method,...(method==='PUT'?{body:{revision:null,profile:values()}}:{})})).status,401);
 const pending=await call(env,'/api/auth/request',null,{method:'POST',body:{name:'Pendente'}});
 assert.equal((await call(env,'/api/profile/self',pending.cookie)).status,403);assert.equal((await put(env,pending.cookie)).status,403);
 for(const role of ['viewer','reviewer','editor','admin']){
  const person=await member(env,admin.cookie,role);const result=await put(env,person.cookie,values({name:'Perfil '+role}));
  assert.equal(result.status,200,role);assert.equal(result.body.identity.role,role);assert.equal((await call(env,'/api/session',person.cookie)).body.name,'Pessoa '+role);
  assert.equal((await call(env,'/api/profile/self?userId=owner',person.cookie)).body.profile.name,'Perfil '+role);
  await call(env,'/api/members/'+person.body.userId,admin.cookie,{method:'DELETE',body:{}});
  assert.equal((await call(env,'/api/profile/self',person.cookie)).status,403);assert.equal((await put(env,person.cookie)).status,403);
 }
 assert.equal((await call(env,'/api/profile/self',admin.cookie)).body.profile.name,'Admin Example');
});

test('profiles are isolated for administrators and members and reject foreign revisions',async()=>{
 const env=environment(),a=await login(env),b=await login(env,'developer'),m=await member(env,a.cookie);
 const first=await put(env,a.cookie,values({name:'Perfil A'}));assert.equal(first.status,200);
 assert.equal((await call(env,'/api/profile/self',b.cookie)).body.profile.name,'Desenvolvimento');
 assert.equal((await put(env,b.cookie,values({name:'Perfil B'}),first.body.revision)).status,409);
 assert.equal((await put(env,b.cookie,values({name:'Perfil B'}))).status,200);
 assert.equal((await put(env,m.cookie,values({name:'Perfil C'}))).status,200);assert.equal(profileKeys(env).length,3);
 assert.equal((await call(env,'/api/profile/self',a.cookie)).body.profile.name,'Perfil A');assert.equal((await call(env,'/api/profile/self',b.cookie)).body.profile.name,'Perfil B');assert.equal((await call(env,'/api/profile/self',m.cookie)).body.profile.name,'Perfil C');
});

test('profile writes require origin, application headers and exact allowlists',async()=>{
 const env=environment(),admin=await login(env),body={revision:null,profile:values()};
 for(const headers of [{},{origin,'content-type':'application/json'},{origin:'https://evil.example','content-type':'application/json','x-minerva-request':'1'}])assert.equal((await call(env,'/api/profile/self',admin.cookie,{method:'PUT',body,headers,csrf:false})).status,403);
 for(const field of ['email','role','id','userId','approved','identity']){
  assert.equal((await put(env,admin.cookie,{...values(),[field]:'admin'})).status,400,field);
  assert.equal((await call(env,'/api/profile/self',admin.cookie,{method:'PUT',body:{...body,[field]:'admin'}})).status,400,field);
 }
 for(const malformed of [{profile:values()},{revision:undefined,profile:values()},{revision:'',profile:values()},{revision:3,profile:values()},{revision:null,profile:{}},{revision:null,profile:null}])assert.equal((await call(env,'/api/profile/self',admin.cookie,{method:'PUT',body:malformed})).status,400);
 assert.equal(profileKeys(env).length,0);
 for(const method of ['POST','DELETE','PATCH'])assert.equal((await call(env,'/api/profile/self',admin.cookie,{method,body:{}})).status,405);
});

test('invalid labels, preference types and oversized bodies cannot replace the profile',async()=>{
 const env=environment(),admin=await login(env),first=await put(env,admin.cookie);
 for(const patch of [{name:''},{name:'A'},{name:'x'.repeat(161)},{employeeId:5},{employeeId:'x'.repeat(81)},{jobTitle:'x'.repeat(121)},{department:'x\u0000y'},{unit:'x\ny'},{keepMenuOpen:'false'},{avatarDataUrl:null}])assert.equal((await put(env,admin.cookie,values(patch),first.body.revision)).status,400);
 const oversized=await call(env,'/api/profile/self',admin.cookie,{method:'PUT',body:' '.repeat(USER_PROFILE_BODY_BYTES+1)});assert.equal(oversized.status,413);
 assert.deepEqual((await call(env,'/api/profile/self',admin.cookie)).body,first.body);
});

test('avatars accept only bounded canonical JPEG PNG WebP data URLs and reject SVG or mismatched bytes',async()=>{
 const env=environment(),admin=await login(env);let revision=null;
 for(const avatarDataUrl of [png,jpeg,webp,'']){const saved=await put(env,admin.cookie,values({avatarDataUrl}),revision);assert.equal(saved.status,200);revision=saved.body.revision;}
 const oversized=Buffer.alloc(USER_PROFILE_AVATAR_BYTES+1);oversized.set([255,216,255]);oversized.set([255,217],oversized.length-2);
 for(const avatarDataUrl of ['https://example.test/avatar.png','data:image/svg+xml;base64,'+Buffer.from('<svg></svg>').toString('base64'),png.replace('image/png','image/jpeg'),'data:image/png;base64,AAAA','data:image/png;base64,A===',png+'\n','data:image/jpeg;base64,'+oversized.toString('base64')])assert.equal((await put(env,admin.cookie,values({avatarDataUrl}),revision)).status,400,avatarDataUrl.slice(0,60));
 assert.equal((await call(env,'/api/profile/self',admin.cookie)).body.profile.avatarDataUrl,'');
});

test('revision and conditional write conflicts preserve the existing document',async()=>{
 const env=environment(),admin=await login(env),first=await put(env,admin.cookie);
 assert.equal((await put(env,admin.cookie,values({name:'Perdido'}),null)).status,409);
 env.BUCKET.conflict=true;const clash=await put(env,admin.cookie,values({name:'Concorrente'}),first.body.revision);assert.equal(clash.status,409);assert.equal(clash.body.code,'PROFILE_CHANGED');
 assert.deepEqual((await call(env,'/api/profile/self',admin.cookie)).body,first.body);
});

test('permission is rechecked after reading the profile and before writing',async()=>{
 const env=environment(),admin=await login(env),person=await member(env,admin.cookie);
 env.BUCKET.beforeGet=async key=>{if(!key.startsWith(USER_PROFILE_PREFIX))return;env.BUCKET.beforeGet=null;const acl=env.BUCKET.objects.get('private/access-v3.json'),value=JSON.parse(acl.text);value.members[person.body.userId].status='revoked';acl.text=JSON.stringify(value);};
 const result=await put(env,person.cookie);assert.equal(result.status,403);assert.equal(result.body.code,'PERMISSION_CHANGED');assert.equal(profileKeys(env).length,0);
});

test('corrupt or wrongly attributed stored documents fail closed',async()=>{
 const env=environment(),admin=await login(env);await put(env,admin.cookie);const key=profileKeys(env)[0],item=env.BUCKET.objects.get(key),saved=JSON.parse(item.text);
 for(const patch of [{schemaVersion:2},{principalHash:'wrong'},{revision:null},{updatedAt:'yesterday'},{profile:{...values(),role:'admin'}},{profile:values({avatarDataUrl:'data:image/svg+xml;base64,AAAA'})}]){item.text=JSON.stringify({...saved,...patch});const result=await call(env,'/api/profile/self',admin.cookie);assert.equal(result.status,503);assert.equal(result.body.code,'PROFILE_STORAGE_INVALID');}
 item.text='not json';assert.equal((await call(env,'/api/profile/self',admin.cookie)).status,503);
});

test('storage module has no unauthenticated or unapproved fallback and calls validation once',async()=>{
 const bucket=new MemoryBucket();for(const access of [{},{authenticated:true,approved:false,member:{id:'x'}}])await assert.rejects(()=>readUserProfile(bucket,access),{status:403});
 let checks=0;const access={authenticated:true,approved:true,role:'viewer',member:{id:'member-a',name:'Viewer'}};
 await saveUserProfile(bucket,access,{revision:null,profile:values()},{validate:async()=>{checks++;},now:()=>epoch});assert.equal(checks,1);
});
