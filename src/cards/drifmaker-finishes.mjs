// Directly studied source layers, rather than inferred materials from names.
// /Users/kyl/Documents/share_kit_3500-4512/drifella assets/drifella2 main/3drifellabody/
// black gem.PNG; lava.PNG; woods.PNG; mossy.PNG; pink leather latex.PNG; cow hide.PNG
// In particular, black gem is smooth glossy resin in the artwork, not facets.
// All coordinates below are unposed mesh coordinates: the finish follows skinning
// without extra textures, world-space swimming, or changes to silhouette/rigging.
const finish=(color,roughness,metalness,envMapIntensity,source)=>Object.freeze({color,roughness,metalness,envMapIntensity,source});
export const COLLECTION_FINISHES=Object.freeze({
 cxpixelstatic:finish('#a9abbe',0.84,0.05,0.7,'Collection material study'),
 cxcheetahvelvet:finish('#c89b58',0.94,0,0.5,'Collection material study'),
 cxtigerplush:finish('#e6a158',0.93,0,0.5,'Collection material study'),
 cxzebrasatin:finish('#e4e3dc',0.42,0.08,0.8,'Collection material study'),
 cxrobotalloy:finish('#a7bac0',0.26,0.85,1.4,'Collection material study'),
 cxzombiepatina:finish('#84a979',0.88,0.15,0.7,'Collection material study'),
 cxdalmatianceramic:finish('#eee6d6',0.24,0.02,1.1,'Collection material study'),
 cxacidwash:finish('#708bc1',0.95,0,0.5,'Collection material study'),
 cxrubberducky:finish('#f7ca3d',0.68,0,0.8,'Collection material study'),
 cxglitchfoil:finish('#d69eff',0.2,0.68,1.5,'Collection material study'),
 cxcrackedleather:finish('#654432',0.87,0,0.55,'Collection material study'),
 cxvelournoise:finish('#88465e',0.97,0,0.6,'Collection material study'),
 mnwatercolor:finish('#b2bed4',0.88,0,0.6,'Mi Note #2'),
 mnruledpaper:finish('#eee3cc',0.96,0,0.4,'Mi Note #1'),
 mngraphite:finish('#bcb5ad',0.89,0.05,0.6,'Mi Note #1'),
 mnroseglaze:finish('#e8b7bc',0.22,0.02,1.2,'Mi Note #49'),
 mninkmarble:finish('#d0dce4',0.48,0.05,0.9,'Mi Note #53'),
 mngoldleaf:finish('#b59b4e',0.37,0.82,1.4,'Mi Note #35'),
 mnpastelchalk:finish('#d8c3b9',0.99,0,0.4,'Mi Note #79'),
 mnwetgouache:finish('#5b859e',0.32,0.03,0.8,'Mi Note #13'),
 mnlinenpaper:finish('#e8dfcb',0.97,0,0.4,'Mi Note #24'),
 blueporcelain:finish('#e0e8ef',0.2,0.03,1.0,'Original stagecraft material'),
 verdigris:finish('#49a68d',0.62,0.65,1.25,'Original stagecraft material'),
 pearl:finish('#e9d6ee',0.19,0.35,1.65,'Original stagecraft material'),
 amethyst:finish('#8d4ac3',0.22,0.26,1.35,'Original stagecraft material'),
 carbonfiber:finish('#252b35',0.28,0.5,1.25,'Original stagecraft material'),
 candyglaze:finish('#ff7d45',0.14,0.05,1.5,'Original stagecraft material'),

 blackgem:finish('#151722',.14,.32,1.7,'black gem.PNG'),
 lava:finish('#dd4818',.72,.08,.8,'lava.PNG'),
 woods:finish('#926442',.83,0,.55,'woods.PNG'),
 mossy:finish('#73833f',.96,0,.4,'mossy.PNG'),
 pinklatex:finish('#e785ad',.19,.02,1.45,'pink leather latex.PNG'),
 cowhide:finish('#decbb0',.88,0,.5,'cow hide.PNG'),
});

const common=`
varying vec3 vDrifFinishPosition;
float drifSurfaceHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float drifSurfaceNoise(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(drifSurfaceHash(i),drifSurfaceHash(i+vec3(1,0,0)),f.x),mix(drifSurfaceHash(i+vec3(0,1,0)),drifSurfaceHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(drifSurfaceHash(i+vec3(0,0,1)),drifSurfaceHash(i+vec3(1,0,1)),f.x),mix(drifSurfaceHash(i+vec3(0,1,1)),drifSurfaceHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float drifSurfaceFbm(vec3 p){return .57*drifSurfaceNoise(p)+.29*drifSurfaceNoise(p*2.07+7.0)+.14*drifSurfaceNoise(p*4.13+17.0);}
// Colors are authored in sRGB, while Three's material lighting is linear.
vec3 drifSurfaceLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
// Analytic surface-gradient bump in view space, valid on every rigged part and
// with no UV requirement. The small height range preserves the modeled shape.
vec3 drifSurfaceNormal(vec3 n,float height,vec3 viewPosition,float faceDirection){
 vec3 dx=dFdx(-viewPosition),dy=dFdy(-viewPosition);
 vec3 r1=cross(dy,n),r2=cross(n,dx);
 float determinant=dot(dx,r1)*faceDirection;
 vec3 gradient=sign(determinant)*(dFdx(height)*r1+dFdy(height)*r2);
 return normalize(max(abs(determinant),1e-8)*n-gradient);
}
`;

// Each shader returns its own color, roughness, microscopic height and emission.
// Broad bands/patches remain readable at portrait size; fine detail is filtered
// through derivatives rather than screen-space noise or decorative line meshes.
const samples={
 cxpixelstatic:`vec3 cell=floor(p*30.0);float n=drifSurfaceHash(cell);vec3 pixel=mix(vec3(.16,.21,.36),vec3(.83,.78,.87),n);pixel=mix(pixel,vec3(.35,.88,.85),step(.88,n));color=drifSurfaceLinear(pixel);roughness=.72+.18*n;height=n*.0008;`,
 cxcheetahvelvet:`vec3 q=p*13.0;float spot=length(fract(q)-.5);float jitter=drifSurfaceHash(floor(q));float ink=1.0-smoothstep(.18+jitter*.08,.23+jitter*.08,spot);vec3 tan=mix(vec3(.60,.36,.12),vec3(.90,.69,.32),drifSurfaceFbm(p*4.0));color=drifSurfaceLinear(mix(tan,vec3(.07,.035,.018),ink));roughness=.94;height=drifSurfaceNoise(p*vec3(240.0,25.0,240.0))*.0012;`,
 cxtigerplush:`float bend=p.x*20.0+p.y*8.0+drifSurfaceFbm(p*5.0)*11.0;float stripe=smoothstep(.55,.76,sin(bend));color=drifSurfaceLinear(mix(vec3(.89,.47,.16),vec3(.065,.035,.025),stripe));roughness=.92;height=drifSurfaceNoise(p*180.0)*.0011;`,
 cxzebrasatin:`float wave=p.x*25.0+sin(p.y*11.0)*2.5+drifSurfaceFbm(p*4.0)*7.0;float stripe=smoothstep(-.12,.13,sin(wave));color=drifSurfaceLinear(mix(vec3(.90,.89,.82),vec3(.02,.026,.038),stripe));roughness=.33+.12*drifSurfaceNoise(p*130.0);height=sin(p.y*280.0)*.00025;`,
 cxrobotalloy:`vec3 q=p*9.0;vec3 edge=min(fract(q),1.0-fract(q));float seam=1.0-smoothstep(.015,.04,min(edge.x,edge.y));float plate=drifSurfaceHash(floor(q));vec3 steel=mix(vec3(.30,.40,.47),vec3(.75,.82,.84),plate);color=drifSurfaceLinear(mix(steel,vec3(.045,.065,.08),seam));roughness=.18+.26*drifSurfaceNoise(p*vec3(25.0,350.0,25.0));height=-seam*.0018;`,
 cxzombiepatina:`float stain=drifSurfaceFbm(p*9.0);float pore=drifSurfaceNoise(p*125.0);color=drifSurfaceLinear(mix(vec3(.28,.37,.23),vec3(.67,.77,.46),stain));color=mix(color,drifSurfaceLinear(vec3(.22,.17,.30)),smoothstep(.64,.78,drifSurfaceFbm(p*6.0+9.0))*.8);roughness=.82+.16*pore;height=pore*.0013;`,
 cxdalmatianceramic:`vec3 q=p*11.0;float seed=drifSurfaceHash(floor(q));float spot=length(fract(q)-.5);float ink=(1.0-smoothstep(.23,.29,spot))*step(.38,seed);color=drifSurfaceLinear(mix(vec3(.96,.92,.83),vec3(.035,.04,.05),ink));roughness=.17+.10*drifSurfaceNoise(p*90.0);height=ink*.0005;`,
 cxacidwash:`float wash=drifSurfaceFbm(p*15.0);float twill=.5+.5*sin((p.x+p.y)*400.0);color=drifSurfaceLinear(mix(vec3(.13,.22,.43),vec3(.74,.81,.91),smoothstep(.28,.73,wash)));roughness=.94;height=twill*.0006+drifSurfaceNoise(p*240.0)*.0005;`,
 cxrubberducky:`float orange=drifSurfaceFbm(p*4.0);color=drifSurfaceLinear(mix(vec3(1.0,.73,.06),vec3(.95,.49,.025),orange*.35));float micro=drifSurfaceNoise(p*190.0);roughness=.59+.20*micro;height=micro*.0005;`,
 cxglitchfoil:`vec3 cell=floor(p*vec3(14.0,45.0,14.0));float n=drifSurfaceHash(cell);vec3 foil=.55+.40*cos(vec3(0.0,2.1,4.2)+n*6.28+p.y*3.0);float spark=step(.97,drifSurfaceHash(floor(p*180.0)));color=drifSurfaceLinear(mix(foil,vec3(1.0),spark));roughness=.15+.17*n;height=n*.0003;glow=color*spark*.28;`,
 cxcrackedleather:`float n=drifSurfaceFbm(p*45.0);float crack=1.0-smoothstep(.012,.055,abs(n-.49));float grain=drifSurfaceNoise(p*150.0);color=drifSurfaceLinear(mix(mix(vec3(.22,.10,.052),vec3(.43,.24,.13),grain),vec3(.065,.026,.018),crack));roughness=.73+.22*grain;height=grain*.0012-crack*.002;`,
 cxvelournoise:`float pile=drifSurfaceNoise(p*vec3(190.0,28.0,190.0));float nap=drifSurfaceFbm(p*vec3(8.0,2.0,8.0));color=drifSurfaceLinear(mix(vec3(.23,.07,.16),vec3(.62,.26,.40),nap))*(.84+.16*pile);roughness=.96;height=pile*.0012;`,
 mnwatercolor:`float wash=drifSurfaceFbm(p*5.0);float edge=abs(wash-.5);vec3 pigment=mix(vec3(.27,.39,.60),vec3(.82,.67,.74),drifSurfaceNoise(p*2.0));color=drifSurfaceLinear(mix(vec3(.94,.91,.83),pigment,(1.0-smoothstep(.0,.09,edge))*.72+wash*.25));roughness=.86;height=drifSurfaceNoise(p*130.0)*.0012;`,
 mnruledpaper:`float ruled=1.0-smoothstep(.018,.05,abs(fract(p.y*15.0)-.5));float margin=1.0-smoothstep(.005,.014,abs(p.x+.31));vec3 paper=mix(vec3(.94,.90,.80),vec3(.81,.79,.73),drifSurfaceNoise(p*150.0)*.25);paper=mix(paper,vec3(.48,.62,.69),ruled*.4);paper=mix(paper,vec3(.80,.34,.38),margin*.55);color=drifSurfaceLinear(paper);roughness=.96;height=drifSurfaceNoise(p*160.0)*.0008;`,
 mngraphite:`float strokes=.5+.5*sin((p.x+p.y*.33)*210.0+drifSurfaceFbm(p*18.0)*12.0);float shade=drifSurfaceFbm(p*5.0);color=drifSurfaceLinear(mix(vec3(.90,.86,.80),vec3(.23,.24,.27),shade*.7+strokes*.15));roughness=.90;height=strokes*.0004;`,
 mnroseglaze:`vec3 q=p*18.0+drifSurfaceFbm(p*6.0);float crack=pow(abs(sin(q.x+sin(q.y))*sin(q.y+sin(q.z))),.12);color=drifSurfaceLinear(mix(vec3(.36,.15,.21),vec3(.91,.65,.70),smoothstep(.45,.72,crack)));roughness=.18+drifSurfaceNoise(p*65.0)*.09;height=(1.0-crack)*-.001;`,
 mninkmarble:`float flow=p.y*12.0+drifSurfaceFbm(p*3.0)*13.0;float ink=pow(.5+.5*sin(flow),5.0);color=drifSurfaceLinear(mix(vec3(.85,.89,.91),vec3(.075,.16,.32),ink));roughness=.40+ink*.15;height=ink*.0004;`,
 mngoldleaf:`float leafField=drifSurfaceFbm(p*18.0);float wear=smoothstep(.54,.65,leafField);color=drifSurfaceLinear(mix(mix(vec3(.46,.28,.045),vec3(.91,.72,.27),drifSurfaceNoise(p*40.0)),vec3(.21,.25,.21),wear));roughness=.23+.4*wear;height=drifSurfaceNoise(p*90.0)*.0012;`,
 mnpastelchalk:`float wash=drifSurfaceFbm(p*4.0);vec3 chalk=mix(vec3(.89,.69,.74),vec3(.61,.75,.80),wash);chalk=mix(chalk,vec3(.96,.88,.67),smoothstep(.48,.66,drifSurfaceFbm(p*5.0+13.0)));color=drifSurfaceLinear(chalk);roughness=.99;height=drifSurfaceNoise(p*190.0)*.0015;`,
 mnwetgouache:`float stroke=drifSurfaceFbm(p*vec3(16.0,3.0,12.0));vec3 pigment=mix(vec3(.10,.27,.37),vec3(.35,.65,.65),stroke);color=drifSurfaceLinear(pigment);roughness=.22+stroke*.35;height=stroke*.003;`,
 mnlinenpaper:`vec3 q=p*145.0;float weave=sin(q.x)*sin(q.y);float fiber=drifSurfaceNoise(p*240.0);color=drifSurfaceLinear(mix(vec3(.81,.76,.64),vec3(.96,.93,.84),.45+weave*.12+fiber*.2));roughness=.97;height=weave*.001+fiber*.0004;`,
 blueporcelain:`float swirls=sin(p.y*21.0+sin(p.x*13.0)*2.0+sin(p.z*12.0));
 float flower=sin(atan(p.z,p.x)*8.0+length(p.xz)*19.0);
 float ink=smoothstep(.65,.90,swirls*flower);
 color=drifSurfaceLinear(mix(vec3(.92,.95,.98),vec3(.025,.12,.42),ink));
 roughness=.16+.07*drifSurfaceNoise(p*80.0);height=ink*.0004;`,
 verdigris:`float field=drifSurfaceFbm(p*6.2);float patina=smoothstep(.37,.58,field);
 color=drifSurfaceLinear(mix(vec3(.66,.30,.12),mix(vec3(.025,.22,.17),vec3(.23,.65,.48),drifSurfaceNoise(p*30.0)),patina));
 roughness=mix(.25,.88,patina);height=patina*drifSurfaceNoise(p*70.0)*.003;`,
 pearl:`float bands=sin(p.y*22.0+drifSurfaceFbm(p*8.0)*9.0);
 vec3 nacre=.80+.14*cos(vec3(0.0,2.0,4.0)+bands*1.9+p.x*4.0);
 color=drifSurfaceLinear(nacre);roughness=.13+.08*drifSurfaceNoise(p*30.0);height=bands*.0008;`,
 amethyst:`vec3 q=p*10.0,base=floor(q),local=fract(q);float nearest=10.0,second=10.0,crystal=0.0;
 for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){
  vec3 cell=vec3(float(x),float(y),float(z));vec3 id=base+cell;
  vec3 seed=vec3(drifSurfaceHash(id),drifSurfaceHash(id+13.7),drifSurfaceHash(id+37.1));
  float distanceToSeed=length(cell+seed-local);
  if(distanceToSeed<nearest){second=nearest;nearest=distanceToSeed;crystal=drifSurfaceHash(id+71.0);}else{second=min(second,distanceToSeed);}
 }
 float quartz=1.0-smoothstep(.015,.07,second-nearest);
 color=drifSurfaceLinear(mix(vec3(.22,.045,.39),vec3(.70,.41,.86),crystal));
 color=mix(color,drifSurfaceLinear(vec3(.78,.60,.87)),quartz*.45);roughness=.15+crystal*.14;height=nearest*.002;`,
 carbonfiber:`vec2 uv=p.xy*46.0;vec2 cell=floor(uv);vec2 f=fract(uv);
 float orientation=mod(cell.x+cell.y,2.0);float strand=mix(f.x,f.y,orientation);
 float yarn=pow(sin(strand*3.14159265),.5);float rib=.5+.5*sin(strand*50.0);
 color=drifSurfaceLinear(mix(vec3(.025,.035,.05),vec3(.16,.18,.21),yarn*(.70+.30*orientation)));
 roughness=.23+.13*(1.0-yarn);height=yarn*.0016+rib*.00012;`,
 candyglaze:`float swirl=.5+.5*sin(p.y*16.0+p.x*9.0+drifSurfaceFbm(p*4.0)*8.0);
 color=drifSurfaceLinear(mix(vec3(.95,.12,.04),vec3(1.0,.72,.25),smoothstep(.20,.80,swirl)));
 float sugar=drifSurfaceNoise(p*170.0);roughness=.095+.09*sugar;height=(sugar-.5)*.0003;`,

 blackgem:`
 float cloud=drifSurfaceFbm(p*3.4);
 float polish=drifSurfaceNoise(p*105.0);
 color=drifSurfaceLinear(mix(vec3(.018,.024,.039),vec3(.10,.115,.16),cloud*.75));
 roughness=mix(.105,.19,polish);height=(polish-.5)*.00018;
 `,
 lava:`
 vec3 flow=p*vec3(5.2,2.8,5.2);
 flow+=vec3(drifSurfaceNoise(flow*.7),drifSurfaceNoise(flow*.7+8.0),drifSurfaceNoise(flow*.7+16.0))*1.7;
 float field=drifSurfaceFbm(flow);
 float channel=abs(field-.50);
 float edge=max(fwidth(channel),.008);
 float heat=1.0-smoothstep(.045-edge,.080+edge,channel);
 float core=1.0-smoothstep(.006,.035,channel);
 float crust=drifSurfaceFbm(p*38.0);
 vec3 rock=mix(vec3(.035,.027,.029),vec3(.13,.09,.075),crust);
 vec3 molten=mix(vec3(1.0,.17,.015),vec3(1.0,.83,.24),core);
 color=drifSurfaceLinear(mix(rock,molten,heat));
 roughness=mix(.87,.27,heat);height=crust*.004-heat*.006;
 glow=drifSurfaceLinear(molten)*heat*.85;
 `,
 woods:`
 float warp=drifSurfaceFbm(p*vec3(3.0,1.1,3.0));
 float rings=length(p.xz*vec2(1.0,1.3)+vec2(.27,-.19))*30.0+warp*5.0+p.y*.38;
 float wave=.5+.5*sin(rings*6.2831853);
 float grain=smoothstep(.50,.83,wave);
 float pores=drifSurfaceNoise(p*vec3(140.0,9.0,140.0));
 color=drifSurfaceLinear(mix(vec3(.22,.115,.057),vec3(.64,.43,.24),.17+.72*grain));
 color*=.80+.20*pores;
 roughness=.73+.20*(1.0-grain);height=grain*.0028+pores*.0006;
 `,
 mossy:`
 float cover=drifSurfaceFbm(p*5.5+vec3(0,5,0));
 float moss=smoothstep(.40,.60,cover);
 float tufts=drifSurfaceFbm(p*67.0);
 float stone=drifSurfaceNoise(p*19.0);
 vec3 base=mix(vec3(.42,.36,.25),vec3(.71,.65,.48),stone);
 vec3 green=mix(vec3(.12,.20,.035),vec3(.48,.58,.12),tufts);
 color=drifSurfaceLinear(mix(base,green,moss));
 roughness=mix(.84,1.0,moss);height=(tufts*.004+.003)*moss+stone*.0007;
 `,
 pinklatex:`
 float broad=drifSurfaceNoise(p*2.5);
 float pebble=drifSurfaceNoise(p*135.0);
 color=drifSurfaceLinear(mix(vec3(.78,.28,.47),vec3(.98,.62,.74),broad*.8+.2));
 roughness=.12+.09*pebble;height=(pebble-.5)*.0003;
 `,
 cowhide:`
 float patches=drifSurfaceFbm(p*7.0+vec3(2,0,5));
 float border=max(fwidth(patches)*1.4,.009);
 float brown=smoothstep(.51-border,.51+border,patches);
 float shade=drifSurfaceNoise(p*16.0);
 vec3 cream=vec3(.94,.88,.74),tan=mix(vec3(.23,.10,.038),vec3(.60,.34,.15),shade);
 float fibers=drifSurfaceNoise(p*vec3(230.0,13.0,230.0));
 color=drifSurfaceLinear(mix(cream,tan,brown))*(.90+.10*fibers);
 roughness=.83+.14*fibers;height=(fibers-.5)*.00065;
 `,
};

export function applyCollectionFinishShader(shader,id){
 if(!Object.hasOwn(COLLECTION_FINISHES,id))return false;
 const anchors=['color_fragment','roughnessmap_fragment','normal_fragment_maps','emissivemap_fragment'];
 if(!shader.vertexShader.includes('#include <begin_vertex>')||anchors.some(anchor=>!shader.fragmentShader.includes(`#include <${anchor}>`)))throw Error('Unsupported Three shader chunks for Drifmaker finish.');
 shader.vertexShader='varying vec3 vDrifFinishPosition;\n'+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvDrifFinishPosition = position;');
 // Pass viewPosition and faceDirection explicitly: the former's declaration
 // follows this injected helper, and the latter is local to Three's main().
 shader.fragmentShader=common+`
void drifFinishSample(vec3 p,out vec3 color,out float roughness,out float height,out vec3 glow){
 glow=vec3(0.0);${samples[id]}
}
`+shader.fragmentShader;
 shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
vec3 drifSurfaceColor,drifSurfaceGlow;
float drifSurfaceRoughness,drifSurfaceHeight;
drifFinishSample(vDrifFinishPosition,drifSurfaceColor,drifSurfaceRoughness,drifSurfaceHeight,drifSurfaceGlow);
diffuseColor.rgb=drifSurfaceColor;`);
 shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=drifSurfaceRoughness;');
 shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=drifSurfaceNormal(normal,drifSurfaceHeight,vViewPosition,faceDirection);');
 shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=drifSurfaceGlow;');
 return true;
}
