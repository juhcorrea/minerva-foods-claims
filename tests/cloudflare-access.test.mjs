import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {cloudflareAccessConfig,createCloudflareAccessVerifier} from '../worker/cloudflare-access.js';
import {createApiHandler} from '../worker/backend.js';
import {createD1Bucket} from '../worker/d1-store.js';

const require=createRequire(import.meta.url),engine=require('../dist/engine.js');
const issuer='https://qa-team.cloudflareaccess.com',origin='https://claims.example.test',domain='corp.example';
const epoch=Date.parse('2026-11-10T12:00:00Z'),seconds=epoch/1000;
const adminEntries=[{id:'owner',email:'admin-a@'+domain},{id:'developer',email:'admin-b@'+domain}];
const configuration=()=>({AUTH_MODE:'cloudflare-access',CF_ACCESS_TEAM_DOMAIN:issuer,CF_ACCESS_AUD:'qa-application-audience',ALLOWED_EMAIL_DOMAIN:domain,CF_ACCESS_ADMIN_IDENTITIES:JSON.stringify(adminEntries)});
const pair=()=>crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const [firstKey,secondKey]=await Promise.all([pair(),pair()]);
const jwk=async(key,kid)=>({...await crypto.subtle.exportKey('jwk',key.publicKey),alg:'RS256',use:'sig',kid});
const firstJwk=await jwk(firstKey,'first'),secondJwk=await jwk(secondKey,'second');
const encode=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
const claims=(changes={})=>({iss:issuer,aud:['qa-application-audience'],sub:'qa-employee-one',email:'employee@'+domain,type:'app',iat:seconds-10,nbf:seconds-10,exp:seconds+3600,...changes});
async function signed(changes={},headerChanges={},key=firstKey){const content=encode({alg:'RS256',typ:'JWT',kid:'first',...headerChanges})+'.'+encode(claims(changes));const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,new TextEncoder().encode(content));return content+'.'+Buffer.from(signature).toString('base64url');}
const tokenRequest=token=>new Request(origin,{headers:token?{'Cf-Access-Jwt-Assertion':token}:{}});
const keyResponse=keys=>Response.json({keys});
function verifierFixture(){let clock=epoch,currentKeys=[firstJwk],fail=false;const requests=[];const verify=createCloudflareAccessVerifier({now:()=>clock,fetcher:async(url,options)=>{requests.push({url,options});if(fail)throw new Error('Unavailable');return keyResponse(currentKeys);}});return {verify,requests,config:cloudflareAccessConfig(configuration()),setKeys:value=>currentKeys=value,setClock:value=>clock=value,setFailure:value=>fail=value};}

test('Access accepts only configured RS256 identity, verifies email domain and ignores untrusted headers',async()=>{
 const f=verifierFixture(),token=await signed();
 const request=new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':token,'Cf-Access-Authenticated-User-Email':'admin-a@'+domain,'X-Forwarded-Email':'admin-b@'+domain}});
 const identity=await f.verify(request,f.config);
 assert.equal(identity.email,'employee@'+domain);assert.equal(identity.subject,'qa-employee-one');assert.equal(identity.provider,'cloudflare-access');assert.equal(identity.issuer,issuer);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,issuer+'/cdn-cgi/access/certs');assert.equal(f.requests[0].options.redirect,'manual');
 assert.equal(await f.verify(tokenRequest(null),f.config),null);
 await f.verify(tokenRequest(token),f.config);assert.equal(f.requests.length,1,'Only public signing keys are cached');
});

test('Access JWKS fetch works with Workers redirect modes and the public Cloudflare key shape',async()=>{
 const requests=[],config=cloudflareAccessConfig(configuration());
 const publicKeyShape=key=>Object.fromEntries(['kid','kty','alg','use','e','n'].map(field=>[field,key[field]]));
 const verify=createCloudflareAccessVerifier({now:()=>epoch,fetcher:async(url,options)=>{
  // Node accepts redirect:error, but Workers throws before sending a request.
  if(!['manual','follow'].includes(options.redirect))throw new TypeError('Unsupported redirect mode');
  requests.push({url,redirect:options.redirect});
  return keyResponse([publicKeyShape(firstJwk),publicKeyShape(secondJwk)]);
 }});
 assert.equal((await verify(tokenRequest(await signed()),config)).email,'employee@'+domain);
 assert.deepEqual(requests,[{url:issuer+'/cdn-cgi/access/certs',redirect:'manual'}]);
});

test('Access rejects all JWKS redirects without contacting their destination',async()=>{
 const config=cloudflareAccessConfig(configuration()),token=await signed();
 for(const status of [301,302,303,307,308]){
  const requests=[];
  const verify=createCloudflareAccessVerifier({now:()=>epoch,fetcher:async(url,options)=>{
   requests.push(url);
   if(options.redirect==='error')throw new TypeError('Unsupported redirect mode');
   // A follow request would obtain valid keys from an unauthorized destination.
   if(options.redirect==='follow'){requests.push('https://other.example/keys');return keyResponse([firstJwk]);}
   return new Response(JSON.stringify({keys:[firstJwk]}),{status,headers:{location:'https://other.example/keys','content-type':'application/json'}});
  }});
  await assert.rejects(()=>verify(tokenRequest(token),config),{status:503,code:'ACCESS_KEYS_UNAVAILABLE'});
  assert.deepEqual(requests,[issuer+'/cdn-cgi/access/certs']);
 }
});

test('Access rejects tampering, algorithm confusion, claim mismatches and unverified email',async()=>{
 const f=verifierFixture();
 const invalidClaims=[{iss:'https://evil.example'},{aud:['another-app']},{aud:[1,'qa-application-audience']},{exp:seconds},{exp:undefined},{exp:String(seconds+60)},{nbf:seconds+1},{nbf:undefined},{nbf:seconds+3600},{iat:seconds+1},{iat:'bad'},{sub:''},{sub:undefined},{type:'service'},{type:undefined},{email:undefined},{email:'employee@sub.'+domain},{email:'employee@'+domain+'.evil.example'},{email:'employee@evil.example'},{email_verified:false},{email_verified:'true'}];
 for(const changes of invalidClaims)await assert.rejects(()=>signed(changes).then(token=>f.verify(tokenRequest(token),f.config)),error=>[401,403].includes(error.status),JSON.stringify(changes));
 for(const header of [{alg:'none'},{alg:'HS256'},{alg:'RS512'},{kid:''},{kid:undefined},{crit:['x']},{b64:false},{typ:'JWE'}])await assert.rejects(()=>signed({},header).then(token=>f.verify(tokenRequest(token),f.config)),{status:401});
 await assert.rejects(()=>signed({}, {},secondKey).then(token=>f.verify(tokenRequest(token),f.config)),{status:401});
 const original=await signed();const parts=original.split('.');parts[1]=encode(claims({email:'admin-a@'+domain}));
 await assert.rejects(()=>f.verify(tokenRequest(parts.join('.')),f.config),{status:401});
 for(const token of ['not-a-token','a.b.c','..','a.b.c.d','X'.repeat(32769),original+', '+original])await assert.rejects(()=>f.verify(tokenRequest(token),f.config),{status:401});
});

test('Access never follows JWT key URLs and bounds refresh for unknown signing keys',async()=>{
 const f=verifierFixture();await f.verify(tokenRequest(await signed({}, {jku:'https://evil.example/keys',x5u:'https://evil.example/cert'})),f.config);
 const rotated=await signed({}, {kid:'second'},secondKey);f.setKeys([firstJwk,secondJwk]);
 for(let n=0;n<3;n++)await assert.rejects(()=>f.verify(tokenRequest(rotated),f.config),{status:401});
 assert.equal(f.requests.length,1,'Unknown kid cannot repeatedly trigger a JWKS fetch');
 f.setClock(epoch+31000);assert.equal((await f.verify(tokenRequest(rotated),f.config)).email,'employee@'+domain);assert.equal(f.requests.length,2);
 assert(f.requests.every(request=>request.url===issuer+'/cdn-cgi/access/certs'));
 f.setClock(epoch+332000);f.setFailure(true);await assert.rejects(()=>f.verify(tokenRequest(rotated),f.config),{status:503});
});

test('Access fails closed on invalid issuer configuration, bootstrap admins and key responses',async()=>{
 for(const mutation of [{CF_ACCESS_TEAM_DOMAIN:'http://qa-team.cloudflareaccess.com'},{CF_ACCESS_TEAM_DOMAIN:'https://qa-team.cloudflareaccess.com.evil.example'},{CF_ACCESS_TEAM_DOMAIN:issuer+'/other'},{CF_ACCESS_TEAM_DOMAIN:issuer+'?x=1'},{CF_ACCESS_TEAM_DOMAIN:'https://name:password@qa-team.cloudflareaccess.com'},{CF_ACCESS_AUD:''},{ALLOWED_EMAIL_DOMAIN:''},{CF_ACCESS_ADMIN_IDENTITIES:'[]'},{CF_ACCESS_ADMIN_IDENTITIES:JSON.stringify([{id:'owner',email:'admin-a@'+domain},{id:'owner',email:'admin-b@'+domain}])},{CF_ACCESS_ADMIN_IDENTITIES:JSON.stringify([{id:'owner',email:'admin-a@'+domain},{id:'developer',email:'ADMIN-A@'+domain}])},{CF_ACCESS_ADMIN_IDENTITIES:JSON.stringify([{id:'owner',email:'admin-a@evil.example'},{id:'developer',email:'admin-b@'+domain}])}])assert.throws(()=>cloudflareAccessConfig({...configuration(),...mutation}),{status:503});
 const token=await signed(),config=cloudflareAccessConfig(configuration());
 for(const body of [{keys:[]},{keys:[firstJwk,firstJwk]},{keys:[{...firstJwk,kty:'oct'}]},{keys:[{...firstJwk,alg:'HS256'}]},{keys:[{...firstJwk,use:'enc'}]},{keys:[{...firstJwk,key_ops:['sign']}]},{keys:[{...firstJwk,d:'private'}]}]){
  const verify=createCloudflareAccessVerifier({now:()=>epoch,fetcher:async()=>Response.json(body)});await assert.rejects(()=>verify(tokenRequest(token),config),{status:503});
 }
 const redirect=createCloudflareAccessVerifier({now:()=>epoch,fetcher:async()=>new Response('',{status:302,headers:{location:'https://evil.example'}})});await assert.rejects(()=>redirect(tokenRequest(token),config),{status:503});
 const oversized=createCloudflareAccessVerifier({now:()=>epoch,fetcher:async()=>new Response('x'.repeat(131073))});await assert.rejects(()=>oversized(tokenRequest(token),config),{status:503});
});

class MemoryBucket{
 objects=new Map();serial=0;conflicts=0;
 async get(key){const item=this.objects.get(key);return item?{etag:item.etag,customMetadata:item.meta,json:async()=>JSON.parse(item.text)}:null;}
 async head(key){const item=this.objects.get(key);return item?{etag:item.etag,customMetadata:item.meta}:null;}
 async put(key,text,options={}){if(options.onlyIf&&this.conflicts-->0)return null;const old=this.objects.get(key);if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const item={etag:'etag-'+(++this.serial),text:String(text),meta:options.customMetadata||{}};this.objects.set(key,item);return {etag:item.etag};}
 async delete(key){this.objects.delete(key);}
}
const environment=()=>({...configuration(),BUCKET:new MemoryBucket()});
function backendFixture(){const handler=createApiHandler({engine,now:()=>epoch,accessFetch:async()=>keyResponse([firstJwk])});return async(env,path,{method='GET',body,token,csrf=true,headers={}}={})=>{const h=new Headers(headers);if(token)h.set('Cf-Access-Jwt-Assertion',token);if(!['GET','HEAD'].includes(method)){h.set('Content-Type','application/json');if(csrf){h.set('Origin',origin);h.set('X-Minerva-Request','1');}}const response=await handler(new Request(origin+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:response.status,body:await response.json(),headers:response.headers};};}
const adminToken=()=>signed({email:'admin-a@'+domain,sub:'qa-admin-a'});

test('Access requires JWT independently of legacy cookies and only bootstraps the two configured admins',async()=>{
 const env=environment(),call=backendFixture(),token=await adminToken();
 const forged={'Cf-Access-Authenticated-User-Email':'admin-a@'+domain,'oai-authenticated-user-email':'admin-a@'+domain,cookie:'__Host-minerva-session='+'A'.repeat(43)};
 const unauthenticated=await call(env,'/api/session',{headers:forged});assert.equal(unauthenticated.status,200);assert.equal(unauthenticated.body.authenticated,false);assert.equal(unauthenticated.body.provider,'cloudflare-access');assert.equal(unauthenticated.body.verifiedEmail,null);
 for(const path of ['/api/report','/api/report/meta','/api/members'])assert.equal((await call(env,path,{headers:forged})).status,401);
 assert.equal((await call(env,'/api/auth/exchange',{method:'POST',body:{token:'A'.repeat(43)}})).body.code,'LEGACY_AUTH_DISABLED');
 assert.equal((await call(env,'/api/auth/request',{method:'POST',body:{name:'Pretend Admin',email:'admin-a@'+domain}})).status,401);
 const admin=await call(env,'/api/session',{token});assert.equal(admin.body.role,'admin');assert.equal(admin.body.userId,'owner');assert.equal(admin.body.verifiedEmail,'admin-a@'+domain);assert.equal(admin.body.approved,true);assert.equal(admin.headers.get('Set-Cookie'),null);
 const second=await call(env,'/api/session',{token:await signed({email:'admin-b@'+domain,sub:'qa-admin-b'})});assert.equal(second.body.userId,'developer');assert.equal(second.body.role,'admin');
 const stored=JSON.parse(env.BUCKET.objects.get('private/access-v3.json').text);assert.deepEqual(Object.keys(stored.admins).sort(),['developer','owner']);assert(![...env.BUCKET.objects.values()].some(item=>item.text.includes(token)));
 const unknown=await call(env,'/api/session',{token:await signed({email:'third-admin@'+domain})});assert.equal(unknown.body.status,'unregistered');assert.equal(unknown.body.approved,false);
});

test('verified identity requests use signed email, remain pending and respect live approval/editor/revocation ACL',async()=>{
 const env=environment(),call=backendFixture(),token=await signed(),admin=await adminToken();
 const initial=await call(env,'/api/session',{token});assert.equal(initial.body.authenticated,true);assert.equal(initial.body.status,'unregistered');assert.equal(initial.body.authProvider,'cloudflare-access');
 assert.equal((await call(env,'/api/report',{token})).status,403);
 const request=await call(env,'/api/auth/request',{method:'POST',token,body:{name:'QA Employee',email:'admin-a@'+domain}});assert.equal(request.status,201);assert.equal(request.body.status,'pending');assert.equal(request.body.email,'employee@'+domain);assert.equal(request.body.verifiedEmail,'employee@'+domain);
 const id=request.body.userId,path='/api/members/'+id;
 assert.equal((await call(env,'/api/auth/request',{method:'POST',token,body:{name:'Duplicate',email:'other@'+domain}})).body.userId,id);
 assert.equal((await call(env,path+'/approve',{method:'POST',token,body:{}})).status,403);
 assert.equal((await call(env,'/api/auth/request',{method:'POST',token,body:{name:'Bad',role:'admin'}})).status,400);
 await call(env,'/api/session',{token:admin});
 assert.equal((await call(env,path+'/approve',{method:'POST',token:admin,body:{}})).status,200);
 assert.equal((await call(env,'/api/report',{token})).status,200);
 assert.equal((await call(env,'/api/session',{token})).body.role,'viewer');
 assert.equal((await call(env,path+'/role',{method:'POST',token:admin,body:{role:'editor'}})).status,200);
 assert.equal((await call(env,'/api/session',{token})).body.role,'editor');
 assert.equal((await call(env,'/api/members',{token})).status,403);
 assert.equal((await call(env,path+'/role',{method:'POST',token:admin,body:{role:'viewer'}})).status,200);assert.equal((await call(env,'/api/session',{token})).body.role,'viewer');
 assert.equal((await call(env,path,{method:'DELETE',token:admin,body:{}})).status,200);
 assert.equal((await call(env,'/api/session',{token})).body.status,'revoked');assert.equal((await call(env,'/api/report',{token})).status,403);
 assert.equal((await call(env,'/api/auth/request',{method:'POST',token,body:{name:'Again'}})).body.status,'revoked');
 assert.equal((await call(env,path+'/request',{method:'DELETE',token:admin,body:{}})).status,200);assert.equal((await call(env,'/api/session',{token})).body.status,'unregistered');
});

test('Access never links a legacy approved member by its unverified email and identity changes require fresh approval',async()=>{
 const env=environment(),call=backendFixture(),admin=await adminToken(),token=await signed();await call(env,'/api/session',{token:admin});
 const key='private/access-v3.json',acl=JSON.parse(env.BUCKET.objects.get(key).text),legacyId=crypto.randomUUID();
 acl.members[legacyId]={id:legacyId,name:'Legacy',email:'employee@'+domain,status:'approved',role:'editor',requestedAt:'2026-01-01'};await env.BUCKET.put(key,JSON.stringify(acl));
 assert.equal((await call(env,'/api/session',{token})).body.status,'unregistered');
 const pending=await call(env,'/api/auth/request',{method:'POST',token,body:{name:'Verified'}});assert.notEqual(pending.body.userId,legacyId);assert.equal(pending.body.status,'pending');
 await call(env,'/api/members/'+pending.body.userId+'/approve',{method:'POST',token:admin,body:{}});
 assert.equal((await call(env,'/api/session',{token})).body.approved,true);
 for(const changes of [{sub:'different-verified-subject'},{email:'changed@'+domain}])assert.equal((await call(env,'/api/session',{token:await signed(changes)})).body.status,'unregistered');
 assert.equal(JSON.parse(env.BUCKET.objects.get(key).text).members[legacyId].role,'editor','Legacy ACL records remain intact');
});

test('Access delegation needs an approved verified corporate identity and obeys live role revocation',async()=>{
 const env=environment(),call=backendFixture(),admin=await adminToken(),token=await signed(),key='private/access-v3.json';
 const member=await call(env,'/api/auth/request',{method:'POST',token,body:{name:'QA Delegate'}}),path='/api/members/'+member.body.userId;
 assert.equal((await call(env,path+'/role',{method:'POST',token:admin,body:{role:'admin'}})).status,409);
 await call(env,path+'/approve',{method:'POST',token:admin,body:{}});
 assert.equal((await call(env,path+'/role',{method:'POST',token,body:{role:'admin'}})).status,403);
 const acl=JSON.parse(env.BUCKET.objects.get(key).text),legacyId=crypto.randomUUID();acl.members[legacyId]={id:legacyId,name:'QA Legacy',email:'legacy@'+domain,status:'approved',role:'editor',requestedAt:'2026-01-01'};await env.BUCKET.put(key,JSON.stringify(acl));
 assert.equal((await call(env,'/api/members/'+legacyId+'/role',{method:'POST',token:admin,body:{role:'admin'}})).body.code,'VERIFIED_IDENTITY_REQUIRED');
 assert.equal((await call(env,path+'/role',{method:'POST',token:admin,body:{role:'admin'}})).status,200);
 assert.equal((await call(env,'/api/session',{token})).body.role,'admin');assert.equal((await call(env,'/api/members',{token})).status,200);
 for(const id of ['owner','developer'])for(const [suffix,method,body]of [['/role','POST',{role:'viewer'}],['','DELETE',{}],['/request','DELETE',{}]])assert.equal((await call(env,'/api/members/'+id+suffix,{token,method,body})).status,400);
 assert.equal((await call(env,path+'/role',{method:'POST',token:admin,body:{role:'reviewer'}})).status,200);assert.equal((await call(env,'/api/session',{token})).body.role,'reviewer');assert.equal((await call(env,'/api/members',{token})).status,403);
 await call(env,path,{method:'DELETE',token:admin,body:{}});assert.equal((await call(env,'/api/session',{token})).body.status,'revoked');await call(env,path+'/approve',{method:'POST',token:admin,body:{}});assert.equal((await call(env,'/api/session',{token})).body.role,'viewer');
});

test('Access preserves CSRF, retries CAS, suppresses secret disclosure and signals gateway logout',async()=>{
 const env=environment(),call=backendFixture(),token=await signed(),admin=await adminToken();
 for(const path of ['/api/auth/request','/api/auth/logout','/api/auth/exchange'])assert.equal((await call(env,path,{method:'POST',token,body:{name:'QA'},csrf:false})).status,403);
 env.BUCKET.conflicts=2;const result=await call(env,'/api/auth/request',{method:'POST',token,body:{name:'CAS Employee'}});assert.equal(result.status,201);
 const simultaneous=await Promise.all([call(env,'/api/auth/request',{method:'POST',token,body:{name:'QA'}}),call(env,'/api/auth/request',{method:'POST',token,body:{name:'QA'}})]);assert(simultaneous.every(item=>item.body.userId===result.body.userId));
 assert.equal(Object.keys(JSON.parse(env.BUCKET.objects.get('private/access-v3.json').text).members).length,1);
 const logout=await call(env,'/api/auth/logout',{method:'POST',token,body:{}});assert.equal(logout.status,200);assert.equal(logout.body.logoutUrl,'/cdn-cgi/access/logout');assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);
 assert.equal((await call(env,'/api/session')).body.authenticated,false,'Access identity disappears once gateway assertion is removed');
 const configured=await call(env,'/api/session',{token:admin});assert(!JSON.stringify(configured.body).includes('tokenHash'));assert(!JSON.stringify(configured.body).includes(admin));assert.match(configured.headers.get('Cache-Control'),/no-store/);
 const wrongMode=await call({...env,AUTH_MODE:'typo'},'/api/session',{token:admin});assert.equal(wrongMode.status,503);
 const missingConfig=await call({...env,CF_ACCESS_AUD:''},'/api/session',{token:admin});assert.equal(missingConfig.status,503);
});

test('concurrent first requests for a verified identity create one pending ACL entry',async()=>{
 const env=environment(),call=backendFixture(),token=await signed();await call(env,'/api/session',{token:await adminToken()});
 const results=await Promise.all([call(env,'/api/auth/request',{method:'POST',token,body:{name:'First device'}}),call(env,'/api/auth/request',{method:'POST',token,body:{name:'Second device'}})]);
 assert(results.every(result=>[200,201].includes(result.status)));assert.equal(results[0].body.userId,results[1].body.userId);
 const acl=JSON.parse(env.BUCKET.objects.get('private/access-v3.json').text);assert.equal(Object.keys(acl.members).length,1);assert.equal(acl.audit.filter(event=>event.action==='verified_access_requested').length,1);
});

test('entry asset authorization uses signed identity and live ACL for direct GET and HEAD requests',async()=>{
 const env=environment(),call=backendFixture(),token=await signed(),admin=await adminToken();
 const pending=await call(env,'/api/auth/request',{method:'POST',token,body:{name:'Asset Employee'}}),id=pending.body.userId;
 const source=await readFile(new URL('../worker/entry.js',import.meta.url),'utf8');
 const context={Request,Response,Headers,URL,Uint8Array,atob,ClaimsEngine:engine,MIGRATION_SOURCE:{base64:''},STATIC_ASSETS:Object.fromEntries(['/index.html','/engine.js','/access.html'].map(path=>[path,{type:'text/plain',body:Buffer.from(path==='/access.html'?'PUBLIC_ACCESS':'PRIVATE_REPORT').toString('base64')}])),createApiHandler:options=>createApiHandler({...options,now:()=>epoch,accessFetch:async()=>keyResponse([firstJwk])}),fetch:()=>{throw new Error('Unexpected remote asset fetch');}};
 context.createD1Bucket=createD1Bucket;
 vm.runInNewContext(source.replace(/^import .*from '\.\/d1-store\.js';\s*$/m,'').replace('export default {','globalThis.worker = {'),context);
 const asset=(assertion,method='GET')=>context.worker.fetch(new Request(origin+'/engine.js?v=test',{method,headers:assertion?{'Cf-Access-Jwt-Assertion':assertion}:{'Cf-Access-Authenticated-User-Email':'admin-a@'+domain}}),env,{});
 for(const method of ['GET','HEAD']){assert.equal((await asset(null,method)).status,401);const denied=await asset(token,method);assert.equal(denied.status,403);assert(!(await denied.text()).includes('PRIVATE_REPORT'));}
 assert.equal((await asset(admin)).status,200);
 await call(env,'/api/members/'+id+'/approve',{method:'POST',token:admin,body:{}});assert.equal((await asset(token)).status,200);
 await call(env,'/api/members/'+id,{method:'DELETE',token:admin,body:{}});assert.equal((await asset(token)).status,403,'Existing signed token loses asset access immediately after ACL revocation');
 const invalid=(await signed()).split('.');invalid[1]=encode(claims({email:'admin-a@'+domain}));assert.equal((await asset(invalid.join('.'))).status,401);
});
