// Opt-in Cloudflare Access verification. Only the configured issuer can supply
// signing keys; JWT-controlled jku/x5u URLs and unverified identity headers are
// never consulted. Application authorization remains in the private ACL.
export class CloudflareAccessError extends Error {
 constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const cfAccessFailure=(status,code,message)=>{throw new CloudflareAccessError(status,code,message);};
const cfAccessInvalid=()=>cfAccessFailure(401,'ACCESS_TOKEN_INVALID','Sua identificação corporativa expirou ou é inválida. Entre novamente.');
const cfAccessConfigInvalid=()=>cfAccessFailure(503,'ACCESS_NOT_CONFIGURED','A identificação corporativa ainda não está configurada.');
const cfAccessPlain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const cfAccessEmail=(value,domain)=>{
 if(typeof value!=='string'||value.length>254||value!==value.trim()||!/^\S+@\S+$/.test(value))return null;
 const email=value.toLowerCase(),parts=email.split('@');
 return parts.length===2&&parts[0].length>0&&parts[0].length<=64&&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0])&&parts[1]===domain?email:null;
};
export function cloudflareAccessConfig(env){
 if(typeof env.CF_ACCESS_TEAM_DOMAIN!=='string'||typeof env.CF_ACCESS_AUD!=='string'||typeof env.ALLOWED_EMAIL_DOMAIN!=='string')cfAccessConfigInvalid();
 const raw=env.CF_ACCESS_TEAM_DOMAIN.trim();let issuer;
 try{const url=new URL(raw.startsWith('https://')?raw:'https://'+raw);if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/'||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(url.hostname))cfAccessConfigInvalid();issuer=url.origin;}catch{cfAccessConfigInvalid();}
 const audience=env.CF_ACCESS_AUD.trim(),domain=env.ALLOWED_EMAIL_DOMAIN.trim().toLowerCase();
 if(!audience||audience.length>512||/\s/.test(audience)||domain.length>253||!(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/).test(domain))cfAccessConfigInvalid();
 let entries;try{entries=JSON.parse(env.CF_ACCESS_ADMIN_IDENTITIES||'');}catch{cfAccessConfigInvalid();}
 if(!Array.isArray(entries)||entries.length!==2||entries.some(item=>!cfAccessPlain(item)||!['owner','developer'].includes(item.id)||!cfAccessEmail(item.email,domain))||new Set(entries.map(item=>item.id)).size!==2||new Set(entries.map(item=>cfAccessEmail(item.email,domain))).size!==2)cfAccessConfigInvalid();
 const admins=entries.map(item=>({id:item.id,email:cfAccessEmail(item.email,domain),name:item.id==='owner'?'Owner':'Developer'}));
 return {issuer,audience,domain,admins,jwksUrl:issuer+'/cdn-cgi/access/certs'};
}
function cfAccessDecode(value){
 if(typeof value!=='string'||!value||value.length>32768||!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)cfAccessInvalid();
 try{const base=value.replace(/-/g,'+').replace(/_/g,'/'),bytes=Uint8Array.from(atob(base+'='.repeat((4-base.length%4)%4)),char=>char.charCodeAt(0));return bytes;}catch{cfAccessInvalid();}
}
function cfAccessJson(value){try{const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(cfAccessDecode(value)));if(!cfAccessPlain(result))cfAccessInvalid();return result;}catch{cfAccessInvalid();}}
export function createCloudflareAccessVerifier({fetcher=(...args)=>fetch(...args),now=()=>Date.now()}={}){
 const cache=new Map(),pending=new Map();
 async function keysFor(config,force=false){
  const previous=cache.get(config.issuer),time=now();
  if(previous&&!force&&previous.expiresAt>time)return previous;
  if(pending.has(config.issuer))return pending.get(config.issuer);
  const task=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
   try{
    const result=await fetcher(config.jwksUrl,{redirect:'error',signal:controller.signal,headers:{accept:'application/json'}});
    if(!result.ok)throw new Error('JWKS unavailable');
    const length=result.headers.get('content-length');if(length&&Number(length)>131072)throw new Error('JWKS too large');
    const reader=result.body?.getReader();if(!reader)throw new Error('JWKS body absent');const chunks=[];let size=0;
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>131072){await reader.cancel();throw new Error('JWKS too large');}chunks.push(part.value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!cfAccessPlain(document)||!Array.isArray(document.keys)||!document.keys.length||document.keys.length>20)throw new Error('Invalid JWKS');
    const keys=new Map();for(const key of document.keys){if(!cfAccessPlain(key)||typeof key.kid!=='string'||!key.kid||key.kid.length>256||keys.has(key.kid)||key.kty!=='RSA'||key.alg&&key.alg!=='RS256'||key.use&&key.use!=='sig'||key.key_ops&&(!Array.isArray(key.key_ops)||!key.key_ops.includes('verify'))||typeof key.n!=='string'||typeof key.e!=='string'||'d' in key)throw new Error('Invalid signing key');keys.set(key.kid,key);}
    const entry={keys,imported:new Map(),fetchedAt:time,expiresAt:time+300000};
    if(cache.size>=8&&!cache.has(config.issuer))cache.delete(cache.keys().next().value);cache.set(config.issuer,entry);return entry;
   }catch(error){if(error instanceof CloudflareAccessError)throw error;cfAccessFailure(503,'ACCESS_KEYS_UNAVAILABLE','Não foi possível conferir sua identificação corporativa. Tente novamente.');}finally{clearTimeout(timer);}
  })();pending.set(config.issuer,task);try{return await task;}finally{pending.delete(config.issuer);}
 }
 return async function verify(request,config){
  const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token)return null;
  if(token.length>32768)cfAccessInvalid();const parts=token.split('.');if(parts.length!==3)cfAccessInvalid();
  const header=cfAccessJson(parts[0]),claims=cfAccessJson(parts[1]);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>256||header.typ&&header.typ!=='JWT'||header.crit!==undefined||header.b64!==undefined)cfAccessInvalid();
  const time=Math.floor(now()/1000),audiences=typeof claims.aud==='string'?[claims.aud]:claims.aud;
  if(claims.iss!==config.issuer||!Array.isArray(audiences)||!audiences.length||audiences.some(aud=>typeof aud!=='string')||!audiences.includes(config.audience)||!Number.isSafeInteger(claims.exp)||claims.exp<=time||!Number.isSafeInteger(claims.nbf)||claims.nbf>time||claims.nbf>=claims.exp||claims.iat!==undefined&&(!Number.isSafeInteger(claims.iat)||claims.iat>time)||typeof claims.sub!=='string'||!claims.sub.trim()||claims.sub.length>512||claims.type!=='app'||claims.email_verified!==undefined&&claims.email_verified!==true)cfAccessInvalid();
  // Access application tokens carry the email verified by the identity provider
  // (including one-time PIN). A client-supplied email header has no authority.
  const email=cfAccessEmail(claims.email,config.domain);if(!email)cfAccessFailure(403,'ACCESS_EMAIL_DOMAIN','Use seu e-mail corporativo autorizado para entrar.');
  let entry=await keysFor(config);if(!entry.keys.has(header.kid)&&now()-entry.fetchedAt>=30000)entry=await keysFor(config,true);
  const jwk=entry.keys.get(header.kid);if(!jwk)cfAccessInvalid();
  let key=entry.imported.get(header.kid);
  try{if(!key){key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);if(key.algorithm.modulusLength<2048)cfAccessInvalid();entry.imported.set(header.kid,key);}
   if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,cfAccessDecode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))cfAccessInvalid();
  }catch{cfAccessInvalid();}
  return {provider:'cloudflare-access',issuer:config.issuer,subject:claims.sub,email,expiresAt:new Date(claims.exp*1000).toISOString()};
 };
}
