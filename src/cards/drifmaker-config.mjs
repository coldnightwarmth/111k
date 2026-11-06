import {CHARACTER_COLLECTION} from './drifmaker-character-collection.mjs';
import {DRILADY_TRAITS} from './drilady-traits.mjs';
import {DRILADY_BUNNY_STUDY} from './drilady-bunny-study.mjs';
import {MINOTE_CATALOG} from './drifmaker-minote.mjs';
import {NEW_TRAITS} from './drifmaker-expansion.mjs';
// Shared by the browser and the showroom worker: only these small, validated
// appearance values cross the network. Models and materials always stay local.
// Drifella 2 collection inspiration: https://www.tensor.trade/trade/drifella_2
// Its 3DRIFELLABODY traits inform mint plush, plush pink, plush lilac, yellow
// and orange cream plush. Eye cues include sleppy, pixelady star and spiral;
// clothing and accessories are independently modeled adaptations for this rig.
const options=items=>Object.freeze(items.map(item=>Object.freeze(item)));
// Replacement heads without built-in ears retain their own face and accept the
// selected ear pair. Onyx cat and Lilac drake keep their built-in ears/fins.
export const EAR_COMPATIBLE_HEADS=Object.freeze(["cobaltmecha","bonsaipot","discoball","paperbag","moonface","divingbell","embroidereddoll","copperoni","cloudhead","dicehead","pumpkin","tv","crystal","ceramiccarapace","masonryidol","candywhorl","mossrelic","ashimp","opartmask","berrybust","orbitdemon",'mnangelmask','mnbellhead','mnjokermask','mnvoxelhead','mnduckhead','mnsharkhead','mnmitrehead','mncakehead']);
export const HEAD_SCALES=Object.freeze({original:1,bighead:1.2,gianthead:1.4,smallhead:.76});
export const isOriginalHead=id=>Object.hasOwn(HEAD_SCALES,id);
export const LEG_OVERRIDE_TOPS=Object.freeze(['wizardrobe','raincape','monasticrobe','flightcoverall','dinosaursuit','mnchoirrobe','mnrainponcho','mnsainttabard','mnpetaldress']);
const ORIGINAL_CATEGORIES=Object.freeze({
 eyes:options([
  {id:'classic',label:'Classic',description:'Bright glossy eyes.'},
  {id:'sleepy',label:'Sleepy',description:'A half-lidded expression inspired by the collection’s sleppy eyes.'},
  {id:'star',label:'Starry',description:'Sculpted star eyes inspired by pixelady star.'},
  {id:'spiral',label:'Spiral',description:'A hypnotic pair of sculpted spiral eyes.'},
  {id:'hearts',label:'Heart eyes',description:'A pair of hearts for your favorite things.'},
  {id:'buttons',label:'Button eyes',description:'Stitched button eyes for a plush expression.'},
  {id:'wink',label:'Wink',description:'One eye open, one eye winking.'},
  {id:'angry',label:'Angry',description:'A sharp, determined stare.'},
  {id:'bored',label:'Bored',description:'An unimpressed, half-lidded gaze.'},
  {id:'tears',label:'Teary',description:'A pair of eyes with sculpted tears.'},
  {id:'dead',label:'X eyes',description:'Crossed-out cartoon eyes.'},
  {id:'cyclops',label:'Cyclops',description:'One large eye at the center of the face.'},
  {id:'pixel',label:'Pixel eyes',description:'Blocky eyes with a pixel-art silhouette.'},
  {id:'lashes',label:'Lashes',description:'Expressive eyes framed by long lashes.'},
 ]),
 mouth:options([
  {id:'original',label:'Original',description:'The original Drifella mouth.'},
  {id:'smile',label:'Smile',description:'A simple, cheerful smile.'},
  {id:'sidesmile',label:'Side smile',description:'A crooked smile with a little attitude.'},
  {id:'fangs',label:'Fangs',description:'A smile with pointed fangs.'},
  {id:'goldgrill',label:'Gold grill',description:'A bright gold grin.'},
  {id:'braces',label:'Braces',description:'A toothy smile with braces.'},
  {id:'tongue',label:'Tongue out',description:'A playful tongue-out expression.'},
  {id:'cat',label:'Cat smile',description:'A small feline smile.'},
  {id:'drool',label:'Drool',description:'A relaxed mouth with a drop of drool.'},
  {id:'skull',label:'Skull teeth',description:'A row of exposed skeletal teeth.'},
  {id:'grin',label:'Big grin',description:'An oversized toothy grin.'},
 ]),
 shirt:options([
  {id:'original',label:'Original hoodie',description:'The signature illustrated hoodie.'},
  {id:'denim',label:'Denim jacket',description:'A blue denim jacket with pockets and contrasting seams.'},
  {id:'bomber',label:'Cream bomber',description:'An off-white bomber with a zip front and ribbed trim.'},
  {id:'jersey',label:'Jersey',description:'A sporty jersey for the show floor.'},
  {id:'tiedye',label:'Tie dye',description:'A colorful tie-dye top.'},
  {id:'skeleton',label:'Skeleton top',description:'A dark top with a sculpted rib cage.'},
  {id:'cloud',label:'Cloud top',description:'A soft sky-inspired top with clouds.'},
  {id:'cloak',label:'Cloak',description:'A draped cloak for a mysterious look.'},
  {id:'suit',label:'Suit jacket',description:'A tailored jacket for a dressed-up Drifella.'},
  {id:'raincoat',label:'Raincoat',description:'A bright coat for rainy days.'},
  {id:'puffer',label:'Puffer',description:'A padded jacket with quilted sections.'},
  {id:'rugby',label:'Rugby shirt',description:'A collared shirt with bold stripes.'},
  {id:'armor',label:'Armor',description:'A set of sculpted armor plates.'},
 ]),
 legs:options([
  {id:'original',label:'Original legs',description:'The original trousers and shoes.'},
  {id:'denim',label:'Jeans',description:'A pair of denim trousers.'},
  {id:'cargo',label:'Cargo pants',description:'Roomy trousers with cargo pockets.'},
  {id:'shorts',label:'Shorts',description:'A casual pair of shorts.'},
  {id:'striped',label:'Striped pants',description:'Bold stripes from waist to ankle.'},
  {id:'patched',label:'Patched pants',description:'Trousers with contrasting patches.'},
  {id:'tech',label:'Tech pants',description:'Utility trousers with technical details.'},
  {id:'skeleton',label:'Skeleton legs',description:'Dark legs with a sculpted bone motif.'},
  {id:'plush',label:'Plush pants',description:'Soft-looking trousers for a plush silhouette.'},
  {id:'boots',label:'Tall boots',description:'A pair of tall boots.'},
  {id:'joggers',label:'Joggers',description:'Relaxed joggers with cuffed ankles.'},
 ]),
 hat:options([
  {id:'none',label:'No hat',description:'Let those fins breathe.'},
  {id:'cap',label:'Teal cap',description:'A dark teal cap with a sculpted brim.'},
  {id:'beanie',label:'Black beanie',description:'A black beanie with a rolled cuff.'},
  {id:'party',label:'Party hat',description:'A rainbow party cone inspired by the Drifella 2 collection.'},
  {id:'tophat',label:'Top hat',description:'A tall hat with a broad brim.'},
  {id:'wizard',label:'Wizard hat',description:'A pointed hat for a little magic.'},
  {id:'crown',label:'Crown',description:'A crown fit for the show floor.'},
  {id:'antlers',label:'Antlers',description:'A pair of branching antlers.'},
  {id:'bunny',label:'Bunny ears',description:'Two long rabbit ears.'},
  {id:'spinner',label:'Spinner cap',description:'A playful cap with a propeller.'},
  {id:'officer',label:'Officer cap',description:'A structured cap with a peaked brim.'},
  {id:'bucket',label:'Bucket hat',description:'A soft hat with a sloping brim.'},
  {id:'horns',label:'Horns',description:'A pair of curved horns.'},
  {id:'halo',label:'Halo',description:'A floating halo above your Drifella.'},
 ]),
 accessory:options([
  {id:'none',label:'No accessory',description:'Keep the silhouette simple.'},
  {id:'original',label:'Crossbody bag',description:'The original black crossbody bag.'},
  {id:'headphones',label:'Headphones',description:'Dark over-ear headphones with sculpted spikes.'},
  {id:'necklace',label:'Ball necklace',description:'A necklace with red-and-white ball beads.'},
  {id:'backpack',label:'Plush backpack',description:'A soft teal companion to carry on your back.'},
  {id:'scarf',label:'Scarf',description:'A cozy scarf wrapped around the neck.'},
  {id:'medallion',label:'Medallion',description:'A statement pendant on a chain.'},
  {id:'wings',label:'Wings',description:'A pair of wings worn on the back.'},
  {id:'bowtie',label:'Bow tie',description:'A neat bow tie for a formal look.'},
  {id:'satchel',label:'Satchel',description:'A side bag with a shoulder strap.'},
  {id:'camera',label:'Camera',description:'A small camera carried on a strap.'},
  {id:'skateboard',label:'Skateboard',description:'A board carried along for the ride.'},
  {id:'flower',label:'Flower',description:'A flower to finish the outfit.'},
  {id:'cassette',label:'Cassette',description:'A wearable cassette player.'},
  {id:'keychain',label:'Keychain',description:'A dangling charm and key ring.'},
 ]),
});
export const CATEGORIES=Object.freeze(Object.fromEntries([...new Set([...Object.keys(ORIGINAL_CATEGORIES),...Object.keys(NEW_TRAITS)])].map(category=>[category,options([...(ORIGINAL_CATEGORIES[category]||[]),...(NEW_TRAITS[category]||[]),...(MINOTE_CATALOG[category]||[]),...(CHARACTER_COLLECTION.drifella[category]||[])])])));
export const GOLD_COLOR='#e2ad32';
export const FINISH_COLORS=Object.freeze({gold:GOLD_COLOR,silver:'#d7dee8',matteblack:'#08090b'});
export const BODY_STYLE_COLORS=Object.freeze({...FINISH_COLORS,...Object.fromEntries(CHARACTER_COLLECTION.bodyStyle.map(({id,hex})=>[id,hex])),mnwatercolor:'#b2bed4',mnruledpaper:'#eee3cc',mngraphite:'#bcb5ad',mnroseglaze:'#e8b7bc',mninkmarble:'#d0dce4',mngoldleaf:'#b59b4e',mnpastelchalk:'#d8c3b9',mnwetgouache:'#5b859e',mnlinenpaper:'#e8dfcb',camo:'#62734a',marble:'#ffffff',holographic:'#d8d6f4',blackgem:'#151722',lava:'#dd4818',woods:'#926442',mossy:'#73833f',pinklatex:'#e785ad',cowhide:'#decbb0',blueporcelain:'#e0e8ef',verdigris:'#49a68d',pearl:'#e9d6ee',amethyst:'#8d4ac3',carbonfiber:'#252b35',candyglaze:'#ff7d45'});
// Studied original 3drifellabody layers: black gem.PNG, lava.PNG, woods.PNG,
// mossy.PNG, pink leather latex.PNG, cow hide.PNG. See drifmaker-finishes.mjs.
export const BODY_STYLES=options([...CHARACTER_COLLECTION.bodyStyle,...MINOTE_CATALOG.bodyStyle,{"id": "blueporcelain", "label": "Blue porcelain"},{"id": "verdigris", "label": "Verdigris copper"},{"id": "pearl", "label": "Mother of pearl"},{"id": "amethyst", "label": "Amethyst"},{"id": "carbonfiber", "label": "Carbon fiber"},{"id": "candyglaze", "label": "Candy glaze"},{id:'marble',label:'Marble',description:'Matte white across all visible parts.'},{id:'holographic',label:'Holographic',description:'Rainbow interference and sparkling trading-card foil.'},{id:'solid',label:'Solid',description:'The familiar sculpted finish.'},{id:'ghost',label:'Ghost aura',description:'Clear, translucent skin with soft luminous fibers.'},{id:'gold',label:'Gold',description:'Polished gold across the whole body and face.'},{id:'silver',label:'Silver',description:'Polished silver across the whole body and face.'},{id:'matteblack',label:'Matte black',description:'A soft black finish across the whole body and face.'},{id:'camo',label:'Camo',description:'Woodland camouflage across the body and fins.'},
 {id:'blackgem',label:'Black gem',description:'Deep glossy resin inspired by the collection’s black gem body.'},
 {id:'lava',label:'Lava',description:'Glowing molten channels through a rough charcoal crust.'},
 {id:'woods',label:'Woods',description:'Warm carved timber with layered directional grain.'},
 {id:'mossy',label:'Mossy',description:'Dense green moss patches across an earthy, weathered surface.'},
 {id:'pinklatex',label:'Pink latex',description:'A glossy pink coating with a fine pebbled texture.'},
 {id:'cowhide',label:'Cow hide',description:'Cream and brown hide patches with directional fibers.'},
]);
export const BODY_COLORS=options([...CHARACTER_COLLECTION.bodyStyle.map(({id,label,hex})=>({id,label,hex,style:id})),...MINOTE_CATALOG.bodyColor,...MINOTE_CATALOG.bodyStyle.map(({id,label})=>({id,label,hex:BODY_STYLE_COLORS[id],style:id})),{"id": "blueporcelain", "label": "Blue porcelain", "hex": "#e0e8ef", "style": "blueporcelain"},{"id": "verdigris", "label": "Verdigris copper", "hex": "#49a68d", "style": "verdigris"},{"id": "pearl", "label": "Mother of pearl", "hex": "#e9d6ee", "style": "pearl"},{"id": "amethyst", "label": "Amethyst", "hex": "#8d4ac3", "style": "amethyst"},{"id": "carbonfiber", "label": "Carbon fiber", "hex": "#252b35", "style": "carbonfiber"},{"id": "candyglaze", "label": "Candy glaze", "hex": "#ff7d45", "style": "candyglaze"},
 {id:'blackgem',label:'Black gem',hex:BODY_STYLE_COLORS.blackgem,style:'blackgem'},
 {id:'lava',label:'Lava',hex:BODY_STYLE_COLORS.lava,style:'lava'},
 {id:'woods',label:'Woods',hex:BODY_STYLE_COLORS.woods,style:'woods'},
 {id:'mossy',label:'Mossy',hex:BODY_STYLE_COLORS.mossy,style:'mossy'},
 {id:'pinklatex',label:'Pink latex',hex:BODY_STYLE_COLORS.pinklatex,style:'pinklatex'},
 {id:'cowhide',label:'Cow hide',hex:BODY_STYLE_COLORS.cowhide,style:'cowhide'},
 {id:'marble',label:'Marble',hex:BODY_STYLE_COLORS.marble,style:'marble'},
 {id:'holographic',label:'Holographic',hex:BODY_STYLE_COLORS.holographic,style:'holographic'},
 {id:'pool',label:'Pool blue',hex:'#00b9ff'},
 {id:'matcha',label:'Matcha',hex:'#86a64a'},
 {id:'bubblepink',label:'Bubble pink',hex:'#ff96df'},
 {id:'vermillion',label:'Vermillion',hex:'#ff3317'},
 {id:'mango',label:'Mango',hex:'#ffb529'},
 {id:'deepteal',label:'Deep teal',hex:'#00675e'},
 {id:'mulberry',label:'Mulberry',hex:'#842058'},
 {id:'iris',label:'Iris',hex:'#6958db'},
 {id:'clay',label:'Clay',hex:'#bd7054'},
 {id:'seafoam',label:'Seafoam',hex:'#78f3c2'},
 {id:'pearlrose',label:'Pearl rose',hex:'#f2d5dd'},
 {id:'midnightnavy',label:'Midnight navy',hex:'#101e46'},

 {id:'woodlandcamo',label:'Woodland camo',hex:BODY_STYLE_COLORS.camo,style:'camo'},
 {id:'plasma',label:'Plasma purple',hex:'#c109ff'},
 {id:'papaya',label:'Papaya',hex:'#ff582e'},
 {id:'arctic',label:'Arctic blue',hex:'#63fff2'},
 {id:'metallicsilver',label:'Metallic silver',hex:FINISH_COLORS.silver,style:'silver'},
 {id:'matteblack',label:'Matte black',hex:FINISH_COLORS.matteblack,style:'matteblack'},
 {id:'metallicgold',label:'Metallic gold',hex:GOLD_COLOR,style:'gold'},
 {id:'azure',label:'Azure',hex:'#1d5dea'},
 {id:'mint',label:'Mint',hex:'#a4d8bd'},
 {id:'plush-pink',label:'Plush pink',hex:'#e8b4cd'},
 {id:'plush-lilac',label:'Plush lilac',hex:'#c4b0e2'},
 {id:'yellow',label:'Yellow',hex:'#f0d66f'},
 {id:'orange-cream',label:'Orange cream',hex:'#efbc94'},
 {id:'scarlet',label:'Scarlet',hex:'#f52b35'},
 {id:'tangerine',label:'Tangerine',hex:'#ff730f'},
 {id:'acid',label:'Acid green',hex:'#b5f522'},
 {id:'emerald',label:'Emerald',hex:'#13cf79'},
 {id:'cyan',label:'Electric cyan',hex:'#00ccef'},
 {id:'cobalt',label:'Cobalt',hex:'#2345f7'},
 {id:'violet',label:'Vivid violet',hex:'#8734f5'},
 {id:'fuchsia',label:'Fuchsia',hex:'#f02cce'},
 {id:'hotpink',label:'Hot pink',hex:'#ff3d8b'},
 {id:'phantom',label:'Phantom ice',hex:'#c0f7ff'},
 {id:'ultraviolet',label:'Ultraviolet',hex:'#5b00ff'},
 {id:'laserpink',label:'Laser pink',hex:'#ff00b8'},
 {id:'cherry',label:'Cherry',hex:'#d50a48'},
 {id:'bloodorange',label:'Blood orange',hex:'#f03a12'},
 {id:'electricgold',label:'Electric gold',hex:'#ffcc00'},
 {id:'lemon',label:'Lemon',hex:'#edff28'},
 {id:'slime',label:'Slime',hex:'#47ed09'},
 {id:'jade',label:'Jade',hex:'#00a98b'},
 {id:'turquoise',label:'Turquoise',hex:'#00edb4'},
 {id:'lagoon',label:'Lagoon',hex:'#009fae'},
 {id:'cerulean',label:'Cerulean',hex:'#008eff'},
 {id:'indigo',label:'Indigo',hex:'#4020c4'},
 {id:'grape',label:'Grape',hex:'#ab24da'},
 {id:'orchid',label:'Orchid',hex:'#e35bff'},
 {id:'coral',label:'Coral',hex:'#ff7971'},
 {id:'butter',label:'Butter',hex:'#ffe8a3'},
 {id:'pistachio',label:'Pistachio',hex:'#c4e4a5'},
 {id:'periwinkle',label:'Periwinkle',hex:'#8c9bff'},
 {id:'charcoal',label:'Charcoal',hex:'#303344'},
 {id:'porcelain',label:'Porcelain',hex:'#f5f0e7'},
]);
export const PORTRAIT_BACKGROUNDS=options([...CHARACTER_COLLECTION.background.map(({id,label})=>({label,hex:id})),...MINOTE_CATALOG.background.map(({id,label})=>({hex:id,label})),
 {label:'Spiral',hex:'spiral'},
 {label:'Black Ops',hex:'blackops'},
 {label:'Obsidian mist',hex:'#909ba8'},
 {label:'Volcanic dusk',hex:'#311e35'},
 {label:'Linen',hex:'#dbcaaf'},
 {label:'Forest light',hex:'#bbc99a'},
 {label:'Glaze blue',hex:'#72c4d9'},
 {label:'Terracotta',hex:'#ac5d3c'},
 {label:'Pool',hex:'#00a4dd'},
 {label:'Matcha',hex:'#778c4e'},
 {label:'Candy rose',hex:'#f098bd'},
 {label:'Tomato',hex:'#ff4428'},
 {label:'Mango',hex:'#f8bf40'},
 {label:'Deep sea',hex:'#006d75'},
 {label:'Wine',hex:'#732542'},
 {label:'Iris',hex:'#5144a8'},
 {label:'Clay',hex:'#bf8064'},
 {label:'Sea glass',hex:'#75c9b3'},
 {label:'Pearl rose',hex:'#f5e1e5'},
 {label:'Night blue',hex:'#172d58'},

 {label:'Rainbow gradient',hex:'rainbow'},
 {label:'Plasma',hex:'#b20fff'},{label:'Papaya',hex:'#ff6c43'},{label:'Arctic',hex:'#5be8e8'},
 {label:'Silver',hex:'#dedfe5'},{label:'Cream',hex:'#e8dfcf'},{label:'Rose',hex:'#dfc6cf'},{label:'Sage',hex:'#c6d1c4'},{label:'Midnight',hex:'#252a35'},
 {label:'Electric blue',hex:'#087ef5'},{label:'Ultramarine',hex:'#3213d5'},{label:'Cyan',hex:'#16cbe7'},{label:'Turquoise',hex:'#0dc7a0'},
 {label:'Emerald',hex:'#1fc36c'},{label:'Lime',hex:'#7fde1a'},{label:'Acid yellow',hex:'#d6ee16'},{label:'Goldenrod',hex:'#dfa51a'},
 {label:'Tangerine',hex:'#ff7d25'},{label:'Vermilion',hex:'#e74322'},{label:'Crimson',hex:'#cd144d'},{label:'Hot pink',hex:'#e62f99'},
 {label:'Magenta',hex:'#e867df'},{label:'Violet',hex:'#9c43e5'},{label:'Grape',hex:'#7025b5'},{label:'Lavender',hex:'#b6a1ed'},
 {label:'Periwinkle',hex:'#8999e0'},{label:'Powder blue',hex:'#a4d5ed'},{label:'Mint',hex:'#a0eccb'},{label:'Peach',hex:'#f4b08c'},
 {label:'Pale lemon',hex:'#f1e3a0'},{label:'Ink',hex:'#131520'},{label:'Paper',hex:'#f4f0e6'},
]);
export const DEFAULT_APPEARANCE=Object.freeze({bodyColor:'#1d5dea',eyes:'classic',mouth:'original',shirt:'original',legs:'original',hat:'none',accessory:'original',head:'original',extra:'none',nose:'original',ears:'original',tattoo:'none',brows:'original',bodyStyle:'solid'});
// Character-specific catalogs keep future Drilady parts separate from Drifella.
// Legacy looks without a character field continue to mean Drifella.
export const CHARACTERS=Object.freeze([{id:'drifella',label:'Drifella'},{id:'drilady',label:'Drilady'}]);
export const characterId=value=>value?.character==='drilady'?'drilady':'drifella';
export const DRILADY_DEFAULT_APPEARANCE=Object.freeze({...DEFAULT_APPEARANCE,character:'drilady',bodyColor:'#da987c'});
export const DRILADY_CATEGORIES=Object.freeze(Object.fromEntries(Object.entries({
 head:[['original','Drilady']],eyes:[['classic','Violet eyes']],brows:[['original','Arched brows']],
 mouth:[['original','Braced smile']],nose:[['original','Rose nose']],ears:[['original','Lop ears']],
 shirt:[['original','Mensa tank']],legs:[['original','Indigo cargos']],hat:[['none','None']],
 accessory:[['original','Disc charm'],['none','None']],extra:[['none','None']],tattoo:[['none','None']],
}).map(([key,rows])=>[key,[...rows.map(([id,label])=>({id,label})),...DRILADY_TRAITS[key],...CHARACTER_COLLECTION.drilady[key],...(DRILADY_BUNNY_STUDY[key]||[])]])));
export const characterCategories=value=>characterId(value)==='drilady'?DRILADY_CATEGORIES:CATEGORIES;
export const characterDefaults=value=>characterId(value)==='drilady'?DRILADY_DEFAULT_APPEARANCE:DEFAULT_APPEARANCE;
// Hairstyle heads retain the accepted face; sculptural replacement heads own it.
export const usesBaseHead=value=>isOriginalHead(value.head)||characterCategories(value).head.some(option=>option.id===value.head&&option.baseHead);
export const headAllowsEars=value=>usesBaseHead(value)||EAR_COMPATIBLE_HEADS.includes(value.head)||characterId(value)==='drilady';
export const topOverridesLegs=value=>characterCategories(value).shirt.some(option=>option.id===value.shirt&&option.overridesLegs)||(characterId(value)==='drifella'&&LEG_OVERRIDE_TOPS.includes(value.shirt));
export const characterHair=value=>{
 if(!usesBaseHead(value)||characterCategories(value).hat.some(option=>option.id===value.hat&&option.coversHair))return 'none';
 if(characterId(value)==='drilady')return ['ladyfbi','ladymilitary','ladyjester','ladywrap','ladyveil','ladyboater','ladyroseberet','ladybonnet','ladyscarf'].includes(value.hat)?'none':value.head;
 return CHARACTER_COLLECTION.drifella.head.some(option=>option.id===value.head)?value.head:'original';
};

// Keep the storage key: normalization supplies defaults for new categories
// without resetting any existing selections in older saved looks.
export const APPEARANCE_STORAGE_KEY='cards-art:drifmaker:appearance:v1';
export const APPEARANCE_EVENT='drifmaker:appearance';
export function normalizeAppearance(value){
 const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const defaults=characterDefaults(input);
 const result={bodyColor:typeof input.bodyColor==='string'&&/^#[0-9a-f]{6}$/i.test(input.bodyColor)?input.bodyColor.toLowerCase():defaults.bodyColor};
 if(characterId(input)==='drilady')result.character='drilady';
 result.bodyStyle=BODY_STYLES.some(item=>item.id===input.bodyStyle)?input.bodyStyle:'solid';
 if(Object.hasOwn(BODY_STYLE_COLORS,result.bodyStyle))result.bodyColor=BODY_STYLE_COLORS[result.bodyStyle];
 for(const [category,items] of Object.entries(characterCategories(input)))result[category]=items.some(item=>item.id===input[category])?input[category]:defaults[category];
 return result;
}
export function appearanceKey(value){return JSON.stringify(normalizeAppearance(value));}
function browserStorage(){return globalThis.localStorage;}
export function loadAppearance(storage){
 try{return normalizeAppearance(JSON.parse((storage??browserStorage())?.getItem(APPEARANCE_STORAGE_KEY)||'null'));}
 catch{return {...DEFAULT_APPEARANCE};}
}
export function saveAppearance(value,storage){
 const appearance=normalizeAppearance(value),target=storage??browserStorage();
 if(!target?.setItem)throw Error('This browser cannot save your character. Allow local storage and try again.');
 target.setItem(APPEARANCE_STORAGE_KEY,JSON.stringify(appearance));
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT,{detail:{...appearance}}));
 return appearance;
}
export function subscribeAppearance(listener){
 if(typeof window==='undefined')return ()=>{};
 const updated=event=>listener(normalizeAppearance(event.detail));
 const stored=event=>{if(event.key===APPEARANCE_STORAGE_KEY||event.key===null)listener(loadAppearance());};
 window.addEventListener(APPEARANCE_EVENT,updated);window.addEventListener('storage',stored);
 return ()=>{window.removeEventListener(APPEARANCE_EVENT,updated);window.removeEventListener('storage',stored);};
}
