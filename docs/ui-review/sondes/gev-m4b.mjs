import puppeteer from 'puppeteer';
import { newQaPage } from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/scripts/lib/qa-first-run.mjs';
const out={};
setTimeout(()=>{console.log(JSON.stringify({...out,TIMEOUT:true}));process.exit(1);},300000);
const b=await puppeteer.launch({headless:'new',protocolTimeout:280000,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page=await newQaPage(b);
await page.setViewport({width:1600,height:900,deviceScaleFactor:1});
await page.goto('http://localhost:4290/',{waitUntil:'domcontentloaded',timeout:60000});
for(let i=0;i<120;i++){ if(await page.evaluate(()=>Boolean(window.__godsEyeView?.dataManager))) break; await new Promise(r=>setTimeout(r,500)); }
await page.evaluate(()=>document.getElementById('data-panel')?.classList.remove('collapsed'));
await new Promise(r=>setTimeout(r,1200));
// vraies tabulations jusqu'à atteindre un .data-toggle-btn
let hops=0, reached=false;
await page.evaluate(()=>document.body.focus());
for(let i=0;i<200;i++){
  await page.keyboard.press('Tab'); hops++;
  reached = await page.evaluate(()=>document.activeElement?.classList.contains('data-toggle-btn'));
  if(reached) break;
}
out.hopsToFirstLayerToggle = reached ? hops : null;
await new Promise(r=>setTimeout(r,900));   // laisser finir transition: all var(--transition-fast)
out.focusVisible = await page.evaluate(()=>{
  const el=document.activeElement; if(!el) return 'aucun';
  const c=getComputedStyle(el);
  return { matchesFocusVisible: el.matches(':focus-visible'),
    id: el.className, boxShadow: c.boxShadow, borderColor: c.borderColor, outline: c.outlineStyle };
});
console.log(JSON.stringify(out,null,2));
await b.close(); process.exit(0);
