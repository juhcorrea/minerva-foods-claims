/* Presentation projections from the existing BD snapshot. No imports, writes,
 * receipt calculations or changes to the operational/financial model. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MinervaMaterialsData=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const list=value=>Array.isArray(value)?value:[];
  const text=value=>value==null?'':String(value).trim();
  const norm=value=>text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
  const status=value=>{
    const key=norm(value).replace(/\s*[-–—]\s*/g,' - ');
    return key==='EM NEGOCIACAO PROCEDENTE'?'EM NEGOCIACAO - PROCEDENTE':key==='PROCEDENTE SEGURO'?'PROCEDENTE - SEGURO':key;
  };
  const NEGOTIATING='EM NEGOCIACAO - PROCEDENTE';
  const ELIGIBLE=['EM NEGOCIAÇÃO - PROCEDENTE','FINALIZADO SEM CUSTO','PREJUÍZO MINERVA','PROCEDENTE - SEGURO','RESSARCIMENTO ENCAMINHADO'];
  const PROCEDENT=new Set(ELIGIBLE.map(status));
  const UNKNOWN_CARRIER=new Set(['','NAO INFORMADO','NAO INFORMADA','SEM INFORMACAO','SEM ARMADOR','N/I','N/A','NA','-','0']);
  const number=value=>value===null||value===undefined||value===''||typeof value==='boolean'?null:Number.isFinite(Number(value))?Number(value):null;
  const money=value=>Math.round((value+Number.EPSILON)*100)/100;
  const yearsOf=values=>[...new Set(list(values).filter(value=>typeof value!=='boolean').map(Number).filter(value=>Number.isInteger(value)&&value>1900&&value<=9999))].sort((a,b)=>a-b);
  const monthsOf=values=>{const months=[...new Set(list(values).filter(value=>typeof value!=='boolean').map(Number).filter(value=>Number.isInteger(value)&&value>=1&&value<=12))].sort((a,b)=>a-b);return months.length===12?[]:months;};
  const civilDate=value=>{
    const date=text(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number(date.slice(0,4))<=1900)return null;
    const parsed=new Date(date+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:null;
  };
  const count=rows=>rows.reduce((total,row)=>total+(text(row.sgr)?1:0),0);
  const amount=rows=>rows.reduce((total,row)=>total+(row.claimed||0),0);
  const ordered=rows=>[...rows].sort((a,b)=>(b.claimed??-Infinity)-(a.claimed??-Infinity)||Number(a.row)-Number(b.row));
  const rowIds=rows=>rows.map(row=>row.row);
  const summarize=rows=>({total:money(amount(rows)),count:count(rows),recordCount:rows.length,rows:ordered(rows),rowIds:rowIds(rows)});
  function group(rows,field){
    const buckets=new Map();
    for(const row of rows){
      const label=text(row[field])||'Não informado',key=norm(label);
      if(!buckets.has(key))buckets.set(key,{name:label,rows:[]});
      buckets.get(key).rows.push(row);
    }
    return [...buckets.values()].map(bucket=>({name:bucket.name,...summarize(bucket.rows)})).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'pt-BR'));
  }
  function build(model={},options={}){
    const source=list(model.executiveReport?.controlClaims),sourceMeta=model.meta||{};
    const requestedYears=Array.isArray(options.years)?options.years:sourceMeta.allYears?[]:sourceMeta.years;
    const years=yearsOf(requestedYears),months=monthsOf(options.months),yearSet=new Set(years),monthSet=new Set(months);
    const asOf=civilDate(sourceMeta.asOf||model.executiveReport?.meta?.asOf);
    // Clone each record: projection sorting and consumers cannot mutate the
    // snapshot. Repeated SGRs are preserved as separate source rows.
    const allRows=source.map(sourceRow=>({...sourceRow,claimed:number(sourceRow.claimed),rncDate:civilDate(sourceRow.rncDate)}));
    const dateEligible=row=>row.rncDate&&(!asOf||row.rncDate<=asOf);
    const inPeriod=row=>(!yearSet.size||yearSet.has(Number(row.rncDate.slice(0,4))))&&(!monthSet.size||monthSet.has(Number(row.rncDate.slice(5,7))));
    const eligible=allRows.filter(row=>dateEligible(row)&&norm(row.reason)!=='INTERFERENCIA EXTERNA');
    const approvedRows=eligible.filter(row=>inPeriod(row)&&PROCEDENT.has(status(row.status)));
    const directors={...summarize(approvedRows),claimedProcedent:money(amount(approvedRows)),eligibleStatuses:[...ELIGIBLE],years:[...years],months:[...months],allYears:!years.length};
    directors.byCountry=group(approvedRows,'country');directors.byReason=group(approvedRows,'reason');
    directors.bySupplier=group(approvedRows,'supplier');directors.topSuppliers=directors.bySupplier.slice(0,10);
    // No selected month means the full historical negotiation portfolio.
    // A selected month restores the explicit RNC year AND month restriction.
    const pending=eligible.filter(row=>status(row.status)===NEGOTIATING&&(!monthSet.size||inPeriod(row)));
    const withoutFup=pending.filter(row=>!norm(row.pending).includes('FUP SUPRIMENTOS'));
    const legal=withoutFup.filter(row=>norm(row.supplier).includes('JURIDICO'));
    const negotiationRows=withoutFup.filter(row=>!norm(row.supplier).includes('JURIDICO'));
    const negotiation={...summarize(negotiationRows),allYears:!monthSet.size,years:monthSet.size?[...years]:yearsOf(withoutFup.map(row=>row.rncDate.slice(0,4))),months:[...months],legalTotal:money(amount(legal)),grandTotal:money(amount(withoutFup)),excludedFupCount:pending.length-withoutFup.length};
    negotiation.byCountry=group(negotiationRows,'country');negotiation.bySupplier=group(negotiationRows,'supplier');negotiation.byReason=group(negotiationRows,'reason');
    const carrierRows=negotiationRows.filter(row=>!UNKNOWN_CARRIER.has(norm(row.armador)));
    const carrierGroups=group(carrierRows,'armador'),carrierUniverse={total:money(amount(carrierRows)),count:count(carrierRows),carrierCount:carrierGroups.length};
    const carriers=carrierGroups.slice(0,3).map(carrier=>({...carrier,byReason:group(carrier.rows,'reason'),byCountry:group(carrier.rows,'country')}));
    return {
      meta:{source:'BD',asOf,years:[...years],months:[...months],yearsAvailable:yearsOf(allRows.filter(dateEligible).map(row=>row.rncDate.slice(0,4))),tab:['directors','carriers','fup'].includes(options.tab)?options.tab:'directors',suppliers:[...list(sourceMeta.suppliers)],operations:[...list(sourceMeta.operations)],excludedDateCount:allRows.filter(row=>!dateEligible(row)).length,missingCarrierCount:negotiationRows.length-carrierRows.length,missingCarrierAmount:money(amount(negotiationRows)-amount(carrierRows)),missingAmountCount:eligible.filter(row=>row.claimed===null).length,legalDetailAvailable:false,rounding:'Valores de origem preservados nas linhas; cada subtotal é arredondado a centavos após a soma.'},
      directors,approvedRows:directors.rows,negotiation,carriers,carrierUniverse
    };
  }
  return {build,version:'1.0.0'};
});
