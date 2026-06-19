#!/usr/bin/env python3

import base64
import json
import os
import sys
from pathlib import Path

from PIL import Image

WIDTH = 384
TARGET_MESSAGE_INDEXES = [31, 32, 33, 34, 35]


def decode_rows_from_packets(raw_packets):
    selected = []
    for index, b64 in enumerate(raw_packets, start=1):
        if index not in TARGET_MESSAGE_INDEXES:
            continue
        packet = base64.b64decode(b64)
        if len(packet) < 5 or packet[1] != 0x2B:
            continue
        payload = packet[4:]
        bits = []
        for x in range(WIDTH):
            byte = payload[x // 8]
            bit = 7 - (x % 8)
            bits.append((byte >> bit) & 1)
        selected.append({"messageIndex": index, "bits": bits})
    return selected


def variant_original(bits):
    return bits


def variant_left_clipped(bits):
    return [0 if x < 24 else bit for x, bit in enumerate(bits)]


def variant_hollow_left(bits):
    out = []
    for x, bit in enumerate(bits):
        if x < 48 and x % 2 == 0:
            out.append(0)
        else:
            out.append(bit)
    return out


def variant_shifted_right(bits):
    out = [0] * len(bits)
    for x, bit in enumerate(bits):
        if bit != 1:
            continue
        nxt = x + 8
        if nxt < len(bits):
            out[nxt] = 1
    return out


VARIANTS = {
    "original": variant_original,
    "left-clipped": variant_left_clipped,
    "hollow-left": variant_hollow_left,
    "shifted-right": variant_shifted_right,
}


def render_rows_to_png(rows, file_path: Path):
    height = len(rows)
    image = Image.new("L", (WIDTH, height), 255)
    px = image.load()
    for y, row in enumerate(rows):
        for x, bit in enumerate(row):
            if bit == 1:
                px[x, y] = 0
    image.save(file_path)


def main():
    packets_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/c91e50af-packets.json")
    output_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/tuckmark-trigger-variants")
    output_dir.mkdir(parents=True, exist_ok=True)

    packet_json = json.loads(packets_path.read_text())
    decoded_rows = decode_rows_from_packets(packet_json["packets"])

    manifest = []
    for name, transform in VARIANTS.items():
        rows = [transform(row["bits"]) for row in decoded_rows]
        file_path = output_dir / f"{name}.png"
        render_rows_to_png(rows, file_path)
        manifest.append(
            {
                "name": name,
                "filePath": str(file_path),
                "rows": [row["messageIndex"] for row in decoded_rows],
            }
        )

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"outputDir": str(output_dir), "manifestPath": str(manifest_path), "manifest": manifest}, indent=2))


if __name__ == "__main__":
    main()
