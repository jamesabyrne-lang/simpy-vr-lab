import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const $ = (id) => document.getElementById(id);
const UI = {
  demand: $('demandMultiplier'), probTrauma: $('probTrauma'), ntTreatP: $('nonTraumaTreatP'),
  nTriage: $('nTriage'), nReg: $('nReg'), nExam: $('nExam'), nTrauma: $('nTrauma'),
  nCubicles1: $('nCubicles1'), nCubicles2: $('nCubicles2'),
  triageMean: $('triageMean'), regMean: $('regMean'), examMean: $('examMean'), traumaMean: $('traumaMean'),
  ntTreatMean: $('ntTreatMean'), traumaTreatMean: $('traumaTreatMean'), seed: $('seed'), duration: $('duration'),
  run: $('runButton'), baseline: $('baselineButton'), playPause: $('playPause'), restart: $('restartButton'),
  speed: $('speed'), timeline: $('timeline'), timelineReadout: $('timelineReadout'), status: $('statusText'), badge: $('engineBadge'),
  clock: $('kpiClock'), inSystem: $('kpiInSystem'), waiting: $('kpiWaiting'), inService: $('kpiService'), completed: $('kpiCompleted'),
  inspector: $('inspector'), resourceCards: $('resourceCards'), eventPanel: $('eventPanel'), eventLog: $('eventLog'),
  eventToggle: $('eventToggle'), eventClose: $('eventClose')
};

const BASELINE = {
  n_triage: 1, n_reg: 1, n_exam: 3, n_trauma: 2, n_cubicles_1: 1, n_cubicles_2: 1,
  triage_mean: 3, reg_mean: 5, exam_mean: 16, trauma_mean: 90,
  trauma_treat_mean: 30, non_trauma_treat_mean: 13.3,
  non_trauma_treat_p: 0.60, prob_trauma: 0.12, demand_multiplier: 1, duration: 360, seed: 17
};
const RESOURCE_LABELS = {
  triage: 'Triage', registration: 'Registration', examination: 'Examination', trauma: 'Trauma stabilisation',
  non_trauma_treatment: 'Non-trauma treatment', trauma_treatment: 'Trauma treatment'
};
const STAGE_ORDER = ['triage','registration','examination','non_trauma_treatment','trauma','trauma_treatment'];
const ZONES = {
  entrance: new THREE.Vector3(-23, 0, 0),
  triage: new THREE.Vector3(-14, 0, 0),
  registration: new THREE.Vector3(-5, 0, 7.4),
  examination: new THREE.Vector3(5.5, 0, 7.4),
  non_trauma_treatment: new THREE.Vector3(16, 0, 7.4),
  trauma: new THREE.Vector3(-2, 0, -7.4),
  trauma_treatment: new THREE.Vector3(13, 0, -7.4),
  exit: new THREE.Vector3(23, 0, 0)
};
const ZONE_COLOURS = {
  triage: 0x57d6ff, registration: 0x6edac8, examination: 0x79b8ff,
  non_trauma_treatment: 0x6dddc9, trauma: 0xff9977, trauma_treatment: 0xffb36f
};

let pyodide = null;
let modelData = null;
let simTime = 0;
let playing = true;
let lastFrame = performance.now();
let lastUiRefresh = -Infinity;
let selected = null;
let patientAgents = [];
let resourceUnits = new Map();
let clickable = [];
let runGeneration = 0;

// ---------- Three.js scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06101b);
scene.fog = new THREE.FogExp2(0x06101b, 0.0135);

const renderer = new THREE.WebGLRenderer({ canvas: $('sceneCanvas'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.05, 180);
camera.position.set(26, 22, 32);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.3, 0);
controls.minDistance = 6;
controls.maxDistance = 70;
controls.maxPolarAngle = Math.PI * 0.49;
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight(0xc5e7ff, 0x172331, 2.4));
const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.position.set(-12, 24, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -35; sun.shadow.camera.right = 35; sun.shadow.camera.top = 25; sun.shadow.camera.bottom = -25;
scene.add(sun);
const warm = new THREE.PointLight(0xffc77b, 30, 30, 2); warm.position.set(10, 5, -5); scene.add(warm);
const cool = new THREE.PointLight(0x54d6ff, 32, 35, 2); cool.position.set(-12, 5, 6); scene.add(cool);

const facility = new THREE.Group();
const dynamicResources = new THREE.Group();
const patientsGroup = new THREE.Group();
scene.add(facility, dynamicResources, patientsGroup);

const materials = {
  floor: new THREE.MeshStandardMaterial({ color: 0x13202c, roughness: .82, metalness: .08 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xdce7ea, roughness: .77, metalness: .03 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xaadff0, transparent: true, opacity: .16, roughness: .08, transmission: .25, side: THREE.DoubleSide }),
  trim: new THREE.MeshStandardMaterial({ color: 0x263b4a, roughness: .35, metalness: .55 }),
  desk: new THREE.MeshStandardMaterial({ color: 0x3c5666, roughness: .48, metalness: .20 }),
  bed: new THREE.MeshStandardMaterial({ color: 0xdde7e9, roughness: .65 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x8ca1ad, roughness: .22, metalness: .72 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0c1824, roughness: .42, metalness: .40 }),
};

function meshBox(w,h,d,material,x,y,z,parent=facility) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material);
  m.position.set(x,y,z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function floorZone(name, x, z, w, d, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .04, emissive: color, emissiveIntensity: .035 });
  const m = meshBox(w,.035,d,mat,x,.025,z);
  m.userData.zone = name; return m;
}
function makeTextSprite(text, opts={}) {
  const c = document.createElement('canvas'); c.width = opts.width || 1024; c.height = opts.height || 220;
  const g = c.getContext('2d');
  g.fillStyle = opts.background || 'rgba(5,15,26,.88)';
  if (g.roundRect) { g.beginPath(); g.roundRect(8,8,c.width-16,c.height-16,28); g.fill(); }
  else g.fillRect(8,8,c.width-16,c.height-16);
  g.strokeStyle = opts.stroke || 'rgba(86,215,255,.40)'; g.lineWidth = 5; g.strokeRect(10,10,c.width-20,c.height-20);
  g.fillStyle = opts.color || '#eff7fb'; g.font = `800 ${opts.fontSize || 62}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width/2, c.height/2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false}));
  s.scale.set(opts.scaleX || 6.5, opts.scaleY || 1.4, 1); return s;
}
function addSign(text,x,y,z,scale=5.6) { const s=makeTextSprite(text,{scaleX:scale,scaleY:1.05,fontSize:56}); s.position.set(x,y,z); facility.add(s); return s; }
function addChair(x,z,rot=0) {
  const g=new THREE.Group();
  const seat=new THREE.Mesh(new THREE.BoxGeometry(.75,.12,.75),materials.dark);seat.position.y=.52;g.add(seat);
  const back=new THREE.Mesh(new THREE.BoxGeometry(.75,.85,.10),materials.dark);back.position.set(0,.92,.33);g.add(back);
  const legGeo=new THREE.CylinderGeometry(.035,.035,.5,8); for(const dx of [-.28,.28])for(const dz of [-.28,.28]){const l=new THREE.Mesh(legGeo,materials.rail);l.position.set(dx,.25,dz);g.add(l)}
  g.position.set(x,0,z);g.rotation.y=rot;facility.add(g);
}
function addBed(x,z,rot=0) {
  const g=new THREE.Group(); const frame=new THREE.Mesh(new THREE.BoxGeometry(2.2,.18,.95),materials.rail);frame.position.y=.55;g.add(frame);
  const mattress=new THREE.Mesh(new THREE.BoxGeometry(2.0,.25,.85),materials.bed);mattress.position.y=.72;g.add(mattress);
  const head=new THREE.Mesh(new THREE.BoxGeometry(.14,.85,.92),materials.rail);head.position.set(-1.06,1,.0);g.add(head);
  g.position.set(x,0,z);g.rotation.y=rot;facility.add(g);return g;
}

function buildFacility() {
  meshBox(52,.35,29,materials.floor,0,-.2,0);
  const grid=new THREE.GridHelper(52,52,0x294355,0x172838);grid.material.opacity=.35;grid.material.transparent=true;facility.add(grid);
  // Outer walls and glass frontage.
  meshBox(52,4.7,.25,materials.wall,0,2.35,-14.4);
  meshBox(52,4.7,.25,materials.wall,0,2.35,14.4);
  meshBox(.25,4.7,28.8,materials.wall,-26,2.35,0);
  meshBox(.25,4.7,28.8,materials.wall,26,2.35,0);
  meshBox(12,3.5,.08,materials.glass,-19,1.75,-.0);
  // Main pathway flooring.
  floorZone('triage',-14,0,8,6,0x17435a);
  floorZone('registration',-5,7.4,8,6,0x174a47);
  floorZone('examination',5.5,7.4,11,6,0x173c55);
  floorZone('non_trauma_treatment',16,7.4,8,6,0x174a47);
  floorZone('trauma',-2,-7.4,10,6,0x573129);
  floorZone('trauma_treatment',13,-7.4,10,6,0x513729);
  meshBox(48,.025,2.4,new THREE.MeshStandardMaterial({color:0x203846,emissive:0x0b2530,emissiveIntensity:.5}),0,.04,0);
  // Waiting room furniture.
  [-9.5,-7.8,-6.1].forEach(x=>{addChair(x,3.0,Math.PI);addChair(x,4.2,Math.PI);});
  // Registration counter.
  meshBox(3.2,1.05,1.0,materials.desk,-5,.53,6.0);
  // Examination room dividers.
  [-.5,3.5,7.5,11.5].forEach(x=>meshBox(.08,2.5,5.7,materials.glass,x,1.25,7.4));
  // Trauma and treatment beds.
  addBed(-3.2,-7.4);addBed(.0,-7.4);addBed(2.9,-7.4);
  addBed(11,-7.4);addBed(14,-7.4);addBed(17,-7.4);
  addBed(14.7,7.4);addBed(17.5,7.4);
  // Corridor dividers and signs.
  meshBox(.08,2.6,10,materials.glass,-9.5,1.3,7.5);
  meshBox(.08,2.6,10,materials.glass,10.7,1.3,7.5);
  meshBox(.08,2.6,10,materials.glass,6.8,1.3,-7.4);
  addSign('ARRIVALS',-22.5,3.4,0,3.8);
  addSign('TRIAGE',-14,3.2,-2.5,4.0);
  addSign('REGISTRATION',-5,3.2,10.1,5.2);
  addSign('EXAMINATION',5.5,3.2,10.1,5.0);
  addSign('NON-TRAUMA TREATMENT',16,3.2,10.1,6.4);
  addSign('TRAUMA / STABILISATION',-2,3.2,-10.2,6.2);
  addSign('TRAUMA TREATMENT',13,3.2,-10.2,5.6);
  addSign('DISCHARGE',23,3.4,0,4.2);
  // Directional floor lines.
  const lineMat1=new THREE.MeshStandardMaterial({color:0x66d6e8,emissive:0x164852,emissiveIntensity:1});
  const lineMat2=new THREE.MeshStandardMaterial({color:0xff9977,emissive:0x4a1e13,emissiveIntensity:1});
  meshBox(28,.04,.08,lineMat1,-1,.08,3.35);
  meshBox(30,.04,.08,lineMat2,0,.08,-3.35);
  // Plants/visual anchors.
  for (const [x,z] of [[-20,11],[21,11],[-21,-11],[21,-11]]) {
    const pot=new THREE.Mesh(new THREE.CylinderGeometry(.35,.45,.55,12),new THREE.MeshStandardMaterial({color:0x654736,roughness:.8}));pot.position.set(x,.28,z);facility.add(pot);
    const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(.65,1),new THREE.MeshStandardMaterial({color:0x3d7a5f,roughness:.9}));crown.position.set(x,1.05,z);facility.add(crown);
  }
}
buildFacility();

// ---------- Resources ----------
function resourcePosition(stage, idx, count) {
  const c=ZONES[stage];
  const spacing = stage === 'examination' ? 2.6 : 2.5;
  const offset=(idx-(count-1)/2)*spacing;
  if (stage === 'triage') return new THREE.Vector3(c.x,0,c.z+offset);
  if (stage === 'registration') return new THREE.Vector3(c.x+offset,0,c.z);
  if (stage === 'examination') return new THREE.Vector3(c.x+offset,0,c.z);
  return new THREE.Vector3(c.x+offset,0,c.z);
}
function queueBase(stage) {
  const c=ZONES[stage];
  if(stage==='triage') return new THREE.Vector3(c.x-4.6,0,c.z);
  if(stage==='registration'||stage==='examination'||stage==='non_trauma_treatment') return new THREE.Vector3(c.x-3.6,0,c.z-2.2);
  return new THREE.Vector3(c.x-3.8,0,c.z+2.2);
}
function queuePosition(stage, idx) {
  const b=queueBase(stage), row=Math.floor(idx/6), col=idx%6, dir=row%2===0?1:-1;
  if(stage==='triage') return new THREE.Vector3(b.x-row*1.05,0,b.z+(col-2.5)*.72*dir);
  return new THREE.Vector3(b.x+(col-2.5)*.72*dir,0,b.z+(stage==='trauma'||stage==='trauma_treatment'?-1:1)*row*.85);
}
function makeResourceUnit(stage, idx, count) {
  const g=new THREE.Group(); const color=ZONE_COLOURS[stage]||0x56d7ff;
  const shellMat=new THREE.MeshStandardMaterial({color:stage.includes('trauma')?0x5d4a43:0x324d5a,roughness:.44,metalness:.18});
  if(stage==='triage'||stage==='registration') {
    const desk=new THREE.Mesh(new THREE.BoxGeometry(1.6,.9,1.05),shellMat);desk.position.y=.45;g.add(desk);
    const screen=new THREE.Mesh(new THREE.BoxGeometry(.55,.48,.08),materials.dark);screen.position.set(0,.98,-.15);g.add(screen);
  } else if(stage==='examination') {
    const couch=new THREE.Mesh(new THREE.BoxGeometry(1.9,.55,.8),materials.bed);couch.position.y=.48;g.add(couch);
    const stand=new THREE.Mesh(new THREE.CylinderGeometry(.06,.08,1.5,10),materials.rail);stand.position.set(.8,1.1,.55);g.add(stand);
  } else {
    const bed=new THREE.Mesh(new THREE.BoxGeometry(2.0,.58,.86),materials.bed);bed.position.y=.48;g.add(bed);
    const head=new THREE.Mesh(new THREE.BoxGeometry(.12,.8,.9),materials.rail);head.position.set(-1, .8,0);g.add(head);
  }
  const beaconMat=new THREE.MeshStandardMaterial({color:0x68e8c0,emissive:0x174638,emissiveIntensity:1.8});
  const beacon=new THREE.Mesh(new THREE.SphereGeometry(.12,12,8),beaconMat);beacon.position.set(0,1.72,.0);g.add(beacon);
  const label=makeTextSprite(`${RESOURCE_LABELS[stage]} ${idx+1}`,{scaleX:2.6,scaleY:.53,fontSize:44,stroke:'rgba(255,255,255,.18)'});label.position.set(0,2.25,0);g.add(label);
  const p=resourcePosition(stage,idx,count);g.position.copy(p);g.userData={kind:'resource',stage,index:idx+1,beacon};
  g.traverse(o=>{if(o.isMesh){o.userData.pickRoot=g;clickable.push(o);o.castShadow=true;}});
  dynamicResources.add(g);return g;
}
function rebuildResources(capacities) {
  while(dynamicResources.children.length) dynamicResources.remove(dynamicResources.children[0]);
  clickable=clickable.filter(o=>o.userData?.pickRoot?.userData?.kind!=='resource');
  resourceUnits=new Map();
  for(const stage of STAGE_ORDER){const count=capacities?.[stage]||BASELINE[{triage:'n_triage',registration:'n_reg',examination:'n_exam',trauma:'n_trauma',non_trauma_treatment:'n_cubicles_1',trauma_treatment:'n_cubicles_2'}[stage]];const arr=[];for(let i=0;i<count;i++)arr.push(makeResourceUnit(stage,i,count));resourceUnits.set(stage,arr);}
}
rebuildResources({triage:1,registration:1,examination:3,trauma:2,non_trauma_treatment:1,trauma_treatment:1});

// ---------- Patient figures ----------
function makePatientFigure(patient) {
  const group=new THREE.Group();
  const pathColor=patient.pathway==='trauma'?0xff8d6d:0x66d6e8;
  const skinPalette=[0xf0c7a8,0xc98e68,0x8c5a3e,0xe2ad82];
  const skin=skinPalette[patient.id%skinPalette.length];
  const cloth=new THREE.MeshStandardMaterial({color:pathColor,roughness:.72});
  const skinMat=new THREE.MeshStandardMaterial({color:skin,roughness:.82});
  const trouser=new THREE.MeshStandardMaterial({color:0x263746,roughness:.8});
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(.22,.31,.78,8),cloth);torso.position.y=1.12;group.add(torso);
  const head=new THREE.Mesh(new THREE.IcosahedronGeometry(.22,2),skinMat);head.position.y=1.72;group.add(head);
  const limbGeo=new THREE.CylinderGeometry(.055,.065,.65,7);
  for(const side of [-1,1]){
    const arm=new THREE.Mesh(limbGeo,skinMat);arm.position.set(.30*side,1.08,0);arm.rotation.z=.10*side;group.add(arm);
    const leg=new THREE.Mesh(limbGeo,trouser);leg.position.set(.13*side,.43,0);group.add(leg);
  }
  const badge=new THREE.Mesh(new THREE.CircleGeometry(.09,16),new THREE.MeshBasicMaterial({color:0xffffff}));badge.position.set(0,1.22,.27);group.add(badge);
  group.scale.setScalar(.92); group.visible=false; group.userData={kind:'patient',patient,initialised:false};
  group.traverse(o=>{if(o.isMesh){o.userData.pickRoot=group;clickable.push(o);o.castShadow=true;}});
  patientsGroup.add(group);return group;
}
function rebuildPatients(){while(patientsGroup.children.length)patientsGroup.remove(patientsGroup.children[0]);clickable=clickable.filter(o=>o.userData?.pickRoot?.userData?.kind!=='patient');patientAgents=[];if(!modelData)return;for(const p of modelData.patients)patientAgents.push(makePatientFigure(p));}

// ---------- Model state → visual state ----------
function stageState(stage,t){
  if(stage.queue_enter==null||t<stage.queue_enter)return null;
  if(stage.service_start==null||t<stage.service_start)return {kind:'queue',stage:stage.stage};
  if(stage.service_end==null||t<stage.service_end)return {kind:'service',stage:stage.stage,resource:stage.resource_id};
  return {kind:'done',stage:stage.stage};
}
function patientState(patient,t,queueMaps){
  if(t<patient.arrival)return null;
  if(patient.departure!=null&&t>=patient.departure)return {kind:'departed',target:ZONES.exit};
  for(const stage of patient.stages){const s=stageState(stage,t);if(!s||s.kind==='done')continue;if(s.kind==='queue'){const idx=queueMaps.get(stage.stage)?.get(patient.id)||0;return {...s,target:queuePosition(stage.stage,idx)};}if(s.kind==='service'){const units=resourceUnits.get(stage.stage)||[];const unit=units[Math.max(0,(stage.resource_id||1)-1)];return {...s,target:unit?unit.position.clone():ZONES[stage.stage].clone()};}}
  if(patient.stages.length){const last=patient.stages[patient.stages.length-1];if(last.service_end!=null&&t>=last.service_end)return {kind:'leaving',target:ZONES.exit};}
  return {kind:'arriving',target:ZONES.entrance};
}
function makeQueueMaps(t){const maps=new Map();for(const stage of STAGE_ORDER){const waiting=[];for(const p of modelData?.patients||[]){const s=p.stages.find(x=>x.stage===stage);if(s&&s.queue_enter<=t&&(s.service_start==null||s.service_start>t))waiting.push({id:p.id,q:s.queue_enter});}waiting.sort((a,b)=>a.q-b.q||a.id-b.id);maps.set(stage,new Map(waiting.map((x,i)=>[x.id,i])));}return maps;}
function liveResourceState(stage,t){const cap=modelData?.resource_capacities?.[stage]||0;let busy=0,busyMinutes=0;for(const p of modelData?.patients||[]){for(const s of p.stages){if(s.stage!==stage||s.service_start==null)continue;const end=s.service_end==null?modelData.config.duration:s.service_end;if(s.service_start<=t&&end>t)busy++;busyMinutes+=Math.max(0,Math.min(t,end)-Math.min(t,s.service_start));}}const util=t>0&&cap?Math.min(1,busyMinutes/(cap*t)):0;return{cap,busy,util};}
function updateVisuals(dt){if(!modelData)return;const qMaps=makeQueueMaps(simTime);const alpha=1-Math.exp(-8*Math.min(.08,dt));patientAgents.forEach((agent)=>{const p=agent.userData.patient,s=patientState(p,simTime,qMaps);agent.visible=!!s;if(!s)return;if(!agent.userData.initialised){agent.position.copy(p.arrival<=simTime?ZONES.entrance:s.target);agent.userData.initialised=true;}agent.position.lerp(s.target,alpha);agent.position.y=.02+Math.sin(performance.now()/340+p.id)*.014;agent.userData.state=s;});
  for(const [stage,units] of resourceUnits){const active=new Set();for(const p of modelData.patients){const s=p.stages.find(x=>x.stage===stage);if(s&&s.service_start!=null&&s.service_start<=simTime&&(s.service_end==null||s.service_end>simTime))active.add(s.resource_id);}units.forEach((u,i)=>{const busy=active.has(i+1),b=u.userData.beacon;b.material.color.setHex(busy?0xf7c76a:0x68e8c0);b.material.emissive.setHex(busy?0x5a350d:0x174638);});}
}

function formatClock(mins){const total=6*60+Math.max(0,Math.floor(mins));const h=Math.floor(total/60)%24,m=total%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;}
function currentCounts(t){let inSystem=0,waiting=0,inService=0,completed=0;const qMaps=makeQueueMaps(t);for(const p of modelData?.patients||[]){if(p.arrival>t)continue;if(p.departure!=null&&p.departure<=t){completed++;continue;}inSystem++;const state=patientState(p,t,qMaps);if(state?.kind==='queue')waiting++;else if(state?.kind==='service')inService++;}return{inSystem,waiting,inService,completed};}
function updateResourceCards(){if(!modelData)return;UI.resourceCards.innerHTML='';for(const stage of STAGE_ORDER){const s=liveResourceState(stage,simTime),card=document.createElement('div');card.className='resource-card';card.innerHTML=`<div class="name">${RESOURCE_LABELS[stage]}</div><strong>${s.busy}/${s.cap} occupied</strong><div class="bar"><i style="width:${Math.round(s.util*100)}%"></i></div>`;UI.resourceCards.appendChild(card);}}
function updateEventLog(){if(!modelData)return;const events=modelData.events.filter(e=>e.time<=simTime).slice(-12).reverse();UI.eventLog.innerHTML=events.map(e=>`<li><b>${formatClock(e.time)}</b> · P${String(e.id).padStart(3,'0')} · ${e.type.replaceAll('_',' ')}${e.stage?` · ${RESOURCE_LABELS[e.stage]}`:''}</li>`).join('')||'<li>No events yet.</li>';}
function updateUi(){UI.clock.textContent=formatClock(simTime);UI.timeline.value=String(Math.round(simTime));UI.timelineReadout.textContent=formatClock(simTime);if(!modelData)return;const c=currentCounts(simTime);UI.inSystem.textContent=c.inSystem;UI.waiting.textContent=c.waiting;UI.inService.textContent=c.inService;UI.completed.textContent=c.completed;updateResourceCards();updateEventLog();if(selected)renderInspector(selected);}

// ---------- Inspector ----------
function patientStatus(p,t){const q=makeQueueMaps(t),s=patientState(p,t,q);if(!s)return'Not arrived';if(s.kind==='queue')return`Waiting: ${RESOURCE_LABELS[s.stage]}`;if(s.kind==='service')return`In service: ${RESOURCE_LABELS[s.stage]} ${s.resource||''}`;if(s.kind==='departed'||s.kind==='leaving')return'Discharged';return'In system';}
function renderPatientInspector(p){const pathClass=p.pathway==='trauma'?'trauma':'non-trauma';const lines=p.stages.map(s=>`<li><b>${RESOURCE_LABELS[s.stage]}</b><br>${formatClock(s.queue_enter)} queue${s.service_start!=null?` → ${formatClock(s.service_start)} start`:''}${s.service_end!=null?` → ${formatClock(s.service_end)} end`:''}${s.wait!=null?` · wait ${s.wait.toFixed(1)}m`:''}</li>`).join('');UI.inspector.innerHTML=`<div class="eyebrow">PATIENT TRACE <span class="path-tag ${pathClass}">${p.pathway.replace('_',' ')}</span></div><h3>Patient ${String(p.id).padStart(3,'0')}</h3><p>${patientStatus(p,simTime)}</p><div class="inspector-grid"><div><span>Arrived</span><strong>${formatClock(p.arrival)}</strong></div><div><span>Departed</span><strong>${p.departure==null?'—':formatClock(p.departure)}</strong></div><div><span>Total wait</span><strong>${p.total_wait.toFixed(1)} min</strong></div><div><span>Time in system</span><strong>${p.total_time==null?'—':p.total_time.toFixed(1)+' min'}</strong></div></div><ol class="timeline-list">${lines}</ol>`;}
function renderResourceInspector(stage,index){const s=liveResourceState(stage,simTime),current=[],queue=[];for(const p of modelData?.patients||[]){const st=p.stages.find(x=>x.stage===stage);if(!st)continue;if(st.service_start!=null&&st.service_start<=simTime&&(st.service_end==null||st.service_end>simTime)&&st.resource_id===index)current.push(p);if(st.queue_enter<=simTime&&(st.service_start==null||st.service_start>simTime))queue.push(p);}UI.inspector.innerHTML=`<div class="eyebrow">RESOURCE TRACE</div><h3>${RESOURCE_LABELS[stage]} ${index}</h3><p>${current.length?'Occupied by patient '+String(current[0].id).padStart(3,'0'):'Idle'} · queue for resource type: ${queue.length}</p><div class="inspector-grid"><div><span>Capacity</span><strong>${s.cap}</strong></div><div><span>Busy now</span><strong>${s.busy}</strong></div><div><span>Cumulative util.</span><strong>${Math.round(s.util*100)}%</strong></div><div><span>Queue</span><strong>${queue.length}</strong></div></div>`;}
function renderSummaryInspector(){if(!modelData)return;const m=modelData.extra_metrics,up=modelData.metrics;UI.inspector.innerHTML=`<div class="eyebrow">RUN SUMMARY</div><h3>Healthcare scenario complete</h3><p>STARS-inspired SimPy prototype · seed ${modelData.config.seed}</p><div class="inspector-grid"><div><span>Arrivals</span><strong>${up['00_arrivals']}</strong></div><div><span>Completed</span><strong>${m.completed}</strong></div><div><span>Mean total wait</span><strong>${m.mean_total_wait==null?'—':m.mean_total_wait.toFixed(1)+'m'}</strong></div><div><span>P95 total wait</span><strong>${m.p95_total_wait==null?'—':m.p95_total_wait.toFixed(1)+'m'}</strong></div><div><span>Mean time in system</span><strong>${m.mean_time_in_system==null?'—':m.mean_time_in_system.toFixed(1)+'m'}</strong></div><div><span>Max queue</span><strong>${modelData.max_queue.overall}</strong></div></div>`;}
function renderInspector(item){if(item.kind==='patient')renderPatientInspector(item.patient);else if(item.kind==='resource')renderResourceInspector(item.stage,item.index);}

const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown',(ev)=>{if(renderer.xr.isPresenting||!modelData)return;const r=renderer.domElement.getBoundingClientRect();pointer.x=((ev.clientX-r.left)/r.width)*2-1;pointer.y=-((ev.clientY-r.top)/r.height)*2+1;raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(clickable,false)[0];if(!hit)return;const root=hit.object.userData.pickRoot;if(!root)return;selected=root.userData;renderInspector(selected);});

// ---------- In-world VR board ----------
const boardCanvas=document.createElement('canvas');boardCanvas.width=1024;boardCanvas.height=480;const boardCtx=boardCanvas.getContext('2d');const boardTex=new THREE.CanvasTexture(boardCanvas);boardTex.colorSpace=THREE.SRGBColorSpace;const board=new THREE.Mesh(new THREE.PlaneGeometry(8.5,4),new THREE.MeshBasicMaterial({map:boardTex,transparent:true,side:THREE.DoubleSide}));board.position.set(1,4.2,-13.9);facility.add(board);
function updateWorldBoard(){const c=currentCounts(simTime);boardCtx.clearRect(0,0,1024,480);boardCtx.fillStyle='rgba(5,15,26,.94)';boardCtx.fillRect(0,0,1024,480);boardCtx.strokeStyle='#56d7ff';boardCtx.lineWidth=7;boardCtx.strokeRect(14,14,996,452);boardCtx.fillStyle='#56d7ff';boardCtx.font='800 30px system-ui';boardCtx.fillText('HEALTHCARE DES · LIVE',48,72);boardCtx.fillStyle='#eef6fb';boardCtx.font='800 76px system-ui';boardCtx.fillText(formatClock(simTime),48,165);boardCtx.font='700 38px system-ui';boardCtx.fillText(`In system  ${c.inSystem}`,48,245);boardCtx.fillText(`Waiting    ${c.waiting}`,48,310);boardCtx.fillText(`In service ${c.inService}`,520,245);boardCtx.fillText(`Completed  ${c.completed}`,520,310);boardCtx.fillStyle='#9bb0c2';boardCtx.font='500 24px system-ui';boardCtx.fillText('Simulation state derives from the SimPy event trace.',48,402);boardTex.needsUpdate=true;}

// ---------- Python / STARS ----------
function readConfig(){return{demand_multiplier:Number(UI.demand.value),prob_trauma:Number(UI.probTrauma.value),non_trauma_treat_p:Number(UI.ntTreatP.value),n_triage:Number(UI.nTriage.value),n_reg:Number(UI.nReg.value),n_exam:Number(UI.nExam.value),n_trauma:Number(UI.nTrauma.value),n_cubicles_1:Number(UI.nCubicles1.value),n_cubicles_2:Number(UI.nCubicles2.value),triage_mean:Number(UI.triageMean.value),reg_mean:Number(UI.regMean.value),exam_mean:Number(UI.examMean.value),trauma_mean:Number(UI.traumaMean.value),non_trauma_treat_mean:Number(UI.ntTreatMean.value),trauma_treat_mean:Number(UI.traumaTreatMean.value),duration:Number(UI.duration.value),seed:Number(UI.seed.value)};}
function setBaseline(){UI.demand.value=BASELINE.demand_multiplier;UI.probTrauma.value=BASELINE.prob_trauma;UI.ntTreatP.value=BASELINE.non_trauma_treat_p;UI.nTriage.value=BASELINE.n_triage;UI.nReg.value=BASELINE.n_reg;UI.nExam.value=BASELINE.n_exam;UI.nTrauma.value=BASELINE.n_trauma;UI.nCubicles1.value=BASELINE.n_cubicles_1;UI.nCubicles2.value=BASELINE.n_cubicles_2;UI.triageMean.value=BASELINE.triage_mean;UI.regMean.value=BASELINE.reg_mean;UI.examMean.value=BASELINE.exam_mean;UI.traumaMean.value=BASELINE.trauma_mean;UI.ntTreatMean.value=BASELINE.non_trauma_treat_mean;UI.traumaTreatMean.value=BASELINE.trauma_treat_mean;UI.duration.value=BASELINE.duration;UI.seed.value=BASELINE.seed;updateReadouts();}
function updateReadouts(){$('demandReadout').textContent=Number(UI.demand.value).toFixed(2)+'×';$('traumaProbReadout').textContent=Math.round(Number(UI.probTrauma.value)*100)+'%';$('treatProbReadout').textContent=Math.round(Number(UI.ntTreatP.value)*100)+'%';}
async function initialisePython(){
  try{
    UI.status.textContent='Loading Python and SimPy…';
    pyodide=await window.loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/'});
    await pyodide.loadPackage('micropip');
    UI.status.textContent='Installing SimPy…';
    await pyodide.runPythonAsync("import micropip\nawait micropip.install('simpy==4.1.1')");
    const model=await fetch('./simulation.py').then(r=>{if(!r.ok)throw new Error('Could not load simulation.py');return r.text();});
    await pyodide.runPythonAsync(model);
    UI.badge.textContent='SimPy ready';
    UI.badge.classList.add('ready');
    UI.run.disabled=false;
    UI.status.textContent='Healthcare treatment-centre model ready';
    await runSimulation();
  }catch(err){
    console.error(err);
    UI.badge.textContent='Load failed';
    UI.status.textContent='Model runtime failed: '+err.message;
  }
}
async function runSimulation(){
  if(!pyodide)return;
  const generation=++runGeneration;
  UI.run.disabled=true; UI.run.textContent='Running model…';
  UI.status.textContent='Executing the SimPy treatment-centre model…';
  try{
    pyodide.globals.set('vr_config_json',JSON.stringify(readConfig()));
    const raw=await pyodide.runPythonAsync('run_healthcare_vr(vr_config_json)');
    if(generation!==runGeneration)return;
    modelData=JSON.parse(raw);
    UI.timeline.max=String(modelData.config.duration);
    rebuildResources(modelData.resource_capacities); rebuildPatients(); selected=null; resetPlayback();
    const m=modelData.extra_metrics;
    UI.status.textContent=modelData.metrics['00_arrivals']+' arrivals · '+m.completed+' completed · max queue '+modelData.max_queue.overall+' · seed '+modelData.config.seed;
    renderSummaryInspector();
  }catch(err){console.error(err);UI.status.textContent='Simulation failed: '+err.message;}
  finally{UI.run.disabled=false;UI.run.textContent='Run simulation';}
}
function resetPlayback(){simTime=0;playing=true;UI.playPause.textContent='Ⅱ';lastFrame=performance.now();for(const a of patientAgents){a.userData.initialised=false;a.visible=false;}updateVisuals(.016);updateUi();updateWorldBoard();}

// ---------- Controls ----------
[UI.demand,UI.probTrauma,UI.ntTreatP].forEach(el=>el.addEventListener('input',updateReadouts));
UI.run.addEventListener('click',runSimulation);UI.baseline.addEventListener('click',setBaseline);UI.restart.addEventListener('click',resetPlayback);
UI.playPause.addEventListener('click',()=>{playing=!playing;UI.playPause.textContent=playing?'Ⅱ':'▶';lastFrame=performance.now();});
UI.timeline.addEventListener('input',()=>{simTime=Number(UI.timeline.value);playing=false;UI.playPause.textContent='▶';lastFrame=performance.now();updateVisuals(.1);updateUi();updateWorldBoard();});
UI.eventToggle.addEventListener('click',()=>{UI.eventPanel.hidden=false;updateEventLog();});UI.eventClose.addEventListener('click',()=>UI.eventPanel.hidden=true);
const views={overview:[[26,22,32],[0,1.3,0]],triage:[[-8,7,13],[-14,1.2,0]],trauma:[[9,7,-18],[5,1.2,-7.4]],nontrauma:[[9,8,20],[6,1.2,7.4]]};
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{const v=views[b.dataset.view];camera.position.set(...v[0]);controls.target.set(...v[1]);controls.update();}));

const vrButton=VRButton.createButton(renderer,{optionalFeatures:['local-floor','bounded-floor']});$('vrSlot').appendChild(vrButton);
renderer.xr.addEventListener('sessionstart',()=>{controls.enabled=false;camera.position.set(-18,1.7,10);});
renderer.xr.addEventListener('sessionend',()=>{controls.enabled=true;camera.position.set(26,22,32);controls.target.set(0,1.3,0);controls.update();});
addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});

renderer.setAnimationLoop((now)=>{const dt=Math.min(.12,Math.max(0,(now-lastFrame)/1000));lastFrame=now;if(playing&&modelData){simTime+=dt*Number(UI.speed.value);if(simTime>=modelData.config.duration){simTime=modelData.config.duration;playing=false;UI.playPause.textContent='▶';renderSummaryInspector();}}updateVisuals(dt);if(now-lastUiRefresh>220){lastUiRefresh=now;updateUi();updateWorldBoard();}if(controls.enabled)controls.update();renderer.render(scene,camera);});

setBaseline();updateWorldBoard();initialisePython();
