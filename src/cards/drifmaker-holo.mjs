// Foil coordinates are sampled in bind space, so the flecks follow the rig.
// View-dependent interference and tiny reflective flakes emulate old TCG foil.
export function applyHoloShader(shader){
 shader.vertexShader='varying vec3 vDrifFoilPosition;\n'+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvDrifFoilPosition = position;');
 shader.fragmentShader=`varying vec3 vDrifFoilPosition;
float drifFoilHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
vec3 drifFoilSpectrum(float hue){return .52+.48*cos(6.2831853*(hue+vec3(0.0,.333333,.666667)));}
`+shader.fragmentShader;
 shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`vec3 foilView=normalize(vViewPosition);
float foilFacing=abs(dot(normalize(normal),foilView));
float foilHue=fract(vDrifFoilPosition.y*.53+vDrifFoilPosition.x*.24+(1.0-foilFacing)*1.45);
vec3 foilColor=drifFoilSpectrum(foilHue);
vec3 foilCell=floor(vDrifFoilPosition*155.0);
float foilSeed=drifFoilHash(foilCell);
vec3 foilFacet=normalize(normal+vec3(sin(foilSeed*41.0),cos(foilSeed*53.0),sin(foilSeed*71.0))*.65);
float foilFlash=pow(max(0.0,dot(foilFacet,foilView)),52.0)*step(.91,foilSeed);
float foilGrain=.91+.09*drifFoilHash(floor(vDrifFoilPosition*430.0));
outgoingLight=mix(outgoingLight,foilColor*(.34+length(outgoingLight)*.48)*foilGrain,.86);
outgoingLight+=vec3(1.0,.97,.91)*foilFlash*1.45;
#include <opaque_fragment>`);
}
