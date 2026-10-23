"""Blender source generator: six jointed mascots, volleyball, padded post, juice hut.
Coordinates below use the game's Y-up, +Z-forward convention. Export to glTF Y-up.
Each rig pivot has a stable `role` extra; animation is solved by the game at runtime.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'client/assets/models'
(OUT/'characters').mkdir(parents=True,exist_ok=True)
scene=bpy.data.scenes.new('Volley Isle — Gameplay Cast')
bpy.context.window.scene=scene
for old in list(bpy.data.scenes):
    if old != scene and old.name.startswith('Volley Isle — Gameplay Cast'):
        for obj in list(old.objects): bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.scenes.remove(old)

def xyz(p): return (p[0],-p[2],p[1])
def color(hex):
    rgb=[int(hex[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb)
def mat(name,hex):
    m=bpy.data.materials.new(name); c=color(hex)
    m.diffuse_color=(*c,1); m.use_nodes=True
    n=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    n.inputs['Base Color'].default_value=(*c,1); n.inputs['Roughness'].default_value=.8
    return m
M={k:mat(k,v) for k,v in {'Ink':'24263d','Ivory':'fff3cf','White':'ffffff','Team':'2f9bff','Sole':'f8f2e4','Mouth':'651c39','Tongue':'ff7798','Blush':'ff8f9c','Leaf':'48b959','LeafLight':'a2d85b','Gold':'ffd65a','Bark':'8b5632','Bamboo':'d29b58','Lava':'ff7a22','LavaLight':'ffce56'}.items()}

def node(role, parent=None, pos=(0,0,0)):
    o=bpy.data.objects.new(role,None); scene.collection.objects.link(o)
    o['role']=role; o.parent=parent; o.location=xyz(pos); return o

def mesh(name,verts,faces,material,parent,smooth=True):
    data=bpy.data.meshes.new(name); data.from_pydata([xyz(v) for v in verts],[],faces); data.validate(); data.update()
    o=bpy.data.objects.new(name,data); scene.collection.objects.link(o); o.parent=parent; data.materials.append(material)
    for p in data.polygons: p.use_smooth=smooth
    return o

def ell(name,pos,scale,material,parent,seg=16,rings=10):
    # Mesh coordinates carry the shape; pivot transforms stay clean for animation.
    verts=[]; faces=[]
    for j in range(rings+1):
        t=math.pi*j/rings
        for i in range(seg):
            a=math.tau*i/seg
            verts.append((pos[0]+scale[0]*math.sin(t)*math.cos(a),pos[1]+scale[1]*math.cos(t),pos[2]+scale[2]*math.sin(t)*math.sin(a)))
    for j in range(rings):
        for i in range(seg):
            q=j*seg+i; nxt=j*seg+(i+1)%seg
            faces.append((q,nxt,nxt+seg,q+seg))
    return mesh(name,verts,faces,material,parent)

def loft(name,profiles,material,parent,seg=24):
    verts=[]; faces=[]
    for y,rx,rz,zc in profiles:
        for i in range(seg):
            a=math.tau*i/seg
            verts.append((rx*math.cos(a),y,zc+rz*math.sin(a)))
    for j in range(len(profiles)-1):
        for i in range(seg):
            q=j*seg+i; n=j*seg+(i+1)%seg
            faces.append((q,q+seg,n+seg,n))
    faces.extend([tuple(range(seg)),tuple((len(profiles)-1)*seg+i for i in reversed(range(seg)))])
    return mesh(name,verts,faces,material,parent)

def tube(name,points,radii,material,parent,sides=8):
    verts=[]; faces=[]
    for i,p in enumerate(points):
        t=(Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])).normalized()
        axis=Vector((0,0,1)) if abs(t.z)<.9 else Vector((1,0,0))
        u=t.cross(axis).normalized(); v=t.cross(u).normalized()
        for j in range(sides):
            a=j*math.tau/sides
            verts.append(Vector(p)+radii[i]*(math.cos(a)*u+math.sin(a)*v))
        if i:
            for j in range(sides):
                q=(i-1)*sides+j; n=(i-1)*sides+(j+1)%sides
                faces.append((q,n,n+sides,q+sides))
    faces.extend([tuple(reversed(range(sides))),tuple((len(points)-1)*sides+j for j in range(sides))])
    return mesh(name,verts,faces,material,parent)

def box(name,pos,size,material,parent,bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o=bpy.context.object; o.name=name; o.parent=parent; o.location=xyz(pos); o.scale=(size[0],size[2],size[1]); o.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Soft corners','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def ribbon(name,points,widths,material,parent):
    verts=[]
    for p,w in zip(points,widths):
        verts.extend([(p[0]-w,p[1]-.015,p[2]),(p[0],p[1]+.02,p[2]),(p[0]+w,p[1]-.015,p[2])])
    faces=[]
    for i in range(len(points)-1):
        for k in range(2):
            q=i*3+k; faces.append((q,q+3,q+4,q+1))
    return mesh(name,verts,faces,material,parent)

def smile(parent,pos,r):
    mouth=node('Mouth',parent,pos)
    verts=[(0,-r*.18,.01),(-r,0,0),(r,0,0)]
    verts += [(r*math.cos(j*math.pi/12),-r*.75*math.sin(j*math.pi/12),0) for j in range(1,12)]
    faces=[(0,i, i+1 if i<len(verts)-1 else 1) for i in range(1,len(verts))]
    mesh('Smile',verts,faces,M['Mouth'],mouth)
    ell('Tongue',(0,-r*.43,.021),(r*.55,r*.21,.012),M['Tongue'],mouth)
    return mouth

def descendants(root): return [root]+list(root.children_recursive)
def export(root,path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in descendants(root): o.select_set(True)
    bpy.context.view_layer.objects.active=root
    # Merge static geometry per pivot, retaining independent animation nodes.
    for parent in [o for o in descendants(root) if o.type=='EMPTY']:
        children=[o for o in parent.children if o.type=='MESH']
        if len(children)>1:
            bpy.ops.object.select_all(action='DESELECT')
            for o in children:o.select_set(True)
            bpy.context.view_layer.objects.active=children[0]; bpy.ops.object.join()
    bpy.ops.object.select_all(action='DESELECT')
    for o in descendants(root):o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_extras=True)
    tris=0
    for o in descendants(root):
        if o.type=='MESH': o.data.calc_loop_triangles(); tris+=len(o.data.loop_triangles)
    print(path.name, tris, 'triangles')

names=['Bongo','Pinchy','Pip','Tiki','Mochi','Rocco']
colors=['74ce46','f26643','30384f','925735','ffaccb','767389']
shoulders=[(.41,.8),(.52,.75),(.38,.95),(.22,.7),(.38,.75),(.38,.72)]
hips=[(.17,.3),(.2,.38),(.15,.3),(.11,.34),(.16,.3),(.17,.3)]
eyes=[(.18,1.3,.19,.13),(.15,1.4,.13,.11),(.14,1.13,.37,.1),(.11,1.08,.36,.1),(.17,1.02,.33,.065),(.12,.9,.29,.11)]
cast=[]
for index,name in enumerate(names):
    root=node(name); root['species']=index
    skin=mat(name+' Skin',colors[index]); light=mat(name+' Highlight',['c4e98b','ffab70','fff6df','eed8ac','ffe1ec','aaa5ba'][index])
    limb=mat(name+' Limb','dba46f') if index==3 else skin
    body=node('Torso',root)
    if index==0:
        loft('Pear-shaped frog',[(.27,.14,.12,0),(.35,.28,.24,0),(.55,.40,.34,0),(.83,.43,.35,0),(1.03,.35,.29,0),(1.16,.29,.22,0),(1.23,.1,.10,0)],skin,body)
        ell('Belly',(0,.65,.285),(.29,.31,.09),M['Ivory'],body)
        for s in (-1,1):
            ell('Eye hood',(s*.18,1.22,.10),(.185,.175,.175),skin,body)
            ell('Cheek',(s*.28,1.015,.27),(.065,.035,.025),M['Blush'],body)
            for j in range(3):ell('Freckle',(s*(.30+j*.023),.87-j*.09,.235-j*.028),(.026,.034,.022),light,body,12,6)
        smile(body,(0,1.035,.327),.145)
    elif index==1:
        loft('Broad carapace',[(.39,.20,.18,0),(.47,.44,.33,0),(.66,.56,.41,0),(.83,.53,.40,0),(1.0,.38,.29,0),(1.08,.12,.1,0)],skin,body)
        ell('Shell underside',(0,.57,.33),(.35,.12,.10),light,body)
        for s in (-1,1):
            tube('Eyestalk',[(s*.17,1.0,.11),(s*.17,1.2,.12),(s*.15,1.37,.13)],[.055,.043,.045],skin,body)
            for j in range(3):
                fin=node('Secondary_ShellLeg_'+str(s)+'_'+str(j),root,(s*.44,.60,-.22+j*.16))
                tube('Swimmer leg',[(0,0,0),(s*.18,-.04,-.04),(s*.24,-.16,-.03)],[.052,.038,.012],skin,fin)
            for j in range(3):ell('Shell spot',(s*(.12+j*.1),.99-j*.025,.03),(.048,.018,.065),light,body,12,6)
        smile(body,(0,.80,.413),.12)
    elif index==2:
        loft('Puffin pear',[(.26,.12,.11,0),(.35,.29,.28,0),(.60,.40,.36,0),(.90,.37,.33,0),(1.15,.30,.26,0),(1.30,.22,.19,0),(1.36,.05,.05,0)],skin,body)
        ell('Belly bib',(0,.64,.28),(.28,.29,.095),M['Ivory'],body)
        for s in (-1,1):ell('Face mask',(s*.13,1.10,.27),(.17,.19,.11),M['Ivory'],body)
        # Puffin's broad orange triangular bill, with a pale ridge.
        mesh('Sculpted bill',[(-.13,1.045,.35),(.13,1.045,.35),(0,.99,.62),(-.09,.99,.36),(.09,.99,.36)],[(0,1,2),(0,2,3),(1,4,2),(3,2,4),(0,3,4,1)],M['Lava'],body,False)
        tube('Bill ridge',[(0,1.05,.36),(0,1.01,.54),(0,.99,.62)],[.025,.019,.007],M['Gold'],body)
        jaw=node('LowerBeak',body,(0,.99,.35))
        mesh('Lower bill',[(-.09,0,.01),(.09,0,.01),(0,0,.27),(-.07,-.06,.015),(.07,-.06,.015)],[(0,1,2),(0,2,3),(1,4,2),(3,2,4),(0,3,4,1)],M['Gold'],jaw,False)
        tuft=node('Secondary_Crest',root,(0,1.30,0))
        for s in (-1,0,1):tube('Swept crest',[(s*.05,0,0),(s*.07,.12,-.04),(s*.1,.19,-.13)],[.045,.038,.004],skin,tuft)
        tail=node('Secondary_Tail',root,(0,.42,-.28))
        for s in (-1,0,1):ell('Tail feather',(s*.06,.03,-.12),(.055,.08,.20),skin,tail)
    elif index==3:
        loft('Coconut torso',[(.30,.11,.1,0),(.4,.23,.18,0),(.65,.22,.19,0),(.79,.12,.11,0)],limb,body)
        ell('Coconut shell',(0,1.065,0),(.37,.335,.335),skin,body,24,16)
        ell('Face carving',(0,1.035,.255),(.265,.23,.09),M['Ivory'],body)
        for i in range(7):
            a=math.tau*i/7
            points=[]
            for j in range(7):
                t=.25+j*.42
                points.append((.372*math.sin(t)*math.cos(a),1.065+.338*math.cos(t),.338*math.sin(t)*math.sin(a)))
            if math.sin(a)<.5:tube('Husk grain',points,[.009]*7,M['Bamboo'],body,5)
        skirt=node('Secondary_Skirt',root,(0,.49,0))
        for i in range(12):
            a=i*math.tau/12
            tube('Grass tassel',[(.22*math.cos(a),.03,.19*math.sin(a)),(.29*math.cos(a),-.17,.26*math.sin(a))],[.045,.018],M['Gold'],skirt,5)
        sprout=node('Secondary_Crest',root,(0,1.36,0))
        for i in range(5):
            a=i*math.tau/5
            leaf=node('Sprout_'+str(i),sprout); leaf.rotation_euler.z=-a
            ribbon('Broad sprout',[(0,0,0),(0,.21,.09),(0,.28,.25),(0,.20,.42)],[.01,.09,.07,.002],M['Leaf'] if i%2 else M['LeafLight'],leaf)
        smile(body,(0,.94,.351),.085)
    elif index==4:
        loft('Axolotl silhouette',[(.27,.14,.12,0),(.38,.30,.28,0),(.68,.36,.34,0),(.88,.41,.35,0),(1.07,.39,.30,0),(1.22,.27,.21,0),(1.27,.08,.07,0)],skin,body)
        ell('Belly',(0,.62,.28),(.25,.27,.08),light,body)
        for s in (-1,1):
            ell('Rosy cheek',(s*.27,.93,.3),(.065,.035,.025),M['Blush'],body)
            for j in (-1,0,1):
                g=node('Secondary_Gill_'+str(s)+'_'+str(j),root,(s*.33,1.02+j*.10,-.04))
                points=[(0,0,0),(s*.16,j*.07,0),(s*.28,j*.13,-.025)]
                tube('Gill stalk',points,[.044,.035,.006],M['Tongue'],g)
                for k in range(3):
                    x=s*(.10+k*.06); y=j*(.04+k*.03)
                    for d in (-1,1):tube('Gill filament',[(x,y,0),(x+s*.025,y+d*.065,-.015)],[.018,.004],M['Blush'],g,5)
        tail=node('Secondary_Tail',root,(0,.40,-.25))
        tube('Curved tail',[(0,0,0),(0,.02,-.22),(.10,.10,-.42),(.18,.19,-.51)],[.12,.09,.05,.008],skin,tail,12)
        ribbon('Tail fin',[(0,.08,-.05),(0,.16,-.24),(.1,.22,-.42),(.18,.19,-.51)],[.08,.09,.05,.002],M['Tongue'],tail)
        smile(body,(0,.94,.355),.10)
    else:
        loft('Basalt silhouette',[(.28,.26,.24,0),(.36,.42,.36,0),(.62,.37,.33,0),(.90,.29,.26,0),(1.12,.25,.23,0),(1.18,.20,.18,0)],skin,body,12)
        loft('Crater rim',[(1.11,.25,.23,0),(1.20,.26,.23,0),(1.22,.20,.18,0),(1.13,.16,.14,0)],light,body,12)
        ell('Lava pool',(0,1.15,0),(.19,.025,.17),M['Lava'],body)
        for s in (-1,1):
            tube('Lava fissure',[(s*.2,1.16,.14),(s*.23,1.04,.16),(s*.20,.99,.22),(s*.24,.91,.23)],[.023,.02,.015,.005],M['Lava'],body,6)
            for j in range(2):ell('Rock plate',(s*(.23+j*.035),.45+j*.14,.22-j*.03),(.09,.085,.06),light,body,8,5)
        for j in range(3):
            smoke=node('Secondary_Smoke_'+str(j),root,(0,1.26+j*.15,0));ell('Smoke',(0,0,0),(.075,.065,.075),M['Ivory'],smoke,12,8)
        smile(body,(0,.73,.329),.10)
    # Full articulated limb nodes: game solves two segments and positions the wrist/ankle.
    sx,sy=shoulders[index]; hx,hy=hips[index]
    for side,s in [('L',-1),('R',1)]:
        upper=node('UpperArm_'+side,root,(s*sx,sy,.02))
        fore=node('Forearm_'+side,root,(s*(sx+.06),sy-.22,.02))
        hand=node('Hand_'+side,root,(s*(sx+.07),sy-.43,.02))
        for parent,length in [(upper,.24),(fore,.24)]:
            if index==2:
                loft('Layered wing',[(0,.055,.065,0),(-.09,.09,.09,0),(-.20,.065,.065,.015),(-length,.025,.03,.01)],skin,parent,12)
                for k in range(3):ell('Feather tip',((k-1)*.045,-.19,.02),(.035,.08,.045),skin,parent,12,8)
            else:
                tube('Limb',[(0,0,0),(0,-length*.5,0),(0,-length,0)],[.062,.053,.061],limb,parent,10)
                ell('Joint',(0,0,0),(.065,.065,.065),limb,parent,12,8)
        if index!=2:
            tube('Team wrist cuff',[(0,.045,0),(0,.095,0)],[.078,.078],M['Team'],hand,12)
        if index==1:
            ell('Claw palm',(0,-.03,0),(.12,.11,.09),skin,hand)
            for p in (-1,1):tube('Curved pincer',[(p*.075,-.08,0),(p*.10,-.17,.025),(p*.045,-.22,.04)],[.05,.038,.005],skin,hand)
        elif index==2:
            ell('Wing tip',(0,-.055,0),(.07,.11,.07),skin,hand)
        else:
            ell('Palm',(0,-.035,0),(.077,.075,.048),limb,hand)
            for k in range(3):
                tube('Finger',[( (k-1)*.045,-.065,.005),((k-1)*.045,-.125,.02)],[.024,.019],limb,hand,8)
            tube('Thumb',[(-s*.065,-.015,.01),(-s*.105,-.055,.03)],[.029,.023],limb,hand,8)
        length=(hy-.10)/2
        thigh=node('Thigh_'+side,root,(s*hx,hy,0))
        shin=node('Shin_'+side,root,(s*hx,hy-length,0))
        shoe=node('Shoe_'+side,root,(s*hx,.10,0))
        for p in (thigh,shin):tube('Leg',[(0,0,0),(0,-length,0)],[.075,.062],limb,p,10)
        ell('Knee pad',(0,0,.04),(.078,.07,.036),M['Team'],shin,12,8)
        ell('Sneaker',(0,-.025,.045),(.125,.085,.185),M['Team'],shoe)
        ell('Rubber sole',(0,-.074,.045),(.132,.029,.19),M['Sole'],shoe)
        ell('Toe cap',(0,-.017,.175),(.102,.055,.052),M['Ivory'],shoe)
        for j in range(3):tube('Lace',[(-.062,.047,.015+j*.035),(.062,.047,.015+j*.035)],[.009,.009],M['White'],shoe,5)
        ex,ey,ez,er=eyes[index]
        eye=node('Eye_'+side,root,(s*ex,ey,ez))
        if index==4:
            ell('Bead eye',(0,0,0),(er,er,er),M['Ink'],eye)
            ell('Eye glint',(.02,.025,.05),(.019,.019,.012),M['White'],eye,12,8)
        else:
            ell('Eye white',(0,0,0),(er,er,er),M['White'],eye,20,12)
            pupil=node('Pupil_'+side,eye,(0,0,er*.6))
            ell('Pupil',(0,0,0),(er*.55,er*.55,er*.55),M['Ink'],pupil)
            ell('Catchlight',(er*.18,er*.2,er*.42),(er*.16,er*.16,er*.12),M['White'],pupil,12,8)
        brow=node('Brow_'+side,root,(s*ex,ey+er+.025,ez))
        tube('Expressive brow',[(-er*.6,0,0),(0,.018,0),(er*.6,0,0)],[.014,.018,.014],skin,brow,6)
    export(root,OUT/'characters'/f'{name.lower()}.glb')
    root.location=xyz(((index-2.5)*1.65,0,0)); cast.append(root)

# Volleyball: 18 curved stitched panels projected from a cube onto a sphere.
ball=node('MatchVolleyball'); R=.3
ell('Recessed seams',(0,0,0),(R*.99,)*3,M['Ink'],ball,32,20)
for axis in range(3):
    for sign in (-1,1):
        for stripe in range(3):
            verts=[]; faces=[]
            for j in range(11):
                v=-.982+1.964*j/10
                for k in range(5):
                    u=-1+stripe*2/3+.018+(2/3-.036)*k/4
                    p=[0.,0.,0.];p[axis]=sign;p[(axis+1)%3]=u;p[(axis+2)%3]=v
                    q=Vector(p).normalized()*R;verts.append(q)
            for j in range(10):
                for k in range(4):
                    q=j*5+k;faces.append((q,q+1,q+6,q+5) if sign>0 else (q,q+5,q+6,q+1))
            mesh('Curved panel',verts,faces,[M['Gold'],M['White'],M['Team']][(stripe+axis)%3],ball)
export(ball,OUT/'match-volleyball.glb');ball.location=xyz((-1,.35,2))

post=node('PaddedNetPost')
tube('Bamboo standard',[(0,0,0),(0,2.65,0)],[.095,.08],M['Bamboo'],post,12)
loft('Safety padding',[(.04,.13,.13,0),(.10,.16,.16,0),(.95,.16,.16,0),(1.04,.13,.13,0)],M['Team'],post,16)
for h in (.22,.8):tube('Pad strap',[(0,h-.025,0),(0,h+.025,0)],[.165,.165],M['Ivory'],post,16)
ell('Post cap',(0,2.67,0),(.12,.09,.12),M['Gold'],post)
for h in (1.1,2.3):
    box('Net mount',(.10,h,0),(.16,.09,.15),M['Ink'],post)
    tube('Tension wheel',[(.14,h,.01),(.14,h,.11)],[.065,.065],M['Gold'],post,10)
export(post,OUT/'padded-net-post.glb');post.location=xyz((1.5,0,2))

hut=node('IslandJuiceHut')
for x in (-1.25,1.25):
    for z in (-.9,.9):tube('Bamboo post',[(x,0,z),(x,2.6,z)],[.10,.075],M['Bamboo'],hut)
box('Counter',(0,1.04,.9),(2.75,.14,.8),M['Bark'],hut)
for i in range(11):box('Counter slat',(-1.2+i*.24,.5,.98),(.22,.94,.12),M['Bamboo'],hut,.025)
for h in (.12,.86):box('Painted trim',(0,h,1.06),(2.65,.08,.07),M['Team'],hut)
# Overlapping thatch courses form a pitched roof with individual cut ends.
for s in (-1,1):
    for row in range(4):
        t=row/4
        for col in range(17):
            x=-1.63+col*.20
            z=s*(.1+t*1.35); y=3.55-t*.95
            mesh('Thatch shingle',[(x-.12,y,z),(x+.12,y,z),(x+.10,y-.36,z+s*.54),(x-.10,y-.38,z+s*.54)],[(0,1,2,3)],M['Gold'] if (row+col)%3 else M['Bamboo'],hut,False)
tube('Ridge cap',[(-1.8,3.58,0),(1.8,3.58,0)],[.10,.10],M['Bark'],hut,10)
box('Signboard',(0,2.23,1.02),(1.9,.43,.10),M['Team'],hut,.06)
# Embossed SUN SIP letters, converted to mesh for a self-contained export.
bpy.ops.object.text_add()
t=bpy.context.object;t.name='SUN SIP sign';t.data.body='SUN SIP';t.data.align_x='CENTER';t.data.size=.25;t.data.extrude=.006;t.data.materials.append(M['Ivory']);t.parent=hut;t.location=xyz((0,2.15,1.08));t.rotation_euler=(math.pi/2,0,0)
bpy.ops.object.convert(target='MESH')
for x in (-.75,0,.75):
    ell('Coconut cup',(x,1.22,.93),(.15,.17,.15),M['Bark'],hut)
    tube('Drinking straw',[(x+.04,1.30,.93),(x+.04,1.60,.93),(x+.12,1.65,.93)],[.015]*3,M['Team'],hut,6)
    ell('Fruit garnish',(x-.07,1.36,.94),(.065,.065,.018),M['Gold'],hut,12,8)
export(hut,OUT/'juice-hut.glb');hut.location=xyz((4,0,3))
scene.world=bpy.data.worlds.new('Cast studio');scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.3,.35,.45,1)
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.shading.color_type='MATERIAL'
        area.spaces.active.region_3d.view_distance=12
        area.spaces.active.region_3d.view_location=(0,0,.8)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/gameplay-cast.blend'))
print('Gameplay source saved; 9 models exported.')
