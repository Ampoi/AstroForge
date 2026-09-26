import * as THREE from 'three';
import type {ExhaustFrame} from './exhaust.ts';

const MAX_ENGINES = 80;

/** Reduced-order visual envelope, not a nozzle/combustion solver. The engine data
 * lacks exit pressure, temperature and gas composition, so no shock cells are
 * invented. Confinement and dilution approximate the atmospheric/vacuum limits.
 */
export function plumeEnvelope(throttle: number, density: number) {
  const power = THREE.MathUtils.clamp(throttle, 0, 1);
  const air = THREE.MathUtils.clamp(density, 0, 1);
  return {radius: .44, length: (7 + 5 * (1 - air)) * Math.sqrt(power),
    spread: .055 + .24 * (1 - Math.sqrt(air)), power};
}

/** One instanced proxy per nozzle. Integrate an axisymmetric emissive gas field
 * through the proxy, so side, oblique and end-on views all see a filled volume.
 * Fixed 12 samples, no textures, sorting, lights, shadows or extra render targets.
 */
export class ExhaustPlume {
  private geometry = new THREE.InstancedBufferGeometry();
  private origins = new Float32Array(MAX_ENGINES * 3);
  private axes = new Float32Array(MAX_ENGINES * 3);
  private shapes = new Float32Array(MAX_ENGINES * 4);
  private material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    forceSinglePass: true, blending: THREE.AdditiveBlending,
    uniforms: {ground: {value: new THREE.Vector4()}, air: {value: 1}},
    vertexShader: `
      attribute vec3 origin; attribute vec3 axis; attribute vec4 shape;
      uniform vec4 ground;
      varying vec3 point; varying vec3 eye; varying vec4 profile;
      varying vec4 surface;
      void main() {
        vec3 a=normalize(axis);
        vec3 t=normalize(cross(abs(a.x)<.9?vec3(1,0,0):vec3(0,1,0),a));
        mat3 basis=mat3(t,a,cross(t,a));
        float bound=shape.x+shape.y*shape.z;
        point=position*vec3(2.0*bound,shape.y,2.0*bound)+vec3(0,shape.y*.5,0);
        mat3 viewBasis=mat3(modelViewMatrix)*basis;
        eye=-(modelViewMatrix*vec4(origin,1)).xyz*viewBasis;
        surface=vec4(ground.xyz*basis,dot(ground.xyz,origin)+ground.w);
        profile=shape;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(origin+basis*point,1);
      }`,
    fragmentShader: `
      uniform float air;
      varying vec3 point; varying vec3 eye; varying vec4 profile;
      varying vec4 surface;
      void main() {
        float radius=profile.x, lengthJet=profile.y;
        float bound=radius+lengthJet*profile.z;
        vec3 lo=vec3(-bound,0,-bound), hi=vec3(bound,lengthJet,bound);
        bool inside=all(greaterThanEqual(eye,lo))&&all(lessThanEqual(eye,hi));
        if(gl_FrontFacing==inside) discard;
        vec3 ray=normalize(point-eye);
        vec3 safeRay=mix(vec3(1e-5),ray,step(vec3(1e-5),abs(ray)));
        vec3 a=(lo-eye)/safeRay, b=(hi-eye)/safeRay;
        vec3 nearT=min(a,b), farT=max(a,b);
        float entry=max(0.0,max(nearT.x,max(nearT.y,nearT.z)));
        float exitT=min(farT.x,min(farT.y,farT.z));
        // Intersect the conical support as well as its box. Sampling the entire
        // wide vacuum box would undersample the narrow nozzle and create bands.
        float opening=profile.z, atEye=radius+opening*eye.y;
        float qa=dot(ray.xz,ray.xz)-opening*opening*ray.y*ray.y;
        float qb=2.0*(dot(eye.xz,ray.xz)-atEye*opening*ray.y);
        float qc=dot(eye.xz,eye.xz)-atEye*atEye;
        if(abs(qa)<1e-6) {
          if(abs(qb)<1e-6) { if(qc>0.0) discard; }
          else if(qb>0.0) exitT=min(exitT,-qc/qb);
          else entry=max(entry,-qc/qb);
        } else {
          float discriminant=qb*qb-4.0*qa*qc;
          if(discriminant<0.0) { if(qa>0.0) discard; }
          else {
            float root=sqrt(discriminant);
            float t0=(-qb-root)/(2.0*qa), t1=(-qb+root)/(2.0*qa);
            float first=min(t0,t1), last=max(t0,t1);
            if(qa>0.0) { entry=max(entry,first); exitT=min(exitT,last); }
            else if(entry<first) exitT=min(exitT,first);
            else entry=max(entry,last);
          }
        }
        // Clip the integration interval to the ground, even in vacuum.
        float height=dot(surface.xyz,eye)+surface.w;
        float slope=dot(surface.xyz,ray);
        if(abs(slope)<1e-6) { if(height<0.0) discard; }
        else if(slope<0.0) exitT=min(exitT,-height/slope);
        else entry=max(entry,-height/slope);
        if(exitT<=entry) discard;
        float stepLength=(exitT-entry)/12.0;
        vec3 emission=vec3(0);
        for(int i=0;i<12;i++) {
          vec3 p=eye+ray*(entry+(float(i)+.5)*stepLength);
          float z=p.y/lengthJet;
          float width=radius+profile.z*p.y;
          float r2=dot(p.xz,p.xz)/(width*width);
          // A smooth radial field with compact support, not visible parcels.
          float radial=exp(-3.5*r2)*(1.0-smoothstep(.55,1.0,r2));
          // Continuity: expanding area dilutes the gas. Cooling removes light
          // before the gas itself ends; the mixed wake is rendered separately.
          float dilution=radius*radius/(width*width);
          float cooling=exp(-z*2.4)*(1.0-smoothstep(.65,1.0,z));
          vec3 color=mix(vec3(.38,.60,1.0),vec3(1.0,.40,.12),smoothstep(.02,.55,z)*air);
          color=mix(color,vec3(1.0,.94,.82),exp(-z*9.0)*exp(-r2*5.0)*.8);
          emission+=color*radial*dilution*cooling*stepLength;
        }
        emission*=2.6*sqrt(profile.w);
        // Bounded exposure; the nozzle cannot become an opaque white cylinder
        // when viewed along its whole length.
        gl_FragColor=vec4(vec3(1.0)-exp(-emission),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  readonly mesh: THREE.Mesh;
  constructor() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.geometry.index = box.index;
    this.geometry.setAttribute('position', box.getAttribute('position'));
    for (const [name, data, size] of [['origin', this.origins, 3], ['axis', this.axes, 3], ['shape', this.shapes, 4]] as const) {
      this.geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, size).setUsage(THREE.DynamicDrawUsage));
    }
    this.geometry.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'continuous-engine-plume';
    this.mesh.frustumCulled = false;
    // Smoke first, emissive gas second; smoke itself remains depth-sorted.
    this.mesh.renderOrder = 1;
  }
  update(frame: ExhaustFrame) {
    let count = 0;
    for (const e of frame.emitters) {
      if (!(e.throttle > 0)) continue;
      if (count === MAX_ENGINES) throw RangeError('Exhaust supports at most 80 emitters');
      const shape = plumeEnvelope(e.throttle, frame.density);
      e.position.toArray(this.origins, count * 3);
      e.direction.toArray(this.axes, count * 3);
      this.shapes.set([shape.radius, shape.length, shape.spread, shape.power], count * 4);
      count++;
    }
    this.material.uniforms.ground.value.set(frame.up.x, frame.up.y, frame.up.z, frame.groundHeight);
    this.material.uniforms.air.value = THREE.MathUtils.clamp(frame.density, 0, 1);
    this.geometry.instanceCount = count;
    for (const name of ['origin', 'axis', 'shape']) {
      const attr = this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attr.clearUpdateRanges(); attr.addUpdateRange(0, count * attr.itemSize); attr.needsUpdate = true;
    }
  }
  clear() { this.geometry.instanceCount = 0; }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
