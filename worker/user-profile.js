// Personal presentation settings are kept apart from access decisions and audit
// identities. The caller supplies only a server-resolved, approved principal.
export const USER_PROFILE_PREFIX='private/user-profiles-v1/';
export const USER_PROFILE_AVATAR_BYTES=512*1024;
export const USER_PROFILE_BODY_BYTES=720000;
const profileFields=Object.freeze(['name','employeeId','jobTitle','department','unit','avatarDataUrl','keepMenuOpen']);
const profileManagerFields=Object.freeze(['managerId','managerName']);
const profileAdministrativeFields=Object.freeze(['name','employeeId','jobTitle','department','unit','managerId','managerName']);
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
 if(!profilePlain(value)||profileFields.some(key=>!profileOwn(value,key))||Object.keys(value).some(key=>!profileFields.includes(key)&&!profileManagerFields.includes(key)&&key!=='showInOrganization'))profileInvalid();
 const profile={};
 for(const [field,max]of Object.entries(profileTextLimits)){
  if(typeof value[field]!=='string'||value[field].length>max||/[\u0000-\u001f\u007f]/.test(value[field]))profileInvalid();
  profile[field]=value[field].trim();
 }
 if(profile.name.length<2)profileFail(400,'PROFILE_NAME_REQUIRED','Informe seu nome completo.');
 if(typeof value.keepMenuOpen!=='boolean')profileInvalid();
 profile.avatarDataUrl=profileAvatarValue(value.avatarDataUrl);profile.keepMenuOpen=value.keepMenuOpen;
 if(profileOwn(value,'showInOrganization')&&typeof value.showInOrganization!=='boolean')profileInvalid();
 profile.showInOrganization=value.showInOrganization??true;
 for(const [field,max]of [['managerId',100],['managerName',160]]){
  const text=value[field]===undefined?'':value[field];
  if(typeof text!=='string'||text.length>max||/[\u0000-\u001f\u007f]/.test(text))profileInvalid();
  profile[field]=text.trim();
 }
 if(profile.managerId&&profile.managerName)profileFail(400,'PROFILE_MANAGER_INVALID','Selecione uma pessoa do painel ou informe um gestor externo.');
 return profile;
}
async function profileHashId(id,admin){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode((admin?'admin:':'member:')+id));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function profilePrincipalHash(access){
 const person=access.admin||access.member;
 if(!access.authenticated||!access.approved||!person?.id)profileFail(403,'PROFILE_ACCESS_REQUIRED','Entre em uma conta aprovada para acessar seu perfil.');
 return profileHashId(person.id,!!access.admin);
}
function profileIdentity(access){
 const person=access.admin||access.member;
 return {userId:person.id,email:access.identity?.email||person.email||'',role:access.role};
}
function profileDefault(access,displayName){
 const person=access.admin||access.member;
 return {name:displayName||person.name||'',employeeId:'',jobTitle:'',department:'',unit:'',avatarDataUrl:'',keepMenuOpen:true,managerId:'',managerName:'',showInOrganization:true};
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
// Principals are supplied by the backend after checking the current ACL. The
// Manager selection exposes workplace labels only. The administrative
// organization view may also display the already validated profile photo.
export async function readProfileDirectory(bucket,principals,{organization=false,relationships=false}={}){
 const people=[];
 for(let offset=0;offset<principals.length;offset+=8){
  const batch=await Promise.all(principals.slice(offset,offset+8).map(async person=>{
   const found=await profileReadStored(bucket,await profileHashId(person.id,person.admin===true));
   const value=found?.value.profile;
   return {id:person.id,name:value?.name||person.name,jobTitle:value?.jobTitle||'',department:value?.department||'',unit:value?.unit||'',...(organization||relationships?{managerId:value?.managerId||'',managerName:value?.managerName||''}:{}),...(organization?{avatarDataUrl:value?.avatarDataUrl||'',showInOrganization:value?.showInOrganization??true}:{})};
  }));people.push(...batch);
 }
 people.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.id.localeCompare(b.id));
 // Manager validation uses the complete stored graph. Visibility changes only
 // the administrative presentation, never the saved manager links or access.
 if(!organization)return {people};
 const directory=new Map(people.map(person=>[person.id,person]));
 return {people:people.filter(person=>person.showInOrganization).map(person=>{
  const {showInOrganization,...visible}=person;
  if(directory.get(visible.managerId)?.showInOrganization===false){
   const visited=new Set([visible.id]);let managerId=visible.managerId;
   while(managerId&&directory.get(managerId)?.showInOrganization===false&&!visited.has(managerId)){
    visited.add(managerId);managerId=directory.get(managerId).managerId;
   }
   visible.managerId=managerId&&!visited.has(managerId)&&directory.get(managerId)?.showInOrganization===true?managerId:'';
   visible.managerName='';
  }
  return visible;
 })};
}
export function validateProfileManager(profile,userId,people){
 // This checks a current directory snapshot, not a cross-profile transaction.
 // Concurrent reciprocal changes can still race; readers must retain people
 // and flag invalid links instead of dropping cyclic or unresolved branches.
 if(!profile.managerId)return;
 const directory=new Map(people.map(person=>[person.id,person]));
 if(profile.managerId===userId||!directory.has(profile.managerId))profileFail(400,'PROFILE_MANAGER_INVALID','Selecione outro gestor com acesso aprovado ao painel.');
 const visited=new Set([userId]);let manager=profile.managerId;
 while(manager){
  if(visited.has(manager))profileFail(400,'PROFILE_MANAGER_CYCLE','Esse vínculo criaria um ciclo entre gestores. Escolha outro gestor.');
  visited.add(manager);manager=directory.get(manager)?.managerId||'';
 }
}
function profileValidateEnvelope(input){
 if(!profilePlain(input)||Object.keys(input).length!==2||!profileOwn(input,'revision')||!profileOwn(input,'profile')||!(input.revision===null||(typeof input.revision==='string'&&input.revision.length>0&&input.revision.length<=100)))profileInvalid();
}
async function profileWriteStored(bucket,access,profile,hash,found,{validate=async()=>{},now=()=>Date.now()}={}){
 if(profile.managerId===(access.admin||access.member).id)profileFail(400,'PROFILE_MANAGER_INVALID','Você não pode ser seu próprio gestor.');
 await validate(profile);
 const value={schemaVersion:1,principalHash:hash,revision:crypto.randomUUID(),updatedAt:new Date(now()).toISOString(),profile};
 const written=await bucket.put(USER_PROFILE_PREFIX+hash+'.json',JSON.stringify(value),{httpMetadata:{contentType:'application/json; charset=utf-8'},onlyIf:found?{etagMatches:found.etag}:{etagDoesNotMatch:'*'}});
 if(!written)profileChanged();
 return profilePublicDocument(access,value);
}
export async function saveUserProfile(bucket,access,input,options={}){
 profileValidateEnvelope(input);
 const profile=profileNormalize(input.profile),hash=await profilePrincipalHash(access),found=await profileReadStored(bucket,hash);
 if(input.revision!==(found?.value.revision||null))profileChanged();
 const visibility=found?.value.profile.showInOrganization??true;
 if(profileOwn(input.profile,'showInOrganization')&&profile.showInOrganization!==visibility)profileFail(403,'PROFILE_VISIBILITY_ADMIN_REQUIRED','A exibição no organograma é definida pela administração em Usuários E Solicitações.');
 profile.showInOrganization=visibility;
 // An older client that sends only the original fields must not erase a link.
 if(!profileManagerFields.some(field=>profileOwn(input.profile,field)))for(const field of profileManagerFields)profile[field]=found?.value.profile[field]||'';
 return profileWriteStored(bucket,access,profile,hash,found,options);
}
export async function saveMemberProfile(bucket,target,input,options={}){
 profileValidateEnvelope(input);
 if(!profilePlain(input.profile)||profileAdministrativeFields.some(field=>!profileOwn(input.profile,field))||Object.keys(input.profile).some(field=>!profileAdministrativeFields.includes(field)&&!['avatarDataUrl','showInOrganization'].includes(field)))profileFail(400,'PROFILE_ADMIN_FIELDS_INVALID','Edite somente os dados pessoais, a foto, o local de trabalho, o gestor e a exibição no organograma.');
 const hash=await profilePrincipalHash(target),found=await profileReadStored(bucket,hash);
 if(input.revision!==(found?.value.revision||null))profileChanged();
 const profile=profileNormalize({...input.profile,avatarDataUrl:profileOwn(input.profile,'avatarDataUrl')?input.profile.avatarDataUrl:found?.value.profile.avatarDataUrl||'',keepMenuOpen:found?.value.profile.keepMenuOpen??true,showInOrganization:profileOwn(input.profile,'showInOrganization')?input.profile.showInOrganization:found?.value.profile.showInOrganization??true});
 return profileWriteStored(bucket,target,profile,hash,found,options);
}
