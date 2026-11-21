"""Reproducible meter-scale traveler. Blender Z-up, facing -Y => glTF +Z."""
import bpy, math, json, argparse, sys
from pathlib import Path
from mathutils import Vector
ap=argparse.ArgumentParser(); ap.add_argument('--output',required=True); ap.add_argument('--height',type=float,default=1.8)
a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]); out=Path(a.output); out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene; scene.unit_settings.system='METRIC'
M={}
for name,color in {'robe':(.12,.27,.25,1),'trim':(.31,.48,.39,1),'straw':(.66,.43,.18,1),'edge':(.85,.66,.32,1),'scarf':(.66,.19,.10,1),'skin':(.68,.43,.27,1),'dark':(.055,.042,.029,1),'leather':(.25,.12,.065,1),'pack':(.43,.33,.17,1),'cloth':(.62,.62,.43,1),'metal':(.61,.48,.22,1)}.items():
 m=bpy.data.materials.new(name); m.diffuse_color=color; m.use_nodes=True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=color; m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.88; M[name]=m
root=bpy.data.objects.new('Pilgrim',None); scene.collection.objects.link(root)
def finish(o,n,m,parent=root):
 o.name=n; o.data.materials.append(M[m]); o.parent=parent; return o
def ball(n,loc,scale,m,parent=root):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=loc); o=bpy.context.object; o.scale=scale; finish(o,n,m,parent)
 for p in o.data.polygons:p.use_smooth=True
 return o
def box(n,loc,scale,m,parent=root):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.scale=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); mod=o.modifiers.new('Soft sewn edges','BEVEL'); mod.width=.025; mod.segments=2; bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=mod.name); return finish(o,n,m,parent)
def rod(n,p,q,r,m,parent=root):
 v=Vector(q)-Vector(p); bpy.ops.mesh.primitive_cylinder_add(vertices=10,radius=r,depth=v.length,location=(Vector(p)+Vector(q))/2); o=bpy.context.object; o.rotation_euler=v.to_track_quat('Z','Y').to_euler(); return finish(o,n,m,parent)
def line(n,pts,r,m):
 cu=bpy.data.curves.new(n,'CURVE'); cu.dimensions='3D'; cu.bevel_depth=r; cu.bevel_resolution=1; s=cu.splines.new('POLY'); s.points.add(len(pts)-1)
 for p,co in zip(s.points,pts): p.co=(*co,1)
 o=bpy.data.objects.new(n,cu); scene.collection.objects.link(o); o.parent=root; cu.materials.append(M[m]); return o
# Pleated robe mesh; modeled folds remain readable at game distance.
verts=[]; faces=[]; rings=[(.32,.30,.22),(.38,.31,.23),(.78,.23,.18),(1.10,.25,.19),(1.28,.26,.16),(1.34,.13,.13)]
for z,rx,ry in rings:
 for i in range(48):
  t=i*math.tau/48; fold=1+.045*math.cos(t*12); verts.append((rx*math.cos(t)*fold,ry*math.sin(t)*fold,z))
for j in range(len(rings)-1):
 for i in range(48): k=j*48+i; nxt=j*48+(i+1)%48; faces.append((k,nxt,nxt+48,k+48))
faces.extend([tuple(reversed(range(48))),tuple(range(240,288))]); mesh=bpy.data.meshes.new('Pleated robe'); mesh.from_pydata(verts,[],faces); mesh.update(); ob=bpy.data.objects.new('Robe',mesh); scene.collection.objects.link(ob); finish(ob,'Robe','robe')
for z,rx,ry in [(.355,.305,.225),(.80,.235,.185)]:line('Woven robe border',[(rx*math.cos(t*math.tau/64),ry*math.sin(t*math.tau/64),z) for t in range(65)],.012,'trim')
for side in [-1,1]:
 x=side*.13
 pivot=bpy.data.objects.new(('Left' if side<0 else 'Right')+'Leg',None); scene.collection.objects.link(pivot); pivot.parent=root; pivot.location=(x,0,.46)
 # Keep limb geometry local so game code can rotate named pivots directly.
 rod('Trouser leg',(0,0,-.32),(0,0,0),.070,'cloth',pivot); ball('Travel shoe',(0,-.065,-.395),(.105,.17,.065),'dark',pivot)
 for zz in [-.29,-.24]:rod('Leg wrap',(-.002,0,zz-.012),(-.002,0,zz+.012),.075,'trim',pivot)
 arm=bpy.data.objects.new(('Left' if side<0 else 'Right')+'Arm',None); scene.collection.objects.link(arm); arm.parent=root; arm.location=(side*.25,0,1.23)
 rod('Wide sleeve',(0,0,0),(side*.12,-.015,-.28),.105,'robe',arm); rod('Cuff',(side*.12,-.015,-.26),(side*.13,-.02,-.32),.089,'trim',arm); ball('Hand',(side*.14,-.025,-.36),(.065,.065,.085),'skin',arm)
ball('Head',(0,-.01,1.49),(.14,.125,.17),'skin'); ball('Nose',(0,-.135,1.485),(.026,.035,.033),'skin')
for x in [-.050,.050]:ball('Eye',(x,-.124,1.53),(.012,.009,.016),'dark')
# Scarf cowl and flowing tails.
ball('Scarf cowl',(0,-.015,1.345),(.18,.145,.085),'scarf')
tail=box('Scarf front tail',(.095,-.208,1.12),(.105,.034,.32),'scarf'); tail.rotation_euler[1]=-.15
line('Scarf stitch',[(.07,-.230,.98),(.09,-.230,1.24)],.004,'edge')
# A broad conical woven kasa with radial reeds and circular bands.
bpy.ops.mesh.primitive_cone_add(vertices=64,radius1=.435,radius2=.055,depth=.21,location=(0,0,1.675)); finish(bpy.context.object,'Straw hat','straw')
for r in [.10,.16,.22,.28,.34,.40,.435]:
 z=1.78-(r-.055)*.21/.38
 line('Hat woven ring',[(r*math.cos(i*math.tau/96),r*math.sin(i*math.tau/96),z+.003) for i in range(97)],.0045,'edge')
for i in range(40):
 t=i*math.tau/40; line('Hat radial reed',[(r*math.cos(t),r*math.sin(t),1.78-(r-.055)*.21/.38+.003) for r in [.06,.15,.25,.35,.433]],.0028,'edge')
ball('Hat cap',(0,0,1.778),(.060,.060,.022),'straw')
for x in [-.12,.12]:line('Hat chin cord',[(x,-.04,1.59),(x*.7,-.14,1.37),(0,-.155,1.32)],.006,'leather')
# Rear pack, leather flap, buckles, bedroll, side canteen.
box('Backpack',(0,.26,1.06),(.39,.21,.43),'pack'); box('Pack flap',(0,.38,1.22),(.40,.055,.16),'leather')
for x in [-.14,.14]:
 line('Shoulder strap',[(x,.32,1.28),(x,.03,1.34),(x,-.185,1.19),(x,-.19,.88),(x,.24,.85)],.022,'leather')
 box('Pack strap',(x,.378,1.02),(.035,.024,.31),'leather'); box('Brass buckle',(x,.399,1.08),(.057,.016,.055),'metal')
rod('Rolled sleeping mat',(-.25,.28,1.39),(.25,.28,1.39),.085,'cloth')
for x in [-.17,.17]:
 line('Bedroll tie',[(x,.28+.087*math.cos(i*math.tau/32),1.39+.087*math.sin(i*math.tau/32)) for i in range(33)],.009,'leather')
ball('Canteen',(.27,.24,.94),(.09,.075,.13),'straw'); rod('Bottle stopper',(.27,.24,1.05),(.27,.24,1.10),.033,'leather')
# Scale whole hierarchy to measured target height; origin remains ground center.
bpy.context.view_layer.update(); meshes=[o for o in scene.objects if o.type in {'MESH','CURVE'}]
lo=min((o.matrix_world@Vector(c)).z for o in meshes for c in o.bound_box); hi=max((o.matrix_world@Vector(c)).z for o in meshes for c in o.bound_box)
s=a.height/(hi-lo); root.scale=(s,s,s); root.location.z=-lo*s; bpy.context.view_layer.update()
coords=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]; dims=[max(v[i] for v in coords)-min(v[i] for v in coords) for i in range(3)]
bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
for o in meshes:
 o.select_set(True)
# Include empty limb pivots in export.
for o in scene.objects:
 if o.type=='EMPTY':o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out/'pilgrim.glb'),export_format='GLB',use_selection=True,export_yup=True)
tri=sum(len(p.vertices)-2 for o in meshes if o.type=='MESH' for p in o.data.polygons)
meta={'version':'002','units':'meters','height_m':dims[2],'blender_dimensions_xyz_m':dims,'gltf_dimensions_xyz_m':[dims[0],dims[2],dims[1]],'forward':'+Z (glTF)','up':'+Y (glTF)','origin':'ground center','mesh_curve_nodes':len(meshes),'mesh_triangles_before_curve_conversion':tri,'animation':'Named LeftArm RightArm LeftLeg RightLeg rigid pivots; no skeletal clips','approval':'Awaiting visual feedback; game integration authorized; no printing'}
(out/'asset-metadata.json').write_text(json.dumps(meta,indent=2))
# Studio belongs to .blend/render only and is excluded from GLB.
bpy.ops.mesh.primitive_plane_add(size=200); floor=bpy.context.object; floor.name='Studio floor'; floor.location.z=-.008; floor.data.materials.append(M['cloth'])
world=scene.world; world.color=(.16,.16,.16)
for pos,power,size in [((3,-4,6),450,4),((-3,-1,3),220,3),((0,3,4),500,3)]:
 bpy.ops.object.light_add(type='AREA',location=pos); l=bpy.context.object; l.data.energy=power; l.data.shape='DISK'; l.data.size=size; l.rotation_euler=(Vector((0,0,.9))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(2.5,-4,2.35)); cam=bpy.context.object; cam.rotation_euler=(Vector((0,0,.9))-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.type='ORTHO'; cam.data.ortho_scale=2.4; scene.camera=cam
scene.render.engine='CYCLES'; scene.cycles.samples=32; scene.render.resolution_x=900; scene.render.resolution_y=1000; scene.render.resolution_percentage=100
bpy.ops.wm.save_as_mainfile(filepath=str(out/'pilgrim.blend')); scene.render.filepath=str(out/'pilgrim.png'); bpy.ops.render.render(write_still=True)
cam.location=(-2.7,4,2.4); cam.rotation_euler=(Vector((0,0,.9))-cam.location).to_track_quat('-Z','Y').to_euler(); scene.render.filepath=str(out/'pilgrim-back.png'); bpy.ops.render.render(write_still=True)
