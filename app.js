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
