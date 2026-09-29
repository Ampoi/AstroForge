"""Build the editable Blender source and the runtime GLB; no third-party assets.

Usage: blender --background --python scripts/build-launch-complex.py -- --render
Authoring coordinates below match Three.js: metres, Y up, pad contact at Y=0.
The Blender file uses Z up. glTF export restores the runtime coordinates.
"""
import argparse
import json
import math
from pathlib import Path
import random
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / "design/launch-complex"
ASSETS = ROOT / "public/assets/launch-complex"
TAU = math.tau
RNG = random.Random(73129)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = "METRIC"
bpy.context.scene.unit_settings.scale_length = 1
bpy.context.preferences.filepaths.save_version = 0

# Linear RGB gives Blender and glTF the same PBR palette.
def linear(hex_color):
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb)


def material(name, color, rough=.7, metal=0, glow=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*linear(color), 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = mat.diffuse_color
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if glow:
        bsdf.inputs["Emission Color"].default_value = mat.diffuse_color
        bsdf.inputs["Emission Strength"].default_value = glow
    return mat


MATS = {
    "concrete": material("Concrete / warm precast", "aeb3af", .93),
    "concreteLight": material("Concrete / pale deck", "c4c9c3", .9),
    "concreteDark": material("Concrete / expansion joints", "858f89", .95),
    "shell": material("Ceramic white cladding", "dae0dd", .47, .16),
    "steel": material("Graphite structural steel", "414f55", .52, .72),
    "silver": material("Brushed alloy / pipework", "9cacae", .38, .78),
    "dark": material("Charcoal recesses", "26343b", .8, .22),
    "road": material("Asphalt", "465250", .97),
    "paint": material("Ivory road paint", "d7d8bd", .82),
    "yellow": material("Safety ochre", "d9a94c", .5, .28),
    "red": material("Oxide orange crane", "ba593c", .55, .42),
    "glass": material("Blue grey opaque glazing", "284c57", .26, .65),
    "teal": material("Teal guide lights", "65d6c9", .36, .25, .65),
    "light": material("Warm task lights", "ffebbb", .4, 0, 1.5),
    "soil": material("Managed landscape", "5b6950", 1),
    "gravel": material("Gravel shoulders", "85877a", 1),
}
BATCHES = {}
FACILITY = "01 Pad and flame channel"


def point(v):
    return (v[0], -v[2], v[1])


def geometry(vertices, faces, mat, smooth=False):
    data = BATCHES.setdefault((FACILITY, mat), [[], [], []])
    offset = len(data[0])
    data[0].extend(point(v) for v in vertices)
    data[1].extend(tuple(offset + i for i in face) for face in faces)
    data[2].extend([smooth] * len(faces))


CUBE_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
              (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def box(center, size, mat="shell"):
    x, y, z = center
    a, b, c = (v / 2 for v in size)
    geometry([(x-a, y-b, z-c), (x+a, y-b, z-c), (x+a, y+b, z-c),
              (x-a, y+b, z-c), (x-a, y-b, z+c), (x+a, y-b, z+c),
              (x+a, y+b, z+c), (x-a, y+b, z+c)], CUBE_FACES, mat)


def slab_with_opening(x0, x1, z0, z1, bottom, top, opening, mat):
    """Partition a slab around a rectangular opening instead of stacking floors."""
    ox0, ox1, oz0, oz1 = opening
    xs=sorted(set((x0,x1,max(x0,ox0),min(x1,ox1))))
    zs=sorted(set((z0,z1,max(z0,oz0),min(z1,oz1))))
    for a,b in zip(xs,xs[1:]):
        for c,d in zip(zs,zs[1:]):
            if a>=b or c>=d or ox0<=(a+b)/2<=ox1 and oz0<=(c+d)/2<=oz1:
                continue
            box(((a+b)/2,(bottom+top)/2,(c+d)/2),(b-a,top-bottom,d-c),mat)


def paved_union(rectangles, y, mat):
    """Emit a single non-overlapping surface, including road intersections."""
    xs=sorted({v for r in rectangles for v in r[:2]})
    zs=sorted({v for r in rectangles for v in r[2:]})
    for a,b in zip(xs,xs[1:]):
        for c,d in zip(zs,zs[1:]):
            if any(x0<=(a+b)/2<=x1 and z0<=(c+d)/2<=z1 for x0,x1,z0,z1 in rectangles):
                geometry([(a,y,c),(a,y,d),(b,y,d),(b,y,c)],[(0,1,2,3)],mat)


def beam(a, b, width=.14, mat="steel", depth=None):
    start, end = Vector(a), Vector(b)
    direction = end - start
    rotation = Vector((0, 1, 0)).rotation_difference(direction.normalized())
    w, h, d = width / 2, direction.length / 2, (depth or width) / 2
    verts = [(-w,-h,-d), (w,-h,-d), (w,h,-d), (-w,h,-d),
             (-w,-h,d), (w,-h,d), (w,h,d), (-w,h,d)]
    center = (start + end) / 2
    geometry([center + rotation @ Vector(v) for v in verts], CUBE_FACES, mat)


def pipe(a, b, radius=.18, mat="silver", sides=12):
    start, end = Vector(a), Vector(b)
    axis = (end - start).normalized()
    u = axis.cross(Vector((0, 1, 0)) if abs(axis.y) < .9 else Vector((1, 0, 0))).normalized()
    v = axis.cross(u)
    verts = [p + radius * (math.cos(i * TAU / sides) * u + math.sin(i * TAU / sides) * v)
             for p in (start, end) for i in range(sides)]
    # Clockwise viewed along the axis: caps and tube have outward normals.
    geometry(verts, [(i, (i+1) % sides, (i+1) % sides+sides, i+sides) for i in range(sides)], mat, True)
    geometry(verts, [tuple(reversed(range(sides))), tuple(range(sides, sides*2))], mat)


def cylinder(x, y, z, r, h, mat="shell", sides=32):
    pipe((x,y-h/2,z), (x,y+h/2,z), r, mat, sides)


def sphere(center, scale, mat="shell", segments=32, rings=12):
    x, y, z = center
    rx, ry, rz = scale
    # Single pole vertices avoid degenerate exported triangles.
    verts = [(x, y+ry, z)]
    for j in range(1, rings):
        p = j * math.pi / rings
        for i in range(segments):
            t = i * TAU / segments
            verts.append((x+rx*math.sin(p)*math.cos(t), y+ry*math.cos(p), z+rz*math.sin(p)*math.sin(t)))
    bottom = len(verts)
    verts.append((x, y-ry, z))
    faces = [(0, 1+(i+1)%segments, 1+i) for i in range(segments)]
    for j in range(rings-2):
        a, b = 1+j*segments, 1+(j+1)*segments
        faces.extend((a+i, a+(i+1)%segments, b+(i+1)%segments, b+i) for i in range(segments))
    faces.extend((bottom, bottom-segments+i, bottom-segments+(i+1)%segments) for i in range(segments))
    geometry(verts, faces, mat, True)


def ring(center, radius, tube=.08, mat="silver", segments=48):
    x, y, z = center
    for i in range(segments):
        a, b = i*TAU/segments, (i+1)*TAU/segments
        pipe((x+radius*math.cos(a), y, z+radius*math.sin(a)),
             (x+radius*math.cos(b), y, z+radius*math.sin(b)), tube, mat, 8)


def rail(a, b, mat="yellow"):
    start, end = Vector(a), Vector(b)
    steps = max(1, math.ceil((end-start).length/2.8))
    for i in range(steps+1):
        p = start.lerp(end, i/steps)
        beam(p, p+Vector((0,1.15,0)), .055, mat)
    for height in (.52, 1.13):
        beam(start+Vector((0,height,0)), end+Vector((0,height,0)), .055, mat)
    beam(start+Vector((0,.08,0)), end+Vector((0,.08,0)), .07, mat, .12)


def platform(x, y, z, w, d):
    box((x,y-.1,z), (w,.2,d), "steel")
    for zz in (z-d/2, z+d/2):
        rail((x-w/2,y,zz), (x+w/2,y,zz))
    for xx in (x-w/2, x+w/2):
        rail((xx,y,z-d/2), (xx,y,z+d/2))


def route(points, radius=.18, mat="silver"):
    for a,b in zip(points, points[1:]):
        pipe(a,b,radius,mat)
    for p in points[1:-1]:
        sphere(p,(radius,radius,radius),mat,12,6)


# Preserve the simulator's existing apron footprint and contact plane.
slab_with_opening(-46,46,-46,46,-1.195,-.845,(-14,14,6,46),"concrete")
box((-7,-.5,0), (11,1,13), "concreteLight")
box((7,-.5,0), (11,1,13), "concreteLight")
box((0,-.5,4.5), (3,1,4), "concreteLight")
box((0,-.82,-20), (3,.025,47), "dark")
for x in (-1.7,1.7):
    box((x,-.44,-24), (.4,.8,39), "concreteDark")
for z in range(-41,-4,3):
    box((0,-.79,z), (2.95,.025,.055), "silver")
for x in (-.95,.95):
    for z in (-.95,.95):
        box((x,-.48,z),(.32,1.1,.32),"steel")
        beam((x,.06,z),(x*.56,.06,z*.56),.16)
ring((0,-.08,0),1.22,.1)
for x in (-8,8):
    for z in (-5,5):
        box((x,.28,z),(.55,.55,.55),"silver")
        route([(x,.5,z),(x*.8,1,z),(x*.66,1.05,z*.8)],.12)
for x in (-11.8,11.8):
    rail((x,0,-5.8),(x,0,5.8))
for i in range(24):
    box((-11.5+i, .014,-6.15),(.55,.028,.48),"yellow" if i%2 else "dark")
for x in (-30,-20,-10,10,20,30,40):
    box((x,-.838,22),( .045,.012,44),"concreteDark")
for z in (-40,-30,-20,10,20,30,40):
    box((0,-.837,z),(90,.012,.045),"concreteDark")
# Wider lateral blast shields read as a deliberate flame outlet.
for x in (-5.5,5.5):
    box((x,.65,-32),(1.2,3,24),"concrete")
    for z in range(-43,-20,4):
        box((x, .68,z),(1.28,3.12,.14),"concreteDark")
    rail((x,2.2,-43),(x,2.2,-21))
for x in (-16,16):
    box((x,-.55,19),(6,.6,10),"concreteDark")
    box((x,.2,19),(5,1,8),"shell")
    for z in (16,18,20,22):
        box((x,.55,z),(4,.025,.6),"dark")

FACILITY = "02 Service tower"
tx, tz, height = -23, -3, 72
box((tx,-.45,tz),(18,1.3,18),"concreteLight")
for x in (tx-6, tx+6):
    for z in (tz-6,tz+6):
        box((x,35.8,z),(.65,72,.65),"steel")
        box((x,.2,z),(1.6,.5,1.6),"silver")
for level in range(0,73,6):
    platform(tx,level,tz,13,13)
    if level < height:
        for z in (tz-6,tz+6):
            beam((tx-6,level,z),(tx+6,level+6,z),.22)
            beam((tx+6,level,z),(tx-6,level+6,z),.22)
        for x in (tx-6,tx+6):
            beam((x,level,tz-6),(x,level+6,tz+6),.22)
            beam((x,level,tz+6),(x,level+6,tz-6),.22)
# The white lift/service spine gives the exposed truss a near-future silhouette.
box((tx-2,36,tz+2),(3.6,72,4),"dark")
for level in range(0,72,3):
    box((tx-2,level+1.45,tz+4.08),(3.5,2.85,.18),"shell")
    box((tx-3.86,level+1.45,tz+2),(.18,2.85,4),"shell")
box((tx-3.95,36,tz+4.2),(.09,71,.12),"teal")
for dx in (1.1,1.85,2.6):
    pipe((tx+dx,.1,tz+2),(tx+dx,70,tz+2),.21)
    for level in range(3,70,6):
        cylinder(tx+dx,level,tz+2,.27,.15,"steel",16)
# Alternating staircase flights, intermediate landings and handrails.
for level in range(0,72,6):
    for half in range(2):
        base = level + half*3
        x = tx+7.6+half*1.7
        direction = 1 if half == 0 else -1
        for i in range(15):
            z = tz + direction*(-4.5+i*.6)
            box((x,base+i*.2+.08,z),(1.45,.16,.62),"silver")
        a,b=(x,base,tz-direction*4.8),(x,base+3,tz+direction*4.2)
        for side in (-.75,.75):
            beam((a[0]+side,a[1],a[2]),(b[0]+side,b[1],b[2]),.13)
            rail((a[0]+side,a[1]+.15,a[2]),(b[0]+side,b[1]+.15,b[2]))
        box((x,base+2.92,tz+direction*5.1),(1.5,.16,1.8),"steel")
# Service arms stop well short of the vehicle axis, leaving the launch path clear.
for level,length in ((12,9),(30,10),(51,8),(66,9)):
    start,end=tx+6,tx+6+length
    platform((start+end)/2,level,tz,length,2.4)
    for z in (tz-1,tz+1):
        beam((start,level-3,z),(end,level-.2,z),.22)
        for i in range(int(length/2)):
            beam((start+i*2,level-2,z),(start+(i+1)*2,level,z),.11)
    box((end,level+.9,tz),(.6,1.8,2.7),"shell")
    box((end+.32,level+1,tz),(.07,1.4,2),"teal")
    pipe((start,level+.35,tz),(end,level+.35,tz),.14)
platform(tx,73,tz,15,15)
# Tower-top lattice crane, boom directed away from the launch axis.
cylinder(tx,75,tz,1.6,3,"steel")
box((tx,77,tz),(4,1.6,3),"red")
for z in (tz-1,tz+1):
    beam((tx+8,77,z),(tx-30,77,z),.22,"red")
    beam((tx+8,79.4,z),(tx-30,78,z),.18,"red")
    for i in range(19):
        x=tx-30+i*2
        beam((x,77,z),(x+2,78+(i/19)*1.4,z),.12,"red")
beam((tx,77,tz),(tx,84,tz),.28,"red")
for x in (tx-29,tx+8):
    pipe((tx,84,tz),(x,79,tz),.035,"steel",6)
pipe((tx-28,77,tz),(tx-28,67,tz),.045,"steel",8)
box((tx-28,66.6,tz),(.8,.8,.8),"yellow")
box((tx+6.8,77.5,tz),(3,2.4,3.4),"concreteDark")
box((tx+1,75,tz-2.2),(3,2.5,2.2),"shell")
box((tx+1,75.4,tz-3.32),(2.6,1.4,.05),"glass")

FACILITY = "03 VAB transport corridor"
# One uninterrupted 28 m causeway: VAB front at z=185 to the pad at z=6.5.
# It is flush with the existing apron; a short ramp meets the y=0 launch deck.
box((0,-.965,116),(28,.24,220),"concreteLight")
for x in (-14.5,14.5):
    box((x,-.97,116),(1,.2,220),"gravel")
for z in range(10,223,5):
    box((0,-.835,z),(27.8,.012,.055),"concreteDark")
for x in (-6.6,-6,6,6.6):
    box((x,-.822,116),(.16,.04,220),"steel")
for x in (-12.8,12.8):
    box((x,-.816,116),(.16,.016,220),"paint")
    for z in range(12,225,9):
        box((x,-.79,z),( .23,.08,2.1),"teal")
for z in range(18,180,24):
    for x in (-16,16):
        box((x,-.15,z),(.38,1.3,.38),"dark")
        box((x,.35,z),(.4,.12,.4),"light")
# Deck access ramp only on the landward side; the flame slot remains open.
geometry([(-12.5,-.845,17),(12.5,-.845,17),(12.5,0,6.5),(-12.5,0,6.5)],
         [(0,1,2,3)],"concreteLight")
for x in (-6.6,-6,6,6.6):
    beam((x,-.815,17),(x,.028,6.5),.06,"steel",.15)

FACILITY = "04 Vehicle assembly building"
vx,vz,w,d,h=0,230,76,90,57
box((vx,-1.045,vz),(96,.15,108),"concrete")
slab_with_opening(-w/2,w/2,185,275,-1.045,-.845,(-14,14,185,226),"dark")
# A true recessed assembly bay, not a door painted on a box.
for x in (-w/2,w/2):
    box((x,h/2-.85,vz),(2,h,d),"shell")
box((vx,h/2-.85,vz+d/2),(w,h,2),"shell")
box((vx,h-.85,vz),(w+1,1.5,d+1),"shell")
for x in (-27.5,27.5):
    box((x,h/2-.85,185),(21,h,2),"shell")
box((0,51.2,185),(34,10,2),"shell")
box((0,47.3,183.7),(37,1,3),"steel")
for x in (-18,18):
    box((x,22,183.9),(1.3,45,2.3),"steel")
    box((x,22,182.68),(.22,44,.1),"teal")
# Partly retracted segmented overhead door reveals structural depth.
for y in (43,44,45):
    box((0,y,185),(33,.82,.8),"silver")
for z in range(190,275,9):
    for x in (-35,35):
        box((x,26,z),(.65,54,.65),"steel")
    beam((-35,54,z),(0,56,z),.45)
    beam((0,56,z),(35,54,z),.45)
    box((0,54.2,z),(25,.08,.25),"light")
for x in (-25,25):
    for y in range(7,43,9):
        platform(x,y,254,9,32)
for x in (-34,34):
    box((x,22,218),(.3,1.2,45),"teal")
for z in range(190,276,6):
    for x in (-39,39):
        box((x,26.5,z),(.22,54,.2),"concreteDark")
for x in range(-35,36,5):
    box((x,56.95,vz),(.18,.2,89),"silver")
for x in (-29,29):
    box((x,28,183.87),(10,45,.12),"concreteLight")
    box((x-4.5,27,183.76),(.17,41,.1),"teal")
    for y in range(3,53,4):
        box((x,y,183.7),(9.8,.055,.12),"silver")
# Attached low service wings and roof plant.
for x in (-53,53):
    box((x,7,230),(25,16,68),"shell")
    box((x,15.2,230),(26,.6,70),"dark")
    box((x,6,195.9),(22,3,.15),"glass")
    for z in (210,230,250):
        box((x,16.5,z),(8,2,5),"silver")
        for dx in (-2,2):
            cylinder(x+dx,17.55,z,1.5,.1,"dark",20)

FACILITY = "05 Cryogenic tank farm"
box((-132,-.95,-62),(106,.3,72),"concrete")
for x in (-185,-79):
    box((x,.15,-62),(.6,2.4,72),"concreteLight")
for z in (-98,-26):
    box((-132,.15,z),(106,2.4,.6),"concreteLight")
for x in (-168,-146,-124,-102):
    z=-72
    cylinder(x,.2,z,7.2,2,"concreteDark")
    cylinder(x,12,z,5.8,24)
    sphere((x,24,z),(5.8,2.5,5.8))
    for y in (1.2,5,10,15,20,24):
        ring((x,y,z),5.85,.09)
    ring((x,25,z),4.6,.05,"yellow")
    for i in range(12):
        a=i*TAU/12
        beam((x+4.6*math.cos(a),24,z+4.6*math.sin(a)),(x+4.6*math.cos(a),25,z+4.6*math.sin(a)),.055,"yellow")
    pipe((x,24,z),(x,27.7,z),.18)
    for dx in (-.38,.38):
        beam((x+dx,1,z+5.95),(x+dx,24,z+5.95),.075)
    for y in range(1,48):
        beam((x-.4,y*.5,z+6),(x+.4,y*.5,z+6),.045)
    route([(x,1,z+5.8),(x,1,-40),(x,3,-40)],.3)
for x in (-160,-132,-104):
    z=-42
    sphere((x,8.2,z),(7.5,7.5,7.5),segments=40,rings=18)
    ring((x,8.2,z),7.53,.1)
    for dx in (-4.5,4.5):
        for dz in (-4.5,4.5):
            cylinder(x+dx,2.4,z+dz,.22,6,"steel",12)
    pipe((x,15.5,z),(x,18,z),.15)
    route([(x,2,z),(x,2,-31),(-82,2,-31)],.2)

FACILITY = "06 Utility pipe racks"
for z in range(-65,0,8):
    for x in (-37,-31):
        box((x,2.2,z),(.22,6,.22),"steel")
        box((x,-.55,z),(1,.5,1),"concrete")
    beam((-37,4.5,z),(-31,4.5,z),.22)
    beam((-37,3.1,z),(-31,3.1,z),.16)
for x in range(-122,-32,8):
    for z in (-68,-62):
        box((x,2.2,z),(.22,6,.22),"steel")
    beam((x,4.5,-68),(x,4.5,-62),.22)
for i in range(5):
    route([(-124,4.8,-67+i),(-36+i,4.8,-67+i),(-36+i,4.8,-2),
           (-30,4.8,-2),(-28,1,-2)],.18 if i<3 else .27)
for x in range(-120,-38,8):
    beam((x,1,-62),(x+8,4.5,-62),.12)
for z in range(-64,-8,8):
    beam((-37,1,z),(-37,4.5,z+8),.12)

FACILITY = "07 Water and power"
wx,wz=65,-52
box((wx,-.6,wz),(27,1,27),"concrete")
for dx in (-5,5):
    for dz in (-5,5):
        beam((wx+dx*1.5,0,wz+dz*1.5),(wx+dx,30,wz+dz),.42)
for level in (4,12,20):
    for dz in (-5,5):
        beam((wx-6,level,wz+dz),(wx+6,level+8,wz+dz),.18)
        beam((wx+6,level,wz+dz),(wx-6,level+8,wz+dz),.18)
cylinder(wx,30,wz,8,9)
sphere((wx,34.5,wz),(8,2.2,8))
sphere((wx,25.5,wz),(8,2.8,8))
ring((wx,27,wz),8.35,.06,"yellow")
pipe((wx,25,wz),(wx,1,wz),.55)
route([(wx,1,wz),(18,1,wz),(18,1,-5),(8,1,-5)],.45)
for x in (95,112):
    box((x,2.8,-48),(12,7,18),"shell")
    box((x,6.5,-48),(12.6,.5,18.6),"dark")
    for z in range(-54,-39,3):
        box((x+6.05,3,z),(.15,3.8,1.5),"steel")
for x in range(90,119,4):
    box((x,.5,-70),(2.5,2.6,5),"silver")
    for z in (-71,-69):
        cylinder(x,2.6,z,.22,1.8,"dark",12)

FACILITY = "08 Lightning protection"
for x,z in ((-69,-92),(66,-94),(-70,54),(65,54)):
    box((x,-.4,z),(9,1.4,9),"concreteLight")
    for level in range(0,85,7):
        a=2.8*(1-level/105)
        b=2.8*(1-(level+7)/105)
        for dx,dz in ((-1,-1),(-1,1),(1,-1),(1,1)):
            beam((x+dx*a,level,z+dz*a),(x+dx*b,level+7,z+dz*b),.15,"silver")
        for side in (-1,1):
            beam((x-a,level,z+side*a),(x+b,level+7,z+side*b),.075,"silver")
            beam((x+side*a,level,z-a),(x+side*b,level+7,z+b),.075,"silver")
    pipe((x,84,z),(x,94,z),.09,"silver",12)
    sphere((x,94,z),(.18,.18,.18),"light",12,6)

FACILITY = "09 Operations campus"
for x,z,w,d,h in ((104,148,54,31,11),(-118,211,46,55,13),(110,245,35,42,8)):
    box((x,-.95,z),(w+14,.3,d+16),"concrete")
    box((x,h/2-.85,z),(w,h,d),"shell")
    box((x,h-.6,z),(w+1,.6,d+1),"dark")
    for side in (-1,1):
        box((x,h*.56,z+side*(d/2+.06)),(w-4,2.8,.14),"glass")
        for xx in range(0,int(w)-3,4):
            box((x-w/2+2+xx,h*.56,z+side*(d/2+.16)),(.1,2.85,.12),"silver")
    box((x,h*.77,z-d/2-.15),(w-4,.12,.1),"teal")
    for xx in (-w/3,0,w/3):
        box((x+xx,h+.6,z),(4,2,6),"silver")
    box((x,2,z-d/2-.15),(4,5,.2),"dark")
    box((x,4.6,z-d/2-2),(8,.25,4),"shell")
# A horizontal logistics transporter parked beside the VAB, leaving the route clear.
box((-50,.2,164),(11,1.8,18),"steel")
box((-50,1.25,164),(12,.45,19),"shell")
for x in (-55, -45):
    for z in (158,162,166,170):
        pipe((x-.65,-.2,z),(x+.65,-.2,z),.75,"dark",16)
box((-50,2.2,156),(7,1.7,2),"dark")
box((-50,2.4,154.97),(6,1.1,.08),"glass")

FACILITY = "10 Roads landscape and perimeter"
# No landscaping blanket: the planet's terrain remains visible between facilities.
road_rectangles=[]
for x in (-205,175):
    road_rectangles.append((x-5,x+5,-146,306))
for z in (-140,305):
    road_rectangles.append((-210,180,z-5,z+5))
for x in (-85,82):
    road_rectangles.append((x-4.5,x+4.5,60.5,305.5))
for z in (95,285):
    road_rectangles.append((-210,180,z-4.5,z+4.5))
paved_union(road_rectangles,-.9,"road")
for z in range(-135,306,12):
    for x in (-205,175):
        box((x,-.891,z),(.15,.012,4),"paint")
for z in (95,285,-140,305):
    for x in range(-200,172,12):
        # The crawlerway takes priority where roads cross it.
        if abs(x)>17:
            box((x,-.89,z),(4,.012,.15),"paint")
for x,z,w,d in ((103,119,60,17),(-135,169,55,15),(130,209,27,18)):
    box((x,-.95,z),(w,.22,d),"road")
    for dx in range(0,int(w)-3,4):
        box((x-w/2+2+dx,-.83,z),(.12,.016,d-3),"paint")
for x,z in ((90,118),(102,118),(110,118),(-138,170),(-122,170)):
    box((x,-.05,z),(2.3,1.5,4.7),"shell")
    box((x,.85,z-.3),(2, .8,2.4),"glass")
    for dx in (-1.12,1.12):
        for dz in (-1.4,1.4):
            pipe((x+dx-.12,-.4,z+dz),(x+dx+.12,-.4,z+dz),.4,"dark",12)
for x in (-191,160):
    for z in range(-126,303,32):
        pipe((x,-1,z),(x,9,z),.1,"steel",8)
        beam((x,9,z),(x-2,9.8,z),.1)
        box((x-2,9.8,z),(1.5,.12,.5),"light")
for z in (-151,319):
    rail((-215,-1,z),(185,-1,z),"silver")
    for x in range(-215,186,8):
        beam((x,-1,z),(x,1.6,z),.08)
    for y in (1,1.6):
        beam((-215,y,z),(185,y,z),.035,"silver")
for x in (-215,185):
    rail((x,-1,-151),(x,-1,319),"silver")
    for z in range(-151,320,8):
        beam((x,-1,z),(x,1.6,z),.08)
    for y in (1,1.6):
        beam((x,y,-151),(x,y,319),.035,"silver")

# Create editable, named facility/material meshes. Each becomes one draw call.
collections = {}
runtime_objects = []
for (facility, mat), (vertices, faces, smoothing) in BATCHES.items():
    if facility not in collections:
        collection=bpy.data.collections.new(facility)
        bpy.context.scene.collection.children.link(collection)
        collections[facility]=collection
    mesh=bpy.data.meshes.new(facility+" / "+mat)
    mesh.from_pydata(vertices,[],faces)
    mesh.materials.append(MATS[mat])
    mesh.update()
    for poly,smooth in zip(mesh.polygons,smoothing):
        poly.use_smooth=smooth
    obj=bpy.data.objects.new(mesh.name,mesh)
    collections[facility].objects.link(obj)
    runtime_objects.append(obj)


def label(text, location, size, collection):
    curve=bpy.data.curves.new(text,"FONT")
    curve.body=text
    curve.size=size
    curve.extrude=.006
    curve.align_x="CENTER"
    curve.align_y="CENTER"
    obj=bpy.data.objects.new(text,curve)
    collection.objects.link(obj)
    obj.location=point(location)
    obj.rotation_euler=(math.pi/2,0,math.pi)
    curve.materials.append(MATS["dark"])
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target="MESH")
    runtime_objects.append(bpy.context.object)


label("ASTROFORGE", (0,52.1,183.94),3.2,collections["04 Vehicle assembly building"])
label("01", (-29,40,183.59),6,collections["04 Vehicle assembly building"])
label("VAB", (29,11,183.59),3,collections["04 Vehicle assembly building"])
label("LC / 01", (-23,69,-9.55),1.3,collections["02 Service tower"])
for obj in runtime_objects:
    obj["asset_role"]="launch_complex"

ASSETS.mkdir(parents=True,exist_ok=True)
DESIGN.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for obj in runtime_objects:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ASSETS/"launch-complex.glb"),export_format="GLB",
                          use_selection=True,export_yup=True,export_texcoords=False,
                          export_normals=True,export_materials="EXPORT",export_extras=True)

triangles=0
for obj in runtime_objects:
    obj.data.calc_loop_triangles()
    triangles+=len(obj.data.loop_triangles)
stats={"blender":bpy.app.version_string,"meshes":len(runtime_objects),"triangles":triangles,
       "materials":len(MATS),"padContactY":0,"apronSurfaceY":-.845,
       "vabDoorZ":185,"transportCorridor":{"minZ":6,"maxZ":226,"width":28},
       "boundsMetres":{"x":[-215,185],"z":[-151,319]},"towerHeightMetres":84}
(DESIGN/"model-stats.json").write_text(json.dumps(stats,indent=2)+"\n")

# Presentation-only objects are excluded from the runtime GLB.
presentation=bpy.data.collections.new("Presentation - excluded from GLB")
bpy.context.scene.collection.children.link(presentation)
ground_mesh=bpy.data.meshes.new("Preview ground")
ground_mesh.from_pydata([(-1400,-1400,-1.13),(1400,-1400,-1.13),(1400,1400,-1.13),(-1400,1400,-1.13)],[],[(0,1,2,3)])
ground_mesh.materials.append(MATS["soil"])
ground=bpy.data.objects.new("Preview ground",ground_mesh)
presentation.objects.link(ground)
# A subtle procedural surface exists only on the presentation ground.
soil=MATS["soil"]
nodes=soil.node_tree.nodes
noise=nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value=.22
noise.inputs["Detail"].default_value=3
tex=nodes.new("ShaderNodeTexCoord")
soil.node_tree.links.new(tex.outputs["Object"],noise.inputs["Vector"])
ramp=nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color=(*linear("475541"),1)
ramp.color_ramp.elements[1].color=(*linear("78806a"),1)
soil.node_tree.links.new(noise.outputs["Fac"],ramp.inputs[0])
soil.node_tree.links.new(ramp.outputs[0],nodes.get("Principled BSDF").inputs["Base Color"])


def camera(name, pos, target, lens):
    data=bpy.data.cameras.new(name)
    data.lens=lens
    data.clip_end=5000
    obj=bpy.data.objects.new(name,data)
    presentation.objects.link(obj)
    obj.location=point(pos)
    obj.rotation_euler=(Vector(point(target))-obj.location).to_track_quat("-Z","Y").to_euler()
    return obj


overview=camera("Overview - connected VAB and pad",(380,285,-455),(-15,12,94),43)
detail=camera("Pad - service tower and pipework",(130,68,-58),(-16,35,-4),47)
scene=bpy.context.scene
scene.camera=overview
scene.render.engine="CYCLES"
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.render.resolution_x=1600
scene.render.resolution_y=1100
scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG"
scene.world.use_nodes=True
scene.world.node_tree.nodes["Background"].inputs[0].default_value=(.58,.7,.85,1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value=.45
sun_data=bpy.data.lights.new("Late afternoon sun","SUN")
sun_data.energy=3
sun_data.angle=.055
sun=bpy.data.objects.new("Late afternoon sun",sun_data)
presentation.objects.link(sun)
sun.rotation_euler=(.42,-.55,-.7)
scene.view_settings.view_transform="AgX"
scene.render.film_transparent=False
bpy.ops.object.select_all(action="DESELECT")
for area in bpy.context.screen.areas:
    if area.type=="VIEW_3D":
        area.spaces.active.region_3d.view_perspective="CAMERA"
        area.spaces.active.clip_end=5000
bpy.ops.wm.save_as_mainfile(filepath=str(DESIGN/"launch-complex.blend"))
print("LAUNCH_COMPLEX_STATS "+json.dumps(stats),flush=True)
parser=argparse.ArgumentParser()
parser.add_argument("--render",action="store_true")
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
if args.render:
    for cam,name in ((overview,"overview"),(detail,"pad-detail")):
        scene.camera=cam
        scene.render.filepath=str(DESIGN/(name+".png"))
        bpy.ops.render.render(write_still=True)
