/**
 * UUID v7 (time-ordered) generator
 *
 * UUIDv7 encodes a Unix timestamp in the first 48 bits, followed by
 * random bits. This makes them time-sortable, which is good for
 * database primary keys (reduced index fragmentation).
 *
 * Format: 01932c1b-0000-7abc-8000-a1b2c3d4e5f6
 */

import { randomBytes } from "node:crypto";

export function v7(): string {
  // Get current timestamp in milliseconds
  const timestamp = Date.now();

  // Generate 10 random bytes for the remaining bits
  const random = randomBytes(10);

  // UUID v7 layout (per RFC 9562):
  // - 48 bits: Unix timestamp in milliseconds (big-endian)
  // - 4 bits: version = 0x7
  // - 12 bits: rand_a
  // - 2 bits: variant = 0b10
  // - 62 bits: rand_b

  const hex = [
    // bytes 0-5: timestamp (48 bits)
    ((timestamp >> 40) & 0xff).toString(16).padStart(2, "0"),
    ((timestamp >> 32) & 0xff).toString(16).padStart(2, "0"),
    ((timestamp >> 24) & 0xff).toString(16).padStart(2, "0"),
    ((timestamp >> 16) & 0xff).toString(16).padStart(2, "0"),
    ((timestamp >> 8) & 0xff).toString(16).padStart(2, "0"),
    (timestamp & 0xff).toString(16).padStart(2, "0"),

    // bytes 6-7: version (0x7) + rand_a (12 bits)
    ((0x7 << 4) | (random[0] & 0x0f)).toString(16).padStart(2, "0"),
    random[1].toString(16).padStart(2, "0"),

    // bytes 8-9: variant (0b10) + rand_b (first 14 bits)
    ((0x80 | (random[2] & 0x3f)).toString(16).padStart(2, "0")),
    (random[3] | random[4] | random[5] | random[6] | random[7] | random[8] | random[9])
      .toString(16)
      .padStart(2, "0"),
  ].join("");

  // Format as standard UUID
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
