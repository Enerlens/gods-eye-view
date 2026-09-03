import puppeteer from 'puppeteer';
const URL='http://localhost:4290/?welcome=0';
const b=await puppeteer.launch({headless:'new',protocolTimeout:180000,args:['--no-sandbox','--window-size=1600,1000']});
const p=await b.newPage();
await p.setViewport({width:1600,height:1000});
await p.goto(URL,{waitUntil:'domcontentloaded',timeout:120000});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<40;i++){const ok=await p.evaluate(()=>!!window.__godsEyeView?.dataManager);if(ok)break;await sleep(500);}
// expand data panel
await p.evaluate(()=>{
  const panel=document.getElementById('data-panel');
  if(panel&&panel.classList.contains('collapsed')){const btn=panel.querySelector('.panel-collapse-btn');if(btn)btn.click();}
});
await sleep(800);
const out={};
// --- C1: focus ring on .data-toggle-btn
out.c1=await p.evaluate(()=>{
  const el=document.querySelector('#data-toggles .data-toggle-btn');
  if(!el)return{err:'no btn'};
  const strip=(s)=>s.replace(/:focus-visible|:focus-within|:focus|:active|:hover/g,'');
  const hits=[];
  for(const sh of document.styleSheets){
    let rules;try{rules=sh.cssRules}catch(e){continue}
    const walk=(rs)=>{for(const r of rs){
      if(r.cssRules&&!r.selectorText){walk(r.cssRules);continue}
      if(!r.selectorText)continue;
      if(!/:focus/.test(r.selectorText))continue;
      for(const sel of r.selectorText.split(',')){
        const s=sel.trim();
        if(!/:focus/.test(s))continue;
        let m=false;try{m=el.matches(strip(s))}catch(e){}
        if(m)hits.push({href:sh.href?sh.href.split('/').pop():'inline',sel:s,css:r.style.cssText});
      }
    }};
    walk(rules);
  }
  const cs=getComputedStyle(el);
  return{hits,outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,boxShadow:cs.boxShadow,text:el.textContent};
});
// visual: tab to a data-toggle-btn and diff computed styles + pixels
const c1v=await p.evaluate(()=>{
  const el=document.querySelector('#data-toggles .data-toggle-btn');
  const snap=(e)=>{const c=getComputedStyle(e);return{outline:c.outline,boxShadow:c.boxShadow,bg:c.backgroundColor,bc:c.borderColor,color:c.color};};
  const before=snap(el);
  el.focus();
  const afterFocus=snap(el);
  const matchesFV=(()=>{try{return el.matches(':focus-visible')}catch(e){return 'unsupported'}})();
  return{before,afterFocus,matchesFV,active:document.activeElement===el};
});
out.c1visual=c1v;
// real keyboard tab
await p.evaluate(()=>document.getElementById('data-toggles').scrollIntoView());
const tabres=await (async()=>{
  await p.evaluate(()=>{const el=document.querySelector('#data-toggles .data-toggle-btn'); el.previousElementSibling; el.focus();});
  return await p.evaluate(()=>{
    const el=document.activeElement;
    return {tag:el.tagName,cls:el.className,fv:(()=>{try{return el.matches(':focus-visible')}catch(e){return null}})()};
  });
})();
out.c1tab=tabres;
// --- C2: disabled controls
out.c2=await p.evaluate(()=>{
  const ids=['scene-stop-btn','radio-play-btn','radio-stop-btn','radio-prev-btn'];
  const r={};
  for(const id of ids){const e=document.getElementById(id);if(!e){r[id]='missing';continue}
    const c=getComputedStyle(e);
    r[id]={disabled:e.disabled,ariaDisabled:e.getAttribute('aria-disabled'),opacity:c.opacity,cursor:c.cursor,visible:e.offsetParent!==null,rect:e.getBoundingClientRect().width};}
  return r;
});
// --- C3: :active on data-toggle-btn (synthetic + real mouse handled after)
// --- C4: feed-loading vs active colours, measured live via injected clones
out.c4=await p.evaluate(()=>{
  const host=document.querySelector('#data-toggles');
  const mk=(cls)=>{const b=document.createElement('button');b.className=cls;b.textContent='X';host.appendChild(b);const c=getComputedStyle(b);const o={color:c.color,bg:c.backgroundColor,border:c.borderColor,shadow:c.boxShadow,minWidth:c.minWidth,ls:c.letterSpacing};b.remove();return o;};
  return{
    off:mk('data-toggle-btn'),
    on:mk('data-toggle-btn active feed-nominal'),
    loading:mk('data-toggle-btn active feed-loading'),
    stale:mk('data-toggle-btn active feed-stale'),
    degraded:mk('data-toggle-btn active feed-degraded'),
    unavailable:mk('data-toggle-btn active feed-unavailable'),
    transitioning:mk('data-toggle-btn transitioning enabling'),
    uncertain:mk('data-toggle-btn lifecycle-uncertain'),
  };
});
// --- C6: satellites legend items clickable?
out.layerIds=await p.evaluate(()=>[...document.querySelectorAll('#data-toggles [data-layer-id]')].map(e=>e.dataset.layerId).length);
console.log(JSON.stringify(out,null,1));
await b.close();
