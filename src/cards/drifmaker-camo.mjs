// Sample the unposed mesh coordinates so woodland patches stay attached during
// every animation and continue across the body, fins and muzzle without UV seams.
export function applyCamoShader(shader){
 shader.vertexShader='varying vec3 vDrifCamoPosition;\n'+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvDrifCamoPosition = position;');
 shader.fragmentShader=`varying vec3 vDrifCamoPosition;
float drifHash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
float drifNoise(vec3 p) {
 vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(mix(drifHash(i),drifHash(i+vec3(1,0,0)),f.x),mix(drifHash(i+vec3(0,1,0)),drifHash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(drifHash(i+vec3(0,0,1)),drifHash(i+vec3(1,0,1)),f.x),mix(drifHash(i+vec3(0,1,1)),drifHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
`+shader.fragmentShader;
 shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
vec3 camoP = vDrifCamoPosition * 8.5;
float camoN = drifNoise(camoP + 1.6 * vec3(drifNoise(camoP*.7),drifNoise(camoP*.7+8.0),drifNoise(camoP*.7+16.0)));
camoN = camoN*.78 + drifNoise(camoP*2.7)*.22;
vec3 camoColor = vec3(.105,.155,.057);
camoColor = mix(camoColor,vec3(.36,.32,.17),step(.55,camoN));
camoColor = mix(camoColor,vec3(.12,.077,.031),step(.66,camoN));
camoColor = mix(camoColor,vec3(.018,.027,.012),1.0-step(.39,camoN));
diffuseColor.rgb = camoColor;`);
}
