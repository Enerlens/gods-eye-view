import puppeteer from 'puppeteer';
const URL='http://localhost:4291/?welcome=0';
const b=await puppeteer.launch({headless:'new',protocolTimeout:180000,args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage','--disable-web-security','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1600,1000']});
const p=await b.newPage();await p.setViewport({width:1600,height:1000});
await p.goto(URL,{waitUntil:'domcontentloaded',timeout:120000});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<90;i++){const ok=await p.evaluate(()=>!!(window.__godsEyeView?.dataManager)).catch(()=>0);if(ok)break;await sleep(1000);}
const pump=(n=20)=>p.evaluate(k=>{for(let i=0;i<k;i++)window.__godsEyeView.viewer.scene.render();},n);
const setv=(lon,lat,alt,pitch=-90,head=0)=>p.evaluate(a=>{const{viewer}=window.__godsEyeView;viewer.camera.cancelFlight();viewer.camera.setView({destination:viewer.camera.position.constructor.fromDegrees(a.lon,a.lat,a.alt),orientation:{heading:a.head*Math.PI/180,pitch:a.pitch*Math.PI/180,roll:0}});for(let i=0;i<12;i++)viewer.scene.render();},{lon,lat,alt,pitch,head});
const lum=rgb=>{const[r,g,bb]=rgb.map(v=>{const c=v/255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*bb;};
const sample=pts=>p.evaluate(pts=>{const{viewer}=window.__godsEyeView;const sc=viewer.scene;for(let i=0;i<20;i++)sc.render();
  const cv=viewer.canvas;const off=document.createElement('canvas');off.width=cv.width;off.height=cv.height;const ctx=off.getContext('2d');ctx.drawImage(cv,0,0);
  const C3=viewer.camera.position.constructor;const out=[];
  for(const q of pts){const w=C3.fromDegrees(q.lon,q.lat,0);const win=sc.cartesianToCanvasCoordinates(w);
    if(!win){out.push({n:q.n,err:'nowin'});continue;}
    const px=Math.round(win.x*(cv.width/cv.clientWidth)),py=Math.round(win.y*(cv.height/cv.clientHeight));
    if(px<0||py<0||px>=cv.width||py>=cv.height){out.push({n:q.n,err:'oob',px,py});continue;}
    const d=ctx.getImageData(px,py,1,1).data;out.push({n:q.n,px,py,rgb:[d[0],d[1],d[2]]});}
  return out;},pts);
const cam=()=>p.evaluate(()=>{const c=window.__godsEyeView.viewer.camera;const carto=window.__godsEyeView.viewer.scene.globe.ellipsoid.cartesianToCartographic(c.position);return{lon:+(carto.longitude*180/Math.PI).toFixed(3),lat:+(carto.latitude*180/Math.PI).toFixed(3),alt:Math.round(carto.height)};});
await p.evaluate(()=>window.__godsEyeView.dataManager.setEnabled('delinquance-fr',true,{origin:'qa'}));
await setv(2.4,46.6,1600000);
for(let i=0;i<20;i++){await sleep(5000);await pump();const n=await p.evaluate(()=>document.querySelectorAll('#data-toggles [data-layer-id="delinquance-fr"] .data-toggle-legend-item').length);if(n>=6)break;}
await setv(2.4,46.6,1600000); await sleep(4000); await pump(30);
console.log('cam',JSON.stringify(await cam()));
const PTS=[{n:'Finistere',lon:-4.1,lat:48.3},{n:'Cantal',lon:2.7,lat:45.05},{n:'Gironde',lon:-0.6,lat:44.8},{n:'Nord',lon:3.2,lat:50.4},{n:'Herault',lon:3.4,lat:43.6},{n:'Manche',lon:-1.3,lat:49.1},{n:'Aube',lon:4.1,lat:48.3},{n:'Loiret',lon:2.3,lat:47.9}];
const nA=await sample(PTS);
console.log('F5_NORMAL',JSON.stringify(nA.map(o=>({n:o.n,rgb:o.rgb,err:o.err,L:o.rgb?+lum(o.rgb).toFixed(4):null}))));
const legN=await p.evaluate(()=>[...document.querySelectorAll('#data-toggles [data-layer-id="delinquance-fr"] .data-toggle-legend-item')].map(i=>i.textContent.trim()));
console.log('legN',legN.length);
await p.screenshot({path:'/tmp/advK7/c-normal.png'}).catch(()=>{});
const clicked=await p.evaluate(()=>{const btn=document.querySelector('.style-btn[data-style="thermal"]');if(btn){btn.click();return btn.outerHTML.slice(0,120);}return 'NOBTN';});
console.log('thermalClick',clicked);
await sleep(4000);await pump(40);
console.log('cam after',JSON.stringify(await cam()));
const tA=await sample(PTS);
console.log('F5_THERMAL',JSON.stringify(tA.map(o=>({n:o.n,rgb:o.rgb,err:o.err,L:o.rgb?+lum(o.rgb).toFixed(4):null}))));
const legT=await p.evaluate(()=>[...document.querySelectorAll('#data-toggles [data-layer-id="delinquance-fr"] .data-toggle-legend-item')].map(i=>({t:i.textContent.trim(),sw:getComputedStyle(i.querySelector('.data-toggle-legend-swatch')).backgroundColor})));
console.log('LEG_THERMAL',JSON.stringify(legT));
await p.screenshot({path:'/tmp/advK7/c-thermal.png'}).catch(()=>{});
// F2: GSD at V-PARIS
await p.evaluate(()=>{const n=document.querySelector('.style-btn[data-style="normal"]');if(n)n.click();});
await sleep(2500);
await setv(2.3364,48.86,900,-35,160);
await sleep(6000);await pump(30);
const f2=await p.evaluate(()=>{const{viewer}=window.__godsEyeView;const sc=viewer.scene,cam=viewer.camera,cv=viewer.canvas;
  const C2=cv.clientWidth,H=cv.clientHeight;
  const ell=sc.globe.ellipsoid;
  const mpp=(fracY)=>{const y=H*fracY;const a=cam.pickEllipsoid({x:C2/2-50,y},ell),bq=cam.pickEllipsoid({x:C2/2+50,y},ell);
    if(!a||!bq)return null;const dx=a.x-bq.x,dy=a.y-bq.y,dz=a.z-bq.z;return Math.sqrt(dx*dx+dy*dy+dz*dz)/100;};
  return {gsd:document.getElementById('hud-gsd')?.textContent,alt:document.getElementById('hud-alt')?.textContent,
    mpp_top15:mpp(0.15),mpp_center:mpp(0.5),mpp_bot85:mpp(0.85),W:C2,H,fovy:sc.camera.frustum.fovy,
    scaleBar:!!document.querySelector('[class*="scale-bar"],[id*="scale-bar"],[class*="scalebar"]')};
});
console.log('F2',JSON.stringify(f2,null,1));
await p.screenshot({path:'/tmp/advK7/c-vparis.png'}).catch(()=>{});
await b.close();
