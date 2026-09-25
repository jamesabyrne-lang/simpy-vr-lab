import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const $ = id => document.getElementById(id);
const UI = {
  arrivalRate: $('arrivalRate'), meanService: $('meanService'), variability: $('variability'),
  servers: $('servers'), seed: $('seed'), speed: $('speed'), playPause: $('playPause'),
  restart: $('restartButton'), run: $('runButton'), status: $('statusText'), badge: $('engineBadge'),
  clock: $('kpiClock'), queue: $('kpiQueue'), wait: $('kpiWait'), util: $('kpiUtil'), throughput: $('kpiThroughput')
};
const DURATION = 120;
let pyodide, data = null, simTime = 0, playing = true, last = performance.now(), desks = [], agents = [];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06101c);
scene.fog = new THREE.FogExp2(0x06101c, 0.017);
const renderer = new THREE.WebGLRenderer({ canvas: $('sceneCanvas'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.05, 160);
camera.position.set(18, 14, 24);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.target.set(0, 1.6, 0); controls.minDistance = 6; controls.maxDistance = 55;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(0xb7ddff, 0x101928, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 4.2); sun.position.set(-8, 18, 10); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); scene.add(sun);
const glow1 = new THREE.PointLight(0x4cd8ff, 25, 32, 2); glow1.position.set(-8, 5, -7); scene.add(glow1);
const glow2 = new THREE.PointLight(0xffbd68, 20, 28, 2); glow2.position.set(8, 4, 7); scene.add(glow2);

const world = new THREE.Group(); scene.add(world);
const mat = {
  floor: new THREE.MeshStandardMaterial({ color: 0x111d2b, roughness: .82, metalness: .12 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0b1421, roughness: .42, metalness: .55 }),
  desk: new THREE.MeshStandardMaterial({ color: 0x243750, roughness: .35, metalness: .45 }),
  cyan: new THREE.MeshStandardMaterial({ color: 0x56d9ff, emissive: 0x143d4e, emissiveIntensity: 1.25 }),
  mint: new THREE.MeshStandardMaterial({ color: 0x66efc4, emissive: 0x10382e, emissiveIntensity: 1.25 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x91a8bb, roughness: .25, metalness: .8 })
};
function box(w,h,d,m,x,y,z){ const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m); o.position.set(x,y,z); o.castShadow=true;o.receiveShadow=true;world.add(o);return o; }
function sprite(text,color='#edf5ff'){
  const c=document.createElement('canvas'); c.width=768;c.height=160; const x=c.getContext('2d');
  x.fillStyle='rgba(6,14,25,.84)';x.roundRect(6,6,756,148,24);x.fill();x.strokeStyle='rgba(86,217,255,.45)';x.lineWidth=4;x.stroke();
  x.fillStyle=color;x.font='800 48px system-ui';x.textAlign='center';x.textBaseline='middle';x.fillText(text,384,80);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false}));s.scale.set(6,1.25,1);return s;
}

box(38,.35,24,mat.floor,0,-.2,0); const grid=new THREE.GridHelper(38,38,0x29485f,0x172a3b);grid.material.opacity=.42;grid.material.transparent=true;world.add(grid);
box(31,.04,5,new THREE.MeshStandardMaterial({color:0x102a3a,emissive:0x092333,emissiveIntensity:.8}),0,.01,0);
[-2.55,2.55].forEach(z=>box(31,.05,.07,mat.cyan,0,.04,z));
[-15,-7.5,0,7.5,15].forEach(x=>[-10.5,10.5].forEach(z=>box(.45,5.2,.45,mat.dark,x,2.6,z)));
const title=sprite('SECURITY  •  SCREENING');title.position.set(3.5,5.2,0);world.add(title);
const aSign=sprite('ARRIVALS','#66efc4');aSign.scale.set(3.5,.75,1);aSign.position.set(-14.2,3,-4);world.add(aSign);
const eSign=sprite('CLEARED','#66efc4');eSign.scale.set(3.5,.75,1);eSign.position.set(14.2,3,4);world.add(eSign);
box(.35,3.6,6.4,mat.dark,-15.2,1.8,0);box(.6,.35,6.4,mat.mint,-15,3.55,0);box(.35,3.6,6.4,mat.dark,15.2,1.8,0);box(.6,.35,6.4,mat.mint,15,3.55,0);

const postGeo=new THREE.CylinderGeometry(.06,.08,1,14), beltGeo=new THREE.BoxGeometry(3.2,.045,.045);
[[-9,-3.2],[-5.8,-3.2],[-2.6,-3.2],[-9,3.2],[-5.8,3.2],[-2.6,3.2]].forEach(p=>{const o=new THREE.Mesh(postGeo,mat.rail);o.position.set(p[0],.5,p[1]);world.add(o);});
[-3.2,3.2].forEach(z=>[-7.4,-4.2].forEach(x=>{const b=new THREE.Mesh(beltGeo,mat.cyan);b.position.set(x,.82,z);world.add(b);}));
[[-9,0],[-2.6,0]].forEach(p=>{const b=new THREE.Mesh(new THREE.BoxGeometry(.045,.045,6.4),mat.cyan);b.position.set(p[0],.82,p[1]);world.add(b);});

function setDesks(n){
  desks.forEach(d=>world.remove(d));desks=[];const gap=Math.min(4.2,12/Math.max(1,n-1)),z0=-(n-1)*gap/2;
  for(let i=0;i<n;i++){const g=new THREE.Group(),z=z0+i*gap;
    const base=new THREE.Mesh(new THREE.BoxGeometry(2.7,1.25,1.75),mat.desk);base.position.set(3.5,.63,z);base.castShadow=true;g.add(base);
    const scanner=new THREE.Mesh(new THREE.BoxGeometry(1.05,.18,.68),mat.cyan);scanner.position.set(3.8,1.35,z);g.add(scanner);
    const light=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,1.05,14),mat.mint.clone());light.position.set(4.7,1.9,z+.6);g.add(light);g.userData.light=light;
    const label=sprite('LANE '+(i+1));label.scale.set(2.3,.5,1);label.position.set(3.5,2.9,z);g.add(label);world.add(g);desks.push(g);
  }
}
setDesks(3);

function makeAgent(i){const g=new THREE.Group(),c=new THREE.Color().setHSL((i*.137)%1,.45,.58),body=new THREE.Mesh(new THREE.CapsuleGeometry(.28,.72,4,10),new THREE.MeshStandardMaterial({color:c,roughness:.6}));body.position.y=.78;body.castShadow=true;const head=new THREE.Mesh(new THREE.SphereGeometry(.23,14,10),new THREE.MeshStandardMaterial({color:0xf0c5a3,roughness:.8}));head.position.y=1.55;g.add(body,head);g.visible=false;world.add(g);return g;}
for(let i=0;i<180;i++)agents.push(makeAgent(i));
function qPoint(i){const cap=7,l=Math.floor(i/cap),s=i%cap,x=Math.max(-11.8,-2.4-l*3.2),z=l%2===0?-2.55+s*.82:2.55-s*.82;return new THREE.Vector3(x,0,z);}
function dPoint(i){const n=Number(UI.servers.value),gap=Math.min(4.2,12/Math.max(1,n-1)),z0=-(n-1)*gap/2;return new THREE.Vector3(1.85,0,z0+i*gap);}
const entrance=new THREE.Vector3(-14.3,0,0),exit=new THREE.Vector3(14.3,0,0),postExit=new THREE.Vector3(19,0,0);
const ease=t=>t*t*(3-2*t),move=(a,b,t)=>a.clone().lerp(b,ease(THREE.MathUtils.clamp(t,0,1)));
function state(p,t,map){if(t<p.arrival)return null;const q=qPoint(map.get(p.id)||0),s=p.service_start,d=p.departure;if(t<p.arrival+.55)return {p:move(entrance,q,(t-p.arrival)/.55)};if(s==null||t<s)return {p:q};const dp=dPoint(p.server||0);if(t<s+.45)return {p:move(q,dp,(t-s)/.45)};if(d==null||t<d)return {p:dp,server:p.server};if(t<d+.9)return {p:move(dp,exit,(t-d)/.9)};if(t<d+1.8)return {p:move(exit,postExit,(t-d-.9)/.9)};return null;}
function updateAgents(t){if(!data)return;const q=data.passengers.filter(p=>p.arrival<=t&&(p.service_start==null||p.service_start>t)).sort((a,b)=>a.arrival-b.arrival),map=new Map(q.map((p,i)=>[p.id,i])),busy=new Set();
  agents.forEach((a,i)=>{const p=data.passengers[i];if(!p){a.visible=false;return;}const s=state(p,t,map);a.visible=!!s;if(!s)return;a.position.copy(s.p);a.position.y=.02+Math.sin(t*3+i)*.015;if(s.server!=null)busy.add(s.server);});
  desks.forEach((d,i)=>{const l=d.userData.light,b=busy.has(i);l.material.color.setHex(b?0xffc86f:0x66efc4);l.material.emissive.setHex(b?0x5c2c07:0x10382e);});UI.queue.textContent=String(q.length);
}
function clock(m){const w=Math.max(0,Math.floor(m));return Math.floor(w/60)+':'+String(w%60).padStart(2,'0');}
function updateKPIs(){UI.clock.textContent=clock(simTime);if(!data)return;const m=data.metrics;UI.wait.textContent=m.mean_wait.toFixed(1)+' min';UI.util.textContent=Math.round(m.utilisation*100)+'%';UI.throughput.textContent=String(m.throughput);}
function reset(){simTime=0;playing=true;UI.playPause.textContent='Ⅱ';last=performance.now();updateAgents(0);updateKPIs();}
function params(){return {arrival_rate:Number(UI.arrivalRate.value),mean_service:Number(UI.meanService.value),servers:Number(UI.servers.value),duration:DURATION,variability:Number(UI.variability.value),seed:Number(UI.seed.value)};}
async function run(){if(!pyodide)return;UI.run.disabled=true;UI.run.textContent='Running SimPy…';setDesks(Number(UI.servers.value));try{pyodide.globals.set('params_json',JSON.stringify(params()));const r=await pyodide.runPythonAsync("import json\nparams=json.loads(params_json)\njson.dumps(run_simulation(**params))");data=JSON.parse(r);reset();const m=data.metrics;UI.status.textContent=m.arrivals+' passengers · max queue '+m.max_queue+' · p95 wait '+m.p95_wait.toFixed(1)+' min';}catch(e){console.error(e);UI.status.textContent='Simulation error: '+e.message;}finally{UI.run.disabled=false;UI.run.textContent='Run SimPy experiment';}}
async function initPython(){try{UI.status.textContent='Loading CPython/WebAssembly…';pyodide=await window.loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/'});await pyodide.loadPackage('micropip');await pyodide.runPythonAsync("import micropip\nawait micropip.install('simpy==4.1.2')");const code=await fetch('./simulation.py').then(r=>r.text());await pyodide.runPythonAsync(code);UI.badge.textContent='SimPy ready';UI.badge.classList.add('ready');UI.run.disabled=false;await run();}catch(e){console.error(e);UI.badge.textContent='Load failed';UI.status.textContent='Python runtime failed: '+e.message;}}
function readouts(){$('arrivalReadout').textContent=Number(UI.arrivalRate.value).toFixed(2)+'/min';$('serviceReadout').textContent=Number(UI.meanService.value).toFixed(1)+' min';$('variabilityReadout').textContent='CV '+Number(UI.variability.value).toFixed(2);}
[UI.arrivalRate,UI.meanService,UI.variability].forEach(x=>x.addEventListener('input',readouts));UI.run.addEventListener('click',run);UI.restart.addEventListener('click',reset);UI.playPause.addEventListener('click',()=>{playing=!playing;UI.playPause.textContent=playing?'Ⅱ':'▶';last=performance.now();});
const views={overview:[[18,14,24],[0,1.6,0]],queue:[[-8,4.5,10],[-6,1.2,0]],desks:[[8,4.3,9],[3.4,1.2,0]]};document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{const v=views[b.dataset.view];camera.position.set(...v[0]);controls.target.set(...v[1]);controls.update();}));
const vr=VRButton.createButton(renderer,{optionalFeatures:['local-floor','bounded-floor']});$('vrSlot').appendChild(vr);renderer.xr.addEventListener('sessionstart',()=>{controls.enabled=false;});renderer.xr.addEventListener('sessionend',()=>{controls.enabled=true;camera.position.set(18,14,24);controls.target.set(0,1.6,0);});
addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
renderer.setAnimationLoop(now=>{const dt=Math.min(.1,Math.max(0,(now-last)/1000));last=now;if(playing&&data){simTime+=dt*Number(UI.speed.value);if(simTime>=DURATION){simTime=DURATION;playing=false;UI.playPause.textContent='▶';}}updateAgents(simTime);updateKPIs();if(controls.enabled)controls.update();renderer.render(scene,camera);});
readouts();initPython();
