import * as THREE from 'three';
import {GROUND_ALTITUDE} from '../shared/craft.ts';

// Metres; the launch deck is y=0 so the engine remains at the physics contact plane.
export function makeLaunchSite(){
  const site=new THREE.Group(),cube=new THREE.BoxGeometry(1,1,1),cylinder=new THREE.CylinderGeometry(1,1,1,24),palette=new Map<string,THREE.MeshStandardMaterial>();
  const colors: Record<string,string>={concrete:'#9badae',wall:'#ccd7d3',roof:'#586c76',steel:'#718791',dark:'#243b47',road:'#38494d',paint:'#e5d6a2',glass:'#285d74',grass:'#425e50',orange:'#df8c59'};
  function mat(color: string){color=colors[color]||color;if(!palette.has(color))palette.set(color,new THREE.MeshStandardMaterial({color,roughness:.78,metalness:.12}));return palette.get(color)!;}
  function block(w: number,h: number,d: number,x: number,y: number,z: number,color='wall',parent=site){const m=new THREE.Mesh(cube,mat(color));m.scale.set(w,h,d);m.position.set(x,y,z);parent.add(m);return m;}
  function drum(r: number,h: number,x: number,y: number,z: number,color='wall',parent=site){const m=new THREE.Mesh(cylinder,mat(color));m.scale.set(r,h,r);m.position.set(x,y,z);parent.add(m);return m;}
  function beam(a: number[],b: number[],width=.14,color='steel',parent=site){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.sub(start);const m=block(width,delta.length(),width,0,0,0,color,parent);m.position.copy(start.addScaledVector(delta,.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return m;}
  function sign(text: string,w: number,h: number,x: number,y: number,z: number,parent=site){
    const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d')!;ctx.fillStyle='#203945';ctx.fillRect(0,0,512,128);ctx.fillStyle='#dbe9de';ctx.font='600 48px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,64,480);
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map,roughness:.8}));m.position.set(x,y,z);parent.add(m);
  }
  const ground=new THREE.Mesh(new THREE.CircleGeometry(2400,128),mat('grass'));ground.rotation.x=-Math.PI/2;ground.position.y=GROUND_ALTITUDE;ground.receiveShadow=true;site.add(ground);
  block(92,.35,92,0,-1.02,0,'concrete');
  // Concrete deck surrounds an open, dark flame duct extending toward -Z.
  block(11,1,13,-7,-.5,0,'concrete');block(11,1,13,7,-.5,0,'concrete');block(3,1,4,0,-.5,4.5,'concrete');
  block(3,.08,35,0,-1.02,-14,'dark');
  for(const x of [-1.7,1.7])block(.4,.8,27,x,-.65,-18,'concrete');
  block(3.1,.15,3.5,0,-.72,-2,'steel').rotation.x=.32;
  // Four hold-down supports, launch ring, painted hazard perimeter.
  for(const x of [-.95,.95])for(const z of [-.95,.95]){block(.32,1.1,.32,x,-.48,z,'steel');beam([x,.06,z],[x*.56,.06,z*.56],.16);}
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.22,.1,8,48),mat('steel'));ring.rotation.x=Math.PI/2;ring.position.y=-.08;site.add(ring);
  for(let i=0;i<20;i++){block(.5,.02,1,-11+i*1.1,.012,5.9,i%2?'dark':'paint');}
  for(const x of [-11,11])for(let z=-5;z<6;z+=2){block(.07,1,.07,x,.5,z,'paint');}
  for(const x of [-11,11])block(.07,.07,11,x,1,0,'paint');
  for(let i=0;i<5;i++)block(2,.2,1,-10,-.9+i*.2,9-i*.6,'concrete');
  sign('LAUNCH COMPLEX 01',8,1.2,6,1.5,7);
  // Open truss service tower with platforms, ladders and an umbilical arm.
  for(const x of [-6,-3.5])for(const z of [-3,-.5])block(.22,21,.22,x,10.4,z,'steel');
  for(let y=0;y<21;y+=3){
    block(2.9,.14,2.9,-4.75,y,-1.75,'roof');
    for(const z of [-3,-.5]){beam([-6,y,z],[-3.5,y+3,z]);beam([-3.5,y,z],[-6,y+3,z]);}
    beam([-6,y,-3],[-6,y+3,-.5]);
    block(.08,2.8,.08,-6.25,y+1.5,-2.2,'paint');block(.08,2.8,.08,-6.25,y+1.5,-1.4,'paint');
    for(let j=0;j<9;j++)block(.1,.04,.8,-6.25,y+j*.33,-1.8,'steel');
  }
  block(3.5,.2,3.5,-4.75,21.2,-1.75,'wall');drum(.07,6,-4.75,24,-1.75,'steel');
  beam([-4,5,-1],[-1,5,-.1],.28);beam([-4,7,-1],[-1,5,-.1],.12);
  block(.32,5,.32,-7,2.5,-2,'orange');
  // Roads, vehicle apron and markings connect distinct facilities.
  block(270,.06,10,15,-.88,68,'road');block(10,.06,118,35,-.88,8,'road');block(10,.06,95,-90,-.88,110,'road');
  block(85,.08,63,-88,-.9,16,'concrete');block(67,.08,45,105,-.9,26,'concrete');
  for(let x=-112;x<150;x+=12)block(5,.015,.18,x,-.835,68,'paint');
  for(let z=-45;z<65;z+=12)block(.18,.015,5,35,-.835,z,'paint');
  function building(x: number,z: number,w: number,d: number,h: number,label: string){
    const g=new THREE.Group();g.position.set(x,-.85,z);site.add(g);
    block(w+2,.5,d+2,0,.15,0,'concrete',g);block(w,h,d,0,h/2,0,'wall',g);block(w+.9,.65,d+.9,0,h,0,'roof',g);
    for(const side of [-1,1])for(let px=-w/2+3;px<w/2-1;px+=4)for(let y=3;y<h-1;y+=3.5)block(2.8,1.45,.12,px,y,side*(d/2+.06),'glass',g);
    for(let px=-w/2+1;px<w/2;px+=3)block(.1,h,.12,px,h/2,d/2+.15,'steel',g);
    for(let px=-w/3;px<=w/3;px+=w/3)block(3,1.5,3,px,h+1,-d/4,'steel',g);
    block(4,3,.15,w/2-4,1.5,d/2+.2,'dark',g);block(6,.2,2,w/2-4,3.3,d/2+1,'roof',g);
    sign(label,Math.min(w-4,19),2.3,0,h-2,d/2+.25,g);return g;
  }
  const assembly=building(-90,5,36,43,27,'VEHICLE ASSEMBLY');
  block(16,22,.22,0,11,21.8,'roof',assembly);
  for(let y=1;y<22;y+=1.4)block(16,.12,.24,0,y,21.95,'steel',assembly);
  for(const x of [-8.5,8.5])block(.7,24,.6,x,12,22,'wall',assembly);
  building(100,24,42,22,10,'MISSION CONTROL');
  building(-88,125,32,25,9,'LOGISTICS');
  const operations=building(127,-53,23,21,7,'OPERATIONS');
  drum(.15,9,0,11,0,'steel',operations);
  const dish=new THREE.Mesh(new THREE.SphereGeometry(3,24,12,0,Math.PI*2,0,Math.PI*.4),mat('wall'));dish.rotation.z=-.5;dish.position.set(0,13,0);operations.add(dish);
  // Bunded propellant farm and overhead pipe runs.
  block(50,.35,32,-61,-.9,-75,'concrete');
  for(const x of [-77,-62,-47]){
    drum(5,12,x,5.1,-75);drum(5.1,.3,x,11.15,-75,'steel');drum(5.15,.3,x,1.1,-75,'steel');
    const dome=new THREE.Mesh(new THREE.SphereGeometry(5,24,12),mat('wall'));dome.scale.y=.28;dome.position.set(x,11.3,-75);site.add(dome);
    beam([x,1,-69],[x,1,-54],.4,'steel');beam([x,1,-54],[-9,1,-54],.4,'steel');
  }
  beam([-9,1,-54],[-9,1,-4],.4,'steel');
  for(let z=-50;z<0;z+=10)block(.9,1.8,.9,-9,0,z,'concrete');
  // Parking bays, parked service vehicles, light poles and site boundary.
  for(let x=79;x<122;x+=4){block(.12,.02,7,x,-.79,44,'paint');}
  for(const [x,z] of [[84,44],[96,44],[-104,36]]){block(2.4,1.4,4.6,x,0,z,'wall');block(2.1,1,2.4,x,.9,z+.2,'glass');for(const dx of [-1.2,1.2])for(const dz of [-1.4,1.4])drum(.45,.2,x+dx,-.35,z+dz,'dark').rotation.z=Math.PI/2;}
  for(const x of [-125,52,148])for(const z of [-100,66,153]){drum(.13,13,x,5.5,z,'steel');block(3,.25,.8,x,12,z,'wall');}
  for(let x=-150;x<=165;x+=15){block(.15,2.4,.15,x,.15,-115,'steel');block(.15,2.4,.15,x,.15,160,'steel');}
  for(const z of [-115,160])for(const y of [.2,1.2])block(315,.07,.07,7.5,y,z,'steel');
  for(let z=-115;z<=160;z+=15)for(const x of [-150,165])block(.15,2.4,.15,x,.15,z,'steel');
  for(const x of [-150,165])for(const y of [.2,1.2])block(.07,.07,275,x,y,22.5,'steel');
  // Batch repeated primitives: facility detail costs a few draw calls per material.
  site.updateMatrixWorld(true);const batches=new Map<string,THREE.Mesh<THREE.BufferGeometry,THREE.Material>[]>(),remove: THREE.Mesh[]=[];
  site.traverse(o=>{if(!(o instanceof THREE.Mesh))return;if(o.geometry!==cube&&o.geometry!==cylinder)return;const key=o.geometry.uuid+(o.material as THREE.Material).uuid;if(!batches.has(key))batches.set(key,[]);batches.get(key)!.push(o);remove.push(o);});
  for(const meshes of batches.values()){const instances=new THREE.InstancedMesh(meshes[0].geometry,meshes[0].material,meshes.length);meshes.forEach((m,i)=>instances.setMatrixAt(i,m.matrixWorld));instances.castShadow=true;instances.receiveShadow=true;site.add(instances);}
  for(const m of remove)m.removeFromParent();
  return site;
}
