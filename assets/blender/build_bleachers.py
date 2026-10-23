"""Build the reusable three-tier wooden sideline stand. Units: metres, Y-up in helpers."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
scene=bpy.data.scenes.new('Volley Isle — Wooden Bleachers')
bpy.context.window.scene=scene
for s in list(bpy.data.scenes):
    if s!=scene and s.name.startswith('Volley Isle — Wooden Bleachers'):
        for o in list(s.objects):bpy.data.objects.remove(o,do_unlink=True)
        bpy.data.scenes.remove(s)

def pos(p):return (p[0],-p[2],p[1])
def material(name,c):
    m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
    shader=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value=(*c,1);shader.inputs['Roughness'].default_value=.92
    return m
wood=material('Honey planks',(.48,.25,.095));light=material('Sunlit plank edges',(.65,.38,.16));dark=material('Timber frame',(.22,.105,.043));grain=material('Wood grain',(.32,.15,.052));bolt=material('Iron bolts',(.075,.09,.10));team=material('Team',(.028,.328,1));ivory=material('Ivory',(.95,.88,.66))

def box(name,p,size,mat,bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o=bpy.context.object;o.name=name;o.location=pos(p);o.scale=(size[0],size[2],size[1]);o.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Worn edges','BEVEL');mod.width=bevel;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def beam(name,a,b,width,mat):
    av,bv=Vector(pos(a)),Vector(pos(b));delta=bv-av
    o=box(name,(0,0,0),(width,delta.length,width),mat,.012)
    o.location=(av+bv)*.5;o.rotation_euler=delta.to_track_quat('Z','Y').to_euler()
    return o

for row in range(3):
    z=.95-row*.95;seat=.5+row*.45
    # Tread deck and bench top use separate long planks and small visible seams.
    for j in range(3):
        box('Tread board',(0,seat-.30,z+.18+j*.23),(6,.10,.215),wood if j%2 else light)
    for j in range(2):box('Bench plank',(0,seat-.065,z-.10+j*.22),(6,.13,.205),wood if (j+row)%2 else light)
    for x in (-2.75,-1.35,0,1.35,2.75):
        box('Bench upright',(x,seat*.5-.04,z),( .12,seat-.08,.14),dark)
        box('Deck bearer',(x,seat-.39,z+.3),(.14,.16,1.0),dark)
        for dz in (-.10,.12):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,location=pos((x,seat+.004,z+dz)))
            o=bpy.context.object;o.name='Recessed peg';o.scale=(.027,.027,.009);o.data.materials.append(bolt)
    # Long irregular grain lines kept quiet enough to read at gameplay scale.
    for j in range(3):
        box('Plank grain',(0,seat+.002,z-.14+j*.12),(5.65,.003,.008),grain,0)
# Back and side guards, braced for a recognisable timber construction.
for x in (-3,0,3):box('Rear rail post',(x,1.13,-1.48),(.13,2.26,.13),dark)
for y in (1.70,2.18):box('Rear guard rail',(0,y,-1.48),(6.15,.12,.10),light)
for x in (-2.85,2.85):
    beam('Rear diagonal',(x, .13,-1.43),(-x,1.65,-1.43),.10,dark)
for x in (-3.03,3.03):
    box('Front rail post',(x,.51,1.4),(.13,1.02,.13),dark)
    beam('Sloped handrail',(x,1.03,1.4),(x,2.18,-1.48),.105,light)
    beam('Side brace',(x,.12,1.3),(x,1.25,-1.35),.10,dark)
# Three compact entrance steps at the right end, outside the seats.
for row in range(3):
    z=1.1-row*.78;y=.16+row*.42
    box('Aisle step',(3.43,y*.5,z),(.55,y,.72),wood)
    box('Step nose',(3.43,y+.015,z+.32),(.58,.045,.08),light)
# Team pennants hang from the front fascia.
box('Front fascia',(0,.32,1.33),(5.9,.22,.09),dark)
for i in range(9):
    x=-2.6+i*.65
    verts=[pos((x-.20,.42,1.39)),pos((x+.20,.42,1.39)),pos((x,.08,1.39))]
    data=bpy.data.meshes.new('Pennant');data.from_pydata(verts,[],[(0,1,2)]);data.update()
    o=bpy.data.objects.new('Team pennant',data);scene.collection.objects.link(o);o.data.materials.append(team if i%2 else ivory)
# One mesh with material groups; instanced copies share the GLB geometries in Three.js.
bpy.ops.object.select_all(action='SELECT');bpy.context.view_layer.objects.active=next(o for o in scene.objects if o.type=='MESH');bpy.ops.object.join()
o=bpy.context.object;o.name='WoodenBleachers';scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
out=ROOT/'client/assets/models/wooden-bleachers.glb'
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True)
o.data.calc_loop_triangles();print('Stand triangles:',len(o.data.loop_triangles))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/wooden-bleachers.blend'))
