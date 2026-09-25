/** Stable uint32 identifiers; collision resolution belongs to the vessel registry. */
export class PartIdentity{
  private ids=new Map<string,number>();
  get(name:string){
    let id=this.ids.get(name);if(id!==undefined)return id;
    id=2166136261;for(const char of name)id=Math.imul(id^char.charCodeAt(0),16777619)>>>0;
    const used=new Set(this.ids.values());while(used.has(id))id=(id+1)>>>0;
    this.ids.set(name,id);return id;
  }
}
