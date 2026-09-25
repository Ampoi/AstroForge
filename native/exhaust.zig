const std = @import("std");
const Vec = [3]f64;
const Particle = extern struct { position: Vec, velocity: Vec, age: f64, life: f64, size: f64, seed: f64 };
const Body = struct { start: Vec, axis: Vec, inverse_length: f64, low: Vec, high: Vec, radius: f64, velocity: Vec };
var particles: [2400]Particle = undefined;
var frame: [13]f64 = @splat(0); // shift, air velocity, up, ground, density, h, steps
var emitters: [80][10]f64 = undefined; // position, direction, velocity, throttle
var obstacles: [80][10]f64 = undefined; // start, end, radius, velocity
var bodies: [80]Body = undefined;
var count: u32 = 0;
var credit: f64 = 0;
var serial: u32 = 0;
export fn abi_version() u32 {
    return 1;
}
export fn particles_ptr() [*]Particle {
    return &particles;
}
export fn frame_ptr() [*]f64 {
    return &frame;
}
export fn emitters_ptr() [*][10]f64 {
    return &emitters;
}
export fn obstacles_ptr() [*][10]f64 {
    return &obstacles;
}
export fn particle_count() u32 {
    return count;
}
export fn clear() void {
    count = 0;
    credit = 0;
}
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
fn unit(a: Vec) Vec {
    const n = @sqrt(dot(a, a));
    return mul(a, 1 / (if (n > 0) n else 1));
}
fn clamp(x: f64, lo: f64, hi: f64) f64 {
    return @max(lo, @min(hi, x));
}
export fn step(emitter_count: u32, obstacle_count: u32, capacity: u32) u32 {
    if (emitter_count > 80 or obstacle_count > 80 or capacity > 2400 or count > capacity) return 0;
    for (frame) |x| {
        if (!std.math.isFinite(x)) return 0;
    }
    if (frame[11] <= 0 or frame[12] < 1 or frame[12] > 36 or @floor(frame[12]) != frame[12]) return 0;
    for (emitters[0..emitter_count]) |e| {
        for (e) |x| {
            if (!std.math.isFinite(x)) return 0;
        }
    }
    for (obstacles[0..obstacle_count], 0..) |o, i| {
        for (o) |x| {
            if (!std.math.isFinite(x)) return 0;
        }
        const axis = sub(o[3..6].*, o[0..3].*);
        const length = dot(axis, axis);
        var low: Vec = undefined;
        var high: Vec = undefined;
        for (0..3) |j| {
            low[j] = @min(o[j], o[3 + j]) - o[6];
            high[j] = @max(o[j], o[3 + j]) + o[6];
        }
        bodies[i] = .{ .start = o[0..3].*, .axis = axis, .inverse_length = 1 / (if (length > 0) length else 1), .low = low, .high = high, .radius = o[6], .velocity = o[7..10].* };
    }
    const shift: Vec = frame[0..3].*;
    const air: Vec = frame[3..6].*;
    const up: Vec = frame[6..9].*;
    const density = clamp(frame[10], 0, 1);
    const h = frame[11];
    for (0..@as(usize, @intFromFloat(frame[12]))) |_| {
        var index: usize = count;
        while (index > 0) {
            index -= 1;
            const p = &particles[index];
            p.age += h;
            if (p.age >= p.life) {
                count -= 1;
                p.* = particles[count];
                continue;
            }
            const mix = 1 - @exp(-density * (0.5 + p.age * 32) * h);
            p.velocity = add(p.velocity, mul(sub(air, p.velocity), mix));
            const eddy = density * @min(1, p.age * 5) * 7 * h;
            p.velocity[0] += @sin(p.seed + p.age * 13 + p.position[2] * 1.6) * eddy;
            p.velocity[2] += @cos(p.seed * 1.7 + p.age * 11 + p.position[0] * 1.6) * eddy;
            p.velocity = add(p.velocity, mul(up, density * 4 * h));
            p.position = sub(add(p.position, mul(p.velocity, h)), shift);
            const height = dot(p.position, up) + frame[9];
            if (height < 0.06 and density > 0.001) {
                p.position = add(p.position, mul(up, 0.06 - height));
                var normal = sub(p.position, mul(up, dot(p.position, up)));
                if (dot(normal, normal) < 0.01) {
                    normal = .{ @cos(p.seed), 0, @sin(p.seed) };
                    normal = sub(normal, mul(up, dot(normal, up)));
                }
                normal = unit(normal);
                const incoming = dot(sub(p.velocity, air), up);
                if (incoming < 0) p.velocity = add(add(p.velocity, mul(up, -incoming)), mul(normal, -incoming * 0.65));
            }
            for (bodies[0..obstacle_count]) |b| {
                const margin = p.size * 0.15;
                // Conservative capsule AABB rejection; sequential contacts still see corrected positions.
                if (p.position[0] < b.low[0] - margin or p.position[0] > b.high[0] + margin or
                    p.position[1] < b.low[1] - margin or p.position[1] > b.high[1] + margin or
                    p.position[2] < b.low[2] - margin or p.position[2] > b.high[2] + margin) continue;
                const t = clamp(dot(sub(p.position, b.start), b.axis) * b.inverse_length, 0, 1);
                const nearest = add(b.start, mul(b.axis, t));
                var normal = sub(p.position, nearest);
                const radius = b.radius + margin;
                const length = dot(normal, normal);
                if (length >= radius * radius) continue;
                if (length < 1e-10) normal = .{ @cos(p.seed), 0, @sin(p.seed) };
                normal = unit(normal);
                p.position = add(nearest, mul(normal, radius));
                const inward = dot(sub(p.velocity, b.velocity), normal);
                if (inward < 0) p.velocity = sub(p.velocity, mul(normal, inward));
            }
        }
        if (emitter_count == 0) {
            credit = 0;
            continue;
        }
        credit += h * @min(1500, 1200 * @as(f64, @floatFromInt(emitter_count)));
        while (credit >= 1 and count < capacity) {
            credit -= 1;
            const e = emitters[serial % emitter_count];
            const number: f64 = @floatFromInt(serial);
            serial +%= 1;
            const seed = number * 2.3999632297;
            const spread = @sqrt(@mod(number * 0.61803398875, 1));
            const direction: Vec = e[3..6].*;
            const tangent = unit(cross(if (@abs(direction[0]) > 0.9) .{ 0, 1, 0 } else .{ 1, 0, 0 }, direction));
            const side = cross(direction, tangent);
            const radial = add(mul(tangent, @cos(seed)), mul(side, @sin(seed)));
            const throttle = @sqrt(clamp(e[9], 0, 1));
            const speed = 72 * throttle * (1 - 0.58 * spread * spread);
            particles[count] = .{ .position = add(e[0..3].*, mul(radial, 0.38 * spread)), .velocity = add(add(e[6..9].*, mul(direction, speed)), mul(radial, (2 + 5 * (1 - density)) * spread)), .age = 0, .life = (0.65 + density * 0.9) * (0.35 + 0.65 * throttle), .size = (0.20 + 0.20 * spread) * throttle, .seed = seed };
            count += 1;
        }
        credit = @min(credit, 1);
    }
    return 1;
}
