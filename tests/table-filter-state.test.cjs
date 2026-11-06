'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){const window={addEventListener(){}},document={addEventListener(){},createElement(){let html='';return {set innerHTML(value){html=value;},content:{querySelectorAll:()=>[],get textContent(){return html.replace(/<[^>]*>/g,'');}}};}};vm.runInNewContext(fs.readFileSync(require.resolve('../dist/table-filters.js'),'utf8'),{window,document,Intl});return window.MinervaTableFilters;}
const plain=value=>JSON.parse(JSON.stringify(value));
test('table state roundtrip filters current rows and sorts without source rows or callbacks',()=>{
 const F=fixture();let changes=0;F.onChange(()=>changes++);
 const saved={tables:[{id:'claims',filters:[{column:0,values:['A','B']}],sort:{column:1,direction:'desc'},rows:[{secret:'not persisted'}],headers:['not persisted']}]};
 F.importState(saved);const cells=r=>[r.name,String(r.amount)],headers=['Fornecedor','Valor USD'];
 const rows=[{name:'A',amount:12},{name:'B',amount:40},{name:'C',amount:900}];
 assert.deepEqual(F.prepare('claims',headers,rows,cells).map(r=>r.amount),[40,12]);
 const exported=plain(F.exportState());assert.deepEqual(exported,{tables:[{id:'claims',filters:[{column:0,values:['A','B']}],sort:{column:1,direction:'desc'}}]});assert.equal(changes,0);
 F.importState(exported);assert.deepEqual(F.prepare('claims',headers,[{name:'B',amount:50},{name:'C',amount:999}],cells).map(r=>r.amount),[50]);
 F.importState({tables:[]});assert.equal(F.has('claims'),false);assert.equal(F.getSort('claims'),null);assert.equal(changes,0);
});
test('sanitization whitelists bounded selections and preserves intentional empty filter',()=>{
 const F=fixture();const clean=plain(F.sanitizeState({tables:[null,{id:'bad\n',filters:[]},{id:'x'.repeat(101),filters:[]},{id:'safe',filters:[{column:-1,values:['x']},{column:101,values:['x']},{column:0,values:['A','A',17,'x'.repeat(301)]},{column:0,values:['B']},{column:1,values:[]}],sort:{column:1,direction:'desc',extra:true},rows:[{private:true}]},{id:'safe',filters:[],sort:{column:0,direction:'asc'}},{id:'none',filters:[],sort:{column:0,direction:'invalid'}}]}));
 assert.deepEqual(clean,{tables:[{id:'safe',filters:[{column:0,values:['A']},{column:1,values:[]}],sort:{column:1,direction:'desc'}}]});
 F.importState(clean);assert.equal(F.prepare('safe',['Name','State'],[{name:'A'}],r=>[r.name,'Ready']).length,0);
 const large=F.sanitizeState({tables:Array.from({length:110},(_,i)=>({id:'t'+i,filters:[{column:0,values:Array.from({length:510},(_,j)=>'v'+j)}],sort:null}))});assert.equal(large.tables.length,100);assert.equal(large.tables[0].filters[0].values.length,500);
 assert.deepEqual(plain(F.sanitizeState(null)),{tables:[]});
});
