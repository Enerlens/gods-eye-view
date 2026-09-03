import puppeteer from 'puppeteer';
import { newQaPage } from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/scripts/lib/qa-first-run.mjs';
const out = {};
setTimeout(()=>{console.log(JSON.stringify({...out,TIMEOUT:true}));process.exit(1);},420000);
const b = await puppeteer.launch({ headless:'new', protocolTimeout:400000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await newQaPage(b);
await page.setViewport({ width:1600, height:900, deviceScaleFactor:1 });
await page.goto('http://localhost:4290/', { waitUntil:'domcontentloaded', timeout:60000 });
for(let i=0;i<120;i++){ if(await page.evaluate(()=>Boolean(window.__godsEyeView?.viewer))) break; await new Promise(r=>setTimeout(r,500)); }
const pump=()=>page.evaluate(()=>{for(let i=0;i<12;i++)window.__godsEyeView.viewer.scene.render();});
await page.evaluate(()=>{ const {viewer}=window.__godsEyeView; viewer.camera.cancelFlight();
  const C=viewer.camera.position.constructor; const rad=d=>d*Math.PI/180;
  viewer.camera.setView({destination:C.fromDegrees(2.3364,48.8600,700),orientation:{heading:0,pitch:rad(-75),roll:0}}); });
for(let i=0;i<25;i++){ await pump(); await new Promise(r=>setTimeout(r,600)); }

async function measure(tag){
  const rect = await page.evaluate(()=>{ const e=document.getElementById('hud-summary');
    const b=e.getBoundingClientRect();
    return {x:b.x,y:b.y,w:b.width,h:b.height,color:getComputedStyle(e).color,opacity:getComputedStyle(e).opacity}; });
  await page.evaluate(()=>{ const st=document.createElement('style'); st.id='__hideglyphs';
    st.textContent='#intel-hud, #intel-hud * { color: transparent !important; text-shadow: none !important; }';
    document.head.appendChild(st); });
  await pump();
  const shot = await page.screenshot({encoding:'base64'});
  await page.evaluate(()=>{ document.getElementById('__hideglyphs')?.remove(); });
  await pump();
  const px = await page.evaluate(async ({b64,rect})=>{
    const img=new Image(); img.src='data:image/png;base64,'+b64; await img.decode();
    const c=document.createElement('canvas'); c.width=img.width;c.height=img.height;
    const ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
    const sx=img.width/window.innerWidth, sy=img.height/window.innerHeight;
    const out=[];
    for(let i=0;i<24;i++) for(let j=0;j<3;j++){
      const x=Math.round((rect.x+rect.w*(i+0.5)/24)*sx), y=Math.round((rect.y+rect.h*(j+0.5)/3)*sy);
      const d=ctx.getImageData(x,y,1,1).data; out.push([d[0],d[1],d[2]]); }
    return out; }, {b64:shot,rect});
  return { tag, rect, px };
}
out.scopeOn = await measure('scope ON (défaut)');
out.scopeState = await page.evaluate(()=>{ const t=document.getElementById('scope-toggle');
  return { pressed:t?.getAttribute('aria-pressed'), classes:t?.className }; });
await page.evaluate(()=>{ document.getElementById('scope-toggle')?.click(); });
for(let i=0;i<8;i++){ await pump(); await new Promise(r=>setTimeout(r,400)); }
out.scopeAfter = await page.evaluate(()=>document.getElementById('scope-toggle')?.getAttribute('aria-pressed'));
out.scopeOff = await measure('scope OFF');
console.log(JSON.stringify(out));
await b.close(); process.exit(0);
