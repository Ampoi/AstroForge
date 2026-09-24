const std = @import("std");

// Fixed, versioned f64 ABI shared with server/physics-kernel.js. No allocation,
// imports, retained vessel state or memory growth. Calls are synchronous.
const Vec = [3]f64;
const Quat = [4]f64;
const State = [13]f64;
const max_fins = 80;
const header_len = 43;
const fin_stride = 7; // position xyz, normal xyz, area
var input: [header_len + max_fins * fin_stride]f64 = @splat(0);
var output: [13]f64 = @splat(0);

export fn abi_version() u32 {
    return 1;
}
export fn input_ptr() [*]f64 {
    return &input;
}
export fn output_ptr() [*]f64 {
    return &output;
}
export fn input_len() u32 {
    return input.len;
}
export fn output_len() u32 {
    return output.len;
}

const earth_radius = 6371000;
const mu = 3.986004418e14;
const spin = 7.292115e-5;
const area = std.math.pi * 0.625 * 0.625;
const layers = [_]f64{ 0, 11000, 20000, 32000, 47000, 51000, 71000, 84852 };
const lapse = [_]f64{ -0.0065, 0, 0.001, 0.0028, 0, -0.0028, -0.002 };
const Atmosphere = struct { density: f64, pressure: f64, temperature: f64, sound: f64 };
const bases = blk: {
    @setEvalBranchQuota(10000);
    var values: [8][2]f64 = undefined;
    values[0] = .{ 288.15, 101325 };
    for (lapse, 0..) |l, i| {
        const t = values[i][0];
        const p = values[i][1];
        const dh = layers[i + 1] - layers[i];
        const next = t + l * dh;
        values[i + 1] = .{ next, p * (if (l != 0) std.math.pow(f64, t / next, 9.80665 / (287.05287 * l)) else @exp(-9.80665 * dh / (287.05287 * t))) };
    }
    break :blk values;
};

fn add(a: Vec, b: Vec) Vec {
    return .{ a[0] + b[0], a[1] + b[1], a[2] + b[2] };
}
fn sub(a: Vec, b: Vec) Vec {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn mul(a: Vec, k: f64) Vec {
    return .{ a[0] * k, a[1] * k, a[2] * k };
}
fn dot(a: Vec, b: Vec) f64 {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
fn cross(a: Vec, b: Vec) Vec {
    return .{ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
}
fn norm(a: Vec) f64 {
    return @sqrt(dot(a, a));
}
fn unit(a: Vec) Vec {
    const n = norm(a);
    return mul(a, 1 / (if (n != 0) n else 1));
}
fn clamp(x: f64, lo: f64, hi: f64) f64 {
    return @max(lo, @min(hi, x));
}
fn qnorm(q: Quat) Quat {
    const n = @sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    const k = 1 / (if (n != 0) n else 1);
    return .{ q[0] * k, q[1] * k, q[2] * k, q[3] * k };
}
fn rotate(q: Quat, v: Vec) Vec {
    const axis: Vec = q[0..3].*;
    const t = mul(cross(axis, v), 2);
    return add(v, add(mul(t, q[3]), cross(axis, t)));
}
fn matVec(m: [9]f64, v: Vec) Vec {
    return .{ dot(m[0..3].*, v), dot(m[3..6].*, v), dot(m[6..9].*, v) };
}

fn atmosphere(alt: f64) Atmosphere {
    if (alt >= 150000) return .{ .density = 0, .pressure = 0, .temperature = 186.87, .sound = 274 };
    const h = earth_radius * @max(0, alt) / (earth_radius + @max(0, alt));
    var i: usize = 0;
    while (i < layers.len - 1 and h >= layers[i + 1]) : (i += 1) {}
    var t = bases[i][0];
    var p = bases[i][1];
    if (i < lapse.len) {
        const l = lapse[i];
        const next = t + l * (h - layers[i]);
        p *= if (l != 0) std.math.pow(f64, t / next, 9.80665 / (287.05287 * l)) else @exp(-9.80665 * (h - layers[i]) / (287.05287 * t));
        t = next;
    } else {
        p *= @exp(-(h - layers[i]) / 6500) * clamp((150000 - alt) / 30000, 0, 1);
    }
    return .{ .density = p / (287.05287 * t), .pressure = p, .temperature = t, .sound = @sqrt(1.4 * 287.05287 * t) };
}

const Aero = struct { force: Vec, torque: Vec, q: f64, mach: f64, aoa: f64, drag: f64 };
fn applyNormal(result: *Aero, vb: Vec, omega: Vec, density: f64, point: Vec, normal: Vec, a: f64, slope: f64) void {
    const r = sub(point, input[14..17].*);
    const v = add(vb, cross(omega, r));
    const speed = norm(v);
    if (speed < 0.001) return;
    const incidence = dot(v, normal) / speed;
    const f = mul(normal, -0.5 * density * speed * speed * a * clamp(slope * incidence, -1.8, 1.8));
    result.force = add(result.force, f);
    result.torque = add(result.torque, cross(r, f));
}
fn aerodynamic(s: State, fin_count: usize) Aero {
    const position: Vec = s[0..3].*;
    const velocity: Vec = s[3..6].*;
    const q: Quat = s[6..10].*;
    const omega: Vec = s[10..13].*;
    const atm = atmosphere(norm(position) - earth_radius);
    const relative = sub(velocity, cross(.{ 0, 0, spin }, position));
    const vb = rotate(.{ -q[0], -q[1], -q[2], q[3] }, relative);
    const speed = norm(vb);
    const dynamic_pressure = 0.5 * atm.density * speed * speed;
    const aoa = if (speed > 1) std.math.acos(clamp(vb[0] / speed, -1, 1)) else 0;
    const mach = speed / atm.sound;
    const transonic = (mach - 1.05) / 0.35;
    const cd = 0.25 + 0.32 * @exp(-transonic * transonic) + 0.65 * @sin(aoa) * @sin(aoa);
    const direction = unit(vb);
    var result = Aero{ .force = mul(direction, -dynamic_pressure * cd * area), .torque = .{ 0, 0, 0 }, .q = dynamic_pressure, .mach = mach, .aoa = aoa, .drag = 0 };
    const nose: Vec = .{ input[35] * 0.75, 0, 0 };
    applyNormal(&result, vb, omega, atm.density, nose, .{ 0, 1, 0 }, area, 2);
    applyNormal(&result, vb, omega, atm.density, nose, .{ 0, 0, 1 }, area, 2);
    for (0..fin_count) |i| {
        const offset = header_len + i * fin_stride;
        const fin = input[offset..][0..fin_stride];
        applyNormal(&result, vb, omega, atm.density, fin[0..3].*, fin[3..6].*, fin[6], 4.5);
        result.force = add(result.force, mul(direction, -dynamic_pressure * fin[6] * 0.018));
    }
    result.drag = -dot(result.force, direction);
    return result;
}

fn derivative(s: State, fin_count: usize) State {
    var normalized = s;
    const q = qnorm(s[6..10].*);
    normalized[6..10].* = q;
    const aero = aerodynamic(normalized, fin_count);
    const position: Vec = s[0..3].*;
    const w: Vec = s[10..13].*;
    const r = norm(position);
    const acceleration = add(mul(position, -mu / (r * r * r)), mul(rotate(q, add(input[36..39].*, aero.force)), 1 / input[13]));
    const angular = matVec(input[26..35].*, sub(add(input[39..42].*, aero.torque), cross(w, matVec(input[17..26].*, w))));
    const dq = mul(add(mul(w, q[3]), cross(q[0..3].*, w)), 0.5);
    return s[3..6].* ++ acceleration ++ dq ++ [1]f64{-0.5 * dot(q[0..3].*, w)} ++ angular;
}
fn offsetState(s: State, k: State, dt: f64) State {
    var result: State = undefined;
    for (&result, s, k) |*out, value, change| out.* = value + change * dt;
    return result;
}
fn validInput(fin_count: u32) bool {
    if (fin_count > max_fins) return false;
    for (input[0 .. header_len + fin_count * fin_stride]) |x| if (!std.math.isFinite(x)) return false;
    return input[13] > 0 and norm(input[0..3].*) > 0;
}
fn finiteOutput(length: usize) bool {
    for (output[0..length]) |x| if (!std.math.isFinite(x)) return false;
    return true;
}
// Return 0 on invalid input/non-finite results; caller retains the last valid state.
export fn integrate(fin_count: u32) u32 {
    if (!validInput(fin_count) or input[42] <= 0) return 0;
    const start: State = input[0..13].*;
    const dt = input[42];
    const k1 = derivative(start, fin_count);
    const k2 = derivative(offsetState(start, k1, dt / 2), fin_count);
    const k3 = derivative(offsetState(start, k2, dt / 2), fin_count);
    const k4 = derivative(offsetState(start, k3, dt), fin_count);
    for (&output, start, k1, k2, k3, k4) |*out, value, a, b, c, d| out.* = value + dt * (a + 2 * b + 2 * c + d) / 6;
    return @intFromBool(finiteOutput(13));
}
export fn evaluate_aero(fin_count: u32) u32 {
    if (!validInput(fin_count)) return 0;
    const result = aerodynamic(input[0..13].*, fin_count);
    output[0..10].* = result.force ++ result.torque ++ [4]f64{ result.q, result.mach, result.aoa, result.drag };
    return @intFromBool(finiteOutput(10));
}
export fn evaluate_atmosphere(alt: f64) u32 {
    if (!std.math.isFinite(alt)) return 0;
    const result = atmosphere(alt);
    output[0..4].* = .{ result.density, result.pressure, result.temperature, result.sound };
    return @intFromBool(finiteOutput(4));
}
