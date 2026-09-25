import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const $=id=>document.getElementById(id);
const UI={
 status:$('statusText'),badge:$('engineBadge'),run:$('runButton'),reset:$('resetBaseline'),
 arrival:$('arrivalScale'),traumaP:$('traumaProb'),treatP:$('ntTreatProb'),triage:$('nTriage'),reg:$('nReg'),exam:$('nExam'),
 trauma:$('nTrauma'),ntcub:$('nNTCub'),tcub:$('nTCub'),examMean:$('examMean'),traumaMean:$('traumaTreatMean'),ntMean:$('ntTreatMean'),
 seed:$('seed'),runLength:$('runLength'),speed:$('speed'),play:$('playPause'),restart:$('restart'),timeline:$('timeline'),
 clock:$('kpiClock'),system:$('kpiSystem'),waiting:$('kpiWaiting'),service:$('kpiService'),completed:$('kpiCompleted'),
 inspectTitle:$('inspectTitle'),inspectBody:$('inspectBody'),eventLog:$('eventLog'),toggleEvents:$('toggleEvents')
};
const BASE={arrival_scale:1,prob_trauma:.12,non_trauma_treat_p:.60,n_triage:1,n_reg:1,n_exam:3,n_trauma:2,n_cubicles_1:1,n_cubicles_2:1,exam_mean:16,trauma_treat_mean:30,non_trauma_treat_mean:13.3,seed:17,run_length:1140};
const STAGE={
 triage:{label:'Triage',p:[-11,0,0],q:[-14,0,0]},
 registration:{label:'Registration',p:[-5,0,7],q:[-8,0,7]},
 examination:{label:'Examination',p:[2,0,7],q:[-1,0,7]},
 nontrauma_treatment:{label:'Non-trauma treatment',p:[9,0,7],q:[6,0,7]},
 trauma:{label:'Trauma stabilisation',p:[-1,0,-7],q:[-5,0,-7]},
 trauma_treatment:{label:'Trauma treatment',p:[9,0,-7],q:[5,0,-7]}
};
const entrance=new THREE.Vector3(-18,0,0),exit=new THREE.Vector3(17.5,0,0),gone=new THREE.Vector3(23,0,0);
let pyodide=null,data=null,simTime=0,playing=true,last=performance.now(),patients=[],resources=new Map(),selected=null,eventVisible=true;

const scene=new THREE.Scene();scene.background=new THREE.Color(0x07111b);scene.fog=new THREE.FogExp2(0x07111b,.012);
const renderer=new THREE.WebGLRenderer({canvas:$('sceneCanvas'),antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight,false);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;renderer.xr.enabled=true;
const rig=new THREE.Group();scene.add(rig);const camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.05,180);rig.add(camera);camera.position.set(22,16,28);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.target.set(0,1.2,0);controls.maxPolarAngle=Math.PI*.49;controls.minDistance=7;controls.maxDistance=65;
scene.add(new THREE.HemisphereLight(0xc9e8ff,0x16212c,2.1));const sun=new THREE.DirectionalLight(0xffffff,3.5);sun.position.set(-8,20,11);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);scene.add(sun);
const fill1=new THREE.PointLight(0x5ed8f4,24,36,2);fill1.position.set(-8,5,7);scene.add(fill1);const fill2=new THREE.PointLight(0xff9b88,20,35,2);fill2.position.set(3,4,-7);scene.add(fill2);

const world=new THREE.Group();scene.add(world);
const MAT={
 floor:new THREE.MeshStandardMaterial({color:0x152431,roughness:.86,metalness:.06}),
 wall:new THREE.MeshStandardMaterial({color:0xd7e5e8,roughness:.7}),
 dark:new THREE.MeshStandardMaterial({color:0x111d29,roughness:.5,metalness:.28}),
 desk:new THREE.MeshStandardMaterial({color:0x31495a,roughness:.38,metalness:.3}),
 rail:new THREE.MeshStandardMaterial({color:0x91a5b0,roughness:.22,metalness:.82}),
 cyan:new THREE.MeshStandardMaterial({color:0x67d8f4,emissive:0x113744,emissiveIntensity:1.1}),
 mint:new THREE.MeshStandardMaterial({color:0x6ee3b7,emissive:0x10382c,emissiveIntensity:1.1})
};
function box(w,h,d,m,x,y,z,parent){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;(parent||world).add(o);return o}
function sign(text,accent,scale){
 const c=document.createElement('canvas');c.width=800;c.height=170;const x=c.getContext('2d');x.fillStyle='rgba(7,17,27,.90)';x.roundRect(8,8,784,154,24);x.fill();x.strokeStyle=accent||'#67d8f4';x.globalAlpha=.55;x.lineWidth=4;x.stroke();x.globalAlpha=1;x.font='800 45px system-ui';x.fillStyle='#eef7fb';x.textAlign='center';x.textBaseline='middle';x.fillText(text,400,85);
 const tx=new THREE.CanvasTexture(c);tx.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tx,transparent:true,depthWrite:false}));const z=scale||4;s.scale.set(z,z*.2125,1);return s
}
function buildClinic(){
 box(43,.28,24,MAT.floor,0,-.15,0);const grid=new THREE.GridHelper(42,42,0x294657,0x1c3340);grid.material.opacity=.25;grid.material.transparent=true;world.add(grid);
 box(43,3.3,.25,MAT.wall,0,1.65,-12);box(43,3.3,.25,MAT.wall,0,1.65,12);box(.25,3.3,8,MAT.wall,-21.5,1.65,-8);box(.25,3.3,8,MAT.wall,-21.5,1.65,8);box(.25,3.3,8,MAT.wall,21.5,1.65,-8);box(.25,3.3,8,MAT.wall,21.5,1.65,8);
 box(20,.12,.06,MAT.cyan,-1,.03,0);[-8,-5,-2].forEach(x=>[3.7,10.1].forEach(z=>box(2.1,.42,.7,MAT.dark,x,.38,z)));[-5,-1,3].forEach(x=>[-10.1,-3.7].forEach(z=>box(2.1,.42,.7,MAT.dark,x,.38,z)));
 box(4,1,1.4,MAT.desk,-15,.5,2.4);box(3.6,.08,1.1,MAT.cyan,-15,1.05,2.4);
 [['NON-TRAUMA →','#78aef8',-3,10.7,5.2],['TRAUMA →','#ff8f83',-1,-10.7,4.5],['ARRIVALS','#6ee3b7',-18.2,0,3.1],['DISCHARGE','#6ee3b7',17.9,0,3.3]].forEach(a=>{const s=sign(a[0],a[1],a[4]);s.position.set(a[2],3.2,a[3]);world.add(s)});
 Object.keys(STAGE).forEach(k=>{const s=STAGE[k],l=sign(s.label,k.indexOf('trauma')>=0?'#ff8f83':'#67d8f4',3.5);l.position.set(s.p[0],3.15,s.p[2]);world.add(l);for(let i=0;i<4;i++){const r=new THREE.Mesh(new THREE.CylinderGeometry(.045,.06,.85,10),MAT.rail);r.position.set(s.q[0]-i*.7,.42,s.q[2]+1);world.add(r)}});
}
buildClinic();

function caps(){return{triage:+UI.triage.value,registration:+UI.reg.value,examination:+UI.exam.value,trauma:+UI.trauma.value,nontrauma_treatment:+UI.ntcub.value,trauma_treatment:+UI.tcub.value}}
function offsets(stage,count){const b=STAGE[stage].p,v=['registration','examination','nontrauma_treatment'].includes(stage),gap=stage==='examination'?2:2.25,out=[];for(let i=0;i<count;i++){const d=(i-(count-1)/2)*gap;out.push(new THREE.Vector3(b[0]+(v?0:d),0,b[2]+(v?d:0)))}return out}
function clearResources(){resources.forEach(r=>world.remove(r.group));resources.clear()}
function buildResources(c){
 clearResources();Object.entries(c).forEach(([stage,count])=>offsets(stage,count).forEach((p,i)=>{const g=new THREE.Group();g.position.copy(p);g.userData={resourceId:stage+':'+i,stage:stage,unit:i};const base=box(1.55,.78,1.25,MAT.desk,0,.39,0,g);base.userData=g.userData;const top=box(1.25,.09,.95,MAT.cyan.clone(),0,.84,0,g);top.userData=g.userData;const light=new THREE.Mesh(new THREE.SphereGeometry(.1,12,8),MAT.mint.clone());light.position.set(.62,1.16,.48);light.userData=g.userData;g.add(light);const n=sign(String(i+1),'#6ee3b7',.8);n.position.set(0,1.38,0);g.add(n);world.add(g);resources.set(stage+':'+i,{group:g,top:top,light:light,stage:stage,unit:i})}))
}
buildResources(caps());

function person(id,path){
 const g=new THREE.Group();g.userData={patientId:id};const colour=path==='trauma'?0xff8f83:0x78aef8;const body=new THREE.Mesh(new THREE.CylinderGeometry(.25,.32,.92,12),new THREE.MeshStandardMaterial({color:colour,roughness:.58}));body.position.y=.82;body.castShadow=true;body.userData=g.userData;g.add(body);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.22,14,10),new THREE.MeshStandardMaterial({color:0xe8bea0,roughness:.8}));head.position.y=1.48;head.castShadow=true;head.userData=g.userData;g.add(head);const lm=new THREE.MeshStandardMaterial({color:0x243242,roughness:.72});[-.13,.13].forEach(dx=>{const leg=new THREE.Mesh(new THREE.CylinderGeometry(.07,.08,.55,8),lm);leg.position.set(dx,.28,0);leg.userData=g.userData;g.add(leg)});g.visible=false;world.add(g);return g
}
function buildPatients(){patients.forEach(p=>world.remove(p.object));patients=data.patients.map(p=>Object.assign({},p,{object:person(p.id,p.pathway)}))}
function rank(patient,stage,t){const a=[];patients.forEach(p=>{const j=p.journey.find(x=>x.stage===stage);if(j&&j.queue_enter<=t&&t<j.service_start)a.push({id:p.id,q:j.queue_enter})});a.sort((x,y)=>x.q-y.q||x.id-y.id);return Math.max(0,a.findIndex(x=>x.id===patient.id))}
function qpos(stage,r){const q=new THREE.Vector3(...STAGE[stage].q),row=Math.floor(r/6),slot=r%6;q.x-=slot*.58;q.z+=(row%2===0?1:-1)*(1.35+row*.65);return q}
function spos(stage,u){return (offsets(stage,data.resource_capacities[stage])[u]||new THREE.Vector3(...STAGE[stage].p)).clone()}
function lerp(a,b,u){u=THREE.MathUtils.clamp(u,0,1);u=u*u*(3-2*u);return a.clone().lerp(b,u)}
function state(p,t){
 if(t<p.arrival)return{visible:false,status:'not arrived'};if(!p.journey.length)return{visible:true,pos:entrance.clone(),status:'arrived'};let prev=entrance;
 for(const j of p.journey){if(t<j.queue_enter)return{visible:true,pos:prev.clone(),status:'moving'};const q=qpos(j.stage,rank(p,j.stage,t));if(t<j.service_start){const travel=Math.min(.45,Math.max(.08,(j.service_start-j.queue_enter)*.25));return{visible:true,pos:t<j.queue_enter+travel?lerp(prev,q,(t-j.queue_enter)/travel):q,status:'waiting · '+j.label,stage:j.stage}}const sp=spos(j.stage,j.resource_unit);if(t<j.service_end){const travel=Math.min(.28,Math.max(.05,(j.service_end-j.service_start)*.06));return{visible:true,pos:t<j.service_start+travel?lerp(q,sp,(t-j.service_start)/travel):sp,status:'in service · '+j.label,stage:j.stage,resource:j.resource_id}}prev=sp}
 if(p.departure!==null&&t>=p.departure){const u=(t-p.departure)/1.3;if(u<1)return{visible:true,pos:lerp(prev,exit,u),status:'departed'};if(u<1.8)return{visible:true,pos:lerp(exit,gone,(u-1)/.8),status:'departed'};return{visible:false,status:'departed'}}return{visible:true,pos:prev,status:'in system'}
}
function updateWorld(t){
 if(!data)return;const occupied=new Set();patients.forEach(p=>{const s=state(p,t);p._state=s;p.object.visible=s.visible;if(s.visible&&s.pos){p.object.position.copy(s.pos);p.object.position.y=.02+Math.sin(t*.7+p.id)*.018}if(s.resource)occupied.add(s.resource)});
 resources.forEach((r,id)=>{const busy=occupied.has(id);r.light.material.color.setHex(busy?0xefc56a:0x6ee3b7);r.light.material.emissive.setHex(busy?0x553704:0x10382c);r.top.material.color.setHex(busy?0xefc56a:0x67d8f4)});
 updateKPIs(t);updateEvents(t);if(selected)inspect()
}
function clock(m){const total=Math.floor(360+m),day=Math.floor(total/1440),v=total%1440,hh=Math.floor(v/60),mm=v%60;return(day?'D+'+day+' ':'')+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')}
function updateKPIs(t){UI.clock.textContent=clock(t);if(!data)return;const arrived=patients.filter(p=>p.arrival<=t),done=arrived.filter(p=>p.departure!==null&&p.departure<=t),active=arrived.filter(p=>!(p.departure!==null&&p.departure<=t));UI.system.textContent=active.length;UI.waiting.textContent=active.filter(p=>p._state&&p._state.status.indexOf('waiting')===0).length;UI.service.textContent=active.filter(p=>p._state&&p._state.status.indexOf('in service')===0).length;UI.completed.textContent=done.length}
function label(stage){return STAGE[stage]?STAGE[stage].label:stage}
function eventText(e){if(e.type==='arrival')return e.pathway+' arrival';if(e.type==='enter_queue')return'queue → '+label(e.stage);if(e.type==='start_service')return'start '+label(e.stage)+' #'+(e.resource_unit+1);if(e.type==='end_service')return'finish '+label(e.stage);if(e.type==='move_to_next_stage')return'move → '+label(e.to_stage);if(e.type==='departure')return'discharged';return e.type}
function updateEvents(t){if(!data||!eventVisible)return;UI.eventLog.innerHTML=data.events.filter(e=>e.time<=t).slice(-12).reverse().map(e=>'<div class="event-row"><time>'+e.time.toFixed(1)+'</time><span>P'+String(e.patient_id).padStart(3,'0')+' · '+eventText(e)+'</span></div>').join('')}
function inspect(){
 if(!selected||!data)return;if(selected.type==='patient'){const p=patients.find(x=>x.id===selected.id);if(!p)return;UI.inspectTitle.textContent='Patient '+String(p.id).padStart(3,'0');let html='<div class="inspect-grid"><div><span>Pathway</span><b>'+p.pathway+'</b></div><div><span>Current</span><b>'+(p._state?p._state.status:'not arrived')+'</b></div><div><span>Arrived</span><b>'+clock(p.arrival)+'</b></div><div><span>Departed</span><b>'+(p.departure===null?'—':clock(p.departure))+'</b></div></div>';p.journey.forEach(j=>{html+='<div class="journey-row"><strong>'+j.label+'</strong><br>Queue '+j.queue_enter.toFixed(1)+' → '+j.service_start.toFixed(1)+' ('+j.wait.toFixed(1)+' min wait)<br>Service '+j.service_start.toFixed(1)+' → '+j.service_end.toFixed(1)+' · '+j.resource_id+'</div>'});UI.inspectBody.innerHTML=html
 }else{const r=resources.get(selected.id);if(!r)return;const users=patients.filter(p=>p._state&&p._state.resource===selected.id),q=patients.filter(p=>p._state&&p._state.stage===r.stage&&p._state.status.indexOf('waiting')===0).length,done=patients.reduce((n,p)=>n+p.journey.filter(j=>j.resource_id===selected.id&&j.service_end<=simTime).length,0);UI.inspectTitle.textContent=label(r.stage)+' #'+(r.unit+1);UI.inspectBody.innerHTML='<div class="inspect-grid"><div><span>Status</span><b>'+(users.length?'Occupied':'Idle')+'</b></div><div><span>Queue</span><b>'+q+'</b></div><div><span>Current patient</span><b>'+(users.length?'P'+String(users[0].id).padStart(3,'0'):'—')+'</b></div><div><span>Completed</span><b>'+done+'</b></div></div>'}
}
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown',ev=>{if(renderer.xr.isPresenting)return;const r=renderer.domElement.getBoundingClientRect();pointer.x=((ev.clientX-r.left)/r.width)*2-1;pointer.y=-((ev.clientY-r.top)/r.height)*2+1;ray.setFromCamera(pointer,camera);for(const h of ray.intersectObjects(world.children,true)){const u=h.object.userData||{};if(u.patientId!==undefined){selected={type:'patient',id:u.patientId};inspect();return}if(u.resourceId){selected={type:'resource',id:u.resourceId};inspect();return}}});

function params(){return{arrival_scale:+UI.arrival.value,prob_trauma:+UI.traumaP.value,non_trauma_treat_p:+UI.treatP.value,n_triage:+UI.triage.value,n_reg:+UI.reg.value,n_exam:+UI.exam.value,n_trauma:+UI.trauma.value,n_cubicles_1:+UI.ntcub.value,n_cubicles_2:+UI.tcub.value,exam_mean:+UI.examMean.value,trauma_treat_mean:+UI.traumaMean.value,non_trauma_treat_mean:+UI.ntMean.value,seed:+UI.seed.value,run_length:+UI.runLength.value}}
function readouts(){$('arrivalScaleOut').textContent=(+UI.arrival.value).toFixed(2)+'×';$('traumaProbOut').textContent=Math.round(+UI.traumaP.value*100)+'%';$('ntTreatProbOut').textContent=Math.round(+UI.treatP.value*100)+'%';$('examMeanOut').textContent=(+UI.examMean.value).toFixed(0)+' min';$('traumaTreatMeanOut').textContent=(+UI.traumaMean.value).toFixed(0)+' min';$('ntTreatMeanOut').textContent=(+UI.ntMean.value).toFixed(1)+' min'}
function baseline(){UI.arrival.value=BASE.arrival_scale;UI.traumaP.value=BASE.prob_trauma;UI.treatP.value=BASE.non_trauma_treat_p;UI.triage.value=BASE.n_triage;UI.reg.value=BASE.n_reg;UI.exam.value=BASE.n_exam;UI.trauma.value=BASE.n_trauma;UI.ntcub.value=BASE.n_cubicles_1;UI.tcub.value=BASE.n_cubicles_2;UI.examMean.value=BASE.exam_mean;UI.traumaMean.value=BASE.trauma_treat_mean;UI.ntMean.value=BASE.non_trauma_treat_mean;UI.seed.value=BASE.seed;UI.runLength.value=BASE.run_length;readouts()}
async function runSim(){
 if(!pyodide)return;UI.run.disabled=true;UI.run.textContent='Running SimPy…';UI.status.textContent='Executing STARS treatment-centre model in your browser…';
 try{pyodide.globals.set('params_json',JSON.stringify(params()));const json=await pyodide.runPythonAsync('run_from_json(params_json)');data=JSON.parse(json);buildResources(data.resource_capacities);buildPatients();simTime=0;playing=true;selected=null;UI.play.textContent='Ⅱ';UI.timeline.max=data.run_length;UI.timeline.value=0;last=performance.now();updateWorld(0);const m=data.metrics.upstream;UI.status.textContent=data.metrics.arrivals+' arrivals · '+data.metrics.throughput+' discharged · triage wait '+Number(m['01a_triage_wait']).toFixed(1)+' min · upstream '+data.provenance.upstream_version}catch(e){console.error(e);UI.status.textContent='Simulation failed: '+e.message}finally{UI.run.disabled=false;UI.run.textContent='Run SimPy'}
}
async function initPython(){
 try{UI.status.textContent='Loading CPython/WebAssembly…';pyodide=await window.loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/'});await pyodide.loadPackage('micropip');await pyodide.runPythonAsync("import micropip\nawait micropip.install('simpy==4.1.1')");const source=await fetch('./stars_model.py').then(r=>{if(!r.ok)throw new Error('Could not load stars_model.py');return r.text()});await pyodide.runPythonAsync(source);UI.badge.textContent='STARS SimPy ready';UI.badge.classList.add('ready');UI.run.disabled=false;await runSim()}catch(e){console.error(e);UI.badge.textContent='Load failed';UI.status.textContent='Python runtime failed: '+e.message}
}
[UI.arrival,UI.traumaP,UI.treatP,UI.examMean,UI.traumaMean,UI.ntMean].forEach(x=>x.addEventListener('input',readouts));
UI.reset.addEventListener('click',()=>{baseline();runSim()});UI.run.addEventListener('click',runSim);UI.play.addEventListener('click',()=>{playing=!playing;UI.play.textContent=playing?'Ⅱ':'▶';last=performance.now()});UI.restart.addEventListener('click',()=>{simTime=0;UI.timeline.value=0;playing=true;UI.play.textContent='Ⅱ';last=performance.now();updateWorld(0)});UI.timeline.addEventListener('input',()=>{simTime=+UI.timeline.value;playing=false;UI.play.textContent='▶';updateWorld(simTime)});UI.toggleEvents.addEventListener('click',()=>{eventVisible=!eventVisible;UI.eventLog.style.display=eventVisible?'block':'none';UI.toggleEvents.textContent=eventVisible?'Hide':'Show'});
const views={overview:[[22,16,28],[0,1.2,0]],arrivals:[[-14,5,9],[-11,1,0]],nontrauma:[[6,6,18],[2,1,7]],trauma:[[6,5,-18],[2,1,-7]]};document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{const v=views[b.dataset.view];rig.position.set(0,0,0);camera.position.set(...v[0]);controls.target.set(...v[1]);controls.update()}));
const vr=VRButton.createButton(renderer,{optionalFeatures:['local-floor','bounded-floor']});$('vrSlot').appendChild(vr);const controller=renderer.xr.getController(0);scene.add(controller);controller.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-8)]),new THREE.LineBasicMaterial({color:0x67d8f4})));const floor=new THREE.Plane(new THREE.Vector3(0,1,0),0),xrRay=new THREE.Raycaster(),hit=new THREE.Vector3();
controller.addEventListener('select',()=>{xrRay.ray.origin.setFromMatrixPosition(controller.matrixWorld);xrRay.ray.direction.set(0,0,-1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));if(xrRay.ray.intersectPlane(floor,hit)&&Math.abs(hit.x)<19&&Math.abs(hit.z)<10.5){const p=camera.getWorldPosition(new THREE.Vector3());rig.position.x+=hit.x-p.x;rig.position.z+=hit.z-p.z}});
renderer.xr.addEventListener('sessionstart',()=>{controls.enabled=false;rig.position.set(0,0,0);camera.position.set(0,1.65,4)});renderer.xr.addEventListener('sessionend',()=>{controls.enabled=true;rig.position.set(0,0,0);camera.position.set(22,16,28);controls.target.set(0,1.2,0)});
addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()});
renderer.setAnimationLoop(now=>{const dt=Math.min(.12,Math.max(0,(now-last)/1000));last=now;if(playing&&data){simTime+=dt*(+UI.speed.value);if(simTime>=data.run_length){simTime=data.run_length;playing=false;UI.play.textContent='▶'}UI.timeline.value=simTime}updateWorld(simTime);if(controls.enabled)controls.update();renderer.render(scene,camera)});
baseline();initPython();
