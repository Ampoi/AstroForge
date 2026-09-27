"""Author AstroForge's mechanical parts in Blender and export indexed visuals.

blender --background --factory-startup --python scripts/build-blender-parts.py
All dimensions below are metres in runtime Y-up coordinates. The saved .blend
uses native Z-up, one editable collection per part, with named mechanical pieces.
No downloaded models, textures, fonts or Blender extensions are required.
"""
import base64
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src/assets/blender'
OUT.mkdir(parents=True, exist_ok=True)
EXPORT_EXISTING = '--export-blend' in sys.argv
if EXPORT_EXISTING:
    bpy.ops.wm.open_mainfile(filepath=str(Path(sys.argv[sys.argv.index('--export-blend')+1]).resolve()))
else:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for data in list(bpy.data.collections):
        bpy.data.collections.remove(data)

# The small, shared palette keeps the visual language of the existing parts.
PALETTE = {
    'ceramic': ('#dbe5e3', .28, .46),
    'alloy': ('#a7b8bc', .72, .32),
    'edge': ('#637b85', .65, .36),
    'dark': ('#293c47', .55, .42),
    'black': ('#111e27', .22, .56),
    'copper': ('#c89364', .72, .33),
    'amber': ('#e3ae58', .48, .38),
    'orange': ('#de8a64', .32, .45),
    'glass': ('#174b65', .62, .16),
    'rubber': ('#283034', .02, .86),
    'tread': ('#3b464a', .04, .74),
    'chassis': ('#b8c1ac', .50, .46),
    'solar': ('#276281', .52, .26),
    'solar_alt': ('#215470', .50, .29),
    'trace': ('#80b5c4', .65, .28),
}
MATS = {}
for name, (color, metal, rough) in PALETTE.items():
    if EXPORT_EXISTING:
        MATS[name] = bpy.data.materials[name]
        continue
    mat = bpy.data.materials.new(name)
    rgb = [int(color[i:i+2], 16)/255 for i in (1, 3, 5)]
    linear = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    mat.diffuse_color = (*linear, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*linear, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    MATS[name] = mat

CURRENT = None
PARENT = None
ROOTS = []


def part(name):
    global CURRENT, PARENT
    CURRENT = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(CURRENT)
    root = bpy.data.objects.new(name, None)
    CURRENT.objects.link(root)
    root['part_type'] = name
    root['units'] = 'metres'
    PARENT = root
    ROOTS.append(root)
    return root


def pivot(name, loc=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    obj = bpy.data.objects.new(name, None)
    CURRENT.objects.link(obj)
    obj.parent = PARENT
    obj.location, obj.rotation_euler, obj.scale = loc, rotation, scale
    obj['runtime_name'] = name
    return obj


def finish(obj, name, mat, bevel=0, smooth=False):
    obj.name = name
    for col in list(obj.users_collection):
        col.objects.unlink(obj)
    CURRENT.objects.link(obj)
    obj.parent = PARENT
    obj.data.materials.append(MATS[mat])
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
        obj.data.set_sharp_from_angle(angle=math.radians(38))
    if bevel:
        mod = obj.modifiers.new('Machined edge radii', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
    if bevel or smooth:
        mod = obj.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        mod.weight = 40
    return obj


def box(name, size, loc, mat='alloy', bevel=.008, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    # Bake dimensions without baking placement; bevel width is in metres.
    for v in obj.data.vertices:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    obj.location, obj.rotation_euler = loc, rot
    return finish(obj, name, mat, bevel)


def cylinder(name, radius, depth, loc, mat='alloy', axis=(0, 1, 0), vertices=48, bevel=.004):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    obj = bpy.context.object
    obj.location = loc
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(axis))
    return finish(obj, name, mat, bevel, True)


def lathe(name, profile, mat='alloy', loc=(0, 0, 0), axis=(0, 1, 0), segments=64, close=True):
    """Closed cross-section, oriented outward (r,y), including real inner walls."""
    verts = [(r*math.cos(2*math.pi*j/segments), y, r*math.sin(2*math.pi*j/segments))
             for r, y in profile for j in range(segments)]
    faces = []
    for i in range(len(profile) if close else len(profile)-1):
        k = (i+1) % len(profile)
        for j in range(segments):
            n = (j+1) % segments
            faces.append((i*segments+j, k*segments+j, k*segments+n, i*segments+n))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    obj.location = loc
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(Vector(axis))
    return finish(obj, name, mat, 0, True)


def ring(name, outer, inner, height, loc=(0, 0, 0), mat='alloy', axis=(0, 1, 0), bevel=.003, segments=32):
    # A small chamfer catches a highlight without hiding the central opening.
    b = min(bevel, height*.22, (outer-inner)*.22)
    return lathe(name, [(outer-b, -height/2), (outer, -height/2+b),
                       (outer, height/2-b), (outer-b, height/2),
                       (inner+b, height/2), (inner, height/2-b),
                       (inner, -height/2+b), (inner+b, -height/2)], mat, loc, axis, segments)


def tube(name, points, radius, mat='copper'):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 4
    curve.bevel_depth = radius
    curve.bevel_resolution = 1
    curve.use_fill_caps = True
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for bp, co in zip(spline.bezier_points, points):
        bp.co = co
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve)
    CURRENT.objects.link(obj)
    obj.parent = PARENT
    curve.materials.append(MATS[mat])
    return obj


def beam(name, a, b, radius=.02, mat='alloy'):
    a, b = Vector(a), Vector(b)
    return cylinder(name, radius, (b-a).length, (a+b)/2, mat, b-a, 16, radius*.15)


def bolt(name, loc, radius=.014, axis=(0, 1, 0), washer=True):
    p, d = Vector(loc), Vector(axis).normalized()
    if washer:
        ring(name+' washer', radius*1.45, radius*.48, radius*.23, p, 'edge', d, radius*.08, 12)
    cylinder(name+' hex', radius, radius*.65, p+d*radius*.30, 'alloy', d, 6, radius*.10)
    # Recess is an inset black hexagon, not a bright solid screw head.
    cylinder(name+' socket', radius*.43, radius*.035, p+d*radius*.64, 'black', d, 6, 0)


def bolt_circle(name, r, y, count=12, radius=.012):
    for i in range(count):
        a = i*2*math.pi/count
        bolt(f'{name} {i+1:02}', (r*math.cos(a), y, r*math.sin(a)), radius)


def radial_box(name, radius, y, angle, size, mat, bevel=.006):
    return box(name, size, (radius*math.sin(angle), y, radius*math.cos(angle)), mat, bevel, (0, angle, 0))


def docking():
    part('docking')
    box('Hull saddle', (.055, .205, .205), (.0275, 0, 0), 'edge', .012)
    box('Avionics housing', (.115, .187, .187), (.102, 0, 0), 'ceramic', .016)
    ring('Capture barrel', .117, .079, .082, (.185, 0, 0), 'dark', (1, 0, 0))
    ring('Machined capture lip', .132, .091, .024, (.244, 0, 0), 'alloy', (1, 0, 0))
    ring('Contact seal', .106, .089, .012, (.26, 0, 0), 'black', (1, 0, 0))
    cylinder('Recessed docking camera', .049, .012, (.215, 0, 0), 'glass', (1, 0, 0))
    ring('Optics surround', .058, .047, .009, (.225, 0, 0), 'edge', (1, 0, 0))
    for i in range(8):
        a = i*math.pi/4
        bolt('Capture fastener', (.259, .119*math.cos(a), .119*math.sin(a)), .007, (1, 0, 0), False)
    for i in range(3):
        a = i*2*math.pi/3
        obj = box('Capture guide / latch', (.041, .035, .019), (.275, .099*math.cos(a), .099*math.sin(a)), 'amber', .004)
        obj.rotation_euler.x = a
    for y in [-.063, .063]:
        for z in [-.063, .063]:
            bolt('Saddle attachment', (.165, y, z), .008, (1, 0, 0))
    box('Connector body', (.038, .038, .055), (.10, -.092, .07), 'dark', .006)
    tube('Camera harness', [(.073, -.1, .075), (.14, -.109, .08), (.18, -.08, .066)], .007, 'copper')


def pod():
    part('pod')
    lathe('Pressure shell', [(.605, -.515), (.624, -.50), (.323, .497), (.314, .505), (.30, .495), (.601, -.50)], 'ceramic')
    cylinder('Upper pressure bulkhead', .31, .035, (0, .48, 0), 'ceramic')
    lathe('Nose adapter', [(.32, .505), (.20, .625), (.16, .625), (.16, .59), (.29, .505)], 'ceramic')
    cylinder('Nose mating face', .20, .012, (0, .619, 0), 'alloy', bevel=.002)
    ring('Heatshield rim', .635, .535, .13, (0, -.56, 0), 'dark')
    cylinder('Aft bulkhead', .578, .026, (0, -.607, 0), 'black')
    for y, r in [(-.489, .620), (.49, .324)]:
        ring('Circumferential shell seam', r+.003, r-.012, .012, (0, y, 0), 'edge', bevel=.001)
    bolt_circle('Nose interface bolt', .169, .619, 8, .009)
    for i in range(24):
        a = i*math.pi/12
        bolt('Heatshield fastener', (.637*math.sin(a), -.556, .637*math.cos(a)), .011, (math.sin(a), 0, math.cos(a)))
    # Window layers follow the taper instead of floating over the capsule skin.
    slope = math.atan((.624-.32)/1.02)
    for x in [-.145, .145]:
        box('Window gasket', (.257, .263, .029), (x, .065, .431), 'black', .035, (-slope, 0, 0))
        box('Window titanium frame', (.238, .244, .032), (x, .067, .448), 'alloy', .032, (-slope, 0, 0))
        box('Inset cockpit glazing', (.196, .197, .022), (x, .070, .466), 'glass', .027, (-slope, 0, 0))
        for y in [-.027, .163]:
            for dx in [-.101, .101]:
                bolt('Window screw', (x+dx, y, .482-(y-.07)*.3), .007, (0, .29, .957), False)
    # Curved hatch on the port side with recessed gasket, hinges and handle.
    axis = Vector((-.956, .294, 0))
    p = Vector((-.474, -.14, 0))
    cylinder('Hatch pressure seal', .208, .029, p, 'black', axis)
    cylinder('Hatch surround', .197, .036, p+axis*.013, 'alloy', axis)
    cylinder('Hatch recessed centre', .169, .037, p+axis*.031, 'ceramic', axis)
    for z in [-.115, .115]:
        box('Hatch hinge', (.051, .091, .032), (-.509, -.14, z), 'edge', .006, (0, 0, -.30))
    beam('Hatch grab handle', (-.535, -.105, -.065), (-.552, -.159, -.065), .012, 'dark')
    for i in range(8):
        a = i*math.pi/4
        pos = p+axis*.055+Vector((.294*math.cos(a)*.184, .956*math.cos(a)*.184, math.sin(a)*.184))
        bolt('Hatch captive bolt', pos, .009, axis, False)
    for a in [math.pi*.52, math.pi, -math.pi*.52]:
        points = []
        for y in [-.47, -.2, .15, .46]:
            r = .624-(y+.515)/1.02*.304+.002
            points.append((r*math.sin(a), y, r*math.cos(a)))
        tube('Longitudinal panel joint', points, .0025, 'edge')
    for i in range(5):
        radial_box('Avionics cooling slot', .47, -.06+i*.027, math.pi, (.15, .011, .016), 'dark', .003)


def engine(kind):
    root = part(kind)
    accent = {'engine': 'alloy', 'booster_engine': 'copper', 'vacuum_engine': 'trace'}[kind]
    ring('Tank mounting flange', .60, .33, .065, (0, .4825, 0), 'alloy')
    lathe('Thrust frame cone', [(.52, .355), (.60, .455), (.58, .46), (.50, .375)], 'edge')
    ring('Thrust frame inner ring', .34, .255, .055, (0, .385, 0), 'dark')
    bolt_circle('Mount bolt', .554, .516, 16, .014)
    for i in range(4):
        a = i*math.pi/2+math.pi/4
        u = Vector((math.cos(a), 0, math.sin(a)))
        beam('Thrust frame strut', u*.46+Vector((0, .36, 0)), u*.25+Vector((0, .16, 0)), .031)
        beam('Gimbal actuator housing', u*.39+Vector((0, .32, 0)), u*.33+Vector((0, .18, 0)), .035, accent)
        beam('Gimbal actuator rod', u*.33+Vector((0, .18, 0)), u*.24+Vector((0, .11, 0)), .015)
    cylinder('Turbopump body', .10, .26, (.30, .26, 0), 'dark', (0, 0, 1))
    for z in [-.14, .14]:
        cylinder('Pump cover', .115, .025, (.30, .26, z), accent, (0, 0, 1))
    for sign in [-1, 1]:
        tube('Propellant inlet', [(sign*.39, .43, -.19), (sign*.40, .25, -.20), (sign*.29, .17, -.12), (sign*.19, .19, 0)], .027, accent)
        ring('Feed line collar', .037, .028, .045, (sign*.39, .39, -.19), 'alloy')
    global PARENT
    PARENT = pivot('engine-gimbal', (0, .24, 0))
    cylinder('Combustion chamber jacket', .21, .235, (0, -.0475, 0), 'dark')
    ring('Injector flange', .242, .12, .042, (0, .08, 0), accent)
    bolt_circle('Injector stud', .22, .105, 12, .012)
    # Runtime y=-.5 mouth, y=.24 throat. Separate inner wall and exit bead.
    profile = [(.46, -.74), (.44, -.70), (.35, -.58), (.25, -.41), (.176, -.26), (.15, -.11), (.18, 0)]
    if kind == 'booster_engine':
        profile = [(.46, -.74), (.45, -.70), (.375, -.57), (.275, -.40), (.20, -.25), (.175, -.11), (.20, 0)]
    elif kind == 'vacuum_engine':
        profile = [(.46, -.74), (.445, -.70), (.36, -.59), (.245, -.43), (.155, -.27), (.128, -.11), (.17, 0)]
    inner = [(r-.018, y+.005) for r, y in reversed(profile)]
    lathe('Regeneratively cooled nozzle bell', profile+inner, 'edge', segments=96)
    ring('Open nozzle exit reinforcement', .473, .437, .030, (0, -.743, 0), accent)
    # Fine meridional cooling channels are real mesh, visible at grazing angles.
    for i in range(32):
        a = i*2*math.pi/32
        tube('Nozzle cooling channel', [((r+.003)*math.cos(a), y, (r+.003)*math.sin(a)) for r, y in profile[:-1]], .0045, accent)
    for y, r in [(-.20, .172), (-.43, .267)]:
        if kind == 'vacuum_engine':
            r = .15 if y == -.20 else .247
        if kind == 'booster_engine':
            r = .198 if y == -.20 else .293
        ring('Cooling manifold', r+.015, r, .022, (0, y, 0), accent)
    tube('Nozzle coolant return', [(.21, .02, 0), (.27, -.09, 0), (.32, -.37, 0), (.29, -.43, 0)], .015, 'copper')
    PARENT = root


def decoupler():
    part('decoupler')
    ring('Separation ring web', .627, .523, .16, mat='amber')
    for y in [-.09, .09]:
        ring('Mating flange', .645, .515, .035, (0, y, 0), 'edge')
    ring('Break plane seal', .638, .61, .015, mat='black', bevel=.001)
    for i in range(16):
        a = i*math.pi/8
        radial_box('Latch recess', .629, 0, a, (.102, .125, .027), 'black')
        radial_box('Release clamp', .647, 0, a, (.064, .11, .028), 'amber' if i%2 else 'alloy', .009)
        bolt('Clamp pin', (.669*math.sin(a), .031, .669*math.cos(a)), .009, (math.sin(a), 0, math.cos(a)), False)
    bolt_circle('Upper separation bolt', .566, .100, 16, .014)
    for i in range(8):
        a = i*math.pi/4
        radial_box('Inner ejector spring housing', .516, 0, a, (.063, .127, .036), 'dark')
    tube('Pyrotechnic signal conduit', [(.634*math.sin(a), -.045, .634*math.cos(a)) for a in np.linspace(0, 2*math.pi, 49)], .008, 'copper')


def fin():
    part('fin')
    outline = [(0, .44), (.16, .38), (.93, -.40), (.93, -.53), (0, -.43)]
    def panel(name, points, thickness, mat, z=0, bevel=.007):
        verts = [(x, y, z+s*thickness/2) for s in [-1, 1] for x, y in points]
        n = len(points)
        faces = [tuple(range(n)), tuple(range(2*n-1, n-1, -1))]
        faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
        # Points follow a clockwise contour: reverse the cap/edge winding.
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        CURRENT.objects.link(obj)
        return finish(obj, name, mat, bevel)
    panel('Tapered delta wing skin', outline, .055, 'ceramic')
    panel('Leading edge thermal strip', [(0, .44), (.16, .38), (.93, -.4), (.88, -.405), (.135, .335), (0, .393)], .059, 'alloy', bevel=.004)
    panel('Trailing edge reinforcement', [(0, -.39), (.93, -.49), (.93, -.53), (0, -.43)], .058, 'edge', bevel=.003)
    panel('Orange wingtip cap', [(.845, -.316), (.93, -.40), (.93, -.53), (.845, -.521)], .061, 'orange', bevel=.004)
    box('Root spar', (.105, .79, .101), (.018, -.005, 0), 'edge', .012)
    for side in [-1, 1]:
        panel('Inset service panel', [(.12, .21), (.19, .18), (.68, -.315), (.12, -.28)], .006, 'alloy', side*.031, .008)
        for x, y in [(.137, .165), (.137, -.23), (.58, -.279), (.25, .09)]:
            bolt('Wing skin flush fastener', (x, y, side*.038), .008, (0, 0, side), False)
        for y in [-.32, -.10, .13, .33]:
            bolt('Root spar bolt', (.02, y, side*.052), .012, (0, 0, side))
        tube('Wing panel joint', [(.1, -.32, side*.032), (.40, -.35, side*.032), (.8, -.394, side*.032)], .002, 'dark')


def battery():
    part('battery')
    cylinder('Power bank pressure case', .62, .25, (0, 0, 0), 'dark')
    for y in [-.14, .14]:
        ring('Stack interface ring', .633, .51, .04, (0, y, 0), 'alloy')
    cylinder('Upper service lid', .516, .014, (0, .13, 0), 'edge')
    cylinder('Lower service lid', .516, .014, (0, -.13, 0), 'edge')
    bolt_circle('Stack fastener', .577, .153, 16, .010)
    for i in range(12):
        a = i*math.pi/6
        radial_box('Module gasket', .622, 0, a, (.211, .18, .014), 'black')
        radial_box('Cell module cover', .632, 0, a, (.183, .151, .022), 'copper' if i%3 == 0 else 'edge')
        for y in [-.047, -.016, .016, .047]:
            radial_box('Module cooling groove', .645, y, a, (.133, .008, .006), 'black', .002)
        for dx in [-.075, .075]:
            p = Vector((.65*math.sin(a), .061, .65*math.cos(a)))+Vector((math.cos(a), 0, -math.sin(a)))*dx
            bolt('Cover screw', p, .006, (math.sin(a), 0, math.cos(a)), False)
    box('Service connector plate', (.23, .011, .115), (.23, .144, 0), 'dark', .009)
    for x, mat in [(.17, 'copper'), (.28, 'alloy')]:
        cylinder('Recessed power connector', .024, .012, (x, .154, 0), mat, vertices=12, bevel=.002)
    for i in range(4):
        box('Charge indicator lens', (.022, .035, .008), (-.048+i*.032, .02, .650), 'trace', .003)


def chassis():
    part('chassis')
    # Original 4 x 1.8 m deck retained; boxed rails, bays and gussets show structure.
    box('Lower sandwich deck', (1.66, 3.90, .12), (0, 0, -.12), 'chassis', .025)
    for x in [-.835, .835]:
        box('Outer boxed longitudinal rail', (.13, 4, .45), (x, 0, 0), 'edge', .025)
        box('Rail wear strip', (.10, 3.91, .026), (x, 0, .241), 'alloy', .006)
        for y in [-1.7, -.85, 0, .85, 1.7]:
            box('Suspension mounting doubler', (.023, .25, .30), (x+math.copysign(.073, x), y, 0), 'alloy', .013)
            for dy in [-.08, .08]:
                for z in [-.09, .09]:
                    bolt('Suspension mount bolt', (x+math.copysign(.09, x), y+dy, z), .016, (math.copysign(1, x), 0, 0))
    for y in [-1.87, -.65, .65, 1.87]:
        box('Crossmember', (1.64, .13, .32), (0, y, -.01), 'chassis', .018)
        box('Crossmember cap', (1.62, .10, .025), (0, y, .21), 'amber', .008)
    for y in [-1.26, 0, 1.26]:
        box('Equipment bay lid gasket', (1.49, 1.08, .055), (0, y, .17), 'black', .018)
        box('Equipment bay service lid', (1.44, 1.03, .055), (0, y, .199), 'chassis', .018)
        for x in [-.65, .65]:
            for dy in [-.43, 0, .43]:
                bolt('Deck captive fastener', (x, y+dy, .23), .014, (0, 0, 1))
        for x in [-.15, .15]:
            box('Recessed lift handle', (.018, .20, .009), (x, y, .230), 'dark', .003)
        for dx in [-.46, .46]:
            for dy in [-.24, -.16, -.08, 0, .08, .16, .24]:
                box('Deck ventilation slot', (.17, .025, .009), (dx, y+dy, .23), 'dark', .008)
    # Underbody X braces, readable when assembling a rover upside down.
    for y in [-1.25, 0, 1.25]:
        beam('Underbody diagonal brace', (-.73, y-.49, -.205), (.73, y+.49, -.205), .035, 'alloy')
        beam('Underbody diagonal brace', (.73, y-.49, -.205), (-.73, y+.49, -.205), .035, 'alloy')
    for x in [-.66, .66]:
        for y in [-1.94, 1.94]:
            ring('Tie-down eye', .055, .030, .027, (x, y, .12), 'alloy', (0, 1, 0))


def rcs():
    part('rcs')
    box('Mounting foot', (.06, .245, .235), (0, 0, 0), 'edge', .009)
    box('Insulated valve block', (.22, .233, .223), (.083, 0, 0), 'ceramic', .023)
    box('Valve block cover', (.021, .191, .181), (.204, 0, 0), 'alloy', .012)
    for y in [-.069, .069]:
        for z in [-.065, .065]:
            bolt('Valve cover bolt', (.218, y, z), .009, (1, 0, 0), False)
    for i, direction in enumerate([(1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]):
        axis = Vector(direction)
        center = Vector((.08, 0, 0))+axis*.17
        lathe(f'Thruster {i+1} hollow bell', [(.031, -.065), (.039, -.012), (.063, .065), (.051, .065), (.028, -.014), (.022, -.065)], 'edge', center, direction, 48)
        ring('Nozzle exit lip', .065, .051, .009, center+axis*.062, 'alloy', direction)
        ring('Valve collar', .044, .028, .023, center-axis*.025, 'copper', direction)
        cylinder('Dark recessed throat', .021, .002, center-axis*.056, 'black', direction, 32, 0)
    tube('Propellant supply line', [(-.02, -.095, -.08), (.03, -.10, -.10), (.135, -.091, -.102)], .008, 'copper')


def wheel():
    root = part('wheel')
    box('Hull suspension bracket', (.15, .25, .2), (0, 0, 0), 'alloy', .019)
    for y in [-.085, .085]:
        bolt('Suspension bracket bolt', (.079, y, 0), .016, (1, 0, 0))
    global PARENT
    suspension = pivot('suspension', (.32, 0, -.55))
    PARENT = suspension
    box('Lower wishbone', (.32, .09, .085), (-.13, 0, 0), 'alloy', .013)
    cylinder('Steering knuckle', .077, .20, (-.10, 0, .015), 'dark', (0, 0, 1))
    steering = pivot('steering')
    PARENT = steering
    cylinder('Drive motor housing', .15, .18, (-.12, 0, 0), 'edge', (1, 0, 0))
    for i in range(12):
        a = i*math.pi/6
        obj = box('Motor cooling fin', (.16, .025, .040), (-.16, .14*math.cos(a), .14*math.sin(a)), 'alloy', .005)
        obj.rotation_euler.x = a
    tire = pivot('tire')
    PARENT = tire
    lathe('Rounded rubber tire carcass', [(.245, -.135), (.32, -.151), (.403, -.146), (.432, -.115), (.441, -.07), (.441, .07), (.432, .115), (.403, .146), (.32, .151), (.245, .135)], 'rubber', axis=(1, 0, 0), segments=96)
    for i in range(36):
        a = i*2*math.pi/36
        # Alternating shoulder lugs give the tire a chevron tread silhouette.
        for sign in [-1, 1]:
            tread = box('Chevron tread lug', (.131, .053, .020), (sign*.070, .438*math.cos(a), .438*math.sin(a)), 'tread', .006)
            tread.rotation_euler = (a-math.pi/2, 0, sign*.26)
    for side in [-1, 1]:
        axis = (side, 0, 0)
        ring('Rim bead lock', .275, .214, .023, (side*.145, 0, 0), 'alloy', axis)
        ring('Sidewall moulding outer', .363, .353, .004, (side*.151, 0, 0), 'tread', axis, .0005)
        cylinder('Recessed hub backing', .212, .018, (side*.131, 0, 0), 'dark', axis)
        cylinder('Hub centre', .101, .047, (side*.152, 0, 0), 'edge', axis)
        cylinder('Axle dust cap', .071, .020, (side*.181, 0, 0), 'amber', axis)
        for i in range(8):
            a = i*math.pi/4
            beam('Wheel spoke', (side*.15, .10*math.cos(a), .10*math.sin(a)), (side*.144, .220*math.cos(a+.12), .220*math.sin(a+.12)), .029, 'alloy')
            bolt('Hub lug', (side*.181, .130*math.cos(a), .130*math.sin(a)), .012, axis, False)
        for i in range(16):
            a = i*math.pi/8
            bolt('Bead lock fastener', (side*.160, .247*math.cos(a), .247*math.sin(a)), .009, axis, False)
    PARENT = root
    # The existing runtime stretches local Y, then rotates this pivot into Z.
    spring = pivot('spring', (.15, 0, -.275), (math.pi/2, 0, 0), (1, .55, 1))
    PARENT = spring
    cylinder('Damper piston rod', .026, .97, (0, 0, 0), 'alloy')
    cylinder('Damper cylinder', .055, .49, (0, -.22, 0), 'dark')
    points = [(.081*math.cos(i/160*math.pi*16), i/160*.87-.435, .081*math.sin(i/160*math.pi*16)) for i in range(161)]
    tube('Eight turn suspension coil', points, .014, 'amber')
    for y in [-.455, .455]:
        cylinder('Spring seat', .106, .048, (0, y, 0), 'edge')
    PARENT = root


def solar():
    part('solar')
    box('Hull mounting plate', (.04, .15, .18), (.005, 0, 0), 'edge', .008)
    box('Panel support boom', (.25, .065, .065), (.10, 0, 0), 'alloy', .009)
    cylinder('Root hinge barrel', .054, .15, (.211, 0, 0), 'edge', (0, 1, 0))
    for y in [-.083, .083]:
        cylinder('Hinge end cap', .059, .018, (.211, y, 0), 'amber')
        bolt('Hinge pivot bolt', (.211, y, 0), .016, (0, math.copysign(1, y), 0), False)
    box('Composite array substrate', (1.12, .687, .033), (.76, 0, 0), 'dark', .008)
    for y in [-.35, .35]:
        box('Long edge extrusion', (1.15, .025, .065), (.76, y, 0), 'alloy', .005)
    for x in [.1975, .76, 1.3225]:
        box('Cross edge extrusion', (.025, .68, .065), (x, 0, 0), 'alloy', .005)
    for side in [-1, 1]:
        # Discrete clipped cells, interconnects and busbars on both faces.
        for col in range(8):
            for row in range(4):
                x, y = .278+col*.138, -.255+row*.17
                box('Photovoltaic cell', (.125, .157, .007), (x, y, side*.022), 'solar' if (row+col)%3 else 'solar_alt', .006)
                for dy in [-.045, 0, .045]:
                    box('Cell collector trace', (.114, .0018, .0015), (x, y+dy, side*.0265), 'trace', 0)
                box('Cell busbar', (.003, .15, .0018), (x-.043, y, side*.027), 'alloy', 0)
        for x in [.203, .76, 1.317]:
            for y in [-.341, .341]:
                bolt('Panel frame screw', (x, y, side*.034), .006, (0, 0, side), False)
    tube('Panel electrical harness', [(.02, -.042, -.037), (.12, -.058, -.055), (.23, -.06, -.050), (.30, -.12, -.038)], .005, 'copper')


def encoded(array, dtype):
    return base64.b64encode(np.asarray(array, dtype=dtype).tobytes()).decode('ascii')


def export(root):
    """Bake bevels/normals and batch by material inside each animated pivot."""
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    objects = list(CURRENT.objects)
    nodes = []
    buckets = {}
    used_materials = []
    for obj in objects:
        if obj == root:
            continue
        if obj.type == 'EMPTY':
            nodes.append({'name': obj['runtime_name'], 'parent': obj.parent.get('runtime_name', 'fixed'),
                          'position': list(obj.location), 'rotation': list(obj.rotation_euler), 'scale': list(obj.scale)})
            continue
        if obj.type not in {'MESH', 'CURVE'}:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        group = obj.parent
        transform = group.matrix_world.inverted() @ obj.matrix_world
        normal_matrix = transform.to_3x3().inverted().transposed()
        positions = [transform @ v.co for v in mesh.vertices]
        normals = [normal_matrix @ n.vector for n in mesh.corner_normals]
        for normal in normals:
            normal.normalize()
        material = obj.data.materials[0].name
        if material not in used_materials:
            used_materials.append(material)
        bucket = buckets.setdefault((group.get('runtime_name', 'fixed'), material), [])
        for tri in mesh.loop_triangles:
            for loop in tri.loops:
                bucket.append((*positions[mesh.loops[loop].vertex_index], *normals[loop]))
        evaluated.to_mesh_clear()
    chunks = []
    for (group, material), values in buckets.items():
        triangles = np.round(np.array(values), 6).reshape(-1, 3, 6)
        edges = np.cross(triangles[:, 1, :3]-triangles[:, 0, :3], triangles[:, 2, :3]-triangles[:, 0, :3])
        # Bevel intersections can collapse to zero area at export precision.
        triangles = triangles[np.sum(edges*edges, axis=1) > 1e-20]
        vertices, indices = np.unique(triangles.reshape(-1, 6), axis=0, return_inverse=True)
        assert len(vertices) < 65536, (root.name, group, material, len(vertices))
        chunks.append({'group': group, 'material': used_materials.index(material),
                       'position': encoded(vertices[:, :3], '<f4'),
                       'normal': encoded(np.rint(vertices[:, 3:]*32767), '<i2'),
                       'index': encoded(indices, '<u2')})
    def material_data(name):
        bsdf = bpy.data.materials[name].node_tree.nodes.get('Principled BSDF')
        rgb = bsdf.inputs['Base Color'].default_value[:3]
        srgb = [round(255*max(0, min(1, 12.92*v if v <= .0031308 else 1.055*v**(1/2.4)-.055))) for v in rgb]
        return dict(name=name, color='#'+''.join(f'{c:02x}' for c in srgb),
                    metalness=bsdf.inputs['Metallic'].default_value,
                    roughness=bsdf.inputs['Roughness'].default_value)
    data = {'materials': [material_data(n) for n in used_materials],
            'nodes': nodes, 'chunks': chunks}
    path = OUT / f'{root.name}.json'
    path.write_text(json.dumps(data, separators=(',', ':'))+'\n')
    count = sum(len(base64.b64decode(c['index']))//6 for c in chunks)
    print(f'EXPORTED {root.name}: {count} triangles, {len(chunks)} draw calls', flush=True)
    return {'triangles': count, 'drawCalls': len(chunks), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


manifest = {'blender': bpy.app.version_string, 'generator': 'scripts/build-blender-parts.py',
            'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'coordinates': 'metres; runtime +Y nose, radial +X outward', 'models': {}}
if EXPORT_EXISTING:
    for root in [obj for obj in bpy.data.objects if 'part_type' in obj]:
        CURRENT = bpy.data.collections[root['part_type']]
        root.location = (0, 0, 0)
        root.rotation_euler = (0, 0, 0)
        manifest['models'][root['part_type']] = export(root)
else:
    for builder in [docking, pod, lambda: engine('engine'), lambda: engine('booster_engine'), lambda: engine('vacuum_engine'), decoupler, fin, battery, chassis, rcs, wheel, solar]:
        builder()
        manifest['models'][ROOTS[-1].name] = export(ROOTS[-1])
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
if EXPORT_EXISTING:
    print('Exported edited Blender library without modifying the source file.', flush=True)
    # Blender itself owns shutdown after the script completes.
else:
    # Save the editable mechanical pieces, not just the merged runtime meshes.
    # Lay out a library on a floor for inspection; exporting uses local part origins.
    for i, root in enumerate(ROOTS):
        root.rotation_euler.x = math.pi/2
        root.location = ((i%4)*3.5, (i//4)*5.0, 2.1)
        root['runtime_origin'] = 'Root local origin, before library layout / Y-up conversion'
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.length_unit = 'METERS'
    bpy.context.scene.world.color = (.18, .18, .18)
    # Open with useful material colours and the entire library framed.
    bpy.ops.object.select_all(action='DESELECT')
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.shading.type = 'MATERIAL'
                area.spaces.active.region_3d.view_distance = 22
                area.spaces.active.region_3d.view_location = (5, 5, 2)
                area.spaces.active.clip_end = 1000
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/blender/astroforge-parts.blend'), compress=True)
    print('Saved editable Blender library.', flush=True)
