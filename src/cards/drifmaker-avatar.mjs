import {CATEGORIES,DEFAULT_APPEARANCE,FINISH_COLORS,EAR_COMPATIBLE_HEADS,LEG_OVERRIDE_TOPS,HEAD_SCALES,isOriginalHead,normalizeAppearance,characterCategories,characterDefaults,usesBaseHead,headAllowsEars,topOverridesLegs,characterHair} from './drifmaker-config.mjs';
import {applyHoloShader} from './drifmaker-holo.mjs';
import {applyCamoShader} from './drifmaker-camo.mjs';
import {COLLECTION_FINISHES,applyCollectionFinishShader} from './drifmaker-finishes.mjs';

// The original tail shares the body mesh with the hands. Filter its complete
// Tail/TailTip-weighted triangles without changing shared geometry or the rig.
function bodyWithoutTail(node){
 const source=node.geometry,joints=source.getAttribute('skinIndex'),weights=source.getAttribute('skinWeight');
 const tailBones=new Set(node.skeleton.bones.flatMap((bone,index)=>/^Tail(?:Tip)?$/.test(bone.name)?[index]:[]));
 if(!joints||!weights||!tailBones.size)return null;
 const tail=Array.from({length:joints.count},(_,vertex)=>{
  for(let component=0;component<4;component++)if(weights.getComponent(vertex,component)>0&&tailBones.has(joints.getComponent(vertex,component)))return true;
  return false;
 });
 const count=source.index?.count??joints.count,kept=[],groups=[];
 const ranges=source.groups.length?source.groups:[{start:0,count,materialIndex:0}];
 for(const group of ranges){
  const start=kept.length;
  for(let i=group.start;i<Math.min(count,group.start+group.count);i+=3){
   const triangle=[0,1,2].map(offset=>source.index?source.index.getX(i+offset):i+offset);
   if(!triangle.some(vertex=>tail[vertex]))kept.push(...triangle);
  }
  groups.push({start,count:kept.length-start,materialIndex:group.materialIndex});
 }
 if(kept.length===count)return null;
 const geometry=source.clone();geometry.setIndex(kept);geometry.clearGroups();
 if(source.groups.length)for(const group of groups)geometry.addGroup(group.start,group.count,group.materialIndex);
 return geometry;
}

// Each character owns its surface finishes and visibility; geometry and textures
// remain shared. A material shared by a face and a shirt must get separate roles.
export function createAvatarAppearance(model,initialAppearance){
 const catalog=characterCategories(initialAppearance),defaults=characterDefaults(initialAppearance);
 const categories=Object.fromEntries(Object.keys(catalog).map(category=>[category,[]])),owned=new Map(),surfaces=[],fuzz=[],tailParts=[],hairParts=[];
 const partName=node=>{for(let current=node;current&&current!==model;current=current.parent)if(/^Drif_(?:Body(?:_|$)|Head_|Ears_|Nose_|Eyes_|Brows_|Mouth_|Legs_|Shirt_|Ghost_)/.test(current.name))return current.name;return node.name;};
 model.traverse(node=>{
  const match=/^Drif_([a-z]+)_([a-z0-9]+)(?:_|$)/i.exec(node.name);
  if(match){const category=match[1].toLowerCase(),id=match[2].toLowerCase();if(category==='hair')hairParts.push({node,id});if(Object.hasOwn(categories,category)&&catalog[category].some(item=>item.id===id))categories[category].push({node,id});}
  if(node.name.startsWith('Drif_Ghost_Fuzz'))fuzz.push(node);
  if(!node.material)return;
  const part=partName(node),skinPart=/^Drif_(?:Body(?:_|$)|Head_|Ears_|Nose_)/.test(part),face=/^Drif_(?:Eyes_|Brows_|Mouth_)/.test(part),fiber=part.startsWith('Drif_Ghost_Fuzz');
  if(node.isSkinnedMesh&&/^Drif_Body(?:_|$)/.test(part))tailParts.push({node,original:node.geometry,hidden:null,prepared:false});
  const isolate=source=>{
   const recolor=/^(?:Drif_Body_Main|Drilady_Fur|Azure blue)(?:[._]|$)/.test(source?.name||'');
   const feet=(part.startsWith('Drif_Legs_')||LEG_OVERRIDE_TOPS.some(id=>part.startsWith('Drif_Shirt_'+id)))&&/^Drif_Original_Warm_ivory/.test(source?.name||'');
   const skin=skinPart||recolor,gilded=skin||face||feet;
   if(!source?.color)return source;
   const role=skin?'skin':feet?'feet':gilded?'gilded':fiber?'fiber':'wardrobe',key=source.uuid+':'+role;
   if(!owned.has(key)){
    const material=source.clone();owned.set(key,material);
    surfaces.push({material,skin,feet,gilded,recolor:recolor||fiber,color:source.color.clone(),map:source.map,metalness:source.metalness,roughness:source.roughness,envMapIntensity:source.envMapIntensity,opacity:source.opacity,transparent:source.transparent,depthWrite:source.depthWrite,emissive:source.emissive?.clone(),intensity:source.emissiveIntensity,vertexColors:source.vertexColors,normalMap:source.normalMap,bumpMap:source.bumpMap,roughnessMap:source.roughnessMap,metalnessMap:source.metalnessMap,alphaMap:source.alphaMap,emissiveMap:source.emissiveMap,alphaTest:source.alphaTest});
    {
     material.userData.drifGhost=false;
     material.userData.drifCamo=false;
     material.userData.drifHolo=false;
     material.userData.drifFinish='';
     material.customProgramCacheKey=()=>material.userData.drifFinish?'drif-collection-'+material.userData.drifFinish+'-v1':material.userData.drifHolo?'drif-holo-v1':material.userData.drifCamo?'drif-camo-v1':material.userData.drifGhost?'drif-ghost-rim-v1':'drif-solid-v1';
     material.onBeforeCompile=shader=>{if(material.userData.drifFinish)applyCollectionFinishShader(shader,material.userData.drifFinish);if(material.userData.drifHolo)applyHoloShader(shader);if(material.userData.drifCamo)applyCamoShader(shader);if(material.userData.drifGhost)shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`float drifRim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 1.35);
diffuseColor.a *= 0.16 + 0.84 * drifRim;
outgoingLight += diffuse * drifRim * 0.7;
#include <opaque_fragment>`);};
    }
    if(fiber){material.depthWrite=false;material.transparent=true;surfaces.at(-1).depthWrite=false;surfaces.at(-1).transparent=true;}
   }
   return owned.get(key);
  };
  node.material=Array.isArray(node.material)?node.material.map(isolate):isolate(node.material);
 });
 const headBone=model.getObjectByName('Head'),headScale=headBone?.scale.clone();
 let current={...defaults},disposed=false,headScaleApplied=false;
 function restoreHeadScale(){if(headBone&&headScaleApplied)headBone.scale.copy(headScale);headScaleApplied=false;}
 function applyHeadScale(){
  if(!headBone||headScaleApplied)return;
  headScale.copy(headBone.scale);headBone.scale.multiplyScalar(HEAD_SCALES[current.head]??1);headScaleApplied=true;
 }
 return {
  get appearance(){return {...current};},
  restoreHeadScale,applyHeadScale,
  setAppearance(value){
   if(disposed)throw Error('This character has been disposed.');
   restoreHeadScale();
   current=normalizeAppearance(value);
   for(const part of tailParts){
    if(current.shirt==='dinosaursuit'&&!part.prepared){part.hidden=bodyWithoutTail(part.node);part.prepared=true;}
    part.node.geometry=current.shirt==='dinosaursuit'&&part.hidden?part.hidden:part.original;
   }
   for(const [category,parts] of Object.entries(categories))for(const {node,id} of parts){
    if(category==='legs'&&topOverridesLegs(current))node.visible=false;
    else if(category==='ears'&&headAllowsEars(current))node.visible=id===current.ears;
    else node.visible=id===(category==='head'&&usesBaseHead(current)?'original':current[category])&&(!['eyes','brows','mouth','nose','ears','tattoo'].includes(category)||usesBaseHead(current));
   }
   for(const {node,id} of hairParts)node.visible=id===characterHair(current);
   for(const node of fuzz)node.visible=current.bodyStyle==='ghost';
   for(const saved of surfaces){
    const {material}=saved,finish=(saved.skin||saved.feet)&&Object.hasOwn(COLLECTION_FINISHES,current.bodyStyle)?COLLECTION_FINISHES[current.bodyStyle]:null,marble=current.bodyStyle==='marble',holo=current.bodyStyle==='holographic'&&saved.gilded,ghost=current.bodyStyle==='ghost'&&saved.gilded,camo=current.bodyStyle==='camo'&&(saved.skin||saved.feet),coated=Object.hasOwn(FINISH_COLORS,current.bodyStyle)&&saved.gilded,metallic=coated&&current.bodyStyle!=='matteblack',matte=coated&&!metallic;
    if(marble||holo)material.color.set('#ffffff');else if(coated)material.color.set(FINISH_COLORS[current.bodyStyle]);else if(ghost)material.color.set(current.bodyColor);else if(saved.recolor&&current.bodyColor!==defaults.bodyColor)material.color.set(current.bodyColor);else material.color.copy(saved.color);
    const map=marble||holo||coated||camo||finish?null:saved.map;
    const vertexColors=marble||finish||holo||coated||ghost?false:saved.vertexColors;
    if(material.vertexColors!==vertexColors){material.vertexColors=vertexColors;material.needsUpdate=true;}
    for(const slot of ['normalMap','bumpMap','roughnessMap','metalnessMap','alphaMap','emissiveMap']){const value=marble||finish?null:saved[slot];if(material[slot]!==value){material[slot]=value;material.needsUpdate=true;}}
    const finishId=finish?current.bodyStyle:'';
    if(material.userData.drifFinish!==finishId){material.userData.drifFinish=finishId;material.needsUpdate=true;}
    material.alphaTest=finish?0:saved.alphaTest;
    if(material.userData.drifHolo!==holo){material.userData.drifHolo=holo;material.needsUpdate=true;}
    if(material.map!==map){material.map=map;material.needsUpdate=true;}
    if(saved.gilded&&material.userData.drifGhost!==ghost){material.userData.drifGhost=ghost;material.needsUpdate=true;}
    if(saved.gilded&&material.userData.drifCamo!==camo){material.userData.drifCamo=camo;material.needsUpdate=true;}
    material.opacity=marble||holo||coated?1:ghost?.52:saved.opacity;material.transparent=marble||holo||coated?false:ghost||saved.transparent;material.depthWrite=marble||holo||coated?true:ghost?false:saved.depthWrite;
    material.metalness=marble?0:holo?.72:metallic?.94:matte||camo?0:saved.metalness;material.roughness=marble?1:holo?.24:metallic?.17:matte||camo?1:ghost?.95:saved.roughness;material.envMapIntensity=marble?.25:holo?1.6:metallic?1.4:matte||camo?.3:saved.envMapIntensity;
    if(material.emissive){if(marble||holo||coated)material.emissive.set(0);else if(ghost)material.emissive.set(current.bodyColor);else material.emissive.copy(saved.emissive);material.emissiveIntensity=marble||holo||coated?0:ghost?.35:saved.intensity;}
    if(finish){
     material.color.set(finish.color);material.roughness=finish.roughness;material.metalness=finish.metalness;material.envMapIntensity=finish.envMapIntensity;
     material.opacity=1;material.transparent=false;material.depthWrite=true;
     if(material.emissive){material.emissive.set(0);material.emissiveIntensity=0;}
    }
   }
   applyHeadScale();model.userData.appearance={...current};return {...current};
  },
  dispose(){if(disposed)return;restoreHeadScale();disposed=true;for(const part of tailParts){part.node.geometry=part.original;part.hidden?.dispose();}for(const material of owned.values())material.dispose();owned.clear();},
 };
}
