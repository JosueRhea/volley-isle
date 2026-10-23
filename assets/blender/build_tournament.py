"""Editable beach tournament prop kit. Run in Blender; helper coordinates are Y-up."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
scene=bpy.data.scenes.new('Volley Isle — Tournament Kit')
bpy.context.window.scene=scene

def pos(p): return (p[0],-p[2],p[1])
def mat(name,c,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=.35 if metal else .8
 return m
wood=mat('Honey wood',(.52,.28,.12));dark=mat('Dark wood',(.19,.085,.035));cream=mat('Ivory',(.95,.89,.72));blue=mat('Team',(.03,.32,1));red=mat('Coral',(.95,.18,.12));ink=mat('Ink',(.025,.03,.05));gold=mat('Trophy gold',(.95,.56,.06),.75);green=mat('Palm green',(.1,.48,.16));white=mat('White',(.98,.98,.94))
def node(name,p=(0,0,0)):
 o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);o.location=pos(p);o['role']=name;return o
def box(name,p,size,m,parent=None):
 bpy.ops.mesh.primitive_cube_add(size=1);o=bpy.context.object;o.name=name;o.location=pos(p);o.scale=(size[0],size[2],size[1]);o.data.materials.append(m);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 mod=o.modifiers.new('Rounded edges','BEVEL');mod.width=min(.04,min(size)*.2);mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name);o.parent=parent;return o
def ell(name,p,size,m,parent=None):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=10);o=bpy.context.object;o.name=name;o.location=pos(p);o.scale=(size[0],size[2],size[1]);o.data.materials.append(m);o.parent=parent
 for f in o.data.polygons:f.use_smooth=True
 return o
def beam(name,a,b,w,m):
 av,bv=Vector(pos(a)),Vector(pos(b));d=bv-av;o=box(name,(0,0,0),(w,d.length,w),m);o.location=(av+bv)/2;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o
def export(name,objects):
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(ROOT/'client/assets/models'/f'{name}.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_extras=True)
 # Display the kit as a row, without baking this presentation offset into exports.
 offset=len(exports)*7
 for o in objects:
  if o.parent is None:o.location.x+=offset
 exports.append(name)
def begin():return set(scene.objects)
def finish(name,before):
 # Merge stationary pieces to material batches; keep the two referee pivots articulated.
 objects=set(scene.objects)-before
 for parent in {o.parent for o in objects if o.type=='MESH'}:
  meshes=[o for o in objects if o.type=='MESH' and o.parent==parent]
  bpy.ops.object.select_all(action='DESELECT')
  for o in meshes:o.select_set(True)
  bpy.context.view_layer.objects.active=meshes[0]
  bpy.ops.object.join()
  objects=set(scene.objects)-before
 export(name,objects)
exports=[]
b=begin()
for x in (-.75,.75):
 for z in (-.6,.6):
  box('Timber upright',(x,1.1,z),(.14,2.2,.14),dark)
  box('Canopy pole',(x,2.65,z),(.08,1.3,.08),wood)
for i in range(7):box('Platform plank',(-.69+i*.23,1.45,0),(.22,.14,1.45),wood)
for x in (-.77,.77):box('Side safety rail',(x,2.03,0),(.10,.10,1.45),cream)
box('Back rail',(0,2.03,-.65),(1.6,.10,.1),cream)
for x in (-.48,.48):beam('Ladder stringer',(x,.08,1.18),(x,1.5,.65),.10,dark)
for i in range(5):box('Ladder rung',(0,.18+i*.27,1.14-i*.095),(1,.09,.14),wood)
for x in (-.75,.75):beam('Cross brace',(x,.15,-.6),(x,1.35,.6),.09,wood)
for i in range(8):
 o=box('Striped canopy',(-.91+i*.26,3.25,0),(.27,.12,1.95),blue if i%2 else cream)
 o.rotation_euler[1]=.12 if i<4 else -.12
 box('Canopy valance',(-.91+i*.26,3.10,.94),(.26,.24,.07),blue if i%2 else cream)
# Small coconut referee with striped shirt, visor, whistle, movable arm pivots.
ell('Referee body',(0,1.91,0),(.31,.40,.25),white)
for x in (-.2,0,.2):box('Shirt stripe',(x,1.9,.242),(.065,.52,.025),ink)
ell('Coconut head',(0,2.43,0),(.30,.28,.27),wood)
for x in (-.11,.11):
 ell('Eye white',(x,2.48,.244),(.074,.084,.035),white);ell('Eye pupil',(x,2.48,.274),(.035,.046,.018),ink)
 ell('Shoe',(x,1.56,.10),(.12,.08,.18),ink)
ell('Referee smile',(0,2.34,.261),(.065,.024,.018),ink)
box('Sun visor',(0,2.64,.13),(.58,.065,.46),blue)
ell('Whistle',(0,2.18,.30),(.045,.045,.065),gold)
for side,sign in [('L',-1),('R',1)]:
 arm=node('RefArm_'+side,(sign*.30,2.12,0));ell('Sleeve',(sign*.09,-.07,0),(.14,.17,.13),white,arm);ell('Forearm',(sign*.16,-.26,0),(.09,.17,.09),wood,arm);ell('Hand',(sign*.16,-.40,0),(.10,.10,.10),wood,arm)
finish('referee-stand',b)
b=begin()
for x in (-1.8,1.8):
 box('Score post',(x,1.65,0),(.20,3.3,.20),dark);box('Wide foot',(x,.10,0),(.65,.20,1),wood)
box('Score backing',(0,2.23,0),(3.9,1.65,.18),dark)
for y in (1.38,3.08):box('Chunky frame',(0,y,.08),(4.15,.17,.26),wood)
for x in (-2,2):box('Frame side',(x,2.23,.08),(.17,1.85,.26),wood)
box('Title plank',(0,3.37,0),(3.1,.4,.16),cream)
for x in (-1,1):
 for dx in (-.55,.55):ell('Panel hinge',(x+dx,2.68,.20),(.05,.08,.05),gold)
finish('beach-scoreboard',b)
b=begin()
box('Trophy plinth',(0,.12,0),(.85,.24,.75),dark);box('Gold trim',(0,.26,0),(.75,.07,.65),gold);box('Winner plaque',(0,.13,.386),(.45,.10,.025),gold)
ell('Stem',(0,.49,0),(.14,.28,.14),gold);ell('Golden coconut',(0,.95,0),(.43,.45,.39),gold)
for x,y in [(-.12,1.05),(.12,1.05),(0,.86)]:ell('Coconut pore',(x,y,.365),(.055,.06,.025),dark)
for sign in (-1,1):
 for j in range(4):
  leaf=ell('Laurel leaf',(sign*(.36+j*.045),.52+j*.15,0),(.10,.18,.04),gold);leaf.rotation_euler[1]=sign*.6
finish('golden-coconut',b)
b=begin()
box('Cooler body',(0,.30,0),(.85,.55,.55),blue);box('Insulated lid',(0,.60,0),(.90,.12,.60),cream);box('Latch',(0,.43,.29),(.12,.16,.05),white)
for x in (-.46,.46):box('Carry handle',(x,.4,0),(.08,.12,.28),cream)
finish('beach-cooler',b)
b=begin()
for i in range(9):box('Woven towel stripe',(0,.018,-.88+i*.22),(1.1,.035,.215),red if i%2 else cream)
for z in (-1.02,1.02):
 for i in range(12):box('Towel fringe',(-.5+i*.09,.015,z),(.035,.025,.12),cream)
for x in (-.28,.22):
 ell('Sandal sole',(x,.07,.12),(.17,.045,.32),dark)
 for sign in (-1,1):beam('Sandal strap',(x,.16,.22),(x+sign*.13,.11,-.03),.045,blue)
finish('towel-sandals',b)
b=begin()
ell('Surfboard',(0,1.22,0),(.38,1.22,.095),cream)
box('Surfboard stripe',(0,1.20,.093),(.12,1.85,.025),red)
ell('Nose insignia',(0,2.06,.077),(.19,.17,.03),blue)
box('Fin',(0,.33,-.16),(.08,.32,.22),wood)
finish('surfboard',b)
b=begin()
ell('Duffel body',(0,.26,0),(.48,.27,.26),red)
for x in (-.27,.27):
 box('Bag webbing',(x,.29,.253),(.055,.35,.035),cream)
 for z in (-.12,.12):beam('Handle',(x,.44,z),(x,.66,0),.045,dark)
box('Zipper',(0,.524,0),(.65,.025,.035),gold)
finish('beach-bag',b)
previous_save_version=bpy.context.preferences.filepaths.save_version
try:
 bpy.context.preferences.filepaths.save_version=0
 bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/tournament-kit.blend'))
finally:
 bpy.context.preferences.filepaths.save_version=previous_save_version
print('Exported:',exports)
