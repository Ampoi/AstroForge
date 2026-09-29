/** Visual-only preview, available through the development server. Production
 * builds always retain full rendering, even with a preview query or build mode. */
export function isLightweightPreview(dev: boolean, mode: string, search: string){
  const override=new URLSearchParams(search).get('render');
  return dev && (override==='preview' || (mode==='preview' && override!=='full'));
}

export const lightweightPreview=isLightweightPreview(
  import.meta.env?.DEV===true,import.meta.env?.MODE??'',globalThis.location?.search??'',
);
