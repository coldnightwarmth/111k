import json,struct,sys,collections
def load(p):
    b=open(p,'rb').read();assert b[:4]==b'glTF'
    o=12;chunks=[]
    while o<len(b):
        l,t=struct.unpack_from('<II',b,o);chunks.append((t,b[o+8:o+8+l]));o+=8+l
    return json.loads(chunks[0][1]),(chunks[1][1] if len(chunks)>1 else b'')
g,bin=load(sys.argv[1])
bv=g.get('bufferViews',[])
imgbytes=sum(bv[i['bufferView']]['byteLength'] for i in g.get('images',[]) if 'bufferView' in i)
print('total bin MB',len(bin)/1e6,'images MB',imgbytes/1e6,'n images',len(g.get('images',[])))
print('meshes',len(g.get('meshes',[])),'nodes',len(g.get('nodes',[])),'materials',len(g.get('materials',[])),'skins',len(g.get('skins',[])),'anims',len(g.get('animations',[])))
print('extensionsUsed',g.get('extensionsUsed'))
acc=g['accessors']
# per mesh size
def accbytes(i):
    a=acc[i];v=bv[a['bufferView']] if 'bufferView' in a else None
    n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]*a['count']*{5126:4,5123:2,5125:4,5121:1,5122:2,5120:1}[a['componentType']]
    return n
ms=[]
for mi,m in enumerate(g['meshes']):
    s=0;tg=0
    for p in m['primitives']:
        for k,v in p['attributes'].items(): s+=accbytes(v)
        if 'indices' in p: s+=accbytes(p['indices'])
        for t in p.get('targets',[]):
            for v in t.values(): s+=accbytes(v);tg+=1
    ms.append((s,m.get('name'),tg))
print('geometry MB',sum(x[0] for x in ms)/1e6)
ani=sum(accbytes(s['input'])+accbytes(s['output']) for a in g.get('animations',[]) for s in a['samplers'])
print('animation MB',ani/1e6)
print('anims:',[a.get('name') for a in g.get('animations',[])][:80])
if len(sys.argv)>2:
    for s,n,t in sorted(ms,reverse=True)[:int(sys.argv[2])]: print(f'{s/1e6:8.3f} {n} targets={t}')
    for i,im in enumerate(g.get('images',[])):
        print('img',i,im.get('name'),im.get('mimeType'),bv[im['bufferView']]['byteLength']/1e6 if 'bufferView' in im else im.get('uri'))
