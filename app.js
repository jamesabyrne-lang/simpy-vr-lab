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
scene.background = new THREE.Color(0x9fb9c8);
scene.fog = new THREE.FogExp2(0x9fb9c8, 0.0065);

const renderer = new THREE.WebGLRenderer({ canvas: $('sceneCanvas'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.05, 180);
camera.position.set(28, 20, 34);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.15, 0);
controls.minDistance = 6;
controls.maxDistance = 70;
controls.maxPolarAngle = Math.PI * 0.49;
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight(0xe9f6ff, 0x64717c, 2.8));
const ambientFill = new THREE.AmbientLight(0xddeaf1, .75); scene.add(ambientFill);
const sun = new THREE.DirectionalLight(0xfff5e8, 4.0);
sun.position.set(-12, 24, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -35; sun.shadow.camera.right = 35; sun.shadow.camera.top = 25; sun.shadow.camera.bottom = -25;
scene.add(sun);
const warm = new THREE.PointLight(0xffdfb3, 16, 24, 2); warm.position.set(10, 4.2, -6); scene.add(warm);
const cool = new THREE.PointLight(0xbbe9ff, 18, 28, 2); cool.position.set(-12, 4.0, 6); scene.add(cool);
for (const [x,z,color] of [[-16,6,0xe7f7ff],[-4,7,0xf8fbff],[8,7,0xf8fbff],[-4,-7,0xffefe7],[11,-7,0xffeee5],[19,6,0xf4fbff]]) {
  const l=new THREE.PointLight(color,7,10,2); l.position.set(x,4.1,z); scene.add(l);
}

const facility = new THREE.Group();
const dynamicResources = new THREE.Group();
const patientsGroup = new THREE.Group();
scene.add(facility, dynamicResources, patientsGroup);

const materials = {
  floor: new THREE.MeshStandardMaterial({ color: 0xcfd7d9, roughness: .64, metalness: .03 }),
  floorWarm: new THREE.MeshStandardMaterial({ color: 0xded9cf, roughness: .72, metalness: .01 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: .84, metalness: .01 }),
  wallAccent: new THREE.MeshStandardMaterial({ color: 0xdfe8e6, roughness: .78, metalness: .02 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xb9e5ee, transparent: true, opacity: .24, roughness: .05, transmission: .46, thickness: .05, side: THREE.DoubleSide }),
  trim: new THREE.MeshStandardMaterial({ color: 0x48616b, roughness: .30, metalness: .48 }),
  desk: new THREE.MeshStandardMaterial({ color: 0x47646d, roughness: .42, metalness: .16 }),
  bed: new THREE.MeshStandardMaterial({ color: 0xf7fbfc, roughness: .68 }),
  bedding: new THREE.MeshStandardMaterial({ color: 0xbfdfe6, roughness: .82 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x91a4ab, roughness: .20, metalness: .78 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x243743, roughness: .55, metalness: .18 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xa57f5a, roughness: .72, metalness: .02 }),
  whitePlastic: new THREE.MeshStandardMaterial({ color: 0xf8fafb, roughness: .46, metalness: .02 }),
  tealPlastic: new THREE.MeshStandardMaterial({ color: 0x3f7d83, roughness: .50, metalness: .04 }),
  door: new THREE.MeshStandardMaterial({ color: 0x78949b, roughness: .55, metalness: .06 }),
  black: new THREE.MeshStandardMaterial({ color: 0x121a1f, roughness: .38, metalness: .28 }),
  screen: new THREE.MeshStandardMaterial({ color: 0x153b4b, emissive: 0x2a8196, emissiveIntensity: .75, roughness: .30 }),
};

const sharedGeo = {
  chairLeg: new THREE.CylinderGeometry(.035,.035,.5,8),
  pole: new THREE.CylinderGeometry(.035,.045,1.55,8),
  caster: new THREE.CylinderGeometry(.07,.07,.045,10),
};

function meshBox(w,h,d,material,x,y,z,parent=facility) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material);
  m.position.set(x,y,z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function floorZone(name, x, z, w, d, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: .62, metalness: .02, emissive: color, emissiveIntensity: .018 });
  const m = meshBox(w,.045,d,mat,x,.035,z);
  m.userData.zone = name; return m;
}
function makeTextSprite(text, opts={}) {
  const c = document.createElement('canvas'); c.width = opts.width || 1024; c.height = opts.height || 220;
  const g = c.getContext('2d');
  const bg=opts.background || 'rgba(22,43,52,.94)';
  g.fillStyle = bg;
  if (g.roundRect) { g.beginPath(); g.roundRect(8,8,c.width-16,c.height-16,28); g.fill(); }
  else g.fillRect(8,8,c.width-16,c.height-16);
  g.strokeStyle = opts.stroke || 'rgba(120,213,225,.62)'; g.lineWidth = 5; g.strokeRect(10,10,c.width-20,c.height-20);
  g.fillStyle = opts.color || '#f7fbfc'; g.font = '800 '+(opts.fontSize || 62)+'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width/2, c.height/2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy=renderer.capabilities.getMaxAnisotropy();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false}));
  s.scale.set(opts.scaleX || 6.5, opts.scaleY || 1.4, 1); return s;
}
function addSign(text,x,y,z,scale=5.6) {
  const s=makeTextSprite(text,{scaleX:scale,scaleY:1.05,fontSize:52,background:'rgba(30,60,68,.92)'});
  s.position.set(x,y,z); facility.add(s); return s;
}
function canvasTexture(draw,w=768,h=512){
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');draw(g,w,h);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t;
}
function makePosterTexture(title,subtitle,accent='#4fa7b8',kind=0){
  return canvasTexture((g,w,h)=>{
    g.fillStyle='#f7f3ea';g.fillRect(0,0,w,h);
    g.fillStyle=accent;g.fillRect(0,0,w,58);
    g.fillStyle='#17313b';g.font='800 46px system-ui';g.fillText(title,44,135);
    g.fillStyle='#536b74';g.font='500 25px system-ui';g.fillText(subtitle,44,178);
    g.strokeStyle=accent;g.lineWidth=9;g.lineCap='round';
    if(kind%3===0){g.beginPath();g.arc(w*.72,h*.61,92,0,Math.PI*2);g.stroke();g.beginPath();g.moveTo(w*.72-90,h*.61);g.lineTo(w*.72+90,h*.61);g.moveTo(w*.72,h*.61-90);g.lineTo(w*.72,h*.61+90);g.stroke();}
    else if(kind%3===1){for(let i=0;i<5;i++){g.beginPath();g.arc(w*.65+i*28,h*.62-i*18,52-i*6,0,Math.PI*2);g.stroke();}}
    else {g.beginPath();g.moveTo(w*.53,h*.72);g.bezierCurveTo(w*.60,h*.40,w*.73,h*.86,w*.84,h*.47);g.stroke();}
    g.fillStyle='#799099';g.font='500 20px system-ui';g.fillText('PATIENT INFORMATION',44,h-42);
  });
}
function addWallPicture(title,subtitle,x,y,z,rotY=0,accent='#4fa7b8',kind=0,w=2.2,h=1.45){
  const frame=new THREE.Group();
  const back=new THREE.Mesh(new THREE.BoxGeometry(w+.12,h+.12,.07),materials.wood);back.position.z=-.035;frame.add(back);
  const art=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:makePosterTexture(title,subtitle,accent,kind)}));art.position.z=.006;frame.add(art);
  frame.position.set(x,y,z);frame.rotation.y=rotY;facility.add(frame);return frame;
}
function addDoor(x,z,rot=0,label=''){
  const g=new THREE.Group();
  const frameMat=materials.trim;
  const leaf=new THREE.Mesh(new THREE.BoxGeometry(1.15,2.55,.12),materials.door);leaf.position.y=1.275;g.add(leaf);
  const jambL=new THREE.Mesh(new THREE.BoxGeometry(.10,2.75,.18),frameMat);jambL.position.set(-.63,1.375,0);g.add(jambL);
  const jambR=jambL.clone();jambR.position.x=.63;g.add(jambR);
  const head=new THREE.Mesh(new THREE.BoxGeometry(1.36,.12,.18),frameMat);head.position.y=2.69;g.add(head);
  const handle=new THREE.Mesh(new THREE.SphereGeometry(.055,10,8),materials.rail);handle.position.set(.42,1.22,.10);g.add(handle);
  if(label){const s=makeTextSprite(label,{scaleX:1.6,scaleY:.38,fontSize:38,background:'rgba(65,88,94,.92)'});s.position.set(0,2.98,0);g.add(s);}
  g.position.set(x,0,z);g.rotation.y=rot;facility.add(g);return g;
}
function addChair(x,z,rot=0,color=0x385d67) {
  const g=new THREE.Group();
  const chairMat=new THREE.MeshStandardMaterial({color,roughness:.68,metalness:.04});
  const seat=new THREE.Mesh(new THREE.BoxGeometry(.72,.12,.72),chairMat);seat.position.y=.52;g.add(seat);
  const back=new THREE.Mesh(new THREE.BoxGeometry(.72,.78,.11),chairMat);back.position.set(0,.93,.31);back.rotation.x=-.08;g.add(back);
  for(const dx of [-.28,.28])for(const dz of [-.28,.28]){const l=new THREE.Mesh(sharedGeo.chairLeg,materials.rail);l.position.set(dx,.25,dz);g.add(l)}
  g.position.set(x,0,z);g.rotation.y=rot;g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});facility.add(g);return g;
}
function addBed(x,z,rot=0,accent=0x7db8c3) {
  const g=new THREE.Group();
  const frame=new THREE.Mesh(new THREE.BoxGeometry(2.25,.16,.98),materials.rail);frame.position.y=.58;g.add(frame);
  const mattress=new THREE.Mesh(new THREE.BoxGeometry(2.03,.22,.88),materials.bed);mattress.position.y=.74;g.add(mattress);
  const blanket=new THREE.Mesh(new THREE.BoxGeometry(1.22,.045,.86),new THREE.MeshStandardMaterial({color:accent,roughness:.86}));blanket.position.set(.30,.88,0);g.add(blanket);
  const pillow=new THREE.Mesh(new THREE.BoxGeometry(.43,.12,.65),materials.whitePlastic);pillow.position.set(-.70,.92,0);g.add(pillow);
  const head=new THREE.Mesh(new THREE.BoxGeometry(.12,.88,.94),materials.rail);head.position.set(-1.08,1.02,0);g.add(head);
  for(const dx of [-.82,.82])for(const dz of [-.34,.34]){const wheel=new THREE.Mesh(sharedGeo.caster,materials.black);wheel.rotation.x=Math.PI/2;wheel.position.set(dx,.20,dz);g.add(wheel);}
  g.position.set(x,0,z);g.rotation.y=rot;g.traverse(o=>{if(o.isMesh)o.castShadow=true;});facility.add(g);return g;
}
function addMonitor(x,z,rot=0){
  const g=new THREE.Group();const pole=new THREE.Mesh(sharedGeo.pole,materials.rail);pole.position.y=.8;g.add(pole);
  const screen=new THREE.Mesh(new THREE.BoxGeometry(.62,.44,.08),materials.black);screen.position.set(0,1.48,0);g.add(screen);
  const glow=new THREE.Mesh(new THREE.PlaneGeometry(.52,.34),materials.screen);glow.position.set(0,1.48,.045);g.add(glow);
  const base=new THREE.Mesh(new THREE.CylinderGeometry(.28,.34,.07,12),materials.rail);base.position.y=.035;g.add(base);
  g.position.set(x,0,z);g.rotation.y=rot;facility.add(g);return g;
}
function addCart(x,z,rot=0){
  const g=new THREE.Group();const body=new THREE.Mesh(new THREE.BoxGeometry(.78,.82,.52),materials.whitePlastic);body.position.y=.52;g.add(body);
  const top=new THREE.Mesh(new THREE.BoxGeometry(.84,.07,.58),materials.tealPlastic);top.position.y=.96;g.add(top);
  for(const y of [.38,.62,.83]){const line=new THREE.Mesh(new THREE.BoxGeometry(.68,.018,.535),materials.trim);line.position.set(0,y,.01);g.add(line);}
  g.position.set(x,0,z);g.rotation.y=rot;facility.add(g);return g;
}
function addBin(x,z,color=0x60777d){
  const m=new THREE.Mesh(new THREE.CylinderGeometry(.24,.28,.55,12),new THREE.MeshStandardMaterial({color,roughness:.72}));m.position.set(x,.275,z);facility.add(m);return m;
}
function addSanitiser(x,y,z,rotY=0){
  const g=new THREE.Group();const back=new THREE.Mesh(new THREE.BoxGeometry(.26,.48,.08),materials.whitePlastic);g.add(back);
  const bottle=new THREE.Mesh(new THREE.BoxGeometry(.15,.20,.10),new THREE.MeshStandardMaterial({color:0x9ed5d5,roughness:.44,transparent:true,opacity:.78}));bottle.position.set(0,-.06,.08);g.add(bottle);
  g.position.set(x,y,z);g.rotation.y=rotY;facility.add(g);
}
function addClock(x,y,z,rotY=0){
  const tex=canvasTexture((g,w,h)=>{g.fillStyle='#f8fbfb';g.fillRect(0,0,w,h);g.strokeStyle='#344d56';g.lineWidth=18;g.beginPath();g.arc(w/2,h/2,w*.42,0,Math.PI*2);g.stroke();g.strokeStyle='#253d46';g.lineWidth=14;g.beginPath();g.moveTo(w/2,h/2);g.lineTo(w*.50,h*.26);g.moveTo(w/2,h/2);g.lineTo(w*.70,h*.55);g.stroke();},512,512);
  const m=new THREE.Mesh(new THREE.CircleGeometry(.42,32),new THREE.MeshBasicMaterial({map:tex}));m.position.set(x,y,z);m.rotation.y=rotY;facility.add(m);
}
function addCeilingLight(x,z,w=2.2,d=.62){
  const fixture=new THREE.Mesh(new THREE.BoxGeometry(w,.06,d),new THREE.MeshStandardMaterial({color:0xf5ffff,emissive:0xe7f8ff,emissiveIntensity:2.6,roughness:.35}));
  fixture.position.set(x,4.52,z);fixture.receiveShadow=false;facility.add(fixture);
}
function addPlant(x,z,scale=1){
  const pot=new THREE.Mesh(new THREE.CylinderGeometry(.28*scale,.36*scale,.48*scale,12),new THREE.MeshStandardMaterial({color:0x8c6749,roughness:.86}));pot.position.set(x,.24*scale,z);facility.add(pot);
  const stemMat=new THREE.MeshStandardMaterial({color:0x3d6e4f,roughness:.88});
  for(let i=0;i<5;i++){const leaf=new THREE.Mesh(new THREE.SphereGeometry(.27*scale,10,8),stemMat);const a=i*Math.PI*2/5;leaf.scale.set(.55,1.5,.34);leaf.rotation.z=.35*Math.sin(a);leaf.position.set(x+Math.cos(a)*.18*scale,.68*scale+i*.07*scale,z+Math.sin(a)*.18*scale);facility.add(leaf);}
}
function addFloorArrow(x,z,rot=0,color=0x5da7b7){
  const shape=new THREE.Shape();shape.moveTo(-.65,-.12);shape.lineTo(.2,-.12);shape.lineTo(.2,-.32);shape.lineTo(.72,0);shape.lineTo(.2,.32);shape.lineTo(.2,.12);shape.lineTo(-.65,.12);shape.closePath();
  const m=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.80,side:THREE.DoubleSide}));m.rotation.x=-Math.PI/2;m.rotation.z=rot;m.position.set(x,.082,z);facility.add(m);
}
function addPrivacyCurtain(x,z,length=2.2,rot=0,color=0xbad8dc){
  const g=new THREE.Group();const rail=new THREE.Mesh(new THREE.BoxGeometry(length,.035,.035),materials.rail);rail.position.y=2.25;g.add(rail);
  const curtain=new THREE.Mesh(new THREE.PlaneGeometry(length,1.65,8,1),new THREE.MeshStandardMaterial({color,roughness:.86,transparent:true,opacity:.88,side:THREE.DoubleSide}));curtain.position.y=1.40;g.add(curtain);
  g.position.set(x,0,z);g.rotation.y=rot;facility.add(g);
}

function buildFacility() {
  // Base, perimeter, and open-dollhouse clinical architecture.
  meshBox(52,.30,29,materials.floor,0,-.16,0);
  meshBox(50,.025,1.6,materials.floorWarm,0,.02,0);
  meshBox(52,4.75,.24,materials.wall,0,2.36,-14.4);
  meshBox(52,4.75,.24,materials.wall,0,2.36,14.4);
  meshBox(.24,4.75,28.8,materials.wall,-26,2.36,0);
  meshBox(.24,4.75,28.8,materials.wall,26,2.36,0);
  // Baseboards / upper trims.
  for(const z of [-14.18,14.18]){meshBox(51.5,.16,.12,materials.trim,0,.08,z);meshBox(51.5,.12,.18,materials.trim,0,4.55,z);}
  for(const x of [-25.78,25.78]){meshBox(.12,.16,28.3,materials.trim,x,.08,0);}

  // Zone floor insets.
  floorZone('triage',-14,0,8.2,6.2,0xc4dde2);
  floorZone('registration',-5,7.4,8.2,6.1,0xcfe2dd);
  floorZone('examination',5.5,7.4,11.3,6.1,0xc9dbe8);
  floorZone('non_trauma_treatment',16,7.4,8.3,6.1,0xcce4dc);
  floorZone('trauma',-2,-7.4,10.3,6.2,0xe7d1c9);
  floorZone('trauma_treatment',13,-7.4,10.3,6.2,0xead7cb);

  // Main corridor edging and pathway bands.
  const corridorMat=new THREE.MeshStandardMaterial({color:0xe7eceb,roughness:.70});
  meshBox(49,.03,2.5,corridorMat,0,.055,0);
  const pathNT=new THREE.MeshBasicMaterial({color:0x67aeb9,transparent:true,opacity:.72});
  const pathT=new THREE.MeshBasicMaterial({color:0xd78169,transparent:true,opacity:.72});
  meshBox(30,.018,.10,pathNT,-.4,.084,3.35);
  meshBox(31,.018,.10,pathT,.4,.084,-3.35);
  for(const [x,z,r,col] of [[-18,3.35,0,0x67aeb9],[-12,3.35,0,0x67aeb9],[-4,3.35,0,0x67aeb9],[5,3.35,0,0x67aeb9],[13,3.35,0,0x67aeb9],[-16,-3.35,0,0xd78169],[-8,-3.35,0,0xd78169],[1,-3.35,0,0xd78169],[10,-3.35,0,0xd78169],[18,-3.35,0,0xd78169]]) addFloorArrow(x,z,r,col);

  // Waiting area with varied furniture and tables.
  [-10.6,-8.8,-7.0].forEach((x,i)=>{addChair(x,3.1,Math.PI,[0x4e7780,0x6d8597,0x50736d][i]);addChair(x,4.35,Math.PI,[0x6d8597,0x4e7780,0x7b6f8f][i]);});
  meshBox(1.25,.42,.65,materials.wood,-8.8,.22,5.25);
  addPlant(-11.8,5.2,.9); addBin(-5.8,5.1); addClock(-9.0,3.55,14.24,Math.PI);

  // Registration counter, privacy screen, computer and storage.
  meshBox(3.4,1.02,1.10,materials.desk,-5,.51,6.0);
  meshBox(3.55,.06,1.18,materials.wood,-5,1.05,6.0);
  meshBox(.06,1.30,2.6,materials.glass,-3.20,1.15,6.0);
  addMonitor(-4.7,6.0,Math.PI); addCart(-2.9,8.6,-Math.PI/2); addBin(-6.7,8.5);

  // Internal partitions / rooms.
  [-.5,3.5,7.5,11.5].forEach(x=>{meshBox(.09,2.65,5.65,materials.wallAccent,x,1.325,7.4);meshBox(.12,.14,5.7,materials.trim,x,2.66,7.4);});
  meshBox(.09,2.65,10,materials.wallAccent,-9.5,1.325,7.5);
  meshBox(.09,2.65,10,materials.wallAccent,10.7,1.325,7.5);
  meshBox(.09,2.65,10,materials.wallAccent,6.8,1.325,-7.4);

  // Doors into clinical rooms.
  addDoor(-.5,4.72,0,'EXAM 1');addDoor(3.5,4.72,0,'EXAM 2');addDoor(7.5,4.72,0,'EXAM 3');
  addDoor(-7.2,-4.48,Math.PI/2,'TRAUMA');addDoor(7.0,-4.48,Math.PI/2,'TREAT');

  // Static beds/couches and details.
  addBed(-3.2,-7.5,0,0xd6a997);addBed(.0,-7.5,0,0xd6a997);addBed(2.9,-7.5,0,0xd6a997);
  addBed(10.5,-7.5,0,0xe2b495);addBed(13.5,-7.5,0,0xe2b495);addBed(16.6,-7.5,0,0xe2b495);
  addBed(14.5,7.5,0,0xaed9ce);addBed(17.5,7.5,0,0xaed9ce);
  [-3.2,0,2.9,10.5,13.5,16.6].forEach(x=>addMonitor(x+.85,-8.6));
  [1.0,5.0,9.0].forEach(x=>addCart(x,9.1));
  addPrivacyCurtain(-1.7,-9.6,2.5,0,0xe3c9c2);addPrivacyCurtain(1.5,-9.6,2.5,0,0xe3c9c2);
  addPrivacyCurtain(12.0,-9.6,2.4,0,0xedd7ca);addPrivacyCurtain(15.0,-9.6,2.4,0,0xedd7ca);

  // Entrance glazing and automatic doors.
  meshBox(.08,3.5,6.8,materials.glass,-24.35,1.75,0);
  meshBox(.10,3.5,.12,materials.trim,-24.30,1.75,-3.45);
  meshBox(.10,3.5,.12,materials.trim,-24.30,1.75,3.45);
  const doorGlass=materials.glass.clone();
  const entranceA=new THREE.Mesh(new THREE.BoxGeometry(.08,2.65,1.65),doorGlass);entranceA.position.set(-24.25,1.33,-.90);facility.add(entranceA);
  const entranceB=entranceA.clone();entranceB.position.z=.90;facility.add(entranceB);

  // Fine details.
  for(const [x,z] of [[-20,11],[21,11],[-21,-11],[21,-11],[-12,11]]) addPlant(x,z,.85);
  for(const [x,z] of [[-14,-2.7],[-5,10.0],[5.5,10.0],[16,10.0],[-2,-10.2],[13,-10.2]]) addSanitiser(x,1.4,z);
  for(const [x,z] of [[-12.4,2.4],[-4,4.7],[5,4.7],[14,4.7],[-2,-4.6],[12,-4.6]]) addBin(x,z);
  // Wall art / information posters.
  addWallPicture('HAND HYGIENE','Clean hands protect everyone',-18.5,2.5,14.23,Math.PI,'#4d9fa8',0,2.1,1.4);
  addWallPicture('BREATHE','Small steps · steady recovery',-14.8,2.5,14.23,Math.PI,'#7b9bc4',2,2.1,1.4);
  addWallPicture('KNOW THE SIGNS','Speak to a clinician if worried',13.5,2.5,14.23,Math.PI,'#d28a67',1,2.1,1.4);
  addWallPicture('MOVE WELL','Gentle movement supports health',17.0,2.5,14.23,Math.PI,'#6b9e7f',2,2.1,1.4);
  addWallPicture('CALM SPACE','You are in safe hands',-14.0,2.45,-14.23,0,'#6c8fa6',1,2.2,1.45);
  addWallPicture('CARE TEAM','Working together for patients',7.8,2.45,-14.23,0,'#a27a91',0,2.2,1.45);
  addWallPicture('RECOVERY','One step at a time',12.0,2.45,-14.23,0,'#b88d68',2,2.2,1.45);

  // Ceiling light panels, kept sparse so overview remains open.
  for(const x of [-20,-14,-8,-2,4,10,16,22]){addCeilingLight(x,0,2.3,.62);}
  for(const x of [-14,-6,2,10,18]){addCeilingLight(x,7.2,1.9,.55);addCeilingLight(x,-7.2,1.9,.55);}

  // Wayfinding signage.
  addSign('ARRIVALS',-22.2,3.45,0,3.7);
  addSign('TRIAGE',-14,3.20,-2.45,3.9);
  addSign('REGISTRATION',-5,3.20,10.0,5.1);
  addSign('EXAMINATION',5.5,3.20,10.0,4.8);
  addSign('NON-TRAUMA TREATMENT',16,3.20,10.0,6.1);
  addSign('TRAUMA / STABILISATION',-2,3.20,-10.0,5.9);
  addSign('TRAUMA TREATMENT',13,3.20,-10.0,5.3);
  addSign('DISCHARGE',22.2,3.45,0,4.0);
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
  const g=new THREE.Group();
  const color=ZONE_COLOURS[stage]||0x56d7ff;
  const shellMat=new THREE.MeshStandardMaterial({color:stage.includes('trauma')?0x8f6d61:0x6d8c93,roughness:.48,metalness:.10});
  const accentMat=new THREE.MeshStandardMaterial({color,roughness:.50,metalness:.04,emissive:color,emissiveIntensity:.04});
  const addLocal=(mesh,x,y,z)=>{mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);return mesh;};

  if(stage==='triage'||stage==='registration') {
    addLocal(new THREE.Mesh(new THREE.BoxGeometry(1.65,.86,1.08),shellMat),0,.43,0);
    addLocal(new THREE.Mesh(new THREE.BoxGeometry(1.76,.055,1.16),materials.wood),0,.90,0);
    const screen=addLocal(new THREE.Mesh(new THREE.BoxGeometry(.62,.46,.07),materials.black),-.18,1.23,-.13);
    const display=new THREE.Mesh(new THREE.PlaneGeometry(.52,.35),materials.screen);display.position.set(-.18,1.23,-.091);g.add(display);
    addLocal(new THREE.Mesh(new THREE.BoxGeometry(.46,.025,.18),materials.dark),.25,.94,.18);
    const stool=new THREE.Mesh(new THREE.CylinderGeometry(.28,.30,.09,16),accentMat);stool.position.set(.0,.46,.84);g.add(stool);
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,.40,10),materials.rail);stem.position.set(0,.23,.84);g.add(stem);
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.25,.32,.05,12),materials.rail);base.position.set(0,.025,.84);g.add(base);
    const privacy=new THREE.Mesh(new THREE.BoxGeometry(.04,.72,.72),materials.glass);privacy.position.set(.80,1.20,0);g.add(privacy);
    void screen;
  } else if(stage==='examination') {
    const couch=addLocal(new THREE.Mesh(new THREE.BoxGeometry(1.95,.46,.82),materials.bed),0,.49,0);
    couch.rotation.z=.01;
    addLocal(new THREE.Mesh(new THREE.BoxGeometry(.55,.10,.70),materials.bedding),-.62,.77,0);
    const paper=new THREE.Mesh(new THREE.BoxGeometry(1.10,.025,.73),materials.whitePlastic);paper.position.set(.30,.74,0);g.add(paper);
    const lampPole=new THREE.Mesh(sharedGeo.pole,materials.rail);lampPole.position.set(.78,.90,.55);g.add(lampPole);
    const lampHead=new THREE.Mesh(new THREE.CylinderGeometry(.20,.27,.10,14),materials.whitePlastic);lampHead.rotation.z=Math.PI/2;lampHead.position.set(.68,1.63,.42);g.add(lampHead);
    const lampGlow=new THREE.PointLight(0xe9fbff,1.6,2.4,2);lampGlow.position.set(.55,1.45,.35);g.add(lampGlow);
    const trolley=new THREE.Mesh(new THREE.BoxGeometry(.48,.58,.38),materials.tealPlastic);trolley.position.set(-.88,.35,.63);g.add(trolley);
    const screen=new THREE.Mesh(new THREE.BoxGeometry(.52,.38,.06),materials.black);screen.position.set(.92,1.38,-.44);g.add(screen);
    const display=new THREE.Mesh(new THREE.PlaneGeometry(.44,.30),materials.screen);display.position.set(.92,1.38,-.407);g.add(display);
  } else {
    addLocal(new THREE.Mesh(new THREE.BoxGeometry(2.06,.46,.88),materials.bed),0,.48,0);
    addLocal(new THREE.Mesh(new THREE.BoxGeometry(1.22,.045,.84),new THREE.MeshStandardMaterial({color:stage==='trauma'?0xd6a696:0xe1bea2,roughness:.86})),.28,.74,0);
    addLocal(new THREE.Mesh(new THREE.BoxGeometry(.44,.11,.64),materials.whitePlastic),-.67,.78,0);
    addLocal(new THREE.Mesh(new THREE.BoxGeometry(.11,.78,.92),materials.rail),-1.03,.83,0);
    const iv=new THREE.Mesh(sharedGeo.pole,materials.rail);iv.position.set(.90,.80,.56);g.add(iv);
    const hook=new THREE.Mesh(new THREE.TorusGeometry(.09,.018,6,14,Math.PI),materials.rail);hook.position.set(.90,1.58,.56);hook.rotation.z=Math.PI;g.add(hook);
    const bag=new THREE.Mesh(new THREE.BoxGeometry(.18,.32,.07),new THREE.MeshStandardMaterial({color:0xbbe2e6,transparent:true,opacity:.72,roughness:.25}));bag.position.set(.82,1.35,.56);g.add(bag);
    const monitorStand=new THREE.Mesh(new THREE.CylinderGeometry(.04,.055,1.35,8),materials.rail);monitorStand.position.set(-.82,.72,.58);g.add(monitorStand);
    const screen=new THREE.Mesh(new THREE.BoxGeometry(.54,.40,.07),materials.black);screen.position.set(-.82,1.42,.58);g.add(screen);
    const display=new THREE.Mesh(new THREE.PlaneGeometry(.46,.32),materials.screen);display.position.set(-.82,1.42,.619);g.add(display);
    const tray=new THREE.Mesh(new THREE.BoxGeometry(.50,.05,.38),materials.rail);tray.position.set(.82,.92,-.62);g.add(tray);
  }

  const floorDisc=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.025,28),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.36}));floorDisc.position.y=.018;g.add(floorDisc);
  const beaconMat=new THREE.MeshStandardMaterial({color:0x68e8c0,emissive:0x174638,emissiveIntensity:2.1,roughness:.30});
  const beacon=new THREE.Mesh(new THREE.SphereGeometry(.12,14,10),beaconMat);beacon.position.set(0,1.88,.0);g.add(beacon);
  const label=makeTextSprite(RESOURCE_LABELS[stage]+' '+(idx+1),{scaleX:2.8,scaleY:.56,fontSize:42,stroke:'rgba(255,255,255,.22)',background:'rgba(38,67,73,.92)'});label.position.set(0,2.35,0);g.add(label);
  const p=resourcePosition(stage,idx,count);g.position.copy(p);g.userData={kind:'resource',stage,index:idx+1,beacon};
  g.traverse(o=>{if(o.isMesh){o.userData.pickRoot=g;clickable.push(o);o.castShadow=true;o.receiveShadow=true;}});
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
function pseudo(id,salt=0){
  let x=(id*1664525+1013904223+salt*374761393)>>>0;
  x^=x>>>13;x=Math.imul(x,1274126177)>>>0;x^=x>>>16;
  return (x>>>0)/4294967295;
}
function makePatientFigure(patient) {
  const group=new THREE.Group();
  const id=patient.id;
  const skinPalette=[0xf2c9aa,0xe2b18d,0xc98f68,0xa96f50,0x7c4e37,0x5d3c2c];
  const tops=[0x44768a,0x6b789b,0x9a6c78,0x5e826e,0x9b7857,0x596978,0x88739b,0x3f7f7c];
  const trousers=[0x263746,0x35404a,0x443e43,0x293b36,0x4f5660];
  const hairPalette=[0x231a17,0x3c2a20,0x6a4a32,0xa2774d,0xd0b074,0x17191b,0x70665e];
  const skin=skinPalette[Math.floor(pseudo(id,1)*skinPalette.length)%skinPalette.length];
  const top=tops[Math.floor(pseudo(id,2)*tops.length)%tops.length];
  const bottom=trousers[Math.floor(pseudo(id,3)*trousers.length)%trousers.length];
  const hair=hairPalette[Math.floor(pseudo(id,4)*hairPalette.length)%hairPalette.length];
  const height=.88+pseudo(id,5)*.18;
  const build=.88+pseudo(id,6)*.20;
  const cloth=new THREE.MeshStandardMaterial({color:top,roughness:.76});
  const cloth2=new THREE.MeshStandardMaterial({color:bottom,roughness:.82});
  const skinMat=new THREE.MeshStandardMaterial({color:skin,roughness:.86});
  const hairMat=new THREE.MeshStandardMaterial({color:hair,roughness:.88});
  const shoeMat=new THREE.MeshStandardMaterial({color:pseudo(id,9)>.5?0x242b30:0x6a5a4d,roughness:.74});

  const torsoShape=pseudo(id,7);
  let torso;
  if(torsoShape<.34) torso=new THREE.Mesh(new THREE.CylinderGeometry(.22*build,.31*build,.76,10),cloth);
  else if(torsoShape<.68){torso=new THREE.Mesh(new THREE.CylinderGeometry(.24*build,.29*build,.70,10),cloth);torso.scale.y=1.03;}
  else torso=new THREE.Mesh(new THREE.BoxGeometry(.48*build,.72,.30*build),cloth);
  torso.position.y=1.14;group.add(torso);

  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.075,.085,.12,8),skinMat);neck.position.y=1.55;group.add(neck);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.215,14,10),skinMat);head.scale.set(1,.98,.92);head.position.y=1.76;group.add(head);

  // Hair styles: cap, crop, bun or bald.
  const hairStyle=Math.floor(pseudo(id,8)*5);
  if(hairStyle===0||hairStyle===1){
    const cap=new THREE.Mesh(new THREE.SphereGeometry(.222,14,8,0,Math.PI*2,0,Math.PI*.48),hairMat);cap.position.y=1.80;cap.scale.set(1.02,.82,.95);group.add(cap);
  } else if(hairStyle===2){
    const cap=new THREE.Mesh(new THREE.SphereGeometry(.224,14,8,0,Math.PI*2,0,Math.PI*.52),hairMat);cap.position.y=1.81;group.add(cap);
    const bun=new THREE.Mesh(new THREE.SphereGeometry(.095,10,8),hairMat);bun.position.set(0,1.91,-.16);group.add(bun);
  } else if(hairStyle===3){
    const crop=new THREE.Mesh(new THREE.BoxGeometry(.31,.08,.28),hairMat);crop.position.set(0,1.94,-.01);crop.rotation.x=-.08;group.add(crop);
  }

  // Face/nose and optional glasses.
  const nose=new THREE.Mesh(new THREE.ConeGeometry(.035,.075,6),skinMat);nose.rotation.x=Math.PI/2;nose.position.set(0,1.76,.205);group.add(nose);
  if(pseudo(id,10)>.76){
    const glassMat=new THREE.MeshBasicMaterial({color:0x26343a});
    for(const sx of [-.072,.072]){const lens=new THREE.Mesh(new THREE.TorusGeometry(.055,.009,5,12),glassMat);lens.position.set(sx,1.80,.202);group.add(lens);}
    const bridge=new THREE.Mesh(new THREE.BoxGeometry(.045,.012,.012),glassMat);bridge.position.set(0,1.80,.205);group.add(bridge);
  }

  const upperArmGeo=new THREE.CylinderGeometry(.052*build,.065*build,.56,8);
  const legGeo=new THREE.CylinderGeometry(.07*build,.082*build,.68,8);
  const leftArm=new THREE.Mesh(upperArmGeo,cloth);leftArm.position.set(-.30*build,1.10,0);leftArm.rotation.z=-.08;group.add(leftArm);
  const rightArm=new THREE.Mesh(upperArmGeo,cloth);rightArm.position.set(.30*build,1.10,0);rightArm.rotation.z=.08;group.add(rightArm);
  for(const side of [-1,1]){
    const hand=new THREE.Mesh(new THREE.SphereGeometry(.065,8,6),skinMat);hand.position.set(.32*build*side,.78,0);group.add(hand);
    const leg=new THREE.Mesh(legGeo,cloth2);leg.position.set(.13*build*side,.44,0);group.add(leg);
    const shoe=new THREE.Mesh(new THREE.BoxGeometry(.17*build,.10,.28),shoeMat);shoe.position.set(.13*build*side,.08,.06);group.add(shoe);
  }

  // Pathway shown as a small wristband/badge rather than identical clothing.
  const pathColor=patient.pathway==='trauma'?0xe67862:0x4f9fb4;
  const badge=new THREE.Mesh(new THREE.CircleGeometry(.075,14),new THREE.MeshBasicMaterial({color:pathColor}));badge.position.set(0,1.25,.245);group.add(badge);
  if(pseudo(id,11)>.72){
    const bag=new THREE.Mesh(new THREE.BoxGeometry(.28,.36,.16),new THREE.MeshStandardMaterial({color:0x6f604e,roughness:.86}));bag.position.set(-.32,1.02,-.14);bag.rotation.z=.08;group.add(bag);
  }

  group.scale.set(build*.94,height,build*.94);
  group.visible=false;
  group.userData={kind:'patient',patient,initialised:false,leftArm,rightArm,walkPhase:pseudo(id,12)*Math.PI*2,lastTarget:new THREE.Vector3()};
  group.traverse(o=>{if(o.isMesh){o.userData.pickRoot=group;clickable.push(o);o.castShadow=true;o.receiveShadow=true;}});
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
function updateVisuals(dt){if(!modelData)return;const qMaps=makeQueueMaps(simTime);const alpha=1-Math.exp(-7*Math.min(.08,dt));patientAgents.forEach((agent)=>{const p=agent.userData.patient,s=patientState(p,simTime,qMaps);agent.visible=!!s;if(!s)return;if(!agent.userData.initialised){agent.position.copy(p.arrival<=simTime?ZONES.entrance:s.target);agent.userData.lastTarget.copy(s.target);agent.userData.initialised=true;}const before=agent.position.clone();agent.position.lerp(s.target,alpha);const delta=agent.position.clone().sub(before);const moving=delta.lengthSq()>.00002;if(moving){const desired=Math.atan2(delta.x,delta.z);let diff=desired-agent.rotation.y;diff=Math.atan2(Math.sin(diff),Math.cos(diff));agent.rotation.y+=diff*Math.min(1,dt*7);}const phase=performance.now()/230+agent.userData.walkPhase;if(moving){agent.userData.leftArm.rotation.x=Math.sin(phase)*.30;agent.userData.rightArm.rotation.x=-Math.sin(phase)*.30;agent.position.y=.025+Math.abs(Math.sin(phase))*0.018;}else{agent.userData.leftArm.rotation.x*=.90;agent.userData.rightArm.rotation.x*=.90;agent.position.y=.02+Math.sin(performance.now()/620+p.id)*.008;}if(s.kind==='service'){agent.rotation.y*=.92;}agent.userData.lastTarget.copy(s.target);agent.userData.state=s;});
  for(const [stage,units] of resourceUnits){const active=new Set();for(const p of modelData.patients){const s=p.stages.find(x=>x.stage===stage);if(s&&s.service_start!=null&&s.service_start<=simTime&&(s.service_end==null||s.service_end>simTime))active.add(s.resource_id);}units.forEach((u,i)=>{const busy=active.has(i+1),b=u.userData.beacon;b.material.color.setHex(busy?0xf2b85e:0x68d9b2);b.material.emissive.setHex(busy?0x7a3f0b:0x174638);b.scale.setScalar(busy?1.18:1);});}
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
const views={overview:[[28,20,34],[0,1.1,0]],triage:[[-8.5,5.8,11.5],[-14,1.15,0]],trauma:[[7.5,5.3,-16.5],[3.5,1.05,-7.4]],nontrauma:[[11,6.2,18],[7.5,1.05,7.4]]};
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{const v=views[b.dataset.view];camera.position.set(...v[0]);controls.target.set(...v[1]);controls.update();}));

const vrButton=VRButton.createButton(renderer,{optionalFeatures:['local-floor','bounded-floor']});$('vrSlot').appendChild(vrButton);
renderer.xr.addEventListener('sessionstart',()=>{controls.enabled=false;camera.position.set(-18,1.7,10);});
renderer.xr.addEventListener('sessionend',()=>{controls.enabled=true;camera.position.set(26,22,32);controls.target.set(0,1.3,0);controls.update();});
addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});

renderer.setAnimationLoop((now)=>{const dt=Math.min(.12,Math.max(0,(now-lastFrame)/1000));lastFrame=now;if(playing&&modelData){simTime+=dt*Number(UI.speed.value);if(simTime>=modelData.config.duration){simTime=modelData.config.duration;playing=false;UI.playPause.textContent='▶';renderSummaryInspector();}}updateVisuals(dt);if(now-lastUiRefresh>220){lastUiRefresh=now;updateUi();updateWorldBoard();}if(controls.enabled)controls.update();renderer.render(scene,camera);});

setBaseline();updateWorldBoard();initialisePython();
