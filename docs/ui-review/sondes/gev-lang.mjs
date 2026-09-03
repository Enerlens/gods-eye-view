import puppeteer from 'puppeteer';
import { newQaPage } from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/scripts/lib/qa-first-run.mjs';
setTimeout(()=>{console.log('{"TIMEOUT":true}');process.exit(1);},120000);
const b=await puppeteer.launch({headless:'new',protocolTimeout:110000,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page=await newQaPage(b);
await page.setViewport({width:1600,height:900,deviceScaleFactor:1});
await page.goto('http://localhost:4290/',{waitUntil:'domcontentloaded',timeout:60000});
for(let i=0;i<120;i++){ if(await page.evaluate(()=>Boolean(window.__godsEyeView?.viewer))) break; await new Promise(r=>setTimeout(r,500)); }
// ouvrir les panneaux principaux pour rendre le texte visible
await page.evaluate(()=>{ document.getElementById('data-panel')?.classList.remove('collapsed');
  document.getElementById('scene-panel')?.classList.remove('collapsed'); });
await new Promise(r=>setTimeout(r,1500));
const res=await page.evaluate(()=>{
  const FR=/[àâäéèêëîïôöùûüçœ]|(^|\s)(de|des|du|la|le|les|et|un|une|par|pour|sur|dans|aux?)(\s|$)/i;
  const EN=/(^|\s)(the|and|of|to|for|with|layer|data|view|show|hide|search|settings?|clear|close|open)(\s|$)/i;
  let fr=0,en=0,neutral=0; const samples={fr:[],en:[]};
  const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  let n; while((n=walk.nextNode())){
    const el=n.parentElement; if(!el) continue;
    if(el.closest('script,style')) continue;
    const cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden') continue;
    if(!el.getClientRects().length) continue;
    const t=n.textContent.trim(); if(t.length<3) continue;
    const isFr=FR.test(t), isEn=EN.test(t);
    if(isFr&&!isEn){fr++; if(samples.fr.length<8)samples.fr.push(t.slice(0,42));}
    else if(isEn&&!isFr){en++; if(samples.en.length<8)samples.en.push(t.slice(0,42));}
    else neutral++;
  }
  return {fr,en,neutral,samples};
});
console.log(JSON.stringify(res,null,2));
await b.close(); process.exit(0);
