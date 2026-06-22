#!/usr/bin/env python
import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort


OUTPUT_SIZE = 720
MODEL_SIZE = 1024
TARGET_PERSON_HEIGHT = 650
TARGET_PERSON_BOTTOM = 710
MODEL_REPOSITORY = "https://huggingface.co/skytnt/anime-seg"


def center_square(frame):
    height, width = frame.shape[:2]
    side = min(height, width)
    x = (width - side) // 2
    y = (height - side) // 2
    cropped = frame[y:y + side, x:x + side]
    return cv2.resize(cropped, (OUTPUT_SIZE, OUTPUT_SIZE), interpolation=cv2.INTER_LANCZOS4)


class AnimeSegmenter:
    def __init__(self, model_path):
        available = ort.get_available_providers()
        providers = []
        if "DmlExecutionProvider" in available:
            providers.append("DmlExecutionProvider")
        providers.append("CPUExecutionProvider")
        self.session = ort.InferenceSession(str(model_path), providers=providers)
        self.input_name = self.session.get_inputs()[0].name

    @property
    def provider(self):
        return self.session.get_providers()[0]

    def predict(self, frame):
        resized = cv2.resize(frame, (MODEL_SIZE, MODEL_SIZE), interpolation=cv2.INTER_LANCZOS4)
        tensor = resized.transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        mask = self.session.run(None, {self.input_name: tensor})[0][0, 0]
        mask = np.clip(mask, 0.0, 1.0)
        return cv2.resize(mask, (OUTPUT_SIZE, OUTPUT_SIZE), interpolation=cv2.INTER_LINEAR)


def largest_central_component(binary):
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, 8)
    best = None
    best_score = -1.0
    for index in range(1, count):
        area = float(stats[index, cv2.CC_STAT_AREA])
        if area < 1000:
            continue
        cx, cy = centroids[index]
        distance = math.hypot(cx - OUTPUT_SIZE / 2, cy - OUTPUT_SIZE / 2)
        score = area * max(0.2, 1.0 - distance / OUTPUT_SIZE)
        if score > best_score:
            best = index
            best_score = score
    if best is None:
        raise RuntimeError("No central anime character was found in the frame.")
    return (labels == best).astype(np.uint8)


def clean_alpha(raw_mask, motion):
    candidate = (raw_mask > 0.20).astype(np.uint8)
    kernel = np.ones((3, 3), np.uint8)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, kernel, iterations=2)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_OPEN, kernel, iterations=1)

    # The reading prop overlaps the torso. It is replaced with a deterministic
    # notebook, so the lower cut is hidden by the new foreground prop.
    if motion == "reading_book":
        candidate[575:, :] = 0

    component = largest_central_component(candidate)
    component = cv2.morphologyEx(component, cv2.MORPH_CLOSE, kernel, iterations=2)
    contracted = cv2.erode(component, kernel, iterations=1)
    support = cv2.GaussianBlur(contracted.astype(np.float32), (0, 0), 0.75)
    alpha = np.minimum(np.clip(raw_mask * 1.15, 0.0, 1.0), support)

    if motion in {"idle", "talking"}:
        alpha[650:, 590:] = 0.0
    if motion == "reading_book":
        alpha[575:, :] = 0.0
    return np.clip(alpha, 0.0, 1.0)


def alpha_bbox(alpha):
    points = cv2.findNonZero((alpha > 0.12).astype(np.uint8))
    if points is None:
        raise RuntimeError("Character alpha is empty.")
    return cv2.boundingRect(points)


def sample_transform(video_path, segmenter, motion, total_frames):
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    sample_count = min(12, max(3, total_frames))
    frame_indexes = np.linspace(0, max(0, total_frames - 1), sample_count).astype(int)
    boxes = []
    try:
        for frame_index in frame_indexes:
            capture.set(cv2.CAP_PROP_POS_FRAMES, int(frame_index))
            ok, frame = capture.read()
            if not ok:
                continue
            square = center_square(frame)
            alpha = clean_alpha(segmenter.predict(square), motion)
            boxes.append(alpha_bbox(alpha))
    finally:
        capture.release()
    if not boxes:
        raise RuntimeError(f"Could not sample character bounds from {video_path}")

    medians = np.median(np.asarray(boxes, dtype=np.float32), axis=0)
    x, y, width, height = [float(value) for value in medians]
    center_x = x + width / 2
    bottom_y = y + height
    if motion == "reading_book":
        scale = 1.05
        tx = OUTPUT_SIZE / 2 - scale * center_x
        ty = 45.0 - scale * y
    else:
        scale = float(np.clip(TARGET_PERSON_HEIGHT / max(height, 1.0), 0.82, 1.20))
        tx = OUTPUT_SIZE / 2 - scale * center_x
        ty = TARGET_PERSON_BOTTOM - scale * bottom_y
    matrix = np.asarray([[scale, 0.0, tx], [0.0, scale, ty]], dtype=np.float32)
    return matrix, {
        "median_bbox": [round(value, 2) for value in medians.tolist()],
        "scale": round(scale, 5),
        "translation": [round(float(tx), 2), round(float(ty), 2)],
    }


def grade_character(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * 1.035, 0, 255)
    hsv[:, :, 2] = np.clip(hsv[:, :, 2] * 0.995, 0, 255)
    graded = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    tint = np.full_like(graded, (16, 7, 6))
    return cv2.addWeighted(graded, 0.985, tint, 0.015, 0)


def blend_overlay(base, overlay, opacity):
    return cv2.addWeighted(overlay, opacity, base, 1.0 - opacity, 0)


def draw_search_panel(frame, progress):
    pulse = 0.48 + 0.16 * math.sin(progress * math.tau)
    overlay = frame.copy()
    x1, y1, x2, y2 = 510, 190, 685, 455
    cv2.rectangle(overlay, (x1, y1), (x2, y2), (86, 32, 42), -1)
    cv2.rectangle(overlay, (x1, y1), (x2, y2), (245, 180, 40), 2)
    cv2.line(overlay, (x1 + 18, y1 + 34), (x2 - 18, y1 + 34), (240, 145, 35), 2)
    for row in range(4):
        y = y1 + 65 + row * 42
        width = 95 + (row % 2) * 24
        cv2.rectangle(overlay, (x1 + 24, y), (x1 + 34, y + 10), (255, 185, 55), -1)
        cv2.line(overlay, (x1 + 48, y + 5), (x1 + 48 + width, y + 5), (210, 100, 50), 3)
        cv2.rectangle(overlay, (x2 - 30, y - 2), (x2 - 18, y + 10), (160, 70, 220), 1)
    return blend_overlay(frame, overlay, pulse)


def draw_happy_particles(frame, progress):
    overlay = frame.copy()
    points = [(94, 248), (132, 185), (607, 235), (642, 310), (105, 420), (620, 455)]
    for index, (x, y) in enumerate(points):
        brightness = 0.5 + 0.5 * math.sin(progress * math.tau + index * 1.1)
        size = 2 + int(brightness * 3)
        color = (255, int(120 + 100 * brightness), int(80 + 150 * (1 - brightness)))
        cv2.rectangle(overlay, (x - size, y - size), (x + size, y + size), color, -1)
    return blend_overlay(frame, overlay, 0.55)


def draw_on_air_indicator(frame, progress):
    overlay = frame.copy()
    pulse = 0.55 + 0.35 * (0.5 + 0.5 * math.sin(progress * math.tau))
    cv2.circle(overlay, (618, 116), 7, (55, 65, 235), -1)
    for index, height in enumerate((16, 28, 21, 34, 18)):
        x = 638 + index * 8
        cv2.rectangle(overlay, (x, 126 - height), (x + 4, 126), (225, 170, 30), -1)
    return blend_overlay(frame, overlay, pulse)


def draw_notebook(frame):
    overlay = frame.copy()
    left = np.asarray([[145, 603], [350, 575], [350, 720], [122, 720]], np.int32)
    right = np.asarray([[350, 575], [575, 603], [598, 720], [350, 720]], np.int32)
    cv2.fillConvexPoly(overlay, left, (88, 34, 38))
    cv2.fillConvexPoly(overlay, right, (98, 38, 44))
    cv2.polylines(overlay, [left], True, (238, 178, 40), 2)
    cv2.polylines(overlay, [right], True, (238, 178, 40), 2)
    cv2.line(overlay, (350, 580), (350, 718), (255, 205, 65), 2)
    for row in range(3):
        y = 622 + row * 25
        cv2.line(overlay, (182, y), (306, y - 8), (180, 90, 60), 3)
        cv2.line(overlay, (395, y - 8), (520, y), (180, 90, 60), 3)
    return blend_overlay(frame, overlay, 0.92)


def make_background_frame(master, frame_index, total_frames, motion=None):
    progress = frame_index / max(total_frames, 1)
    pulse = 0.985 + 0.018 * (0.5 + 0.5 * math.sin(progress * math.tau))
    frame = np.clip(master.astype(np.float32) * pulse, 0, 255).astype(np.uint8)
    if motion == "searching_music":
        frame = draw_search_panel(frame, progress)
    elif motion == "happy":
        frame = draw_happy_particles(frame, progress)
    elif motion == "on_air":
        frame = draw_on_air_indicator(frame, progress)
    return frame


def start_encoder(ffmpeg_path, output_path, fps):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        str(ffmpeg_path),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgr24",
        "-s",
        f"{OUTPUT_SIZE}x{OUTPUT_SIZE}",
        "-r",
        f"{fps:.6f}",
        "-i",
        "-",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        str(output_path),
    ]
    return subprocess.Popen(command, stdin=subprocess.PIPE)


def write_frame(process, frame):
    if process.stdin is None:
        raise RuntimeError("FFmpeg encoder stdin is unavailable.")
    process.stdin.write(np.ascontiguousarray(frame).tobytes())


def finish_encoder(process):
    if process.stdin:
        process.stdin.close()
    code = process.wait()
    if code != 0:
        raise RuntimeError(f"FFmpeg encoder exited with code {code}.")


def create_background_loop(master, output_path, ffmpeg_path, fps=24.0, duration=10.0):
    total_frames = int(round(fps * duration))
    encoder = start_encoder(ffmpeg_path, output_path, fps)
    try:
        for frame_index in range(total_frames):
            write_frame(encoder, make_background_frame(master, frame_index, total_frames))
    finally:
        finish_encoder(encoder)


def process_video(args):
    input_path = Path(args.input)
    output_path = Path(args.output)
    background_path = Path(args.background)
    model_path = Path(args.model)
    ffmpeg_path = Path(args.ffmpeg)

    capture = cv2.VideoCapture(str(input_path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {input_path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 24.0)
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    capture.release()
    if total_frames <= 0:
        raise RuntimeError(f"Cannot determine frame count: {input_path}")

    master = cv2.imread(str(background_path), cv2.IMREAD_COLOR)
    if master is None:
        raise RuntimeError(f"Cannot read background: {background_path}")
    master = cv2.resize(master, (OUTPUT_SIZE, OUTPUT_SIZE), interpolation=cv2.INTER_LANCZOS4)

    segmenter = AnimeSegmenter(model_path)
    matrix, transform_info = sample_transform(input_path, segmenter, args.motion, total_frames)
    print(
        f"{args.motion}: provider={segmenter.provider}, frames={total_frames}, "
        f"scale={transform_info['scale']}",
        flush=True,
    )

    capture = cv2.VideoCapture(str(input_path))
    encoder = start_encoder(ffmpeg_path, output_path, fps)
    previous_alpha = None
    processed_frames = 0
    try:
        while True:
            ok, source_frame = capture.read()
            if not ok:
                break
            square = center_square(source_frame)
            raw_alpha = segmenter.predict(square)
            alpha = clean_alpha(raw_alpha, args.motion)
            if previous_alpha is not None:
                alpha = np.clip(alpha * 0.84 + previous_alpha * 0.16, 0.0, 1.0)
            previous_alpha = alpha

            foreground = grade_character(square)
            foreground = cv2.warpAffine(
                foreground,
                matrix,
                (OUTPUT_SIZE, OUTPUT_SIZE),
                flags=cv2.INTER_LANCZOS4,
                borderMode=cv2.BORDER_CONSTANT,
            )
            alpha = cv2.warpAffine(
                alpha,
                matrix,
                (OUTPUT_SIZE, OUTPUT_SIZE),
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_CONSTANT,
            )
            alpha = np.clip(alpha, 0.0, 1.0)

            background = make_background_frame(master, processed_frames, total_frames, args.motion)
            alpha3 = alpha[:, :, None]
            composed = (
                foreground.astype(np.float32) * alpha3
                + background.astype(np.float32) * (1.0 - alpha3)
            ).astype(np.uint8)
            if args.motion == "reading_book":
                composed = draw_notebook(composed)

            write_frame(encoder, composed)
            processed_frames += 1
            if processed_frames % max(1, int(round(fps))) == 0:
                print(f"{args.motion}: {processed_frames}/{total_frames}", flush=True)
    finally:
        capture.release()
        finish_encoder(encoder)

    metadata = {
        "motion": args.motion,
        "source": str(input_path),
        "output": str(output_path),
        "fps": fps,
        "frames": processed_frames,
        "provider": segmenter.provider,
        "model": MODEL_REPOSITORY,
        "background": str(background_path),
        "transform": transform_info,
    }
    if args.metadata:
        metadata_path = Path(args.metadata)
        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata), flush=True)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--motion")
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--metadata")
    parser.add_argument("--background", required=True)
    parser.add_argument("--model")
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--background-loop-output")
    return parser.parse_args()


def main():
    args = parse_args()
    master = cv2.imread(str(args.background), cv2.IMREAD_COLOR)
    if master is None:
        raise RuntimeError(f"Cannot read background: {args.background}")
    master = cv2.resize(master, (OUTPUT_SIZE, OUTPUT_SIZE), interpolation=cv2.INTER_LANCZOS4)
    if args.background_loop_output:
        create_background_loop(master, Path(args.background_loop_output), Path(args.ffmpeg))
        return
    required = [args.motion, args.input, args.output, args.model]
    if any(value is None for value in required):
        raise RuntimeError("--motion, --input, --output and --model are required.")
    process_video(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Avatar unification failed: {error}", file=sys.stderr)
        raise
