import puppeteer from 'puppeteer';
import { newQaPage } from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/scripts/lib/qa-first-run.mjs';
const browser = await puppeteer.launch({ headless:'new', protocolTimeout:120000,
  args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1600,1000'] });
const page = await newQaPage(browser);
await page.setViewport({width:1600,height:1000});
await page.goto('http://localhost:4290/?welcome=0',{waitUntil:'networkidle2',timeout:120000});
for(let i=0;i<120;i++){ const n=await page.evaluate(()=>document.querySelectorAll('#data-toggles [data-layer-id]').length); if(n>10) break; await new Promise(r=>setTimeout(r,500)); }
await page.evaluate(()=>{ document.getElementById('pp-toggles')?.classList.remove('collapsed'); });
await new Promise(r=>setTimeout(r,2000));
const read=async(t)=>page.evaluate((tag)=>{const d=document.getElementById('detection-toggle');const cs=getComputedStyle(d);
 return{tag,cls:d.className,label:d.querySelector('.pp-label').textContent,inline:d.style.cssText,bg:cs.backgroundColor,border:cs.borderTopColor,transition:cs.transition,anim:cs.animationName};},t);
const out=[await read('boot+2s')];
await page.keyboard.press('d');
await new Promise(r=>setTimeout(r,4000));
out.push(await read('off+4s'));
await page.evaluate(()=>{const v=window.__godsEyeView?.viewer; if(v) for(let i=0;i<10;i++) v.scene.render();});
await new Promise(r=>setTimeout(r,1500));
out.push(await read('off+after-render'));
console.log(JSON.stringify(out,null,1));
try{ await page.screenshot({path:'/tmp/ui-verif-detect-off.png', clip:{x:1330,y:60,width:270,height:400}});}catch(e){console.log('shot',e.message);}
await browser.close();
