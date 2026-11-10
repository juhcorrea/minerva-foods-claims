import {createD1Bucket} from './d1-store.js';
// Access identity and the application's manual approval both remain mandatory.
// Sites keeps its existing R2 binding; the portable deployment may use D1.
function decodeAssetBase64(value){
 if(typeof Uint8Array.fromBase64==='function')return Uint8Array.fromBase64(value);
 const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;
}
const decodedAssets=new Map();
const DECODED_ASSET_LIMIT=8*1024*1024;
let decodedAssetBytes=0;
const apiHandler=createApiHandler({engine:globalThis.ClaimsEngine,migrationSource:{...MIGRATION_SOURCE,get data(){return decodeAssetBase64(MIGRATION_SOURCE.base64);}}});
const BASE_HEADERS={
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Cache-Control':'private, no-store',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https://minervafoods.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
function secured(response){const h=new Headers(response.headers);for(const [k,v]of Object.entries(BASE_HEADERS))h.set(k,v);return new Response(response.body,{status:response.status,headers:h});}
function staticAsset(key,head=false){
 const asset=STATIC_ASSETS[key];if(!asset)return new Response('Não encontrado',{status:404});
 const headers={'Content-Type':asset.type};if(head)return new Response(null,{headers});
 let bytes=decodedAssets.get(key);
 if(!bytes){
  bytes=decodeAssetBase64(asset.body);
  if(bytes.byteLength<=DECODED_ASSET_LIMIT){
   while(decodedAssetBytes+bytes.byteLength>DECODED_ASSET_LIMIT){const oldest=decodedAssets.keys().next().value;decodedAssetBytes-=decodedAssets.get(oldest).byteLength;decodedAssets.delete(oldest);}
   decodedAssets.set(key,bytes);decodedAssetBytes+=bytes.byteLength;
  }
 }
 return new Response(bytes,{headers});
}
// Only the access form and its brand dependencies are available before approval.
// Report scripts contain operational configuration and require the same session
// authorization as the report page, including for direct asset URLs.
const PUBLIC_ASSETS=new Set(['/access.html','/access.css','/access.js','/site.webmanifest','/assets/minerva-logo.png','/assets/minerva-monogram.svg','/assets/montserrat-latin.woff2']);
// These existing brand assets are declared by the official Minerva Foods site.
// Fixed sources only: this is not a general-purpose URL proxy.
const BRAND_ICONS={
 '/favicon.ico':'https://minervafoods.com/wp-content/themes/infobase-wp-theme/public/img/favicon.png',
 '/assets/minerva-favicon.png':'https://minervafoods.com/wp-content/themes/infobase-wp-theme/public/img/favicon.png',
 '/assets/minerva-icon-192.jpg':'https://minervafoods.com/wp-content/uploads/2022/04/cropped-principal-logo-Small-192x192.jpg',
 '/assets/minerva-apple-touch-icon.jpg':'https://minervafoods.com/wp-content/uploads/2022/04/cropped-principal-logo-Small-180x180.jpg'
};
function entryPage(kind,head=false){
 const page=staticAsset('/access.html',head);
 return new Response(page.body,{status:kind==='unavailable'?503:200,headers:page.headers});
}
function unknownDocumentNavigation(request,url){
 if(!['GET','HEAD'].includes(request.method))return false;
 const documentRequest=request.headers.get('sec-fetch-mode')==='navigate'||(request.headers.get('accept')||'').split(',').some(type=>type.split(';')[0].trim().toLowerCase()==='text/html');
 if(!documentRequest)return false;
 let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return false;}
 // A stale page destination may return to the gated root. Files and internal
 // namespaces retain their existing responses, including encoded spellings.
 if(/[.\\\x00-\x1f\x7f]/.test(pathname))return false;
 const first=pathname.split('/').filter(Boolean)[0]?.toLowerCase();
 return !['api','assets','vendor','worker','server','private','dados','cdn-cgi'].includes(first);
}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  try{
   if(!env.BUCKET&&env.DB)env={...env,BUCKET:createD1Bucket(env.DB)};
   if(url.pathname.startsWith('/api/'))return secured(await apiHandler(request,env));
   if(request.method!=='GET'&&request.method!=='HEAD')return secured(new Response('Método não permitido',{status:405}));
   if(url.pathname==='/assets/minerva-logo.webp'){
    const logo=await fetch('https://minervafoods.com/wp-content/uploads/2024/08/logo-1024x451.webp',{cf:{cacheTtl:86400,cacheEverything:true}});
    if(!logo.ok||!/^image\//.test(logo.headers.get('content-type')||''))return secured(new Response('Logo indisponível',{status:502}));
    return secured(new Response(logo.body,{headers:{'Content-Type':logo.headers.get('content-type')}}));
   }
   if(Object.hasOwn(BRAND_ICONS,url.pathname)){
    const icon=await fetch(BRAND_ICONS[url.pathname],{cf:{cacheTtl:86400,cacheEverything:true}});
    if(!icon.ok||!/^image\//.test(icon.headers.get('content-type')||''))return secured(new Response('Ícone indisponível',{status:502}));
    return secured(new Response(icon.body,{headers:{'Content-Type':icon.headers.get('content-type')}}));
   }
   if(url.pathname==='/acesso')return secured(entryPage('anonymous',request.method==='HEAD'));
   if(url.pathname==='/'||url.pathname==='/index.html'){
    const sessionUrl=new URL('/api/session',url);const result=await apiHandler(new Request(sessionUrl,{headers:request.headers}),env);
    if(result.status>=500)return secured(entryPage('unavailable',request.method==='HEAD'));
    const session=await result.json();
    if(!session.authenticated)return secured(entryPage('anonymous',request.method==='HEAD'));
    if(!session.approved||!['admin','editor','reviewer','viewer'].includes(session.role))return secured(entryPage('denied',request.method==='HEAD'));
    return secured(staticAsset('/index.html',request.method==='HEAD'));
   }
   if(!Object.hasOwn(STATIC_ASSETS,url.pathname)){
    if(unknownDocumentNavigation(request,url))return secured(new Response(null,{status:302,headers:{Location:'/'}}));
    return secured(new Response('Não encontrado',{status:404}));
   }
   if(!PUBLIC_ASSETS.has(url.pathname)){
    const sessionUrl=new URL('/api/session',url);const result=await apiHandler(new Request(sessionUrl,{headers:request.headers}),env);
    if(result.status>=500)return secured(new Response('Não foi possível conferir seu acesso.',{status:503}));
    if(!result.ok)return secured(new Response('Acesso não autorizado.',{status:result.status===401?401:403}));
    const session=await result.json();
    if(!session.authenticated)return secured(new Response('Entre no painel para acessar este arquivo.',{status:401}));
    if(!session.approved||!['admin','editor','reviewer','viewer'].includes(session.role))return secured(new Response('Seu acesso não está liberado.',{status:403}));
   }
   return secured(staticAsset(url.pathname,request.method==='HEAD'));
  }catch(error){return secured(url.pathname.startsWith('/api/')?new Response(JSON.stringify({error:'Não foi possível concluir a solicitação.'}),{status:503,headers:{'Content-Type':'application/json'}}):entryPage('unavailable'));}
 }
};
