const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const E=require('../dist/engine.js');
const hash=value=>createHash('sha256').update(value).digest('hex');
const targets=(model,bd,control)=>E.correctionReviewTargets(model,bd,control).map(target=>({...target,key:hash(target.identity)}));
function sources(){
 const bh=Array(64).fill(null),ch=Array(32).fill(null),claim=Array(64).fill(null),paid=Array(32).fill(null);
 Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',16:'Área negociação',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
 Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',9:'N° Confissão',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',23:'Pagamento',30:'ANO COMPENSAÇÃO',31:'ANALISTA'});
 Object.assign(claim,{0:'QA-A',1:'2025-02-03',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',22:'QA/A',25:'EXPORTAÇÃO - CTNR',28:'FORNECEDOR QA',35:100,40:80});
 Object.assign(paid,{1:2026,3:'ME',7:'QA/A',9:'QA CONF',10:'FORNECEDOR QA',11:'Boleto',12:'Pago',14:50,17:'2026-02-01',19:50,20:100,30:2026});
 const missing=[...claim];Object.assign(missing,{0:'QA-B',22:'QA/B',25:null});
 const orphan=[...paid];Object.assign(orphan,{7:'QA/ORPHAN',12:'Vencido',14:75,17:null,19:0});
 return {bd:[bh,claim,missing],control:[ch,paid,orphan]};
}
const analyze=data=>E.analyze(data.bd,data.control,{allYears:true,asOf:'2026-11-10'});

test('every connected warning is a target, including standalone BD, Controle and financial audits',()=>{
 const data=sources(),model=analyze(data),before=JSON.stringify(model),items=targets(model,data.bd,data.control);
 assert(items.length>=3);assert(items.every(target=>/^[a-f0-9]{64}$/.test(target.key)));
 assert(items.some(({item})=>item.issues.some(issue=>issue.kind==='BD_MISSING_OPERATION')));
 assert(items.some(({item})=>item.issues.some(issue=>issue.kind==='CONTROL_WITHOUT_BD')));
 assert(items.some(({item})=>item.audits.some(audit=>audit.hasReceivedMismatch)));
 assert.equal(JSON.stringify(model),before,'Building keys never changes values or source objects');
 for(const {item,key}of items)for(const source of [...item.groups,...item.audits,...item.issues])source.reviewProgress={key,done:true,updatedAt:'2026-11-10T12:00:00Z',updatedBy:'QA'};
 assert(E.buildCorrectionReviewItems(model).every(item=>item.progress?.done&&item.progress.key));
});

test('raw and projection-v3 sources have identical keys; coordinates and source ordering do not define identity',async()=>{
 const {projectClientRows}=await import('../worker/client-report.js'),data=sources();
 data.bd[1][60]='UNUSED PRIVATE';data.control[1][5]='UNUSED PRIVATE';
 const projected={bd:projectClientRows('bd',data.bd),control:projectClientRows('control',data.control)};
 const keys=value=>targets(analyze(value),value.bd,value.control).map(target=>target.key).sort();
 assert.deepEqual(keys(data),keys(projected));
 const reordered={bd:[data.bd[0],...data.bd.slice(1).reverse()],control:[data.control[0],...data.control.slice(1).reverse()]};assert.deepEqual(keys(reordered),keys(data));
 const model=analyze(data),baseline=targets(model,data.bd,data.control).map(target=>target.key).sort();
 for(const entry of [...model.issues,...model.baseReconciliation.rows]){entry.detail='New translated instructions';entry.type='Renamed title';entry.id='new-ui-id';entry.sourceCells=['BD!Z9000'];}
 for(const group of model.correctionGroups){group.id='new-group-id';for(const change of group.changes)change.field='Renamed display label';}
 assert.deepEqual(targets(model,data.bd,data.control).map(target=>target.key).sort(),baseline);
});

test('a new problem, changed source value or additional installment creates a pending identity',()=>{
 const data=sources(),model=analyze(data),original=targets(model,data.bd,data.control).find(target=>target.item.controlRows.includes(2));assert(original);
 const changed=structuredClone(data);changed.control[1][14]=51;assert.notEqual(targets(analyze(changed),changed.bd,changed.control).find(target=>target.item.controlRows.includes(2)).key,original.key);
 const added=structuredClone(data);added.control.push([...added.control[1]]);assert.notEqual(targets(analyze(added),added.bd,added.control).find(target=>target.item.controlRows.includes(2)).key,original.key);
 const invalid=structuredClone(data);invalid.control[1][17]='invalid date';assert.notEqual(targets(analyze(invalid),invalid.bd,invalid.control).find(target=>target.item.controlRows.includes(2)).key,original.key);
});

test('year, supplier, operation and situation filters preserve the identity of unchanged connected source rows',()=>{
 const data=sources();data.bd=[data.bd[0]];data.control=[data.control[0]];
 for(const [index,year]of [2025,2026].entries()){
  const b=Array(64).fill(null),c=Array(32).fill(null);
  Object.assign(b,{0:'FILTER QA '+index,1:year+'-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',22:'DEMO/'+index,25:'EXPORTAÇÃO - CTNR',28:'EXEMPLO '+index,35:100,40:50});
  Object.assign(c,{1:2024,3:'MI',7:'DEMO/'+index,10:'EXEMPLO '+index,11:'Boleto',12:'Pago',13:'2026-01-01',14:40,17:'2026-01-01',19:30,20:110});data.bd.push(b);data.control.push(c);
 }
 const baseline=E.analyze(data.bd,data.control,{allYears:true,asOf:'2026-11-10'}),expected=new Map(targets(baseline,data.bd,data.control).map(target=>[target.item.bdRows.join(','),target.key]));
 for(const options of [{years:[2026]},{allYears:true,suppliers:['EXEMPLO 0']},{allYears:true,operations:['EXPORTAÇÃO - CTNR']},{allYears:true,claimStatuses:['EM ANÁLISE']},{allYears:true,controlOperations:['SEM OPERAÇÃO IDENTIFICADA']},{allYears:true,correctionScenario:'original'}]){
  const model=E.analyze(data.bd,data.control,{...options,asOf:'2026-11-10'}),actual=targets(model,data.bd,data.control);assert(actual.length);
  for(const target of actual)assert.equal(target.key,expected.get(target.item.bdRows.join(',')),JSON.stringify(options));
 }
 const unused=structuredClone(data);unused.bd[1][38]=999999;assert.deepEqual(targets(analyze(unused),unused.bd,unused.control).map(target=>target.key).sort(),[...expected.values()].sort(),'A derived loss cell outside the review sources cannot invalidate marks');
});

test('indistinguishable disconnected records retain multiplicity without sharing acknowledgements',()=>{
 const row=Array(64).fill(null);Object.assign(row,{0:'DUPLICATE QA',6:'EM ANÁLISE',28:'QA'});
 const build=count=>({bd:[[],...Array.from({length:count},()=>[...row])],control:[[]],model:{correctionGroups:[],claimValueAudit:{rows:[]},baseReconciliation:{rows:Array.from({length:count},(_,i)=>({kind:'BD_MISSING_OPERATION',source:'BD',row:i+2,bdRows:[i+2],controlRows:[],reference:'',supplier:'QA'}))},issues:[]}});
 const two=build(2),prior=targets(two.model,two.bd,two.control);assert.equal(new Set(prior.map(target=>target.key)).size,2);
 for(const source of prior[0].item.issues)source.reviewProgress={key:prior[0].key,done:true};assert.equal(E.buildCorrectionReviewItems(two.model).filter(item=>item.progress?.done).length,1);
 const three=build(3),next=targets(three.model,three.bd,three.control);assert.deepEqual(next.slice(0,2).map(target=>target.key),prior.map(target=>target.key));assert(!prior.some(target=>target.key===next[2].key));
 two.model.baseReconciliation.rows.reverse();assert.deepEqual(targets(two.model,two.bd,two.control).map(target=>target.key).sort(),prior.map(target=>target.key).sort());
});

test('legacy marks cover only already acknowledged group problems, never an independent new warning',()=>{
 const progress={key:'a'.repeat(64),done:true,updatedAt:'2026-11-10T12:00:00Z',updatedBy:'QA'},group={progress,changes:[{row:2,cell:'B2',original:2026,corrected:2025}]};
 const item={groups:[group],audits:[],issues:[]};assert.equal(E.correctionReviewLegacyProgress(item),progress);
 item.issues.push({kind:'CONTROL_RNC_YEAR_MISMATCH',row:2,originalYear:2026,correctedYear:2025});assert.equal(E.correctionReviewLegacyProgress(item),progress);
 item.issues.push({kind:'BD_MISSING_OPERATION',row:2});assert.equal(E.correctionReviewLegacyProgress(item),null);item.issues.pop();
 item.audits.push({complete:true,hasReceivedMismatch:true,controlRows:[2]});assert.equal(E.correctionReviewLegacyProgress(item),null);
});
