#!/usr/bin/env python3
"""
Demo 5 CLI — ORB vision tools for agents (OpenClaw, Hermes, etc.)

All commands output JSON to stdout.  Visualizations are saved to files
when --output / -o is given; otherwise the base64 blob is included in
the JSON output.

Usage examples:

    python cli.py list
    python cli.py detect city_day.jpg
    python cli.py detect /tmp/photo.png -o keypoints.jpg
    python cli.py match city_day.jpg city_angle2.jpg -o match_vis.jpg
    python cli.py search city_day.jpg --all
    python cli.py search city_day.jpg forest.jpg beach.jpg mountain.jpg
    python cli.py search /tmp/query.png --db-dir ./my_images/
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import cv2
import numpy as np

_SCRIPT_DIR = Path(__file__).resolve().parent
_DEFAULT_IMAGES_DIR = _SCRIPT_DIR / "test_images"
_DEFAULT_UPLOAD_DIR = _SCRIPT_DIR / "uploads"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


# ── image helpers (self-contained; no server.py import needed) ─────────


def _resolve(name: str, extra_dirs: list[Path] | None = None) -> str | None:
    """Resolve an image name or path to an absolute path."""
    p = Path(name)
    if p.exists():
        return str(p.resolve())
    search_dirs = [_DEFAULT_IMAGES_DIR, _DEFAULT_UPLOAD_DIR]
    if extra_dirs:
        search_dirs = list(extra_dirs) + search_dirs
    for d in search_dirs:
        candidate = d / name
        if candidate.exists():
            return str(candidate)
    for d in search_dirs:
        if d.exists():
            for f in d.iterdir():
                if f.stem == p.stem:
                    return str(f)
    return None


def _load_gray(path: str) -> np.ndarray | None:
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    h, w = img.shape[:2]
    if max(h, w) > 800:
        s = 800 / max(h, w)
        img = cv2.resize(img, None, fx=s, fy=s)
    return img


def _load_color(path: str) -> np.ndarray | None:
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        return None
    h, w = img.shape[:2]
    if max(h, w) > 800:
        s = 800 / max(h, w)
        img = cv2.resize(img, None, fx=s, fy=s)
    return img


def _img_to_base64(img_bgr: np.ndarray, quality: int = 85) -> str:
    _, buf = cv2.imencode(".jpg", img_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf).decode()


def _save_vis(img_bgr: np.ndarray, dest: str) -> str:
    cv2.imwrite(dest, img_bgr)
    return str(Path(dest).resolve())


# ── vision operations ──────────────────────────────────────────────────


def detect_keypoints(image_path: str) -> tuple[dict, np.ndarray | None]:
    gray = _load_gray(image_path)
    color = _load_color(image_path)
    if gray is None or color is None:
        return {"error": f"Failed to load '{image_path}'"}, None

    orb = cv2.ORB_create(500)
    kps, des = orb.detectAndCompute(gray, None)
    vis = cv2.drawKeypoints(color, kps, None, color=(0, 255, 0), flags=cv2.DRAW_MATCHES_FLAGS_DRAW_RICH_KEYPOINTS)

    return {
        "image": str(Path(image_path).name),
        "path": str(Path(image_path).resolve()),
        "num_keypoints": len(kps),
        "image_size": f"{gray.shape[1]}x{gray.shape[0]}",
        "descriptor_shape": f"{des.shape[0]}x{des.shape[1]}" if des is not None else "N/A",
    }, vis


def match_images(path1: str, path2: str, top_k: int = 30) -> tuple[dict, np.ndarray | None]:
    gray1, gray2 = _load_gray(path1), _load_gray(path2)
    color1, color2 = _load_color(path1), _load_color(path2)
    if gray1 is None or gray2 is None:
        return {"error": "Failed to load one or both images"}, None

    orb = cv2.ORB_create(500)
    kp1, d1 = orb.detectAndCompute(gray1, None)
    kp2, d2 = orb.detectAndCompute(gray2, None)

    if d1 is None or d2 is None:
        return {
            "image_1": Path(path1).name,
            "image_2": Path(path2).name,
            "num_keypoints_1": len(kp1) if kp1 else 0,
            "num_keypoints_2": len(kp2) if kp2 else 0,
            "num_good_matches": 0,
            "avg_distance": 999,
            "verdict": "Cannot match — at least one image has no descriptors",
        }, None

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = sorted(bf.match(d1, d2), key=lambda m: m.distance)
    top_matches = matches[:top_k]
    good = [m for m in matches if m.distance < 50]
    avg_dist = sum(m.distance for m in top_matches) / max(len(top_matches), 1)

    if len(good) > 15:
        verdict = "HIGH — very likely the same scene/object"
    elif len(good) > 8:
        verdict = "MEDIUM — possibly the same scene from a different angle"
    elif len(good) > 3:
        verdict = "LOW — some partial similarity"
    else:
        verdict = "NONE — most likely different scenes"

    vis = cv2.drawMatches(
        color1,
        kp1,
        color2,
        kp2,
        top_matches,
        None,
        matchColor=(0, 255, 128),
        singlePointColor=(255, 0, 0),
        flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS,
    )

    details = [
        {
            "distance": m.distance,
            "kp1_pos": [round(kp1[m.queryIdx].pt[0], 1), round(kp1[m.queryIdx].pt[1], 1)],
            "kp2_pos": [round(kp2[m.trainIdx].pt[0], 1), round(kp2[m.trainIdx].pt[1], 1)],
        }
        for m in top_matches[:10]
    ]

    return {
        "image_1": Path(path1).name,
        "image_2": Path(path2).name,
        "num_keypoints_1": len(kp1),
        "num_keypoints_2": len(kp2),
        "total_matches": len(matches),
        "num_good_matches": len(good),
        "top_k_avg_distance": round(avg_dist, 2),
        "verdict": verdict,
        "match_details_top10": details,
    }, vis


def compare_multiple(query_path: str, db_paths: list[str]) -> dict:
    gray_q = _load_gray(query_path)
    if gray_q is None:
        return {"error": f"Failed to load query image '{query_path}'"}

    orb = cv2.ORB_create(500)
    kp_q, d_q = orb.detectAndCompute(gray_q, None)
    if d_q is None:
        return {"error": "Failed to extract descriptors from query image"}

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    results = []
    for p in db_paths:
        name = Path(p).name
        gray = _load_gray(p)
        if gray is None:
            results.append({"image": name, "error": "load failed"})
            continue
        _, d = orb.detectAndCompute(gray, None)
        if d is None:
            results.append({"image": name, "good_matches": 0, "avg_distance": 999})
            continue
        matches = sorted(bf.match(d_q, d), key=lambda m: m.distance)
        good = [m for m in matches if m.distance < 50]
        avg_d = sum(m.distance for m in matches[:20]) / max(len(matches[:20]), 1)
        results.append(
            {
                "image": name,
                "path": str(Path(p).resolve()),
                "good_matches": len(good),
                "total_matches": len(matches),
                "avg_distance": round(avg_d, 2),
            }
        )

    results.sort(key=lambda r: r.get("good_matches", 0), reverse=True)
    best = results[0] if results else None
    return {
        "query_image": Path(query_path).name,
        "rankings": results,
        "best_match": best["image"] if best and best.get("good_matches", 0) > 0 else "no clear match",
    }


def list_images(dirs: list[Path] | None = None) -> dict:
    search_dirs = dirs or [_DEFAULT_IMAGES_DIR, _DEFAULT_UPLOAD_DIR]
    images = []
    for d in search_dirs:
        if d.exists():
            for f in sorted(d.iterdir()):
                if f.suffix.lower() in IMAGE_EXTENSIONS:
                    images.append(
                        {
                            "name": f.name,
                            "path": str(f.resolve()),
                            "source": d.name,
                        }
                    )
    return {"images": images, "count": len(images)}


# ── CLI commands ───────────────────────────────────────────────────────


def _emit(data: dict) -> None:
    json.dump(data, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


def _die(msg: str) -> None:
    _emit({"error": msg})
    sys.exit(1)


def cmd_list(args: argparse.Namespace) -> None:
    extra = [Path(args.db_dir)] if args.db_dir else None
    result = list_images(extra)
    _emit(result)


def cmd_detect(args: argparse.Namespace) -> None:
    extra = [Path(args.db_dir)] if args.db_dir else None
    path = _resolve(args.image, extra)
    if not path:
        _die(f"Image not found: {args.image}")
    result, vis = detect_keypoints(path)
    if vis is not None and args.output:
        saved = _save_vis(vis, args.output)
        result["visualization_saved"] = saved
    elif vis is not None:
        result["visualization_base64"] = _img_to_base64(vis)
    _emit(result)


def cmd_match(args: argparse.Namespace) -> None:
    extra = [Path(args.db_dir)] if args.db_dir else None
    p1 = _resolve(args.image1, extra)
    p2 = _resolve(args.image2, extra)
    if not p1:
        _die(f"Image not found: {args.image1}")
    if not p2:
        _die(f"Image not found: {args.image2}")
    result, vis = match_images(p1, p2, top_k=args.top_k)
    if vis is not None and args.output:
        saved = _save_vis(vis, args.output)
        result["visualization_saved"] = saved
    elif vis is not None:
        result["visualization_base64"] = _img_to_base64(vis)
    _emit(result)


def cmd_search(args: argparse.Namespace) -> None:
    extra = [Path(args.db_dir)] if args.db_dir else None
    query = _resolve(args.query, extra)
    if not query:
        _die(f"Query image not found: {args.query}")

    if args.all:
        available = list_images(extra)
        db_paths = [img["path"] for img in available["images"] if img["path"] != str(Path(query).resolve())]
        if not db_paths:
            _die("No database images found (use --db-dir or add images to test_images/)")
    elif args.db_images:
        db_paths = []
        for name in args.db_images:
            p = _resolve(name, extra)
            if not p:
                _die(f"Database image not found: {name}")
            db_paths.append(p)
    else:
        _die("Provide database image names, or use --all to search against all available images")

    result = compare_multiple(query, db_paths)
    _emit(result)


def cmd_generate(args: argparse.Namespace) -> None:
    """Generate procedural test images (delegates to server.generate_test_images)."""
    sys.path.insert(0, str(_SCRIPT_DIR))
    from server import generate_test_images

    generate_test_images()
    result = list_images()
    _emit({"generated": True, **result})


# ── entry point ────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="demo5-vision",
        description="ORB vision CLI — keypoint detection, image matching & search. JSON output.",
    )
    parser.add_argument(
        "--db-dir",
        metavar="DIR",
        help="Extra directory to search for images (in addition to test_images/ and uploads/)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # list
    p_list = sub.add_parser("list", help="List all available images")
    p_list.set_defaults(func=cmd_list)

    # detect
    p_det = sub.add_parser("detect", help="Detect ORB keypoints in an image")
    p_det.add_argument("image", help="Image filename or path")
    p_det.add_argument("-o", "--output", metavar="FILE", help="Save visualization to FILE instead of base64")
    p_det.set_defaults(func=cmd_detect)

    # match
    p_match = sub.add_parser("match", help="Match ORB features between two images")
    p_match.add_argument("image1", help="First image filename or path")
    p_match.add_argument("image2", help="Second image filename or path")
    p_match.add_argument("-o", "--output", metavar="FILE", help="Save visualization to FILE instead of base64")
    p_match.add_argument("--top-k", type=int, default=30, help="Top-K best matches to visualize (default: 30)")
    p_match.set_defaults(func=cmd_match)

    # search
    p_search = sub.add_parser("search", help="Rank database images by similarity to a query")
    p_search.add_argument("query", help="Query image filename or path")
    p_search.add_argument("db_images", nargs="*", help="Database image filenames or paths")
    p_search.add_argument("--all", action="store_true", help="Search against all available images")
    p_search.set_defaults(func=cmd_search)

    # generate
    p_gen = sub.add_parser("generate", help="Generate procedural test images")
    p_gen.set_defaults(func=cmd_generate)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
