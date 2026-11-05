"""Denoise a baked lightmap with Blender's OpenImageDenoise compositor node.
Runs in its own process (an empty scene renders instantly):
    python3 tools/blender/denoise.py in.exr out.exr
"""
import sys
import bpy

src, dst = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
img = bpy.data.images.load(src)
sc.render.resolution_x, sc.render.resolution_y = img.size
sc.render.resolution_percentage = 100
sc.render.engine = 'CYCLES'
sc.cycles.samples = 1
tree = bpy.data.node_groups.new('denoise', 'CompositorNodeTree')
sc.compositing_node_group = tree
n = tree.nodes
i = n.new('CompositorNodeImage'); i.image = img
d = n.new('CompositorNodeDenoise')
o = n.new('NodeGroupOutput')
tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
tree.links.new(i.outputs[0], d.inputs['Image'])
tree.links.new(d.outputs[0], o.inputs[0])
sc.render.filepath = dst
sc.render.image_settings.file_format = 'OPEN_EXR'
sc.render.image_settings.color_depth = '32'
bpy.ops.render.render(write_still=True)
