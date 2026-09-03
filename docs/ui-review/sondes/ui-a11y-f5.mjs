import fs from 'node:fs';
import sharp from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/node_modules/sharp/lib/index.js';
import puppeteer from 'puppeteer';
import { newQaPage } from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/scripts/lib/qa-first-run.mjs';
const URL='http://localhost:4290/?welcome=0'; const VP={width:1440,height:900};
const browser=await puppeteer.launch({headless:'new',protocolTimeout:300000,args:['--enable-unsafe-swiftshader','--use-gl=swiftshader','--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding',`--window-size=${VP.width},${VP.height}`]});
const page=await newQaPage(browser); await page.setViewport(VP);
await page.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
for(let i=0;i<60;i++){ if(await page.evaluate(()=>Boolean(window.__godsEyeView?.dataManager))) break; await new Promise(r=>setTimeout(r,500)); }
const render=()=>page.evaluate(()=>{for(let i=0;i<10;i++)window.__godsEyeView.viewer.scene.render();});
const canvasShot=async(p)=>{const u=await page.evaluate(()=>window.__godsEyeView.viewer.scene.canvas.toDataURL('image/png'));
  fs.writeFileSync(p,Buffer.from(u.slice(u.indexOf(',')+1),'base64'));};
await page.evaluate(()=>{const{viewer}=window.__godsEyeView;viewer.camera.cancelFlight?.();const e=viewer.scene.globe.ellipsoid;
 viewer.camera.setView({destination:e.cartographicToCartesian({longitude:2.4*Math.PI/180,latitude:46.6*Math.PI/180,height:1600000}),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});for(let i=0;i<12;i++)viewer.scene.render();});
await page.evaluate(async()=>{await window.__godsEyeView.dataManager.setEnabled('delinquance-fr',true,{origin:'qa'});});
await new Promise(r=>setTimeout(r,9000)); await render();
await canvasShot('/tmp/ui-accessibilite-f5-normal.png');

// sample a grid of pixels inside metropolitan France
const grid=[]; for(let y=250;y<720;y+=18) for(let x=520;x<960;x+=18) grid.push([x,y]);
const sampleFrom=async(f)=>{const {data,info}=await sharp(f).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const d=info.width/VP.width; const out=[];
  for(const [x,y] of grid){const X=Math.round(x*d),Y=Math.round(y*d); if(X>=info.width||Y>=info.height)continue;
    const i=(Y*info.width+X)*info.channels; out.push([data[i],data[i+1],data[i+2]]);} return out;};
const normal=await sampleFrom('/tmp/ui-accessibilite-f5-normal.png');

// F5: switch to global FLIR (thermal) post-process
const styleRes=await page.evaluate(()=>{ const b=document.querySelector('button.style-btn[data-style="thermal"]'); if(!b) return {err:'no button'};
  b.click(); return {clicked:true, indicator:document.querySelector('#style-indicator')?.textContent||null};});
await new Promise(r=>setTimeout(r,3500)); await render();
await canvasShot('/tmp/ui-accessibilite-f5-flir.png');
const flir=await sampleFrom('/tmp/ui-accessibilite-f5-flir.png');
const legendAfter=await page.evaluate(()=>{const row=document.querySelector('#data-toggles [data-layer-id="delinquance-fr"]');
  return {swatches:[...(row?.querySelectorAll('.data-toggle-legend-swatch')||[])].map(s=>getComputedStyle(s).backgroundColor),
    filter:getComputedStyle(document.querySelector('#cesiumContainer')||document.body).filter,
    indicator:document.querySelector('#style-indicator')?.textContent||null,
    panelFilter:getComputedStyle(row||document.body).filter};});
try{ await page.screenshot({path:'/tmp/ui-accessibilite-f5-flir-full.png'}); }catch(e){}
await page.evaluate(()=>{document.querySelector('button.style-btn[data-style="normal"]')?.click();});
await new Promise(r=>setTimeout(r,1500));

// live-region probe with a REAL click on a layer row button
await page.evaluate(()=>{const p=document.querySelector('#data-panel'); if(p?.classList.contains('collapsed')) p.querySelector('.panel-collapse-btn')?.click();});
await new Promise(r=>setTimeout(r,700));
const live=await page.evaluate(async()=>{
  const nodes=[...document.querySelectorAll('[aria-live],[role="status"],[role="alert"]')];
  const snap=()=>nodes.map(n=>({sel:n.id||('.'+String(n.className).slice(0,24)), t:(n.textContent||'').trim()}));
  const before=snap();
  const row=[...document.querySelectorAll('#data-toggles [data-layer-id]')].find(r=>r.dataset.layerId==='earthquakes');
  const btn=row?.querySelector('button');
  const beforeLabel=btn?.getAttribute('aria-label');
  btn?.click();
  await new Promise(r=>setTimeout(r,3000));
  const after=snap();
  return { clicked:Boolean(btn), beforeLabel, afterLabel:btn?.getAttribute('aria-label'),
    ariaPressed:btn?.getAttribute('aria-pressed'), role:btn?.getAttribute('role'),
    changes: before.map((b,i)=>({sel:b.sel,before:b.t.slice(0,50),after:after[i].t.slice(0,50)})).filter(x=>x.before!==x.after) };});
fs.writeFileSync('/tmp/ui-a11y-5.json',JSON.stringify({styleRes,legendAfter,live,normalCount:normal.length},null,2));
// classify colour change
const lum=(rgb)=>{const[r,g,b]=rgb.map(v=>{const c=v/255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;};
let flipped=0, pairs=0;
for(let i=0;i<normal.length;i++) for(let j=i+1;j<normal.length;j+=37){
  const a=lum(normal[i]),b=lum(normal[j]),A=lum(flir[i]),B=lum(flir[j]);
  if(Math.abs(a-b)<0.02) continue; pairs++;
  if(Math.sign(a-b)!==Math.sign(A-B)) flipped++;}
console.log('style:',JSON.stringify(styleRes),'legendAfter:',JSON.stringify(legendAfter));
console.log('samples:',normal.length,'lum-order pairs tested:',pairs,'ORDER FLIPPED:',flipped,'('+(100*flipped/Math.max(1,pairs)).toFixed(1)+'%)');
console.log('mean lum normal:',(normal.reduce((s,c)=>s+lum(c),0)/normal.length).toFixed(3),'flir:',(flir.reduce((s,c)=>s+lum(c),0)/flir.length).toFixed(3));
console.log('LIVE:',JSON.stringify(live,null,1));
await browser.close();
