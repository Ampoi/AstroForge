import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** Three's PBR chunk evaluates the BRDF even for out-of-range spotlights.
 * Skip that work for our many small, spatially separated pools of light. */
export function skipInactiveLights(material: THREE.MeshStandardMaterial, terrain = false) {
  const previous = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    let lighting = THREE.ShaderChunk.lights_fragment_begin.replaceAll(
      'RE_Direct( directLight,', 'if ( directLight.visible ) RE_Direct( directLight,');
    // These beams all point above the flat facility ground. Avoid evaluating
    // them over the enormous terrain mesh, which cannot receive their light.
    if (terrain) lighting = lighting.replace(
      /#if \( NUM_SPOT_LIGHTS > 0 \)[\s\S]*?(?=#if \( NUM_DIR_LIGHTS > 0 \))/, '');
    const parameters = THREE.ShaderChunk.lights_pars_begin.replace(
      'vec3 lVector = spotLight.position - geometryPosition;',
      `vec3 lVector = spotLight.position - geometryPosition;
       if ( all( equal( spotLight.color, vec3( 0.0 ) ) ) ||
            ( spotLight.distance > 0.0 && dot( lVector, lVector ) >= spotLight.distance * spotLight.distance ) ) {
         light.color = vec3( 0.0 ); light.direction = vec3( 0.0, 1.0, 0.0 );
         light.visible = false; return;
       }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_pars_begin>', parameters);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lighting);
  };
  material.customProgramCacheKey = () => `${cacheKey}:site-light-culling:${terrain}`;
  material.needsUpdate = true;
}

/** A single inexpensive draw keeps small fixtures visible at approach distances. */
export class LightGlows extends THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  constructor(positions: number[], colors: number[]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    super(geometry, new THREE.ShaderMaterial({
      uniforms: {night: {value: 0}, pixelRatio: {value: 1}},
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float pixelRatio; varying vec3 tint; varying float fade;
        void main() {
          vec4 view = modelViewMatrix * vec4(position, 1.);
          gl_Position = projectionMatrix * view;
          gl_PointSize = clamp(1400. / max(1., -view.z), 3., 12.) * pixelRatio;
          fade = 1. - smoothstep(8000., 20000., length(view.xyz));
          tint = color;
        }`,
      fragmentShader: `uniform float night; varying vec3 tint; varying float fade;
        void main() {
          float radius = length(gl_PointCoord - .5) * 2.;
          if (radius > 1.) discard;
          gl_FragColor = vec4(tint, exp(-5. * radius * radius) * night * fade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.name = 'Runway light halos';
    this.onBeforeRender = renderer => { this.material.uniforms.pixelRatio.value = renderer.getPixelRatio(); };
    // Halos are visual only; picking must continue to hit physical scenery.
    this.raycast = () => {};
  }
}

/** Illumination is tied to the fixed launch site, never the moving vehicle. */
export class SiteLighting extends THREE.Group {
  private readonly emitters = new Map<THREE.MeshStandardMaterial, number>();
  private readonly glows = new Set<LightGlows>();
  private readonly floods = new Map<THREE.SpotLight, number>();
  private readonly surfaces = new Set<THREE.MeshStandardMaterial>();
  private night = 0;

  constructor() {
    super();
    this.name = 'Launch complex ground uplights';
    const housingMaterial = new THREE.MeshStandardMaterial({color: '#343d40', roughness: .7});
    const lampMaterial = new THREE.MeshStandardMaterial({color: '#ffe2b4', emissive: '#ffe2b4', emissiveIntensity: 1.2});
    const housingGeometry = new THREE.BoxGeometry(.6, .4, .22);
    const lensGeometry = new THREE.PlaneGeometry(.44, .26);
    const footGeometry = new THREE.BoxGeometry(.48, .18, .48);
    const housings: THREE.BufferGeometry[] = [], lenses: THREE.BufferGeometry[] = [];
    const uplight = (x: number, z: number, tx: number, ty: number, tz: number, intensity: number) => {
      housings.push(footGeometry.clone().translate(x, -.74, z));
      const housing = new THREE.Object3D();
      housing.position.set(x, -.45, z);
      housing.lookAt(tx, ty, tz);
      housing.updateMatrix();
      housings.push(housingGeometry.clone().applyMatrix4(housing.matrix));
      lenses.push(lensGeometry.clone().translate(0, 0, .112).applyMatrix4(housing.matrix));
      // Narrow, soft cones graze individual facade bays and tower columns.
      // Inverse-square falloff leaves the upper structure naturally darker.
      const flood = new THREE.SpotLight('#ffe2b4', 0, 70, Math.PI / 7, .9, 2);
      flood.position.copy(housing.position);
      flood.target.position.set(tx, ty, tz);
      this.floods.set(flood, intensity);
      this.add(flood, flood.target);
    };
    for (const x of [-31, -23, -15]) for (const z of [-15, 9]) {
      uplight(x, z, -23 + (x + 23) * .65, 22, -3 + (z + 3) * .55, 1200);
    }
    for (const x of [-35, -11]) uplight(x, -3, -23 + (x + 23) * .55, 22, -3, 1200);
    for (const x of [-34, -26, -19, 19, 26, 34]) uplight(x, 178, x, 20, 185, 450);
    for (const side of [-1, 1]) for (const z of [202, 226, 250, 272]) {
      uplight(side * 44, z, side * 38, 20, z, 450);
    }
    this.add(new THREE.Mesh(mergeGeometries(housings), housingMaterial), new THREE.Mesh(mergeGeometries(lenses), lampMaterial));
    for (const geometry of [...housings, ...lenses, housingGeometry, lensGeometry, footGeometry]) geometry.dispose();
    this.register(this);
  }

  /** Also called after the asynchronous GLB load, preserving the current night level. */
  register(root: THREE.Object3D) {
    root.traverse(object => {
      if (object instanceof LightGlows) {
        this.glows.add(object);
        object.material.uniforms.night.value = this.night;
      }
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (!this.surfaces.has(material)) {
          skipInactiveLights(material);
          this.surfaces.add(material);
        }
        if (this.emitters.has(material)) continue;
        if (material.emissive.getHex() === 0 || material.emissiveIntensity <= 0) continue;
        this.emitters.set(material, material.emissiveIntensity);
        material.emissiveIntensity *= this.night;
      }
    });
  }

  update(sunPosition: THREE.Vector3) {
    // SunBody positions use Earth radii; the launch site's zenith is +Y.
    const elevation = (sunPosition.y - 1) / Math.hypot(sunPosition.x, sunPosition.y - 1, sunPosition.z);
    this.night = 1 - THREE.MathUtils.smoothstep(elevation, -.06, .08);
    for (const [material, intensity] of this.emitters) material.emissiveIntensity = intensity * this.night;
    for (const [flood, intensity] of this.floods) flood.intensity = intensity * this.night;
    for (const glow of this.glows) glow.material.uniforms.night.value = this.night;
  }

  dispose() {
    this.emitters.clear();
    this.glows.clear();
    this.surfaces.clear();
    for (const flood of this.floods.keys()) flood.dispose();
    this.floods.clear();
  }
}
