// Personal presentation settings are kept apart from access decisions and audit
// identities. The caller supplies only a server-resolved, approved principal.
export const USER_PROFILE_PREFIX='private/user-profiles-v1/';
export const USER_PROFILE_AVATAR_BYTES=512*1024;
export const USER_PROFILE_BODY_BYTES=720000;
const profileFields=Object.freeze(['name','employeeId','jobTitle','department','unit','avatarDataUrl','keepMenuOpen']);
const profileTextLimits=Object.freeze({name:160,employeeId:80,jobTitle:120,department:120,unit:120});
const profilePlain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const profileOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
export class UserProfileError extends Error{
 constructor(status,code,message){super(message);this.name='UserProfileError';this.status=status;this.code=code;}
}
const profileFail=(status,code,message)=>{throw new UserProfileError(status,code,message);};
const profileInvalid=()=>profileFail(400,'PROFILE_INVALID','Confira os dados do seu perfil.');
const profileStorageInvalid=()=>profileFail(503,'PROFILE_STORAGE_INVALID','Não foi possível carregar seu perfil. Avise a administração.');
const profileChanged=()=>profileFail(409,'PROFILE_CHANGED','Seu perfil foi atualizado em outra janela. Recarregue antes de salvar.');
function profileAvatarValue(value){
 if(value==='')return '';
 if(typeof value!=='string'||value.length>Math.ceil(USER_PROFILE_AVATAR_BYTES/3)*4+32)profileFail(400,'PROFILE_AVATAR_INVALID','Use uma foto JPG, PNG ou WebP de até 512 KB após o ajuste.');
 const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match||match[2].length%4!==0)profileFail(400,'PROFILE_AVATAR_INVALID','Use uma foto JPG, PNG ou WebP válida.');
 let bytes;try{bytes=atob(match[2]);}catch{profileFail(400,'PROFILE_AVATAR_INVALID','Use uma foto JPG, PNG ou WebP válida.');}
 if(!bytes.length||bytes.length>USER_PROFILE_AVATAR_BYTES||btoa(bytes)!==match[2])profileFail(400,'PROFILE_AVATAR_INVALID','Use uma foto JPG, PNG ou WebP válida de até 512 KB após o ajuste.');
 const code=index=>bytes.charCodeAt(index);
 const type=match[1];
 const valid=type==='jpeg'?bytes.length>=4&&code(0)===255&&code(1)===216&&code(2)===255&&code(bytes.length-2)===255&&code(bytes.length-1)===217:
  type==='png'?bytes.length>=33&&bytes.slice(0,8)==='\x89PNG\r\n\x1a\n'&&bytes.slice(12,16)==='IHDR'&&bytes.slice(-8,-4)==='IEND':
  bytes.length>=20&&bytes.slice(0,4)==='RIFF'&&bytes.slice(8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(bytes.slice(12,16));
 if(!valid)profileFail(400,'PROFILE_AVATAR_INVALID','O conteúdo da foto não corresponde ao formato informado.');
 return value;
}
function profileNormalize(value){
 if(!profilePlain(value)||Object.keys(value).length!==profileFields.length||profileFields.some(key=>!profileOwn(value,key))||Object.keys(value).some(key=>!profileFields.includes(key)))profileInvalid();
 const profile={};
 for(const [field,max]of Object.entries(profileTextLimits)){
  if(typeof value[field]!=='string'||value[field].length>max||/[\u0000-\u001f\u007f]/.test(value[field]))profileInvalid();
  profile[field]=value[field].trim();
 }
 if(profile.name.length<2)profileFail(400,'PROFILE_NAME_REQUIRED','Informe seu nome completo.');
 if(typeof value.keepMenuOpen!=='boolean')profileInvalid();
 profile.avatarDataUrl=profileAvatarValue(value.avatarDataUrl);profile.keepMenuOpen=value.keepMenuOpen;
 return profile;
}
async function profilePrincipalHash(access){
 const person=access.admin||access.member;
 if(!access.authenticated||!access.approved||!person?.id)profileFail(403,'PROFILE_ACCESS_REQUIRED','Entre em uma conta aprovada para acessar seu perfil.');
 const name=(access.admin?'admin:':'member:')+person.id;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(name));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function profileIdentity(access){
 const person=access.admin||access.member;
 return {userId:person.id,email:access.identity?.email||person.email||'',role:access.role};
}
function profileDefault(access,displayName){
 const person=access.admin||access.member;
 return {name:displayName||person.name||'',employeeId:'',jobTitle:'',department:'',unit:'',avatarDataUrl:'',keepMenuOpen:true};
}
async function profileReadStored(bucket,hash){
 const object=await bucket.get(USER_PROFILE_PREFIX+hash+'.json');if(!object)return null;
 let saved,profile;
 try{saved=await object.json();}catch{profileStorageInvalid();}
 if(!profilePlain(saved)||saved.schemaVersion!==1||saved.principalHash!==hash||typeof saved.revision!=='string'||!saved.revision||saved.revision.length>100||typeof saved.updatedAt!=='string'||!Number.isFinite(Date.parse(saved.updatedAt))||typeof object.etag!=='string'||!object.etag)profileStorageInvalid();
 try{profile=profileNormalize(saved.profile);}catch{profileStorageInvalid();}
 return {etag:object.etag,value:{schemaVersion:1,principalHash:hash,revision:saved.revision,updatedAt:saved.updatedAt,profile}};
}
const profilePublicDocument=(access,value,displayName)=>({profile:value?.profile||profileDefault(access,displayName),revision:value?.revision||null,updatedAt:value?.updatedAt||null,identity:profileIdentity(access)});
export async function readUserProfile(bucket,access,{displayName}={}){
 const hash=await profilePrincipalHash(access),found=await profileReadStored(bucket,hash);
 return profilePublicDocument(access,found?.value,displayName);
}
export async function saveUserProfile(bucket,access,input,{validate=async()=>{},now=()=>Date.now()}={}){
 if(!profilePlain(input)||Object.keys(input).length!==2||!profileOwn(input,'revision')||!profileOwn(input,'profile')||!(input.revision===null||(typeof input.revision==='string'&&input.revision.length>0&&input.revision.length<=100)))profileInvalid();
 const profile=profileNormalize(input.profile),hash=await profilePrincipalHash(access),found=await profileReadStored(bucket,hash);
 if(input.revision!==(found?.value.revision||null))profileChanged();
 await validate();
 const value={schemaVersion:1,principalHash:hash,revision:crypto.randomUUID(),updatedAt:new Date(now()).toISOString(),profile};
 const written=await bucket.put(USER_PROFILE_PREFIX+hash+'.json',JSON.stringify(value),{httpMetadata:{contentType:'application/json; charset=utf-8'},onlyIf:found?{etagMatches:found.etag}:{etagDoesNotMatch:'*'}});
 if(!written)profileChanged();
 return profilePublicDocument(access,value);
}
