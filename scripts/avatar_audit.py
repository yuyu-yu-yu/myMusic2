#!/usr/bin/env python
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def read_frames(video_path):
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open {video_path}")
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    indexes = sorted({0, max(0, total // 2), max(0, total - 2), max(0, total - 1)})
    frames = []
    next_target = 0
    frame_index = 0
    last_frame = None
    while next_target < len(indexes):
        ok, frame = capture.read()
        if not ok:
            break
        last_frame = frame
        if frame_index >= indexes[next_target]:
            frames.append(frame.copy())
            next_target += 1
        frame_index += 1
    capture.release()
    while len(frames) < len(indexes) and last_frame is not None:
        frames.append(last_frame.copy())
    return frames


def make_contact_sheet(frames):
    tiles = [cv2.resize(frame, (360, 360), interpolation=cv2.INTER_AREA) for frame in frames]
    while len(tiles) < 4:
        tiles.append(np.zeros((360, 360, 3), np.uint8))
    return np.hstack(tiles[:4])


def corner_white_ratio(frame):
    height, width = frame.shape[:2]
    region = frame[int(height * 0.78):, int(width * 0.72):]
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    near_white = (hsv[:, :, 1] < 35) & (hsv[:, :, 2] > 225)
    return float(near_white.mean())


def audit(video_paths, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    summary = {}
    for video_path in video_paths:
        frames = read_frames(video_path)
        if not frames:
            continue
        motion = video_path.stem
        contact = make_contact_sheet(frames)
        cv2.imwrite(str(output_dir / f"{motion}-contact.jpg"), contact)

        corners = []
        for frame in frames:
            height, width = frame.shape[:2]
            crop = frame[int(height * 0.72):, int(width * 0.68):]
            corners.append(cv2.resize(crop, (300, 260), interpolation=cv2.INTER_NEAREST))
        cv2.imwrite(str(output_dir / f"{motion}-corner.jpg"), np.hstack(corners))

        ratios = [corner_white_ratio(frame) for frame in frames]
        summary[motion] = {
            "contact_sheet": f"{motion}-contact.jpg",
            "corner_sheet": f"{motion}-corner.jpg",
            "max_near_white_corner_ratio": max(ratios),
            "watermark_check": "pass" if max(ratios) < 0.01 else "review",
        }
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("videos", nargs="+")
    args = parser.parse_args()
    summary = audit([Path(value) for value in args.videos], Path(args.output_dir))
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
