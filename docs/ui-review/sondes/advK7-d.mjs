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
await p.evaluate(()=>{const d=window.__godsEyeView.dataManager;['irve-fr','schools-fr','delinquance-fr'].forEach(i=>d.setEnabled(i,true,{origin:'qa'}));});
await setv(2.4,46.6,1600000);
for(let i=0;i<20;i++){await sleep(5000);await pump();const n=await p.evaluate(()=>document.querySelectorAll('#data-toggles [data-layer-id="delinquance-fr"] .data-toggle-legend-item').length);if(n>=6)break;}
await setv(2.4,46.6,1600000);await sleep(5000);await pump(30);
// A3: world overlay labels
const a3=await p.evaluate(()=>{const wo=window.__gevWorldOverlay;if(!wo)return{err:'no overlay handle',keys:Object.keys(window).filter(k=>/gev|godsEye/i.test(k))};
  const dump=(o)=>{try{return JSON.parse(JSON.stringify(o))}catch(e){return String(e)}};
  const out={type:typeof wo,keys:Object.keys(wo).slice(0,30)};
  for(const k of ['labels','items','entries','getLabels','list','snapshot']){if(typeof wo[k]==='function'){try{out['fn_'+k]=dump(wo[k]()).slice?dump(wo[k]()).slice(0,60):dump(wo[k]());}catch(e){out['fn_'+k]='ERR '+e.message;}}else if(wo[k]!==undefined){out['p_'+k]=dump(wo[k]);}}
  return out;});
console.log('A3_OVERLAY',JSON.stringify(a3).slice(0,3000));
await p.screenshot({path:'/tmp/advK7/d-snat-france.png'}).catch(()=>{});
// B3 hardening: 12 points inside Gironde at national altitude
const gpts=[];for(let i=0;i<4;i++)for(let j=0;j<3;j++)gpts.push({n:`gi${i}${j}`,lon:-1.0+i*0.35,lat:44.5+j*0.4});
const gs=await p.evaluate(pts=>{const{viewer}=window.__godsEyeView;const sc=viewer.scene;for(let i=0;i<20;i++)sc.render();
 const cv=viewer.canvas;const off=document.createElement('canvas');off.width=cv.width;off.height=cv.height;const ctx=off.getContext('2d');ctx.drawImage(cv,0,0);
 const C3=viewer.camera.position.constructor;return pts.map(q=>{const w=C3.fromDegrees(q.lon,q.lat,0);const win=sc.cartesianToCanvasCoordinates(w);if(!win)return{n:q.n,err:'nowin'};
  const px=Math.round(win.x*(cv.width/cv.clientWidth)),py=Math.round(win.y*(cv.height/cv.clientHeight));const d=ctx.getImageData(px,py,1,1).data;return{n:q.n,rgb:[d[0],d[1],d[2]]};});},gpts);
console.log('B3_NATIONAL',JSON.stringify(gs.map(o=>o.rgb?{n:o.n,rgb:o.rgb,L:+lum(o.rgb).toFixed(4)}:o)));
// live layers
await p.evaluate(()=>{const d=window.__godsEyeView.dataManager;['irve-fr','schools-fr','delinquance-fr'].forEach(i=>d.setEnabled(i,false,{origin:'qa'}));['flights','ais-live-vessels'].forEach(i=>d.setEnabled(i,true,{origin:'qa'}));});
await setv(10,48,12000000);
await sleep(25000);await pump(30);
const live=await p.evaluate(()=>{const{viewer}=window.__godsEyeView;const prims=viewer.scene.primitives;const res=[];
 for(let i=0;i<prims.length;i++){const c=prims.get(i);if(c&&c.constructor&&/BillboardCollection/.test(c.constructor.name)&&c.length>0){
   const alphas=new Set(),rgbs=new Set(),tbd=new Set(),sbd=new Set(),imgs=new Map(),dd=new Set(),scales=new Set();
   for(let j=0;j<c.length;j++){const bmp=c.get(j);alphas.add(+bmp.color.alpha.toFixed(3));rgbs.add([Math.round(bmp.color.red*255),Math.round(bmp.color.green*255),Math.round(bmp.color.blue*255)].join(','));
     tbd.add(bmp.translucencyByDistance?'set':'none');sbd.add(bmp.scaleByDistance?'set':'none');dd.add(bmp.disableDepthTestDistance);scales.add(+bmp.scale.toFixed(2));
     const k=typeof bmp.image==='string'?bmp.image.slice(0,90):'obj';imgs.set(k,(imgs.get(k)||0)+1);}
   res.push({idx:i,n:c.length,alphas:[...alphas],rgbs:[...rgbs].slice(0,6),tbd:[...tbd],sbd:[...sbd],disableDepth:[...dd].slice(0,4),scales:[...scales].sort((a,b)=>a-b).slice(0,12),nImages:imgs.size,topImgCounts:[...imgs.values()].sort((a,b)=>b-a).slice(0,10)});}}
 return {depthTestAgainstTerrain:viewer.scene.globe.depthTestAgainstTerrain,collections:res};});
console.log('LIVE',JSON.stringify(live,null,1).slice(0,3500));
await b.close();
