import * as THREE from 'three';

/** Stable synthetic sky. Directions are area-uniform, not an astronomical catalogue. */
export function starCatalogue(count=5000,seed=411){
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const directions=new Float32Array(count*3),colors=new Float32Array(count*3),sizes=new Float32Array(count);
  const color=new THREE.Color();
  for(let i=0;i<count;i++){
    const longitude=random()*Math.PI*2,z=random()*2-1,radius=Math.sqrt(1-z*z),brightness=random();
    directions.set([Math.cos(longitude)*radius,Math.sin(longitude)*radius,z],i*3);
    color.set(random()>.3?'#d2e6ff':'#ffe7c8').multiplyScalar(.55+random()*.45);
    colors.set(color.toArray(),i*3);sizes[i]=brightness>.992?3.8:brightness>.93?2.5:1.6;
  }
  return {directions,colors,sizes};
}

/** Subpixel cores and soft halos drawn at display resolution: no atlas blur or
 * screen-sized star texture. One draw call, no per-frame catalogue generation. */
export function makeStarField(background:THREE.Texture,cameraRotation:THREE.IUniform,aspect:THREE.IUniform,tanFov:THREE.IUniform){
  const catalogue=starCatalogue(),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(catalogue.directions,3));
  geometry.setAttribute('color',new THREE.BufferAttribute(catalogue.colors,3));
  geometry.setAttribute('size',new THREE.BufferAttribute(catalogue.sizes,1));
  const material=new THREE.ShaderMaterial({
    uniforms:{background:{value:background},cameraRotation,aspect,tanFov,resolution:{value:new THREE.Vector2(1,1)},pixelRatio:{value:1}},
    transparent:true,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false,vertexColors:true,
    vertexShader:`attribute float size; uniform mat3 cameraRotation; uniform float aspect; uniform float tanFov; uniform float pixelRatio; varying vec3 starColor;
      void main(){
        vec3 d=vec3(dot(position,cameraRotation[0]),dot(position,cameraRotation[1]),dot(position,cameraRotation[2]));
        gl_Position=d.z<0.?vec4(d.x/(aspect*tanFov),d.y/tanFov,0.,-d.z):vec4(2.,2.,2.,1.);
        gl_PointSize=size*pixelRatio;starColor=color;
      }`,
    fragmentShader:`uniform sampler2D background; uniform vec2 resolution; varying vec3 starColor;
      void main(){
        float radius=length(gl_PointCoord-.5)*2.;
        float profile=exp(-radius*radius*5.)*(1.-smoothstep(.7,1.,radius));
        float transmission=texture2D(background,gl_FragCoord.xy/resolution).a;
        gl_FragColor=vec4(starColor*1.4,profile*transmission);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points=new THREE.Points(geometry,material);points.frustumCulled=false;return points;
}
