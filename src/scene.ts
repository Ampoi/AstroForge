function isStandardMesh(o: THREE.Object3D): o is THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>{return o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial;}
import type {Design, Assembly, LayoutPart, PartType, Mode, SurfaceHit, AssemblyPlacement, PlacementOptions} from '../shared/types.ts';
import type {FlightSnapshot} from '../server/types.ts';
import {toAssembly} from '../shared/assembly.ts';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PARTS,layoutCraft,surfaceRadius,WHEEL} from '../shared/craft.ts';
import {SURFACE_LEVELS,SURFACE_ANGLES} from '../shared/placement.ts';
import {assemblyLayout,assemblyStats,movingIds,resolveAssemblyPlacement,placeAssembly} from '../shared/assembly.ts';
import {EarthEnvironment,earthFixed,EARTH_RADIUS} from './environment.ts';
import {makeLaunchSite} from './launch-site.ts';
import {ExhaustEffect, engineGimbal, type ExhaustEmitter, type ExhaustObstacle} from './exhaust.ts';
import {FrameClock, type FrameRate} from './display.ts';
import {FlightMotion} from './flight-motion.ts';

const materials: Record<string,THREE.MeshStandardMaterial>={};
function material(color: THREE.ColorRepresentation,metal=.25,rough=.55){const key=String(color)+metal+rough;return materials[key]??=new THREE.MeshStandardMaterial({color,metalness:metal,roughness:rough});}
const cyl=(rt: number,rb: number,h: number,color: THREE.ColorRepresentation,metal=.25)=>new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,40),material(color,metal));
const box=(x: number,y: number,z: number,color: THREE.ColorRepresentation,metal=.2)=>new THREE.Mesh(new THREE.BoxGeometry(x,y,z),material(color,metal));
function put<T extends THREE.Object3D>(group: THREE.Object3D,mesh: T,x=0,y=0,z=0){mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;}
let tankTexture: THREE.Texture,solarTexture: THREE.Texture;
function makeTankTexture(){
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#d9dfd9';ctx.fillRect(0,0,1024,512);
  ctx.fillStyle='#b8c3c0';ctx.fillRect(0,25,1024,3);ctx.fillRect(0,477,1024,3);
  ctx.fillStyle='#e38c65';ctx.fillRect(0,405,1024,24);
  ctx.fillStyle='#647578';for(let x=0;x<1024;x+=128){ctx.fillRect(x,40,2,18);ctx.fillRect(x,445,2,20);}
  for(const x of [135,647]){ctx.fillStyle='#3c535b';ctx.font='600 25px sans-serif';ctx.fillText('ASTROFORGE',x,215);ctx.font='14px monospace';ctx.fillText('FT–1200   /   FLIGHT SYSTEMS',x,245);ctx.fillStyle='#90a19e';ctx.fillRect(x,270,190,2);ctx.font='12px monospace';ctx.fillText('LIQUID PROPELLANT',x,293);}
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
function makeSolarTexture(){
  const c=document.createElement('canvas');c.width=256;c.height=128;const ctx=c.getContext('2d')!;ctx.fillStyle='#102b40';ctx.fillRect(0,0,256,128);
  for(let x=3;x<256;x+=32)for(let y=3;y<128;y+=32){ctx.fillStyle='#276281';ctx.fillRect(x,y,27,27);ctx.fillStyle='#5592a7';ctx.fillRect(x+1,y+10,25,1);ctx.fillRect(x+1,y+20,25,1);}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
export function makePart(type: PartType){
  const g=new THREE.Group();
  if(type==='chassis'){
    put(g,box(1.8,4,.45,'#b8c1ac',.55));
    for(const x of [-.83,.83])put(g,box(.09,3.9,.52,'#526168',.7),x);
    for(const y of [-1.8,0,1.8])put(g,box(1.7,.08,.48,'#e3a865',.6),0,y);
    put(g,box(1.4,2.6,.025,'#73847d'),0,0,.24);
  }else if(type==='wheel'){
    put(g,box(.15,.25,.2,'#9aa9aa',.7));
    const suspension=new THREE.Group();suspension.name='suspension';g.add(suspension);
    suspension.position.set(WHEEL.trackOffset,0,-WHEEL.extension);
    const steering=new THREE.Group();steering.name='steering';suspension.add(steering);
    const tire=new THREE.Group();tire.name='tire';steering.add(tire);
    const rubber=put(tire,cyl(WHEEL.radius,WHEEL.radius,.28,'#283034',.05));rubber.rotation.z=Math.PI/2;
    const hub=put(tire,cyl(.23,.23,.30,'#b1babc',.8));hub.rotation.z=Math.PI/2;
    for(let i=0;i<20;i++){const a=i*Math.PI/10,tread=put(tire,box(.3,.09,.035,'#41494b',.05),0,Math.cos(a)*.443,Math.sin(a)*.443);tread.rotation.x=a-Math.PI/2;}
    const spring=put(g,cyl(.065,.065,1,'#e7b660',.7),.15,0,-WHEEL.extension/2);spring.name='spring';spring.rotation.x=Math.PI/2;spring.scale.y=WHEEL.extension;
    put(suspension,box(.3,.07,.07,'#92a2a5',.7),-.15);
    const coilPoints=Array.from({length:129},(_,i)=>{const a=i/128*Math.PI*16;return new THREE.Vector3(Math.cos(a)*.09,i/128-.5,Math.sin(a)*.09);});
    spring.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPoints),128,.018,6,false),material('#e7b660',.7)));
  }else if(type==='tank'){
    tankTexture??=makeTankTexture();const m=new THREE.MeshStandardMaterial({map:tankTexture,metalness:.25,roughness:.5});
    put(g,new THREE.Mesh(new THREE.CylinderGeometry(.615,.615,2.33,48),m));
    for(const y of [-1.15,1.15]){put(g,cyl(.636,.636,.07,'#a4b3b2',.7),0,y);put(g,cyl(.625,.625,.025,'#536970',.6),0,y*.95);}
    put(g,box(.065,2.15,.065,'#8d9e9c',.6),.54,0,.27);
  }else if(type==='pod'){
    put(g,cyl(.16,.624,1.12,'#dbe5e3',.3),0,.045);
    put(g,cyl(.635,.635,.13,'#465b65',.6),0,-.56);
    put(g,cyl(.12,.16,.12,'#d3e0de'),0,.57);
    const window=put(g,box(.3,.21,.03,'#142d3f',.65),0,-.04,.41);window.rotation.x=.39;
    const rim=put(g,box(.38,.28,.026,'#5c787f',.65),0,-.04,.39);rim.rotation.x=.39;
    put(g,box(.018,.13,.031,'#adcad1',.7),0,-.04,.445).rotation.x=.39;
    const hatch=put(g,cyl(.17,.17,.022,'#a8bab8',.6),-.39,-.15,0);hatch.rotation.z=Math.PI/2+.35;
  }else if(type==='battery'){
    put(g,cyl(.62,.62,.25,'#364c58',.6));
    for(const y of [-.14,.14])put(g,cyl(.633,.633,.04,'#9aaaa8',.65),0,y);
    for(let i=0;i<12;i++){const a=i*Math.PI/6;const m=put(g,box(.16,.17,.027,i%3===0?'#d99a6b':'#1e3039'),Math.sin(a)*.62,0,Math.cos(a)*.62);m.rotation.y=a;}
  }else if(type==='decoupler'){
    put(g,cyl(.64,.64,.18,'#d7a54e',.6));
    for(const y of [-.09,.09])put(g,cyl(.645,.645,.035,'#52646b',.75),0,y);
    for(let i=0;i<16;i++){const a=i*Math.PI/8,m=put(g,box(.12,.14,.025,i%2?'#293b43':'#efc46c'),Math.sin(a)*.64,0,Math.cos(a)*.64);m.rotation.y=a;}
  }else if(type==='engine'){
    put(g,cyl(.60,.52,.16,'#77898d',.8),0,.435);
    const nozzle=new THREE.Group();nozzle.name='engine-gimbal';nozzle.position.y=.24;g.add(nozzle);
    put(nozzle,cyl(.23,.23,.3,'#394b53',.8),0,-.01);
    const pts=[[.18,.24],[.15,.13],[.17,.06],[.23,-.10],[.35,-.34],[.46,-.50]].map(([r,y])=>new THREE.Vector2(r,y));
    const bell=new THREE.Mesh(new THREE.LatheGeometry(pts,40),new THREE.MeshStandardMaterial({color:'#56646c',metalness:.8,roughness:.35,side:THREE.DoubleSide}));put(nozzle,bell,0,-.24);
    put(nozzle,cyl(.473,.473,.035,'#9ca49a',.8),0,-.74);
    for(let i=0;i<4;i++){const a=i*Math.PI/2;put(g,cyl(.035,.035,.4,'#c6a889',.7),Math.cos(a)*.35,.2,Math.sin(a)*.35);}
  }else if(type==='fin'){
    const shape=new THREE.Shape();shape.moveTo(0,.44);shape.lineTo(.16,.38);shape.lineTo(.93,-.4);shape.lineTo(.93,-.53);shape.lineTo(0,-.43);shape.closePath();
    const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.055,bevelEnabled:true,bevelThickness:.01,bevelSize:.01,bevelSegments:1,steps:1}),material('#c3d3d5',.55));put(g,mesh,0,0,-.025);
    put(g,box(.1,.77,.1,'#80969c',.6),.02,-.01,0);
    const tip=put(g,box(.1,.115,.067,'#e39069'),.88,-.455,0);tip.rotation.z=0;
  }else if(type==='rcs'){
    put(g,box(.24,.25,.24,'#e2e2d6',.6),.08,0,0);
    for(const direction of [[1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
      const nozzle=cyl(.065,.035,.13,'#555a5d',.8);nozzle.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...direction));put(g,nozzle,.08+direction[0]*.17,direction[1]*.17,direction[2]*.17);
    }
  }else if(type==='solar'){
    solarTexture??=makeSolarTexture();put(g,box(.25,.065,.065,'#97a6aa',.7),.1,0,0);
    put(g,box(1.15,.72,.065,'#9daeb1',.7),.76,0,0);
    const m=new THREE.MeshStandardMaterial({map:solarTexture,metalness:.45,roughness:.32,side:THREE.DoubleSide});
    put(g,new THREE.Mesh(new THREE.PlaneGeometry(1.09,.66),m),.76,0,.037);
    const back=put(g,new THREE.Mesh(new THREE.PlaneGeometry(1.09,.66),m),.76,0,-.037);back.rotation.y=Math.PI;
  }
  return g;
}
function disposeGroup(g: THREE.Object3D){g.traverse(o=>{if(!(o instanceof THREE.Mesh))return;o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])if(!Object.values(materials).includes(m))m.dispose();});}

export class RocketScene{
  element: HTMLElement; onSelect: (id:string | null)=>void;
  onPlace: (type:PartType, placement:AssemblyPlacement | null, movingId?:string)=>void;
  onPlacement: (placement:AssemblyPlacement | null | false | undefined, draft?:Assembly)=>void;
  mode: Mode='editor'; selected: string | null=null; placing: PartType | null=null;
  groups=new Map<string,THREE.Group>(); showMarkers=false; scene: THREE.Scene;
  camera: THREE.PerspectiveCamera; followCamera: THREE.PerspectiveCamera; globeCamera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer; environment: EarthEnvironment; globe=false;
  controls: OrbitControls; followControls: OrbitControls; globeControls: OrbitControls;
  ground: THREE.Group; editorGround: THREE.Group; launchSite: THREE.Group; grid: THREE.GridHelper;
  hangar: THREE.Group; rocket: THREE.Group; markers: THREE.Group; snapGroup: THREE.Group; preview: THREE.Group;
  placementOptions={count:4,mirror:false,snap:true}; debrisGroups=new Map<string,THREE.Group>();
  raycaster: THREE.Raycaster; pointer: THREE.Vector2; down: {x:number;y:number} | null=null;
  moving: LayoutPart | null=null; dragPlane: THREE.Plane | null=null; grabOffset: THREE.Vector3 | null=null;
  observer: ResizeObserver; running=false; frame=0; private listeners=new AbortController();
  craft: Assembly=toAssembly({name:'',parts:[]}); stats=assemblyStats(this.craft); parts: LayoutPart[]=[];
  exhaust=new ExhaustEffect(); exhaustTime: number | null=null; exhaustVessel: string | null=null; selectionBox: THREE.BoxHelper | null=null; placement: AssemblyPlacement | null=null;
  currentFlight: FlightSnapshot | null=null; craftSignature: string | null=null;
  frameClock=new FrameClock(); flightMotion=new FlightMotion();

  constructor(element: HTMLElement,onSelect: RocketScene['onSelect'],onPlace: RocketScene['onPlace'],onPlacement: RocketScene['onPlacement']=()=>{}){
    this.element=element;this.onSelect=onSelect;this.onPlace=onPlace;this.mode='editor';this.selected=null;this.placing=null;this.groups=new Map();this.showMarkers=false;
    this.scene=new THREE.Scene();this.scene.fog=new THREE.FogExp2('#172a35',.013);
    this.camera=new THREE.PerspectiveCamera(34,1,.05,100000);this.camera.position.set(12,8,15);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.setClearColor(0,0);
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.3;element.appendChild(this.renderer.domElement);
    this.renderer.autoClear=false;this.environment=new EarthEnvironment();this.globe=false;
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.minDistance=3;this.controls.maxDistance=25000;this.controls.maxPolarAngle=Math.PI*.91;this.controls.target.set(0,4,0);
    this.followCamera=this.camera;this.followControls=this.controls;
    this.globeCamera=new THREE.PerspectiveCamera(34,1,.05,4000);this.globeCamera.up.set(0,0,-1);
    this.globeControls=new OrbitControls(this.globeCamera,this.renderer.domElement);this.globeControls.enableDamping=true;this.globeControls.enablePan=false;this.globeControls.minDistance=12;this.globeControls.maxDistance=1500;this.globeControls.enabled=false;
    this.scene.add(new THREE.HemisphereLight('#bddeef','#32464b',2.4));
    const key=new THREE.DirectionalLight('#ffedda',4);key.position.set(8,18,12);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-12;key.shadow.camera.right=12;key.shadow.camera.top=15;key.shadow.camera.bottom=-12;key.shadow.normalBias=.035;this.scene.add(key);
    const rim=new THREE.DirectionalLight('#6cb8e3',2.5);rim.position.set(-10,10,-10);this.scene.add(rim);
    this.ground=new THREE.Group();this.scene.add(this.ground);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(400,400),material('#1a2b33',.2,.9));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;put(this.ground,floor,0,-.025,0);floor.castShadow=false;
    this.grid=new THREE.GridHelper(160,80,'#416070','#2a414e');this.grid.material.transparent=true;this.grid.material.opacity=.38;this.ground.add(this.grid);
    const platform=cyl(3.4,3.5,.13,'#2a414b',.55);put(this.ground,platform,0,-.03,0);
    const ring=new THREE.Mesh(new THREE.RingGeometry(3.1,3.12,128),new THREE.MeshBasicMaterial({color:'#719094',transparent:true,opacity:.5,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;put(this.ground,ring,0,.045,0);
    for(let i=0;i<16;i++){const a=i*Math.PI/8,m=box(.04,.003,i%4===0?.28:.12,'#75908e');m.position.set(Math.cos(a)*3.26,.04,Math.sin(a)*3.26);m.rotation.y=-a+Math.PI/2;this.ground.add(m);}
    this.hangar=new THREE.Group();this.ground.add(this.hangar);
    for(const x of [-35,35])for(const z of [-30,30]){const beam=box(.5,35,.5,'#2b424f');put(this.hangar,beam,x,17,z);}
    this.editorGround=this.ground;this.launchSite=makeLaunchSite();this.launchSite.visible=false;this.scene.add(this.launchSite);
    this.rocket=new THREE.Group();this.scene.add(this.rocket);this.scene.add(this.exhaust.mesh);
    this.markers=new THREE.Group();this.scene.add(this.markers);
    this.snapGroup=new THREE.Group();this.scene.add(this.snapGroup);
    this.preview=new THREE.Group();this.scene.add(this.preview);this.onPlacement=onPlacement;
    this.placementOptions={count:4,mirror:false,snap:true};
    this.debrisGroups=new Map();
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.down=null;
    element.addEventListener('pointerdown',e=>{
      this.down={x:e.clientX,y:e.clientY};
      const p=this.mode==='editor'&&e.button===0?this.parts?.find(p=>p.id===this.hit(e)):null;
      if(p&&!this.placing){
        this.moving=p;this.controls.enabled=false;element.setPointerCapture(e.pointerId);e.stopPropagation();
        const center=new THREE.Vector3(-p.position[1],p.position[0],p.position[2]);
        this.dragPlane=new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()),center);
        const grab=this.raycaster.ray.intersectPlane(this.dragPlane,new THREE.Vector3());
        this.grabOffset=grab?center.clone().sub(grab):new THREE.Vector3();
      }
    },{capture:true,signal:this.listeners.signal});
    element.addEventListener('pointermove',e=>{
      if(this.moving){
        if(!this.down||Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)<5&&!this.placing)return;
        if(!this.placing){this.setPlacement(this.moving.type);this.onSelect(this.moving.id);}
        this.updatePlacement(e);
      }else if(this.placing)this.updatePlacement(e);
    },{signal:this.listeners.signal});
    element.addEventListener('pointerup',e=>{
      const moving=this.moving;
      if(this.placing&&e.button===0){const type=this.placing,placement=this.updatePlacement(e);this.onPlace(type,placement,moving?.id);this.cancelPlacement();}
      else if(this.down&&Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)<=5&&this.mode==='editor')this.pick(e);
      this.moving=null;this.down=null;this.controls.enabled=true;
      if(element.hasPointerCapture(e.pointerId))element.releasePointerCapture(e.pointerId);
    },{signal:this.listeners.signal});
    // Native palette drag-and-drop also sends pointercancel to the canvas.
    // Only cancel a pointer-driven move here; dragend handles palette cancellation.
    element.addEventListener('pointercancel',()=>{if(this.moving)this.cancelPlacement();},{signal:this.listeners.signal});
    window.addEventListener('blur',()=>this.cancelPlacement(),{signal:this.listeners.signal});
    document.addEventListener('visibilitychange',()=>{this.frameClock.reset();this.flightMotion.snap();},{signal:this.listeners.signal});
    element.addEventListener('dragover',e=>{if(this.mode==='editor'&&this.placing){e.preventDefault();e.dataTransfer!.dropEffect='copy';this.updatePlacement(e);}},{signal:this.listeners.signal});
    element.addEventListener('dragleave',e=>{if(!element.contains(e.relatedTarget as Node | null)){this.clearPreview();this.onPlacement(null);}},{signal:this.listeners.signal});
    element.addEventListener('drop',e=>{
      e.preventDefault();if(this.mode!=='editor'||!this.placing)return;
      const type=e.dataTransfer!.getData('text/part'),placement=this.updatePlacement(e);
      if(type===this.placing)this.onPlace(type,placement);
      this.setPlacement(null);
    },{signal:this.listeners.signal});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancelPlacement();},{signal:this.listeners.signal});
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(element);this.resize();
    this.running=true;this.animate();
  }
  resize(){const {width,height}=this.element.getBoundingClientRect();if(!width||!height)return;for(const camera of [this.followCamera,this.globeCamera]){camera.aspect=width/height;camera.updateProjectionMatrix();}this.renderer.setSize(width,height);}
  hit(e: MouseEvent | DragEvent, surface: true): SurfaceHit | null;
  hit(e: MouseEvent | DragEvent, surface?: false): string | null;
  hit(e: MouseEvent | DragEvent,surface=false): SurfaceHit | string | null{
    const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.camera.updateMatrixWorld(true);this.raycaster.setFromCamera(this.pointer,this.camera);
    const excluded=surface?movingIds(this.craft,this.moving?.id):new Set();
    const groups=surface?this.parts.filter(p=>!p.def.radial&&!excluded.has(p.id)).map(p=>this.groups.get(p.id)!):[...this.groups.values()];
    const hit=this.raycaster.intersectObjects(groups,true)[0];if(!hit)return null;
    let obj: THREE.Object3D | null=hit.object;while(obj&&!obj.userData.partId)obj=obj.parent;
    if(!surface)return obj?.userData.partId||null;
    const point=this.rocket.worldToLocal(hit.point.clone()),normal=hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);
    return {id:obj!.userData.partId,point:[point.y,-point.x,point.z],normal:[normal.y,-normal.x,normal.z]};
  }
  pick(e: MouseEvent){this.onSelect(this.hit(e));}
  setCraft(craft: Design){
    const oldHeight=this.stats?.height;
    this.craft=toAssembly(craft);this.stats=assemblyStats(craft);this.parts=assemblyLayout(craft);
    if(this.mode==='flight'&&oldHeight){const dy=(this.stats.height-oldHeight)/2;this.followCamera.position.y+=dy;this.followControls.target.y+=dy;}
    this.select(null);for(const g of this.groups.values()){this.rocket.remove(g);disposeGroup(g);}this.groups.clear();
    for(const p of this.parts){const g=makePart(p.type);g.userData.partId=p.id;g.position.set(-p.position[1],p.position[0],p.position[2]);if(p.type==='wheel')g.scale.x=-Math.cos(p.angle!)||1;else if(p.def.radial)g.rotation.y=p.angle!+Math.PI;if(p.connected===false)this.ghostMaterial(g);this.rocket.add(g);this.groups.set(p.id,g);}
    this.exhaust.clear();this.exhaustTime=null;
    for(const c of [...this.markers.children]){this.markers.remove(c);disposeGroup(c);}
    const core=this.parts.filter(p=>!p.def.radial&&p.connected!==false),bottom=core.length?Math.min(...core.map(p=>p.position[0]-p.def.height/2)):0,axis=core[0]?.position||[0,0,0];
    for(const [y,color] of ([[this.stats.com,'#f8b178'],[this.stats.cp,'#78c7c0']] as [number,string][])){
      const m=new THREE.Mesh(new THREE.SphereGeometry(.10,16,12),new THREE.MeshBasicMaterial({color,depthTest:false}));m.position.set(-axis[1],y+bottom,axis[2]+.76);m.renderOrder=10;this.markers.add(m);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(.20,.015,8,32),new THREE.MeshBasicMaterial({color,depthTest:false}));ring.position.copy(m.position);ring.renderOrder=10;this.markers.add(ring);
    }
    this.markers.visible=this.showMarkers&&this.mode==='editor';this.setPlacement(this.placing);
  }
  select(id: string | null){
    this.selected=id;if(this.selectionBox){this.scene.remove(this.selectionBox);this.selectionBox.geometry.dispose();this.selectionBox.material.dispose();this.selectionBox=null;}
    if(id&&this.groups.has(id)){this.selectionBox=new THREE.BoxHelper(this.groups.get(id)!,'#f3a67f');this.selectionBox.material.transparent=true;this.selectionBox.material.opacity=.65;this.scene.add(this.selectionBox);}
  }
  clearPreview(dispose=false){
    for(const p of this.parts||[]){const g=this.groups.get(p.id)!;g.position.set(-p.position[1],p.position[0],p.position[2]);g.visible=true;}
    this.preview.visible=false;
    this.markers.visible=this.showMarkers&&this.mode==='editor'&&!!this.parts?.length;
    if(dispose)for(const c of [...this.preview.children]){this.preview.remove(c);disposeGroup(c);}
    this.placement=null;
  }
  cancelPlacement(){this.moving=null;this.down=null;this.dragPlane=null;this.grabOffset=null;this.controls.enabled=true;this.setPlacement(null);}
  ghostMaterial(group: THREE.Group){
    group.traverse(o=>{if(!(isStandardMesh(o)))return;const old=o.material;o.material=old.clone();o.material.transparent=true;o.material.opacity=.28;o.material.depthWrite=false;if(!Object.values(materials).includes(old))old.dispose();o.castShadow=false;});
  }
  setPlacement(type: PartType | null,options: PlacementOptions={}){
    Object.assign(this.placementOptions,options);this.clearPreview(true);
    this.placing=type;this.element.style.cursor=type?'crosshair':'';
    for(const c of [...this.snapGroup.children]){this.snapGroup.remove(c);disposeGroup(c);}
    this.onPlacement(type?undefined:false);
    if(!type||!this.parts||!this.placementOptions.snap)return;
    const excluded=movingIds(this.craft,this.moving?.id);
    for(const p of this.parts.filter(p=>!p.def.radial&&!excluded.has(p.id))){
      if(PARTS[type].radial){
        if(p.type==='engine')continue;
        for(const offset of SURFACE_LEVELS)for(const a of (type==='wheel'?[0,Math.PI]:SURFACE_ANGLES)){
          const radius=surfaceRadius(p.type,offset,a)+.012;
          const dot=new THREE.Mesh(new THREE.SphereGeometry(.025,8,6),new THREE.MeshBasicMaterial({color:'#99e4d7',transparent:true,opacity:.8}));
          dot.position.set(-p.position[1]-Math.cos(a)*radius,p.position[0]+offset*p.def.height,p.position[2]+Math.sin(a)*radius);this.snapGroup.add(dot);
        }
      }else{
        for(const side of [1,-1]){
          const position=[p.position[0]+side*(p.def.height+PARTS[type].height)/2,p.position[1],p.position[2]];
          const candidate=resolveAssemblyPlacement(this.craft,type,null,{point:position,movingId:this.moving?.id});
          if(candidate.kind!=='stack'||candidate.parent!==p.id||candidate.side!==side)continue;
          const ring=new THREE.Mesh(new THREE.TorusGeometry(.65,.014,8,40),new THREE.MeshBasicMaterial({color:'#99e4d7',transparent:true,opacity:.65,depthTest:false}));ring.rotation.x=Math.PI/2;ring.position.set(-p.position[1],p.position[0]+side*p.def.height/2,p.position[2]);ring.renderOrder=5;this.snapGroup.add(ring);
        }
      }
    }
  }
  updatePlacement(e: MouseEvent | DragEvent){
    if(!this.placing)return null;
    this.clearPreview();this.rocket.updateMatrixWorld(true);
    const hit=this.hit(e,true);
    const plane=this.dragPlane||new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()),this.controls.target);
    const position=this.raycaster.ray.intersectPlane(plane,new THREE.Vector3());if(!position)return null;
    if(this.grabOffset)position.add(this.grabOffset);
    const point=[position.y,-position.x,position.z];
    const ids=movingIds(this.craft,this.moving?.id),moving=this.parts.find(p=>p.id===this.moving?.id);
    const floor=moving?Math.min(...this.parts.filter(p=>ids.has(p.id)).map(p=>p.position[0]-p.def.height/2))-moving.position[0]:-PARTS[this.placing].height/2;
    point[0]=Math.max(point[0],.08-floor);
    const placement=resolveAssemblyPlacement(this.craft,this.placing,hit,{point,movingId:this.moving?.id,snap:this.placementOptions.snap&&!e.altKey});
    let draft;
    try{draft=placeAssembly(this.craft,this.placing,placement,{movingId:this.moving?.id,...this.placementOptions});}
    catch{this.onPlacement(null);return null;}
    const ghosts=assemblyLayout(draft).filter(p=>ids.has(p.id)||!this.groups.has(p.id));
    if(this.preview.children.map(g=>g.userData.partId).join()!==ghosts.map(p=>p.id).join()){
      this.clearPreview(true);
      for(const p of ghosts){
        const g=makePart(p.type);g.userData.partId=p.id;
        g.traverse(o=>{if(!(isStandardMesh(o)))return;const old=o.material;o.material=old.clone();if(!Object.values(materials).includes(old))old.dispose();});
        this.preview.add(g);
      }
    }
    ghosts.forEach((p,i)=>{const g=this.preview.children[i];g.position.set(-p.position[1],p.position[0],p.position[2]);if(p.type==='wheel')g.scale.x=-Math.cos(p.angle!)||1;else if(p.def.radial)g.rotation.y=p.angle!+Math.PI;g.traverse(o=>{if(!(isStandardMesh(o)))return;const transparent=!p.connected;if(o.material.transparent!==transparent){o.material.transparent=transparent;o.material.needsUpdate=true;}o.material.opacity=transparent?.28:1;o.material.depthWrite=!transparent;o.castShadow=!transparent;});});
    this.preview.visible=true;this.placement=placement;
    for(const p of draft.parts){const g=this.groups.get(p.id);if(g&&!ids.has(p.id))g.position.set(-p.position[1],p.position[0],p.position[2]);}
    for(const id of ids)this.groups.get(id)!.visible=false;
    this.markers.visible=false;
    this.onPlacement(placement,draft);
    return placement;
  }
  setMode(mode: Mode){
    this.flightMotion.clear();
    for(const g of this.debrisGroups.values()){this.scene.remove(g);disposeGroup(g);}this.debrisGroups.clear();
    this.currentFlight=null;this.mode=mode;this.cancelPlacement();this.select(null);this.markers.visible=mode==='editor'&&this.showMarkers;this.ground.position.set(0,0,0);this.rocket.position.set(0,0,0);this.rocket.quaternion.identity();this.exhaust.clear();this.exhaustTime=null;this.exhaustVessel=null;
    for(const g of this.groups.values())g.getObjectByName('engine-gimbal')?.quaternion.identity();
    this.rocket.visible=true;(this.scene.fog as THREE.FogExp2).density=.013;this.element.parentElement!.style.background='';
    this.editorGround.visible=mode==='editor';this.launchSite.visible=mode==='flight';this.ground=mode==='flight'?this.launchSite:this.editorGround;
    this.ground.position.set(0,0,0);this.followControls.maxPolarAngle=mode==='flight'?Math.PI*.49:Math.PI*.91;this.setView(false);
  }
  setView(globe: boolean){
    this.globe=globe&&this.mode==='flight';this.followControls.enabled=!this.globe;this.globeControls.enabled=this.globe;
    this.camera=this.globe?this.globeCamera:this.followCamera;this.controls=this.globe?this.globeControls:this.followControls;this.fit();
  }
  fit(front=false){
    if(this.globe){
      const direction=this.environment.position.clone().normalize().addScaledVector(this.environment.uniforms.sunDirection.value,.65).normalize();
      const screen=this.element.clientHeight||650,area=Math.max(220,screen-310),fill=Math.min(area/screen,this.camera.aspect*.78);
      const distance=10.6/Math.sin(Math.atan(Math.tan(this.camera.fov*Math.PI/360)*fill));
      this.controls.target.set(0,0,0);this.camera.position.copy(direction.multiplyScalar(Math.min(130,distance)));this.controls.update();return;
    }
    if(this.mode==='editor'){
      const bounds=new THREE.Box3();for(const group of this.groups.values())bounds.expandByObject(group);
      const center=bounds.isEmpty()?new THREE.Vector3(0,4,0):bounds.getCenter(new THREE.Vector3());
      const size=bounds.isEmpty()?new THREE.Vector3(2,5,2):bounds.getSize(new THREE.Vector3());
      const distance=Math.max(10,Math.max(size.y,size.x/this.camera.aspect,size.z/this.camera.aspect)*1.65/(2*Math.tan(this.camera.fov*Math.PI/360)));
      this.controls.target.copy(center).add(new THREE.Vector3(0,Math.max(1,size.y*.15),0));
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3(front?0:1,front?.05:.25,1.35).normalize().multiplyScalar(distance));this.controls.update();return;
    }
    const pad=this.mode==='flight'&&(!this.currentFlight||this.currentFlight.status==='pad');
    const h=this.stats?.height||7,screen=this.element.clientHeight||650,top=80,bottom=95;
    const area=Math.max(220,screen-top-bottom),distance=Math.max(pad?90:this.mode==='flight'?24:0,h*screen/(2*Math.tan(this.camera.fov*Math.PI/360)*area));
    const offset=(top-bottom)*h/(2*area);
    this.controls.target.set(0,h/2+offset+(pad?7:0),0);
    const direction=new THREE.Vector3(front?0:1,front?.05:.25,1.35).normalize().multiplyScalar(distance);
    this.camera.position.copy(this.controls.target).add(direction);this.controls.update();
  }
  fitSite(){
    if(this.globe)return this.fit();
    this.controls.target.set(0,this.mode==='flight'?5:(this.stats?.height||7)/2,0);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(340,300,450));this.controls.update();
  }
  zoom(factor: number){this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target);this.controls.update();}
  updateFlight(f: FlightSnapshot,trail: number[][]){
    if(this.mode!=='flight')return;
    this.currentFlight=f;this.environment.update(f,trail);
    this.flightMotion.push(f,performance.now());
    if(document.hidden)this.flightMotion.snap();
    const visibleIds=new Set((f.debris||[]).map(d=>d.id));
    for(const [id,g] of this.debrisGroups)if(!visibleIds.has(id)){this.scene.remove(g);disposeGroup(g);this.debrisGroups.delete(id);}
    for(const d of f.debris||[]){
      let g=this.debrisGroups.get(d.id);
      const signature=JSON.stringify(d.craft);
      if(g&&g.userData.signature!==signature){this.scene.remove(g);disposeGroup(g);this.debrisGroups.delete(d.id);g=undefined;}
      if(!g){
        g=new THREE.Group();g.userData.signature=signature;
        for(const p of layoutCraft(d.craft)){const part=makePart(p.type);part.position.set(-p.position[1],p.position[0],p.position[2]);if(p.type==='wheel')part.scale.x=-Math.cos(p.angle!)||1;else if(p.def.radial)part.rotation.y=p.angle!+Math.PI;g.add(part);}
        this.scene.add(g);this.debrisGroups.set(d.id,g);
      }
    }
  }
  renderFlight(f: FlightSnapshot,now: number){
    for(const w of f.wheels||[]){
      const g=this.groups.get(w.id);if(!g)continue;
      const suspension=g.getObjectByName('suspension'),steering=g.getObjectByName('steering'),tire=g.getObjectByName('tire'),spring=g.getObjectByName('spring');
      const length=WHEEL.extension-w.compression;
      if(suspension)suspension.position.z=-length;
      if(spring){spring.position.z=-length/2;spring.scale.y=length;}
      if(steering)steering.rotation.z=w.steering*g.scale.x;
      if(tire)tire.rotation.x=-w.rotation;
    }

    this.environment.updatePose(f);
    // World ECI -> Three at the rotating launch frame; model y is body x.
    const spin=-7.292115e-5*f.time;
    const frame=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),spin);
    const worldToScene=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(0,1,0,0,1,0,0,0,0,0,-1,0,0,0,0,1));
    const modelToBody=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-Math.PI/2);
    this.rocket.quaternion.copy(worldToScene).multiply(frame).multiply(new THREE.Quaternion(...f.quaternion)).multiply(modelToBody);
    const modelCom=new THREE.Vector3(-f.com[1],f.com[0],f.com[2]).applyQuaternion(this.rocket.quaternion);
    this.rocket.position.set(-modelCom.x,this.stats.height/2-modelCom.y,-modelCom.z);
    for(const d of f.debris){
      const g=this.debrisGroups.get(d.id);if(!g)continue;
      g.quaternion.copy(worldToScene).multiply(frame).multiply(new THREE.Quaternion(...d.quaternion)).multiply(modelToBody);
      const offset=earthFixed(d.position.map((v,i)=>v-f.position[i]),f.time),com=new THREE.Vector3(-d.com[1],d.com[0],d.com[2]).applyQuaternion(g.quaternion);
      g.position.copy(offset).add(new THREE.Vector3(0,this.stats.height/2,0)).sub(com);g.visible=offset.length()<25000;
    }
    this.ground.position.copy(earthFixed(f.position,f.time)).negate().add(new THREE.Vector3(0,EARTH_RADIUS+this.stats.height/2,0));
    this.ground.visible=f.altitude<50000;(this.scene.fog as THREE.FogExp2).density=.00012*Math.exp(-f.altitude/8000);
    this.updateExhaust(f,worldToScene.clone().multiply(frame));
    this.rocket.visible=f.status!=='destroyed';
  }
  updateExhaust(f: FlightSnapshot,inertialToScene: THREE.Quaternion){
    if(this.exhaustVessel!==f.id){this.exhaust.clear();this.exhaustTime=null;this.exhaustVessel=f.id;}
    const dt=this.exhaustTime===null?0:f.time-this.exhaustTime;this.exhaustTime=f.time;
    const inverseFrame=inertialToScene.clone().invert(),center=new THREE.Vector3(0,this.stats.height/2,0);
    const bodyRotation=new THREE.Quaternion(...f.quaternion),omega=new THREE.Vector3(...f.omega).applyQuaternion(bodyRotation);
    const velocity=new THREE.Vector3(...f.velocity),origin=new THREE.Vector3(...f.position),up=origin.clone().normalize();
    const toInertial=(point: THREE.Vector3)=>point.sub(center).applyQuaternion(inverseFrame);
    const emitters: ExhaustEmitter[]=[],obstacles: ExhaustObstacle[]=[];
    for(const p of this.parts){
      const g=this.groups.get(p.id);if(!g)continue;
      if(p.type==='engine'){
        const nozzle=g.getObjectByName('engine-gimbal')!,engine=f.engines.find(e=>e.id===p.id);
        nozzle.quaternion.copy(engineGimbal(engine?.gimbalPitch??0,engine?.gimbalYaw??0));
        if(!engine?.available||engine.thrust<=0||!['pad','flying'].includes(f.status))continue;
        const position=toInertial(nozzle.localToWorld(new THREE.Vector3(0,-.76,0)));
        const direction=new THREE.Vector3(0,-1,0).applyQuaternion(nozzle.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(inverseFrame);
        emitters.push({position,direction,velocity:velocity.clone().add(new THREE.Vector3().crossVectors(omega,position)),throttle:engine.thrust/Math.max(1,engine.maxThrust)});
      }else if(!p.def.radial&&p.connected!==false){
        const radius='depth' in p.def&&typeof p.def.depth==='number'?Math.min(.6,p.def.depth/2):.6,half=Math.max(0,p.def.height/2-radius);
        obstacles.push({start:toInertial(g.localToWorld(new THREE.Vector3(0,-half,0))),end:toInertial(g.localToWorld(new THREE.Vector3(0,half,0))),radius,velocity:velocity.clone().add(new THREE.Vector3().crossVectors(omega,toInertial(g.getWorldPosition(new THREE.Vector3()))))});
      }
    }
    this.exhaust.mesh.quaternion.copy(inertialToScene);this.exhaust.mesh.position.copy(center);
    this.exhaust.update(dt,{origin,airVelocity:new THREE.Vector3(-7.292115e-5*origin.y,7.292115e-5*origin.x,0),
      up,groundHeight:f.altitudeAsl,density:Math.exp(-Math.max(0,f.altitudeAsl)/8500),emitters,obstacles},this.camera);
  }
  dispose(){
    this.running=false;cancelAnimationFrame(this.frame);this.listeners.abort();this.observer.disconnect();
    this.followControls.dispose();this.globeControls.dispose();this.scene.remove(this.exhaust.mesh);this.exhaust.dispose();disposeGroup(this.scene);this.environment.dispose();
    this.renderer.dispose();this.renderer.domElement.remove();
  }
  setFrameRate(rate: FrameRate){this.frameClock.setRate(rate);}
  get fps(){return this.frameClock.fps;}
  animate(now=performance.now()){
    if(!this.running)return;this.frame=requestAnimationFrame(time=>this.animate(time));if(document.hidden)return;
    const delta=this.frameClock.tick(now);if(delta===null)return;
    // Keep camera damping consistent when switching between 30 Hz and high-refresh screens.
    this.controls.dampingFactor=1-Math.pow(.92,delta*60);
    if(this.mode==='flight'){const flight=this.flightMotion.sample(now);if(flight)this.renderFlight(flight,now);}
    this.controls.update();this.selectionBox?.update();this.renderer.clear();
    const near=this.globe ? .05 : Math.max(.05,this.camera.position.distanceTo(this.controls.target)/10000);
    if(this.camera.near!==near){this.camera.near=near;this.camera.updateProjectionMatrix();}
    if(this.mode==='flight'){
      this.environment.render(this.renderer,this.camera,this.globe,new THREE.Vector3(0,(this.stats?.height||7)/2,0));
      if(this.globe)return;this.renderer.clearDepth();
    }
    this.renderer.render(this.scene,this.camera);
  }
}
