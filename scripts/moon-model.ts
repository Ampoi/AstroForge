const RADIUS=1737400;
const TAU=Math.PI*2;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

/** Tangent-space +X is east, +Y north (OpenGL). Longitude spacing shrinks with
 * latitude. Heights are metres, so the slopes do not depend on atlas size. */
export function moonNormals(elevation:Float32Array,width:number,height:number){
  if(elevation.length!==width*height)throw Error('Moon elevation: invalid dimensions');
  const normal=new Uint8Array(width*height*3),dy=Math.PI*RADIUS/height;
  for(let y=0;y<height;y++){
    const cos=Math.cos((.5-(y+.5)/height)*Math.PI),dx=TAU*RADIUS/width*cos;
    // At the last few polar texels the longitude tangent is undersampled.
    const polarFade=smooth(0,.025,cos);
    for(let x=0;x<width;x++){
      const i=y*width+x;
      const east=(elevation[y*width+(x+1)%width]-elevation[y*width+(x+width-1)%width])/(2*dx);
      const north=(elevation[Math.max(0,y-1)*width+x]-elevation[Math.min(height-1,y+1)*width+x])/(2*dy);
      const nx=-east*polarFade,ny=-north*polarFade,nz=1,length=Math.hypot(nx,ny,nz);
      normal[i*3]=Math.round((nx/length*.5+.5)*255);
      normal[i*3+1]=Math.round((ny/length*.5+.5)*255);
      normal[i*3+2]=Math.round((nz/length*.5+.5)*255);
    }
  }
  return normal;
}
