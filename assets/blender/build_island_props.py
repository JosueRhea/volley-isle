"""Run inside Blender. Rebuild the two game props and their portable GLB files."""
import bpy
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'client/assets/models'
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.new('Volley Isle — Island Props')
bpy.context.window.scene = scene
# Rebuilding replaces only scenes owned by this generator.
for previous in list(bpy.data.scenes):
    if previous != scene and previous.name.startswith('Volley Isle — Island Props'):
        for obj in list(previous.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(previous)
materials = {}

def mat(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    shader = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .85
    materials[name] = m
    return m

bark = mat('Bark honey', (.39, .19, .065))
ring = mat('Bark rings', (.62, .34, .12))
leaf = mat('Frond jade', (.055, .40, .115))
leaflight = mat('Frond lime', (.24, .63, .075))
vein = mat('Leaf midribs', (.49, .69, .14))
nut = mat('Coconut husk', (.22, .095, .035))
ivory = mat('Canvas ivory', (.97, .91, .72))
accent = mat('Canvas accent', (.95, .16, .13))
wood = mat('Umbrella bamboo', (.68, .40, .16))
metal = mat('Brass details', (.95, .62, .16))

def mesh(name, verts, faces, material):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.validate()
    data.update()
    o = bpy.data.objects.new(name, data)
    scene.collection.objects.link(o)
    o.data.materials.append(material)
    return o

def tube(name, points, radii, material, sides=10):
    verts, faces = [], []
    for i, point in enumerate(points):
        tangent = Vector(points[min(i+1,len(points)-1)]) - Vector(points[max(0,i-1)])
        tangent.normalize()
        u = tangent.cross(Vector((0,1,0))).normalized()
        v = tangent.cross(u).normalized()
        for j in range(sides):
            a = j * math.tau / sides
            verts.append(Vector(point) + radii[i] * (math.cos(a)*u + math.sin(a)*v))
        if i:
            for j in range(sides):
                a = (i-1)*sides+j
                b = (i-1)*sides+(j+1)%sides
                faces.append((a,b,b+sides,a+sides))
    faces.extend([tuple(reversed(range(sides))),tuple((len(points)-1)*sides+j for j in range(sides))])
    return mesh(name, verts, faces, material)

def sphere(name, loc, scale, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, location=loc)
    o=bpy.context.object
    o.name=name
    o.scale=scale
    o.data.materials.append(material)
    for p in o.data.polygons: p.use_smooth=True
    return o

def combine_export(name, filename):
    bpy.ops.object.select_all(action='DESELECT')
    objects=[o for o in scene.objects if o.type=='MESH' and not o.get('finished')]
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    o=bpy.context.object
    o.name=name
    scene.cursor.location=(0,0,0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/filename),export_format='GLB',use_selection=True,export_yup=True,use_active_scene=True)
    o['finished']=True
    o.data.calc_loop_triangles()
    print(filename, 'triangles:',len(o.data.loop_triangles))
    return o

# Continuous curved trunk with raised growth rings and a broad, rooted base.
def trunk(t): return Vector((1.05*t*t, .16*math.sin(t*2), 6.3*t))
points=[trunk(i/24) for i in range(25)]
tube('Curved trunk',points,[.34*(1-i/24)+.14*(i/24) for i in range(25)],bark,12)
for i in range(1,18):
    t=i/18
    tube('Growth ring',[trunk(t-.007),trunk(t),trunk(t+.008)],
         [.34-.20*t,.365-.20*t,.34-.20*t],ring,12)
for i in range(5):
    a=i*math.tau/5
    tube('Root flare',[(math.cos(a)*.55,math.sin(a)*.55,.03),(math.cos(a)*.18,math.sin(a)*.18,.28),(0,0,.7)], [.075,.12,.15],bark,6)
crown=trunk(1)
# Each frond is a folded, tapering ribbon with a notched silhouette, not a cone.
for i in range(10):
    a=i*math.tau/10
    length=3.05 + .22*math.sin(i*4)
    direction=Vector((math.cos(a),math.sin(a),0))
    across=Vector((-math.sin(a),math.cos(a),0))
    def center(t): return crown+direction*(length*t)+Vector((0,0,.65*math.sin(t*math.pi)-1.05*t*t+(i%2)*.12))
    verts=[]
    for j in range(25):
        t=j/24
        width=max(.002,.55*math.sin(math.pi*t)**.65*(.80 if j%2 else 1))
        for side in (-1,0,1):
            p=center(t)+across*width*side
            p.z-=abs(side)*width*.30
            verts.append(p)
    faces=[]
    for j in range(24):
        for k in range(2): faces.append((j*3+k,j*3+k+1,(j+1)*3+k+1,(j+1)*3+k))
    o=mesh('Sculpted frond',verts,faces,leaf if i%2 else leaflight)
    tube('Golden midrib',[center(j/12)+Vector((0,0,.012)) for j in range(13)],[.027*(1-j/13) for j in range(13)],vein,5)
for i in range(4):
    a=i*math.tau/4
    sphere('Coconut',crown+Vector((.3*math.cos(a),.3*math.sin(a),-.30)),(.25,.24,.31),nut)
palm=combine_export('CoconutPalm','coconut-palm.glb')

# Twelve curved canvas panels, scalloped edge, underside ribs and bamboo mast.
tube('Bamboo pole',[(0,0,0),(0,0,2.83)],[.055,.043],wood,10)
for h in (.25,1.1,1.85,2.32):
    tube('Pole collar',[(0,0,h-.025),(0,0,h+.025)],[.066,.066],metal,10)
N=12
for i in range(N):
    verts=[]
    for j in range(9):
        r=max(.015,1.5*j/8)
        for k in range(7):
            u=k/6
            a=(i+u)*math.tau/N
            z=2.84-.59*(r/1.5)**1.35-.13*math.sin(math.pi*u)*(r/1.5)**5
            verts.append((r*math.cos(a),r*math.sin(a),z))
    faces=[]
    for j in range(8):
        for k in range(6):
            q=j*7+k
            faces.append((q,q+7,q+8,q+1))
    mesh('Canvas panel',verts,faces,accent if i%2==0 else ivory)
    edge=verts[-7:]
    tube('Scalloped piping',edge,[.018]*len(edge),ivory,5)
    a=i*math.tau/N
    rib=[(1.5*t*math.cos(a),1.5*t*math.sin(a),2.82-.59*t**1.35) for t in [j/8 for j in range(9)]]
    tube('Canopy rib',rib,[.014]*9,wood,5)
    tube('Spreader',[(0,0,2.02),(.9*math.cos(a),.9*math.sin(a),2.50)],[.012,.012],wood,5)
sphere('Finial',(0,0,2.88),(.075,.075,.10),metal)
umbrella=combine_export('ScallopedUmbrella','beach-umbrella.glb')

# A separate scene preserves the user's original scene and gives the assets room for inspection.
palm.location.x=-2.3
umbrella.location.x=2.6
scene.world=bpy.data.worlds.new('Island studio')
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.25,.32,.4,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.7
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.shading.color_type='MATERIAL'
        area.spaces.active.region_3d.view_distance=14
        area.spaces.active.region_3d.view_location=(0,0,3)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/island-props.blend'))
print('Saved Blender source and both GLB exports')
