// Decode a GLB's EXT_meshopt_compression views into plain data (Blender here can't import meshopt):
//   npm i --no-save meshoptimizer@0.21.0 && node tools/unmeshopt.mjs in.glb out.glb
// write a copy of a GLB with every EXT_meshopt_compression view decoded into plain data
import {readFileSync, writeFileSync} from 'node:fs';
import {MeshoptDecoder} from 'meshoptimizer';
await MeshoptDecoder.ready;
const [src, out] = process.argv.slice(2), glb = readFileSync(src);
const jl = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + jl)), bin = glb.subarray(28 + jl, 28 + jl + glb.readUInt32LE(20 + jl));
const chunks = []; let size = 0;
const put = d => { const pad = (4 - size % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); size += pad; } const at = size; chunks.push(Buffer.from(d)); size += d.length; return at; };
for (const v of json.bufferViews) {
  const e = v.extensions?.EXT_meshopt_compression;
  if (e) {
    const target = new Uint8Array(e.count * e.byteStride);
    MeshoptDecoder.decodeGltfBuffer(target, e.count, e.byteStride, bin.subarray(e.byteOffset || 0, (e.byteOffset || 0) + e.byteLength), e.mode, e.filter);
    v.byteOffset = put(target); v.byteLength = target.length; delete v.extensions.EXT_meshopt_compression;
    if (!Object.keys(v.extensions).length) delete v.extensions;
  } else if (v.buffer === 0) v.byteOffset = put(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
  v.buffer = 0;
}
const binOut = Buffer.concat(chunks);
json.buffers = [{byteLength: binOut.length}];
json.extensionsUsed = (json.extensionsUsed || []).filter(e => e !== 'EXT_meshopt_compression');
json.extensionsRequired = (json.extensionsRequired || []).filter(e => e !== 'EXT_meshopt_compression');
if (!json.extensionsRequired.length) delete json.extensionsRequired;
const pad = (b, f) => { const p = (4 - b.length % 4) % 4; return p ? Buffer.concat([b, Buffer.alloc(p, f)]) : b; };
const js = pad(Buffer.from(JSON.stringify(json)), 0x20), bn = pad(binOut, 0);
const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + bn.length, 8);
const ch = (b, t) => { const x = Buffer.alloc(8); x.writeUInt32LE(b.length, 0); x.writeUInt32LE(t, 4); return Buffer.concat([x, b]); };
writeFileSync(out, Buffer.concat([h, ch(js, 0x4e4f534a), ch(bn, 0x004e4942)]));
console.log('wrote', out, (Buffer.concat([h]).length + js.length + bn.length) / 1e3 | 0, 'KB');
