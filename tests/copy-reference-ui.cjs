const {chromium} = require('/opt/codex/cua_node/lib/node_modules/playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    const page = await browser.newPage(), errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    await page.setContent('<style>:root{--paper:#fff;--ink:#233b4d;--blue:#2e5372;--line:#e3e8e9;--pale:#edf3f6;--green:#2f7865;--green-pale:#edf5f1;--muted:#6d7d87;--canvas:#f5f6f4}[hidden]{display:none!important}</style><table><tbody><tr><td id="reference"></td></tr></tbody></table>');
    await page.addStyleTag({path:'dist/copy-reference.css'});
    await page.addScriptTag({path:'dist/copy-reference.js'});
    const reference='O/DEMO-3; SO/52&A" <NF>';
    await page.evaluate(reference=>{
      window.copied=[];window.detailOpens=0;
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>copied.push(value)}});
      const host=document.getElementById('reference');
      host.innerHTML='<span class="reference-with-copy"><button data-correction-detail="row">Ordem</button>'+MinervaCopy.button(reference)+'</span>';
      host.addEventListener('click',()=>detailOpens++);
    },reference);
    assert.equal(await page.locator('[data-copy-reference]').getAttribute('data-copy-reference'),reference,'Escaped attribute preserves original reference');
    await page.locator('[data-copy-reference]').click();
    assert.deepEqual(await page.evaluate(()=>copied),[reference]);
    assert.equal(await page.evaluate(()=>detailOpens),0,'Copy does not open the detail');
    assert.equal(await page.locator('#copyReferenceStatus').innerText(),'Copiado');
    assert.equal(await page.locator('#reference').innerText(),'Ordem','Status and icon add no text to filtering cell');
    await page.locator('[data-copy-reference]').focus();await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>copied.length),2,'Keyboard activation copies');
    await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('Permission denied');};window.fallbackCopied=null;document.execCommand=command=>{if(command!=='copy')return false;window.fallbackCopied=document.activeElement.value;return true;};});
    await page.locator('[data-copy-reference]').click();
    assert.equal(await page.evaluate(()=>fallbackCopied),reference,'Fallback copies exact original reference');
    assert.equal(await page.locator('.copy-reference-transfer').count(),0,'Temporary copy field removed');
    await page.evaluate(()=>{document.execCommand=()=>false;});
    await page.locator('[data-copy-reference]').click();
    await page.locator('.copy-reference-dialog[open]').waitFor();
    assert.equal(await page.locator('#copyReferenceManual').inputValue(),reference);
    assert.deepEqual(await page.locator('#copyReferenceManual').evaluate(el=>[el.selectionStart,el.selectionEnd]),[0,reference.length]);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.copy-reference-dialog').isVisible(),false);
    await page.waitForFunction(()=>document.getElementById('copyReferenceManual').value==='');
    assert.equal(await page.locator('#copyReferenceManual').inputValue(),'','Closed fallback clears the reference');
    assert.equal(await page.locator('[data-copy-reference]').evaluate(el=>el===document.activeElement),true);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,exactReference:true,noCellTextPollution:true,keyboard:true,clipboardFallback:true,manualFallback:true,errors}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
