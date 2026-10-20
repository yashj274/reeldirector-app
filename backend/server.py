"""ReelDirector AI Backend - FastAPI + Supabase + Gemini API."""
import asyncio
import os
import json
import logging
import math
import random
import uuid
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any
from urllib.parse import urlparse

import requests
import imageio_ffmpeg
from supabase import AsyncClient, create_async_client
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Query
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
GEMINI_SCAN_MODEL = os.environ.get("GEMINI_SCAN_MODEL", "gemini-3.5-flash-lite")
FAL_KEY = os.environ.get("FAL_KEY", "")
FAL_VIDEO_MODEL = "fal-ai/wan/v2.7/text-to-video"
CREATOMATE_API_KEY = os.environ.get("CREATOMATE_API_KEY", "")
ADMIN_EMAILS = {
    value.strip().casefold()
    for value in os.environ.get("ADMIN_EMAILS", "").split(",")
    if value.strip()
}
GEMINI_GENERATE_CONTENT_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "{model}:generateContent"
)

supabase: Optional[AsyncClient] = None

app = FastAPI(title="ReelDirector AI")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("reeldirector")


# ---------------- Models ----------------
class QuestionnaireIn(BaseModel):
    project_id: Optional[str] = None
    title: str
    shoot_type: str  # wedding, travel, food, etc
    purpose: str = ""
    mood: str = ""
    duration_seconds: int = 30
    style: str = "cinematic"
    platform: str = "instagram_reel"
    audience: str = ""
    language: str = "en"

class ProjectOut(BaseModel):
    id: str
    user_id: str
    title: str
    shoot_type: str
    purpose: str
    mood: str
    duration_seconds: int
    style: str
    platform: str
    audience: str
    status: str  # draft, storyboarded, shooting, editing, exported
    storyboard: Optional[List[Dict[str, Any]]] = None
    scene_map: Optional[Dict[str, Any]] = None
    clips: List[Dict[str, Any]] = []
    export_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    created_at: str
    updated_at: str

class SceneScanIn(BaseModel):
    image_base64: Optional[str] = None  # jpeg base64 without header; kept for older clients
    frames: Optional[List[str]] = None
    project_id: Optional[str] = None
    language: Optional[str] = None

class DirectorInstructionIn(BaseModel):
    project_id: str
    shot_index: int
    image_base64: Optional[str] = None
    language: Optional[str] = None

class ClipQualityIn(BaseModel):
    project_id: str
    shot_index: int
    frame_base64: str  # sample frame from clip
    duration_seconds: float
    brightness: float = 0.0
    language: Optional[str] = None
    frame_storage_path: Optional[str] = None
    video_storage_path: Optional[str] = None

class ClipEditIn(BaseModel):
    shot_index: int
    included: bool = True
    trim_start_seconds: float = 0
    trim_end_seconds: Optional[float] = None
    filter_preset: str = "original"
    brightness: float = 0.0

class CaptionEditIn(BaseModel):
    shot_index: int
    start_seconds: float = 0.0
    end_seconds: Optional[float] = None
    position_x: float = 50.0
    position_y: float = 84.0
    size: str = "medium"
    font: str = "sans"

class ExportIn(BaseModel):
    project_id: Optional[str] = None  # taken from URL path; body-optional
    aspect_ratio: str = "9:16"  # 9:16, 1:1, 16:9
    resolution: str = "1080p"
    fps: int = 30
    editing_style: Optional[str] = None  # cinematic, luxury, minimal, action, editorial, warm, fast_pace
    render_provider: str = "ffmpeg"  # ffmpeg or creatomate
    show_shot_titles: bool = False
    fit_mode: str = "fill"
    clip_order: List[int] = []
    clip_edits: List[ClipEditIn] = []
    caption_edits: List[CaptionEditIn] = []
    title_text: str = ""
    title_font: str = "sans"
    title_position: str = "bottom"
    title_color: str = "white"
    title_size: str = "medium"
    music_volume: float = 0.25
    original_volume: float = 0.8
    voiceover_volume: float = 1.0
    captions_enabled: bool = False


class AiVideoIn(BaseModel):
    shot_index: int
    prompt: str
    duration_seconds: int = 5
    aspect_ratio: str = "9:16"
    resolution: str = "720p"


class ShotPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    camera_movement: Optional[str] = None
    shot_size: Optional[str] = None
    duration_seconds: Optional[float] = None
    direction: Optional[str] = None


class StoryboardPatch(BaseModel):
    shots: List[Dict[str, Any]]


class RegenShotIn(BaseModel):
    shot_index: int
    notes: Optional[str] = None
    language: Optional[str] = None


class StoryboardRequest(BaseModel):
    language: Optional[str] = None


class RetakeIn(BaseModel):
    shot_index: int


# ---------------- Supabase Helpers ----------------
def get_supabase() -> AsyncClient:
    if supabase is None:
        raise HTTPException(503, "Supabase is not configured on the backend")
    return supabase

def is_admin_email(email: Optional[str]) -> bool:
    return bool(email and email.casefold() in ADMIN_EMAILS)

async def current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        response = await get_supabase().auth.get_user(token)
        account = response.user
    except Exception:
        raise HTTPException(401, "Invalid token")
    if not account:
        raise HTTPException(401, "User not found")
    metadata = account.user_metadata or {}
    skill_level = metadata.get("creator_skill_level")
    return {
        "id": str(account.id),
        "email": account.email,
        "name": metadata.get("name") or metadata.get("full_name") or "Director",
        "plan": metadata.get("plan", "free"),
        "creator_skill_level": skill_level if skill_level in {"beginner", "creator", "pro"} else "beginner",
        "creator_style_profile": sanitize_creator_style_profile(metadata.get("creator_style_profile")),
        "is_admin": is_admin_email(account.email),
    }


async def require_admin(user=Depends(current_user)) -> Dict[str, Any]:
    if not is_admin_email(user.get("email")):
        raise HTTPException(403, "Admin access is not enabled for this account")
    return user

def sanitize_creator_style_profile(value: Any) -> Dict[str, Any]:
    styles = {"cinematic", "fast_pace", "minimal", "editorial", "luxury", "action"}
    moods = {"Cinematic", "Emotional", "Energetic", "Luxury", "Minimal", "Warm"}
    categories = {"wedding", "travel", "food", "fashion", "gym", "product", "real_estate", "cafe", "restaurant", "event", "documentary", "business", "lifestyle", "daily_vlog", "social_media", "cinematic", "other"}
    goals = {"storytelling", "showcase", "sales", "education", "entertainment", "memory", "brand_awareness"}
    paces = {"relaxed", "balanced", "fast"}
    text_amounts = {"minimal", "some", "more"}
    movements = {"static", "pan_left", "pan_right", "tilt_up", "tilt_down", "dolly_in", "dolly_out", "tracking", "orbit", "reveal", "handheld"}
    if not isinstance(value, dict):
        return {}
    preferences = value.get("preferences") if isinstance(value.get("preferences"), dict) else {}
    recent = value.get("recent") if isinstance(value.get("recent"), list) else []
    recent = [item for item in recent[-12:] if isinstance(item, dict)]

    def common(field: str, allowed: set, fallback: Any) -> Any:
        counts: Dict[Any, int] = {}
        for item in recent:
            candidate = item.get(field)
            if isinstance(candidate, (str, int)) and candidate in allowed:
                counts[candidate] = counts.get(candidate, 0) + 1
        return max(counts, key=counts.get) if counts else fallback

    raw_style = preferences.get("style")
    raw_mood = preferences.get("mood")
    style = raw_style if isinstance(raw_style, str) and raw_style in styles else common("style", styles, "cinematic")
    mood = raw_mood if isinstance(raw_mood, str) and raw_mood in moods else common("mood", moods, "Cinematic")
    raw_duration = preferences.get("duration_seconds")
    duration = raw_duration if isinstance(raw_duration, int) and raw_duration in {15, 20, 30, 45, 60} else common("duration_seconds", {15, 20, 30, 45, 60}, 30)
    movement_counts: Dict[str, int] = {}
    for item in recent:
        for movement in item.get("movements", []) if isinstance(item.get("movements"), list) else []:
            if isinstance(movement, str) and movement in movements:
                movement_counts[movement] = movement_counts.get(movement, 0) + 1
    learned_movements = sorted(movement_counts, key=movement_counts.get, reverse=True)[:3]
    try:
        total = max(0, min(10000, int(value.get("total", 0) or 0)))
    except (TypeError, ValueError):
        total = 0
    return {
        "style": style,
        "mood": mood,
        "duration_seconds": duration,
        "category": common("category", categories, "social_media"),
        "goal": common("goal", goals, "storytelling"),
        "pacing": common("pacing", paces, "balanced"),
        "text_amount": common("text_amount", text_amounts, "minimal"),
        "movements": learned_movements,
        "project_count": max(len(recent), total),
        "has_preferences": (isinstance(raw_style, str) and raw_style in styles)
            or (isinstance(raw_mood, str) and raw_mood in moods)
            or (isinstance(raw_duration, int) and raw_duration in {15, 20, 30, 45, 60}),
        "has_history": bool(recent),
    }

def creator_style_prompt(profile: Dict[str, Any]) -> str:
    if not profile or not profile.get("has_preferences") and not profile.get("has_history"):
        return ""
    details = []
    if profile.get("has_preferences"):
        details.append(f"preferred style {profile.get('style')}, mood {profile.get('mood')}, and usual length {profile.get('duration_seconds')} seconds")
    if profile.get("has_history"):
        movement_list = ", ".join(profile.get("movements", [])) or "simple, steady camera moves"
        details.append(
            f"usual category {profile.get('category')}, goal {profile.get('goal')}, pace {profile.get('pacing')}, "
            f"on-screen text {profile.get('text_amount')}, and familiar camera movements {movement_list}"
        )
    return "Creator style profile: " + "; ".join(details) + "."

async def fetch_project(pid: str, user_id: str) -> Optional[Dict[str, Any]]:
    result = await get_supabase().table("projects").select("data").eq(
        "id", pid
    ).eq("user_id", user_id).maybe_single().execute()
    return result.data["data"] if result.data else None

async def list_user_projects(user_id: str) -> List[Dict[str, Any]]:
    result = await get_supabase().table("projects").select("data").eq(
        "user_id", user_id
    ).order("created_at", desc=True).limit(200).execute()
    return [row["data"] for row in (result.data or [])]

async def insert_project(doc: Dict[str, Any]) -> None:
    await get_supabase().table("projects").insert({
        "id": doc["id"], "user_id": doc["user_id"], "data": doc,
    }).execute()

async def save_project(doc: Dict[str, Any], user_id: str) -> None:
    await get_supabase().table("projects").update({
        "data": doc,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", doc["id"]).eq("user_id", user_id).execute()

async def download_media(storage_path: str) -> bytes:
    data = await get_supabase().storage.from_("project-media").download(storage_path)
    if isinstance(data, bytes):
        return data
    if hasattr(data, "content"):
        return data.content
    raise RuntimeError("Supabase Storage returned an invalid file")

def _title_font_path(font_name: str) -> Path:
    font_candidates = {
        "sans": [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/System/Library/Fonts/SFNS.ttf"),
        ],
        "serif": [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"),
            Path("/System/Library/Fonts/Supplemental/Georgia.ttf"),
        ],
        "mono": [ROOT_DIR / "assets/fonts/SpaceMono-Regular.ttf"],
        "bold": [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        ],
        "condensed": [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ],
        "serif_bold": [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"),
            Path("/System/Library/Fonts/Supplemental/Georgia Bold.ttf"),
        ],
    }
    candidates = font_candidates.get(font_name, font_candidates["sans"])
    return next((path for path in candidates if path.is_file()),
                ROOT_DIR / "assets/fonts/SpaceMono-Regular.ttf")


def _escape_filter_path(path: Path) -> str:
    return path.as_posix().replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def _has_audio_stream(concat_file: Path, ffmpeg: str) -> bool:
    probe = subprocess.run(
        [ffmpeg, "-hide_banner", "-f", "concat", "-safe", "0", "-i", str(concat_file)],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=20, cwd=concat_file.parent,
    )
    return any(re.search(r"Stream #\d+:\d+.*Audio:", line) for line in probe.stderr.decode(errors="replace").splitlines())


def _ffmpeg_executable() -> str:
    return shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()


def _run_video_render(concat_file: Path, output_file: Path, width: int, height: int,
                      soundtrack_file: Optional[Path], fps: int, editing_style: str,
                      title_text: str = "", title_font: str = "sans",
                      title_position: str = "bottom", title_color: str = "white",
                      title_size: str = "medium", music_volume: float = 0.25,
                      original_volume: float = 0.8, voiceover_file: Optional[Path] = None,
                      voiceover_volume: float = 1.0) -> None:
    ffmpeg = _ffmpeg_executable()
    grades = {
        "cinematic": "eq=contrast=1.08:saturation=0.95:brightness=-0.02",
        "luxury": "eq=contrast=1.04:saturation=0.90,colorbalance=rs=0.04:gs=0.01:bs=-0.02",
        "minimal": "eq=contrast=1.01:saturation=0.85",
        "action": "eq=contrast=1.15:saturation=1.08",
        "editorial": "eq=contrast=1.10:saturation=1.05",
        "warm": "colorbalance=rs=0.08:gs=0.02:bs=-0.06",
        "fast_pace": "eq=contrast=1.12:saturation=1.08",
        "original": "",
        "mono": "hue=s=0,eq=contrast=1.04",
        "vivid": "eq=contrast=1.12:saturation=1.22",
        "cool": "colorbalance=rs=-0.04:gs=0.01:bs=0.08",
        "vintage": "eq=contrast=0.92:saturation=0.78:brightness=0.025",
        "soft": "eq=contrast=0.92:saturation=0.92",
    }
    filters = [
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
    ]
    if editing_style == "fast_pace":
        filters.append("setpts=0.8*PTS")
    filters.append(f"fps={fps}")
    if grades.get(editing_style):
        filters.append(grades[editing_style])
    filters.append("format=yuv420p")
    if title_text.strip():
        title_file = concat_file.parent / "title-overlay.txt"
        title_file.write_text(title_text.strip()[:80], encoding="utf-8")
        font_file = _escape_filter_path(_title_font_path(title_font))
        text_file = _escape_filter_path(title_file)
        size_ratio = {"small": 0.042, "medium": 0.058, "large": 0.074}.get(title_size, 0.058)
        font_size = max(28, min(110, round(min(width, height) * size_ratio)))
        y_position = {
            "top": "h*0.12",
            "center": "(h-text_h)/2",
            "bottom": "h-text_h-h*0.14",
        }.get(title_position, "h-text_h-h*0.14")
        color = {"white": "white", "gold": "0xF5C869", "pink": "0xE0115F", "black": "black"}.get(title_color, "white")
        border_color = "white@0.85" if title_color == "black" else "black@0.78"
        box_color = "white@0.75" if title_color == "black" else "black@0.28"
        filters.append(
            f"drawtext=fontfile='{font_file}':textfile='{text_file}':"
            f"fontsize={font_size}:fontcolor={color}:borderw=2:bordercolor={border_color}:"
            f"box=1:boxcolor={box_color}:boxborderw=14:x=(w-text_w)/2:y={y_position}:"
            "enable='between(t,0,3.5)'"
        )
    video_filter = ",".join(filters)
    command = [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file)]
    external_audio_labels = []
    audio_filters = []
    source_audio_filter = f"{'atempo=1.25,' if editing_style == 'fast_pace' else ''}volume={max(0.0, min(1.0, original_volume))}"
    mix_music = soundtrack_file is not None and music_volume > 0
    mix_voiceover = voiceover_file is not None and voiceover_volume > 0
    probe_audio = mix_music or mix_voiceover or editing_style == "fast_pace" or original_volume != 1.0
    has_source_audio = _has_audio_stream(concat_file, ffmpeg) if probe_audio else True
    next_input = 1
    if mix_music or mix_voiceover:
        if has_source_audio:
            audio_filters.append(f"[0:a]{source_audio_filter}[original]")
        else:
            command.extend(["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"])
            audio_filters.append(f"[{next_input}:a]anull[original]")
            next_input += 1
        external_audio_labels.append("[original]")
    if mix_music:
        command.extend(["-stream_loop", "-1", "-i", str(soundtrack_file)])
        audio_filters.append(f"[{next_input}:a]volume={max(0.0, min(1.0, music_volume))}[music]")
        external_audio_labels.append("[music]")
        next_input += 1
    if mix_voiceover:
        command.extend(["-i", str(voiceover_file)])
        voiceover_tempo = "atempo=1.25," if editing_style == "fast_pace" else ""
        audio_filters.append(f"[{next_input}:a]{voiceover_tempo}volume={max(0.0, min(1.0, voiceover_volume))}[voiceover]")
        external_audio_labels.append("[voiceover]")
    command.extend(["-vf", video_filter, "-map", "0:v:0"])
    if mix_music or mix_voiceover:
        if len(external_audio_labels) > 1:
            audio_filters.append(
                f"{''.join(external_audio_labels)}amix=inputs={len(external_audio_labels)}:"
                "duration=first:dropout_transition=2[aout]"
            )
            audio_label = "[aout]"
        else:
            audio_label = external_audio_labels[0]
        command.extend([
            "-filter_complex", ";".join(audio_filters), "-map", audio_label,
        ])
    elif has_source_audio:
        command.extend(["-map", "0:a?"])
        if editing_style == "fast_pace" or original_volume != 1.0:
            command.extend(["-filter:a", source_audio_filter])
    command.extend([
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(output_file),
    ])
    subprocess.run(
        command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        timeout=600, cwd=concat_file.parent,
    )


def _normalize_video_clip(input_file: Path, output_file: Path, width: int, height: int, fps: int,
                          trim_start_seconds: float = 0, trim_end_seconds: Optional[float] = None,
                          filter_preset: str = "original", fit_mode: str = "fill",
                          brightness: float = 0.0, captions_file: Optional[Path] = None,
                          caption_start_seconds: float = 0.0, caption_end_seconds: Optional[float] = None,
                          caption_position_x: float = 50.0, caption_position_y: float = 84.0,
                          caption_size: str = "medium", caption_font: str = "sans") -> None:
    """Transcode mixed phone/AI sources into matching MP4 video and AAC audio streams."""
    ffmpeg = _ffmpeg_executable()
    probe = subprocess.run(
        [ffmpeg, "-i", str(input_file)], check=False, capture_output=True, text=True, timeout=45,
    )
    has_audio = "Audio:" in probe.stderr
    command = [ffmpeg, "-y"]
    if trim_start_seconds > 0:
        command.extend(["-ss", f"{trim_start_seconds:.3f}"])
    command.extend(["-i", str(input_file)])
    if trim_end_seconds is not None:
        command.extend(["-t", f"{max(0.1, trim_end_seconds - trim_start_seconds):.3f}"])
    audio_map = "0:a:0"
    if not has_audio:
        command.extend(["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"])
        audio_map = "1:a:0"
    if fit_mode == "fit":
        framing = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
    else:
        framing = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    video_filter = f"{framing},setsar=1,fps={fps},format=yuv420p"
    clip_filters = {
        "original": "",
        "warm": "colorbalance=rs=0.08:gs=0.02:bs=-0.06",
        "cool": "colorbalance=rs=-0.04:gs=0.01:bs=0.08",
        "mono": "hue=s=0,eq=contrast=1.04",
        "vivid": "eq=contrast=1.12:saturation=1.22",
        "vintage": "eq=contrast=0.92:saturation=0.78:brightness=0.025",
        "soft": "eq=contrast=0.92:saturation=0.92",
    }
    preset = clip_filters.get(filter_preset, "")
    if preset:
        video_filter = video_filter.replace(",format=yuv420p", f",{preset},format=yuv420p")
    exposure = max(-0.5, min(0.5, float(brightness or 0)))
    if abs(exposure) >= 0.01:
        video_filter = video_filter.replace(",format=yuv420p", f",eq=brightness={exposure:.3f},format=yuv420p")
    if captions_file and captions_file.is_file() and captions_file.read_text(encoding="utf-8").strip():
        font_file = _escape_filter_path(_title_font_path(caption_font))
        text_file = _escape_filter_path(captions_file)
        size_ratio = {"small": 0.034, "medium": 0.046, "large": 0.062}.get(caption_size, 0.046)
        font_size = max(18, min(80, round(min(width, height) * size_ratio)))
        x_ratio = max(0.0, min(100.0, caption_position_x)) / 100
        y_ratio = max(0.0, min(100.0, caption_position_y)) / 100
        caption_duration = max(0.0, caption_end_seconds) if caption_end_seconds is not None else max(0.0, (trim_end_seconds or 0) - trim_start_seconds)
        caption_filter = (
            f"drawtext=fontfile='{font_file}':textfile='{text_file}':"
            f"fontsize={font_size}:fontcolor=white:borderw=2:bordercolor=black@0.85:"
            "expansion=none:box=1:boxcolor=black@0.62:boxborderw=10:"
            f"x=(w-text_w)*{x_ratio:.4f}:y=(h-text_h)*{y_ratio:.4f}:"
            f"enable='between(t,{max(0.0, caption_start_seconds):.3f},{caption_duration:.3f})'"
        )
        video_filter = video_filter.replace(",format=yuv420p", f",{caption_filter},format=yuv420p")
    command.extend([
        "-map", "0:v:0", "-map", audio_map, "-vf", video_filter,
        "-af", "apad", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-r", str(fps), "-c:a", "aac", "-ar", "48000",
        "-ac", "2", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
        str(output_file),
    ])
    subprocess.run(
        command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        timeout=600, cwd=input_file.parent,
    )


# ---------------- Gemini API ----------------
def _send_gemini_response(
    system: str, prompt: str, images: Optional[List[str]] = None, *,
    model: Optional[str] = None, max_output_tokens: int = 2048,
    thinking_level: Optional[str] = None, max_attempts: int = 3,
    timeout: tuple = (10, 45),
) -> str:
    """Send a text and optional JPEG/base64 image prompt to Gemini."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    parts: List[Dict[str, Any]] = [{"text": prompt}]
    for image in images or []:
        if not image:
            continue
        image = image.strip()
        mime_type = "image/jpeg"
        if image.startswith("data:") and "," in image:
            header, image = image.split(",", 1)
            mime_match = re.match(r"data:(image/[a-zA-Z0-9.+-]+);base64", header)
            if mime_match:
                mime_type = mime_match.group(1)
        parts.append({"inlineData": {"mimeType": mime_type, "data": image}})

    request_url = GEMINI_GENERATE_CONTENT_URL.format(model=model or GEMINI_MODEL)
    request_headers = {
        "x-goog-api-key": GEMINI_API_KEY,
        "Content-Type": "application/json",
    }
    generation_config = {"maxOutputTokens": max_output_tokens}
    if thinking_level:
        generation_config["thinkingConfig"] = {"thinkingLevel": thinking_level}
    request_body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": generation_config,
    }
    retryable_statuses = {408, 429, 500, 502, 503, 504}
    max_attempts = max(1, max_attempts)
    response = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = requests.post(
                request_url, headers=request_headers, json=request_body, timeout=timeout,
            )
        except (requests.Timeout, requests.ConnectionError):
            if attempt == max_attempts:
                raise
            delay = (2 ** (attempt - 1)) + random.uniform(0, 0.25)
            log.warning("Gemini request timed out or lost connection; retry %s/%s in %.1fs",
                        attempt, max_attempts - 1, delay)
            time.sleep(delay)
            continue

        if response.status_code not in retryable_statuses or attempt == max_attempts:
            response.raise_for_status()
            break

        retry_after = response.headers.get("Retry-After")
        try:
            delay = min(5.0, max(0.0, float(retry_after))) if retry_after else 2 ** (attempt - 1)
        except (TypeError, ValueError):
            delay = 2 ** (attempt - 1)
        delay += random.uniform(0, 0.25)
        log.warning("Gemini returned HTTP %s; retry %s/%s in %.1fs",
                    response.status_code, attempt, max_attempts - 1, delay)
        time.sleep(delay)

    if response is None:
        raise RuntimeError("Gemini did not return a response")
    body = response.json()
    candidates = body.get("candidates", [])
    text_parts = []
    if candidates:
        for part in candidates[0].get("content", {}).get("parts", []):
            if part.get("text") and not part.get("thought"):
                text_parts.append(part["text"])
    if not text_parts:
        raise RuntimeError("Gemini returned no text content")
    return "".join(text_parts)


async def chat_once(
    system: str, prompt: str, images: Optional[List[str]] = None, **options,
) -> str:
    """Run the blocking HTTP client outside the async event loop."""
    return await asyncio.to_thread(_send_gemini_response, system, prompt, images, **options)

def extract_json(text: str) -> Any:
    """Pull the first JSON object/array from an LLM response."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    m = re.search(r"[\[{].*[\]}]", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    try:
        return json.loads(text)
    except Exception:
        return None


# ---------------- Routes ----------------
@api.get("/")
async def root():
    return {
        "service": "ReelDirector AI", "status": "ok", "database": "supabase",
        "supabase_configured": supabase is not None,
        "ai_provider": "gemini", "gemini_configured": bool(GEMINI_API_KEY),
        "gemini_model": GEMINI_MODEL,
        "video_generation_configured": bool(FAL_KEY),
        "creatomate_configured": bool(CREATOMATE_API_KEY),
    }


@api.get("/capabilities")
async def capabilities():
    return {
        "video_generation": bool(FAL_KEY),
        "creatomate_rendering": bool(CREATOMATE_API_KEY),
        "local_rendering": True,
    }


@app.get("/")
async def service_health():
    return await root()


def _provider_json_sync(method: str, url: str, headers: Dict[str, str], payload: Optional[Dict[str, Any]] = None) -> Any:
    response = requests.request(method, url, headers=headers, json=payload, timeout=(15, 45))
    try:
        data = response.json()
    except ValueError:
        data = {}
    if not response.ok:
        details = data.get("detail") or data.get("message") or data.get("error") or ""
        raise RuntimeError(f"Provider request failed ({response.status_code})" + (f": {str(details)[:400]}" if details else ""))
    return data


async def provider_json(method: str, url: str, headers: Dict[str, str], payload: Optional[Dict[str, Any]] = None) -> Any:
    return await asyncio.to_thread(_provider_json_sync, method, url, headers, payload)


def _download_remote_media_sync(url: str, allowed_suffixes: tuple[str, ...]) -> bytes:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or not any(
        parsed.hostname == suffix.lstrip(".") or parsed.hostname.endswith(suffix)
        for suffix in allowed_suffixes
    ):
        raise RuntimeError("The video provider returned an untrusted media URL")
    response = requests.get(url, timeout=(20, 180), stream=True)
    if not response.ok:
        raise RuntimeError(f"Could not download the rendered video ({response.status_code})")
    final_host = urlparse(response.url).hostname or ""
    if not any(final_host == suffix.lstrip(".") or final_host.endswith(suffix) for suffix in allowed_suffixes):
        raise RuntimeError("The video provider redirected to an untrusted media host")
    max_bytes = 200 * 1024 * 1024
    length = response.headers.get("content-length")
    if length and int(length) > max_bytes:
        raise RuntimeError("The generated video is larger than the 200 MB project limit")
    chunks = []
    total = 0
    for chunk in response.iter_content(chunk_size=1024 * 1024):
        if not chunk:
            continue
        total += len(chunk)
        if total > max_bytes:
            raise RuntimeError("The generated video is larger than the 200 MB project limit")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise RuntimeError("The video provider returned an empty file")
    return data


async def download_remote_media(url: str, allowed_suffixes: tuple[str, ...]) -> bytes:
    return await asyncio.to_thread(_download_remote_media_sync, url, allowed_suffixes)


@api.get("/auth/me")
async def me(user=Depends(current_user)):
    return user


def _admin_project_summary(row: Dict[str, Any]) -> Dict[str, Any]:
    data = row.get("data") if isinstance(row.get("data"), dict) else {}
    clips = data.get("clips") if isinstance(data.get("clips"), list) else []
    return {
        "id": row.get("id"),
        "user_id": row.get("user_id"),
        "title": str(data.get("title") or "Untitled project")[:160],
        "shoot_type": str(data.get("shoot_type") or "other")[:60],
        "status": str(data.get("status") or "draft")[:40],
        "clip_count": len(clips),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


@api.get("/admin/overview")
async def admin_overview(_user=Depends(require_admin)):
    try:
        result = await get_supabase().table("projects").select(
            "id,user_id,data,created_at,updated_at", count="exact"
        ).order("updated_at", desc=True).limit(8).execute()
    except Exception as exc:
        log.exception("Admin overview could not read project data")
        raise HTTPException(503, "Could not load project overview") from exc
    return {
        "project_count": int(result.count or 0),
        "recent_projects": [_admin_project_summary(row) for row in (result.data or [])],
        "services": {
            "database": supabase is not None,
            "gemini": bool(GEMINI_API_KEY),
            "local_rendering": True,
            "creatomate": bool(CREATOMATE_API_KEY),
            "ai_video": bool(FAL_KEY),
        },
    }


@api.get("/admin/projects")
async def admin_projects(
    page: int = Query(1, ge=1, le=100000),
    per_page: int = Query(20, ge=1, le=50),
    _user=Depends(require_admin),
):
    start = (page - 1) * per_page
    try:
        result = await get_supabase().table("projects").select(
            "id,user_id,data,created_at,updated_at", count="exact"
        ).order("updated_at", desc=True).range(start, start + per_page - 1).execute()
    except Exception as exc:
        log.exception("Admin project list could not be loaded")
        raise HTTPException(503, "Could not load projects") from exc
    return {
        "items": [_admin_project_summary(row) for row in (result.data or [])],
        "total": int(result.count or 0),
        "page": page,
        "per_page": per_page,
        "has_more": start + len(result.data or []) < int(result.count or 0),
    }


@api.get("/admin/users")
async def admin_users(
    page: int = Query(1, ge=1, le=100000),
    per_page: int = Query(20, ge=1, le=50),
    _user=Depends(require_admin),
):
    try:
        users = await get_supabase().auth.admin.list_users(page=page, per_page=per_page)
    except Exception as exc:
        log.exception("Admin account list could not be loaded")
        raise HTTPException(503, "Could not load accounts") from exc
    items = []
    for account in users or []:
        metadata = account.user_metadata or {}
        items.append({
            "id": str(account.id),
            "email": account.email or "",
            "name": str(metadata.get("name") or metadata.get("full_name") or "Director")[:120],
            "created_at": account.created_at,
            "last_sign_in_at": account.last_sign_in_at,
            "is_admin": is_admin_email(account.email),
        })
    return {"items": items, "page": page, "per_page": per_page, "has_more": len(items) == per_page}


# ---------------- Templates ----------------
TEMPLATES = [
    {"id": "wedding", "name": "Wedding Cinema", "mood": "Emotional • Romantic", "duration": 45, "style": "cinematic",
     "image": "https://images.pexels.com/photos/33419097/pexels-photo-33419097.jpeg"},
    {"id": "travel", "name": "Travel Vlog", "mood": "Adventure • Wide", "duration": 30, "style": "cinematic",
     "image": "https://images.unsplash.com/photo-1534196213718-bd643e406be4"},
    {"id": "food", "name": "Food Cinematic", "mood": "Warm • Macro", "duration": 20, "style": "cinematic",
     "image": "https://images.unsplash.com/photo-1623594629187-2a68392cbab9?w=940"},
    {"id": "fashion", "name": "Fashion Editorial", "mood": "Bold • Editorial", "duration": 25, "style": "editorial",
     "image": "https://images.unsplash.com/photo-1664076458686-3449062080ac?w=940"},
    {"id": "gym", "name": "Gym Motivation", "mood": "High Energy", "duration": 20, "style": "action",
     "image": "https://images.unsplash.com/photo-1550345332-09e3ac987658?w=940"},
    {"id": "real_estate", "name": "Real Estate", "mood": "Luxury • Spacious", "duration": 40, "style": "luxury",
     "image": "https://images.pexels.com/photos/33529500/pexels-photo-33529500.jpeg?w=940"},
    {"id": "product", "name": "Product Showcase", "mood": "Clean • Premium", "duration": 15, "style": "minimal",
     "image": "https://images.unsplash.com/photo-1761701390293-27a1d3fa9df5?w=940"},
    {"id": "viral", "name": "Viral Reel", "mood": "Fast • Bold", "duration": 15, "style": "fast_pace",
     "image": "https://images.pexels.com/photos/13327382/pexels-photo-13327382.jpeg?w=940"},
]

@api.get("/templates")
async def list_templates():
    return TEMPLATES


# ---------------- Projects ----------------
def project_out(doc: Dict[str, Any]) -> Dict[str, Any]:
    doc.pop("_id", None)
    return doc


@api.post("/projects")
async def create_project(body: QuestionnaireIn, user=Depends(current_user)):
    pid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": pid,
        "user_id": user["id"],
        "title": body.title,
        "shoot_type": body.shoot_type,
        "purpose": body.purpose,
        "mood": body.mood,
        "duration_seconds": body.duration_seconds,
        "style": body.style,
        "platform": body.platform,
        "audience": body.audience,
        "status": "draft",
        "storyboard": None,
        "scene_map": None,
        "clips": [],
        "export_url": None,
        "thumbnail_url": None,
        "created_at": now,
        "updated_at": now,
    }
    await insert_project(doc.copy())
    return project_out(doc)


@api.get("/projects")
async def list_projects(user=Depends(current_user)):
    return await list_user_projects(user["id"])


@api.get("/projects/{pid}")
async def get_project(pid: str, user=Depends(current_user)):
    doc = await fetch_project(pid, user["id"])
    if not doc:
        raise HTTPException(404, "Project not found")
    return doc


@api.delete("/projects/{pid}")
async def delete_project(pid: str, user=Depends(current_user)):
    r = await get_supabase().table("projects").delete().eq("id", pid).eq(
        "user_id", user["id"]
    ).select("id").execute()
    if not r.data:
        raise HTTPException(404, "Project not found")
    return {"ok": True}


# ---------------- AI: Storyboard ----------------
LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "te": "Telugu", "ta": "Tamil",
    "kn": "Kannada", "ml": "Malayalam", "mr": "Marathi", "bn": "Bengali",
    "gu": "Gujarati", "pa": "Punjabi", "es": "Spanish", "fr": "French",
    "de": "German", "ar": "Arabic", "ja": "Japanese", "ko": "Korean", "zh": "Chinese",
}
UI_TRANSLATION_SOURCE = {
    "choose_language": "Choose your language", "language_subtitle": "You can change it anytime in Settings.",
    "continue": "Continue", "welcome_back": "Welcome back", "signin_subtitle": "Sign in to keep directing.",
    "email": "Email", "password": "Password", "forgot_password": "Forgot password?", "sign_in": "Sign in",
    "new_here": "New here?", "create_account": "Create an account", "create_account_title": "Create account",
    "signup_subtitle": "Your first reel is 60 seconds away.", "full_name": "Full name", "have_account": "Have an account?",
    "send_reset_link": "Send reset link", "reset_password": "Reset password", "new_password": "New password",
    "update_password": "Update password", "give_reel_name": "Give it a name", "new_reel": "New Reel",
    "type_of_shoot": "Type of shoot", "mood": "Mood", "duration": "Duration", "platform": "Platform",
    "purpose_label": "What is it for?", "purpose_hint": "Describe what the video should show and why you are making it.",
    "purpose_placeholder": "Describe your project and we'll shape the perfect reel for it…",
    "purpose_required": "Add a little more detail so the AI can plan your story (at least 10 characters).",
    "target_audience": "Target audience (optional)", "create_project": "Create project",
    "custom_script": "Your custom script", "scene_scan_label": "AI environment scan", "scene_elements": "Seen in your space",
    "script_and_shots": "Custom script and shots", "storyboard": "Storyboard", "shots_progress": "shots",
    "no_purpose": "No purpose set", "generate_storyboard": "Generate AI storyboard",
    "directing_your_shoot": "Directing your shoot…", "preview_final_reel": "Preview final reel",
    "continue_shooting": "Continue shooting", "reshoot": "Reshoot", "edit_video_export": "Edit video & export",
    "scan_fallback": "Automatic scan was unavailable; the script uses your description.",
    "clip_filter": "Clip filter", "overall_look": "Overall look", "title_text": "Title text",
    "sound_mix": "Sound mix", "export_format": "Export format", "save_edit": "Save edit",
    "edits_saved": "Edits saved", "render_upload_ready": "Render upload-ready video",
    "editor_title": "Video editor", "editor_heading": "Shape your final video",
    "editor_subheading": "Arrange and trim clips, choose a look, add a title, and balance your audio.",
    "clip_order_trims": "Clip order & trims", "clip_order_help": "Use the arrows to reorder. Trim the in and out points in half-second steps.",
    "ai_clip": "AI clip", "recorded_clip": "Recorded clip", "preview_opening_title": "Preview · opening title and clip filter",
    "preview_selected_filter": "Preview · selected clip filter", "included_final": "Included in final video",
    "skipped_final": "Skipped in final video", "overall_grade": "Apply a finishing grade to the whole video.",
    "title_overlay_help": "Add a readable title overlay to the opening of your video.",
    "sound_mix_help": "Adjust the soundtrack against audio captured with your clips.",
    "export_help": "Choose a format that matches where you’ll upload.",
    "record_clip_to_edit": "Record or upload at least one clip to start editing.", "type_title": "Type your title",
    "font": "Font", "placement_size_color": "Placement · size · color", "original_clip_audio": "Original clip audio",
    "soundtrack": "Soundtrack", "add_soundtrack": "Add a soundtrack", "frame_clips": "Frame the clips",
    "fill_frame": "Fill frame", "fit_whole_clip": "Fit whole clip", "resolution": "Resolution", "frame_rate": "Frame rate",
    "clips_in_edit": "Clips in edit", "estimated_length": "Estimated length", "export_size": "Export size",
    "rendering_video": "Rendering your video…", "saving": "Saving…",
    "reel_name_example": "Example: Sunset rooftop", "audience_example": "Example: families, students, food lovers",
    "move_static": "Hold still", "move_pan_left": "Pan left", "move_pan_right": "Pan right",
    "move_tilt_up": "Tilt up", "move_tilt_down": "Tilt down", "move_dolly_in": "Move closer",
    "move_dolly_out": "Step back", "move_tracking": "Follow the subject", "move_orbit": "Circle the subject",
    "move_reveal": "Slide aside to reveal", "move_handheld": "Move gently",
    "custom": "Custom", "title_required_error": "Give your reel a name first.",
    "email_reset_copy": "Enter your account email and we’ll send you a secure reset link.",
    "choose_password_copy": "Choose a new password for your account.",
    "password_reset_expired": "This password reset link has expired. Request a new one.",
    "password_min_error": "Use at least 8 characters for your password.", "password_mismatch": "The passwords do not match.",
    "reset_email_required": "Enter the email address for your account.",
    "reset_email_sent": "If an account uses that email, a password reset link is on its way.",
    "password_changed": "Your password has been changed. You can now sign in.",
    "rating_unavailable": "Automatic shot rating is unavailable right now. Your clip is saved for review.",
    "dashboard_hello": "Hey {name}", "ready_magic": "Ready to make magic?", "start_new_reel": "Start a new reel",
    "ai_plans_directs_edits": "AI plans, directs, and edits for you.", "cinematic_templates": "Cinematic Templates",
    "recent_projects": "Recent projects", "see_all": "See all", "first_masterpiece": "Your first masterpiece is one tap away.",
    "try_again": "Try again", "sign_in_again": "Sign in again", "no_projects": "No projects yet. Tap + to create one.",
    "profile": "Profile", "preferences": "Preferences", "account": "Account", "support": "Support",
    "creator_skill_level": "How much filming experience do you have?",
    "my_creator_style": "My creator style", "creator_style_help": "Your choices and recent reels help personalize new shot plans.",
    "preferred_duration": "Usual reel length", "reset_style_profile": "Reset style profile",
    "reset_style_confirm": "Clear learned choices and return to the default style?", "reset": "Reset",
    "creator_style_learned": "Learned from {count} reels: {category}, {goal}, {pacing} pace, {text} on-screen text. Familiar moves: {movements}.",
    "creator_style_empty": "Your style will learn from reels you create. You can set a look and length now.", "not_enough_data": "still learning",
    "create_in_my_style": "Create in My Style", "create_in_my_style_help": "Use your saved look and choices for this reel.",
    "more_options": "More options", "fewer_options": "Fewer options",
    "style_cinematic": "Cinematic", "style_fast_pace": "Fast paced", "style_minimal": "Clean",
    "style_editorial": "Editorial", "style_luxury": "Luxury", "style_action": "Action",
    "goal_storytelling": "storytelling", "goal_showcase": "showcase", "goal_sales": "sales",
    "goal_education": "education", "goal_entertainment": "entertainment", "goal_memory": "memories",
    "goal_brand_awareness": "brand building", "pacing_relaxed": "relaxed", "pacing_balanced": "balanced",
    "pacing_fast": "fast", "text_amount_minimal": "minimal", "text_amount_some": "some", "text_amount_more": "more",
    "skill_help": "You can change this anytime. Beginner is the default.",
    "beginner": "Beginner", "creator": "Creator", "pro": "Pro",
    "phase_hook": "Hook", "phase_detail": "Detail", "phase_action": "Action", "phase_hero": "Hero", "phase_cta": "Ending",
    "shot_current": "Current", "shot_done": "Done", "shot_upcoming": "Upcoming", "shot_retake": "Retake",
    "shot_skipped": "Skipped", "shot_plan": "Shot plan", "skip_shot": "Skip this shot", "include_shot": "Include this shot",
    "storyboard_preserved": "AI could not update the plan. Your saved storyboard and clips are unchanged.",
    "all_shots_skipped": "All shots are skipped. Include one to start filming.",
    "language": "Language", "editing_style": "Editing style", "subscription": "Subscription", "downloads": "Downloads",
    "notifications": "Notifications", "help_faq": "Help & FAQ", "send_feedback": "Send Feedback", "privacy": "Privacy",
    "log_out": "Log out", "home": "Home", "projects": "Projects", "templates": "Templates",
    "template_subtitle": "Pick a look. AI handles the rest.",
    "project_status_draft": "Draft", "project_status_storyboarded": "Script ready", "project_status_shooting": "In progress",
    "project_status_exported": "Exported", "all_projects": "Projects",
    "delete_project": "Delete project",
    "delete_project_confirm": "Delete “{title}”? Its clips, soundtrack, and exports will also be deleted.",
    "delete_project_action": "Delete",
    "delete_project_failed": "Could not delete this project. Please try again.",
    "reel_ready": "Your reel is ready", "edit_this_video": "Edit this video",
    "edit_video_features": "Trim clips · filters · text & fonts · sound", "duration_label": "Duration",
    "aspect_label": "Aspect", "size_label": "Size", "style_label": "Style", "music_label": "Music",
    "captions_label": "Captions", "render_label": "Render", "none": "None", "on": "On", "off": "Off",
    "content": "Content", "download": "Download", "saved_to_cloud": "Saved to cloud", "save_project": "Save project",
    "change_regenerate": "Change & Regenerate", "change_music": "Change music", "change_style": "Change style",
    "regenerate": "Regenerate", "edit_again": "Edit again", "export_for": "Export for",
    "more_formats": "More formats", "play": "Play", "pause": "Pause", "full": "Full", "share": "Share",
    "export_other_format": "Export in another format", "loading_reel": "Loading your reel…",
    "could_not_open_reel": "Could not open this reel", "project_unavailable": "The project is unavailable.",
    "go_back": "Go back", "video_saved": "Video saved", "reel_saved_library": "Your finished reel is in your photo library.",
    "save_video_failed": "Could not save video", "allow_library_save": "Allow photo-library access to save the video.",
    "camera_mic_title": "Camera and microphone access needed",
    "camera_https_copy": "This local link cannot open a live camera. Use the button below to record with your phone camera or choose a saved clip.",
    "camera_permission_copy": "Allow both so ReelDirector can show shot guidance and record video with sound.",
    "phone_camera_clip_ready": "Phone camera clip ready", "record_or_choose_video": "Record or choose a video",
    "open_live_camera": "Open live camera", "live_camera": "Live camera preview", "checking_clip_frame": "Checking a frame from your clip…",
    "shot_counter": "SHOT {current}/{total}", "video_mode": "Video", "stabilized_mode": "Stabilized",
    "grid": "Grid", "flip_camera": "Flip camera",
    "use_your_audio": "Use your own audio", "current_music_mix": "Your music will be mixed with the sound recorded by the camera.",
    "import_audio_mix": "Import an audio file to mix it with your recorded clips.", "pause_preview": "Pause preview",
    "preview": "Preview", "remove": "Remove", "choose_different_audio": "Choose a different audio file",
    "choose_audio_file": "Choose audio file", "audio_file_note": "Supports common audio files up to 25 MB. Camera audio remains in the final video.",
    "apply_render_video": "Apply & render video",
    "custom_shoot_type": "Custom shoot type", "custom_shoot_help": "AI will adapt the storyboard to your idea.",
    "custom_shoot_example": "Example: Birthday Party, Bike Ride, College Fest", "cancel": "Cancel", "add": "Add",
    "shoot_type_wedding": "Wedding", "shoot_type_travel": "Travel", "shoot_type_food": "Food",
    "shoot_type_fashion": "Fashion", "shoot_type_gym": "Gym", "shoot_type_product": "Product",
    "shoot_type_real_estate": "Real estate", "shoot_type_cafe": "Cafe", "shoot_type_restaurant": "Restaurant",
    "shoot_type_event": "Event", "shoot_type_documentary": "Documentary", "shoot_type_business": "Business",
    "shoot_type_lifestyle": "Lifestyle", "shoot_type_daily_vlog": "Daily vlog", "shoot_type_social_media": "Social media",
    "shoot_type_cinematic": "Cinematic", "shoot_type_other": "Other", "mood_cinematic": "Cinematic", "mood_emotional": "Emotional",
    "mood_energetic": "Energetic", "mood_luxury": "Luxury", "mood_minimal": "Minimal", "mood_warm": "Warm",
    "template_wedding": "Wedding Cinema", "template_travel": "Travel Vlog", "template_food": "Food Cinematic",
    "template_fashion": "Fashion Editorial", "template_gym": "Gym Motivation", "template_real_estate": "Real Estate",
    "template_product": "Product Showcase", "template_viral": "Viral Reel",
    "template_mood_wedding": "Emotional • Romantic", "template_mood_travel": "Adventure • Wide",
    "template_mood_food": "Warm • Macro", "template_mood_fashion": "Bold • Editorial",
    "template_mood_gym": "High Energy", "template_mood_real_estate": "Luxury • Spacious",
    "template_mood_product": "Clean • Premium", "template_mood_viral": "Fast • Bold",
    "customize_storyboard": "Customize storyboard", "save": "Save", "description_label": "Description",
    "add_scene": "Add scene", "regenerate_scene": "Regenerate scene", "optional_ai_notes": "Optional notes to steer the AI.",
    "regen_notes_example": "Example: more dramatic, add golden hour light", "new_shot": "New Shot",
    "describe_shot": "Describe this shot", "hold_camera_steady": "Hold camera steady",
    "shot_size_extreme_wide": "Extreme wide", "shot_size_wide": "Wide", "shot_size_medium": "Medium",
    "shot_size_close_up": "Close-up", "shot_size_extreme_close_up": "Extreme close-up",
    "edit_filters_text_trim": "Edit filters, text & trim", "confirm_new_password": "Confirm new password",
    "request_another_link": "Request another link", "could_not_update_password": "Could not update your password. Please try again.",
    "environment_scan": "AI environment scan", "scan_explainer": "Scan the place you will film. The AI will use the scene and your description to write a custom shot plan.",
    "camera_access_needed": "Camera access needed", "scan_permission": "Allow camera access to scan the filming environment.",
    "grant_access": "Grant access", "scan_scene": "Scan scene", "analyzing_scene": "Analyzing scene…",
    "scene_analyzed": "Scene analyzed", "lighting": "Lighting", "composition": "Composition",
    "suggested_shots": "Suggested shots", "scan_again": "Scan again", "generate_script": "Use scan & write my script",
    "skip_scan": "Continue without a scan", "start_shooting": "Start shooting", "generating_story": "Writing your custom story…",
    "move_guide": "Movement guide", "live_director": "Live director", "director_checking": "Finding the best shot in this scene…",
    "director_refresh": "Get another direction",
    "flashlight": "Flashlight", "brightness": "Brightness",
    "zoom": "Zoom", "zoom_unavailable": "This camera cannot change zoom right now.",
    "brightness_up": "Increase brightness", "brightness_down": "Decrease brightness",
    "blur": "Blur", "exposure": "Exposure", "framing": "Framing", "stability": "Stability",
    "clip_saved": "Clip saved", "great_shot": "Great shot!", "retake_suggested": "Retake suggested",
    "retake_required": "Retake required", "your_shot": "Your shot · watch it back", "retake": "Retake",
    "next_shot": "Next shot", "finish_edit": "Finish & edit", "camera_movement_unavailable": "This browser cannot control the flashlight on this device.",
    "translation_loading": "Preparing your language…", "translation_failed": "Some labels may remain in English while offline.",
    "local_recovery_pending": "Your latest changes are saved on this device and will sync when you are back online.",
    "local_recovery_offline": "Showing the copy saved on this device. Reconnect to refresh your project and clips.",
    "local_recovery_conflict": "This project changed on another device. Your latest changes are safe on this device but need help to sync.",
    "project_load_failed": "Could not open this project. Check your connection and try again.",
    "sync_try_again": "Try again",
}
UI_TRANSLATION_CACHE: Dict[str, Dict[str, str]] = {"en": dict(UI_TRANSLATION_SOURCE)}

@api.get("/ui/translations/{language_code}")
async def translate_ui(language_code: str):
    code = language_code.lower()
    if code not in LANGUAGE_NAMES:
        raise HTTPException(404, "Choose a supported language.")
    if code not in UI_TRANSLATION_CACHE:
        language = LANGUAGE_NAMES[code]
        try:
            source_items = list(UI_TRANSLATION_SOURCE.items())
            translated_all: Dict[str, str] = {}
            for offset in range(0, len(source_items), 45):
                source_chunk = dict(source_items[offset:offset + 45])
                prompt = (
                    f"Translate each value in this JSON dictionary into natural, concise {language} suitable for a mobile video app. "
                    "Preserve every key and placeholder exactly, return only one JSON object, keep technical labels understandable, "
                    "and do not translate brand names or change numbers. Source dictionary: "
                    + json.dumps(source_chunk, ensure_ascii=False)
                )
                translated = extract_json(await chat_once(
                    "You are a professional mobile-app localization translator. Return valid JSON only.", prompt,
                ))
                if not isinstance(translated, dict):
                    raise ValueError("translation response was not an object")
                translated_all.update({
                    key: str(translated.get(key) or value)
                    for key, value in source_chunk.items()
                })
            UI_TRANSLATION_CACHE[code] = translated_all
        except Exception as error:
            log.warning("UI translation unavailable for %s: %s", code, error)
            raise HTTPException(503, "Translations are temporarily unavailable. Try again when online.")
    return {"language": code, "translations": UI_TRANSLATION_CACHE[code]}

STORYBOARD_SYSTEM = """You are a culturally informed film director and short-form video scriptwriter.
Return ONLY one JSON object with `title`, `concept`, `style`, `goal`, `totalDuration`, `hook`, `cta`, and `shots`. Return 4 to 8 shots. Each shot includes `shotNumber` (1-based), `purpose` (hook/detail/action/hero/cta), `shotType`, `duration`, `cameraMovement`, `animationTemplate`, `subjectPosition`, `cameraStart`, `cameraEnd`, `instruction`, `voiceover`, `onScreenText`, and `difficulty` (easy/medium/advanced), plus `title` and `description`.
Use these movements: static, pan_left, pan_right, tilt_up, tilt_down, dolly_in, dolly_out, tracking, orbit, reveal, handheld. Use these shot types: extreme_wide, wide, medium, close_up, extreme_close_up. Durations must be 1.5 to 12 seconds and add up close to the requested total.
Keep each on-camera `instruction` to one simple sentence of 12 words or fewer, in the requested language. It must tell the creator what to frame, what single move to make, and where to finish; beginner wording uses everyday words and no camera jargon. Make `cameraStart`, `cameraEnd`, and `subjectPosition` agree with the instruction and movement animation. Keep descriptions to one useful sentence. Voiceover and on-screen text are optional; use empty strings when they do not help the story.
Write `concept` as a warm, natural mini-script of 2–4 flowing sentences that could be spoken by a real person. Tell this creator's specific story and emotional progression; do not summarize the production plan or write a list of commands. Give each shot description a human reason to care about the moment, while keeping camera instructions separate and brief. Use natural phrasing and varied rhythm; avoid stock openings, clichés, generic praise, filler, stiff AI-sounding language, and repeated wording. Add concise, speakable voiceover only when it strengthens this story; otherwise leave it empty. Keep on-screen text short and purposeful.
Build a beginning, middle, and ending that tells this user's story. Make the opening a visual hook or reveal, not an automatic generic wide shot. Each later shot must add a new story beat, subject, scale, or angle; finish with a memorable payoff or a goal-specific invitation. For an office, showroom, shop, or interior showcase, reveal the entrance or strongest real view first, then show the space, distinctive features, real activity if present, and a final hero view. Use opening doors only when the scan or creator confirms doors. For a ceremony, build from anticipation and meaningful details toward authentic people or rituals only when present, then a personal closing memory. For travel, reveal the place, guide the viewer through a safe path, show a distinctive landmark or texture, and finish on the strongest view. For other ideas, derive a fresh arc from the creator's explanation rather than reusing a category template.
No prose outside JSON. Be specific to the user's purpose and audience. Infer cultural meaning from clear event names (for example, a mehndi is commonly a South Asian pre-wedding celebration centered on henna art, close family moments, music, and ritual); use that understanding respectfully, adapt details to the supplied scene scan, and never invent people or rituals that the user did not describe or the image does not support. Use the scan to select real visible subjects, positions, backgrounds, and feasible moves; name the chosen subject in each relevant shot. Without a reliable scan, use only objects and actions the creator described, and give a shootable framing plan that can be adapted to the real location. Never write a direction that could fit any reel unchanged: replace vague lines like “show the scene,” “film a detail,” or “move closer” with a named target, clear starting frame, one controlled move, and a clear ending frame. Vary shot size and movement without repeating the same subject unnecessarily. Before returning JSON, silently review every shot for story progression, filmability, scan truth, and a movement that matches its animation; rewrite any weak or generic shot."""

STORY_PHASES = ("hook", "detail", "action", "hero", "cta")


def normalise_storyboard_shot(shot: Any, index: int, total: int) -> Dict[str, Any]:
    if not isinstance(shot, dict):
        raise ValueError("storyboard shot must be an object")
    movement = str(shot.get("cameraMovement") or shot.get("camera_movement") or "static").strip().lower()
    shot_type = str(shot.get("shotType") or shot.get("shot_size") or "medium").strip().lower()
    instruction = str(shot.get("instruction") or shot.get("direction") or "").strip()
    direction = str(shot.get("direction") or instruction).strip()
    title = str(shot.get("title") or "").strip()
    description = str(shot.get("description") or "").strip()
    duration = float(shot.get("duration", shot.get("duration_seconds", 0)))
    if not title or not description or not instruction or not direction:
        raise ValueError("storyboard shot text is incomplete")
    if not 1.5 <= duration <= 12:
        raise ValueError("storyboard shot duration is invalid")
    if index == 0:
        default_phase = "hook"
    elif index == total - 1:
        default_phase = "cta"
    else:
        middle_phases = ("detail", "action", "hero")
        phase_index = round((index - 1) * (len(middle_phases) - 1) / max(1, total - 2))
        default_phase = middle_phases[phase_index]
    phase = str(shot.get("purpose") or default_phase).lower()
    if phase not in STORY_PHASES:
        phase = default_phase
    voiceover = str(shot.get("voiceover") or shot.get("narration") or "")
    on_screen_text = str(shot.get("onScreenText") or shot.get("on_screen_text") or "")
    return {
        **shot, "shotNumber": index + 1, "index": index, "purpose": phase,
        "shotType": shot_type, "shot_size": shot_type,
        "duration": duration, "duration_seconds": duration,
        "cameraMovement": movement, "camera_movement": movement,
        "animationTemplate": str(shot.get("animationTemplate") or f"{movement}_01"),
        "subjectPosition": str(shot.get("subjectPosition") or "center"),
        "cameraStart": str(shot.get("cameraStart") or ""),
        "cameraEnd": str(shot.get("cameraEnd") or ""),
        "instruction": instruction, "direction": direction,
        "voiceover": voiceover, "narration": voiceover,
        "onScreenText": on_screen_text, "on_screen_text": on_screen_text,
        "difficulty": shot.get("difficulty") or "easy",
        "status": shot.get("status") or "pending",
    }


def normalise_storyboard(shots: Any) -> List[Dict[str, Any]]:
    if not isinstance(shots, list) or not 4 <= len(shots) <= 8:
        raise ValueError("storyboard must contain four to eight shots")
    return [normalise_storyboard_shot(shot, index, len(shots)) for index, shot in enumerate(shots)]


def storyboard_is_valid(shots: Any) -> bool:
    try:
        normalise_storyboard(shots)
        return True
    except (TypeError, ValueError):
        return False


def fallback_storyboard(doc: Dict[str, Any]) -> tuple[str, List[Dict[str, Any]]]:
    """Build a purpose-led offline script when Gemini is unavailable.

    This is deliberately grounded in the creator's wording and (when available)
    the environment scan, instead of substituting a generic shot list.
    """
    duration = max(1, int(round(float(doc.get("duration_seconds") or 30))))
    count = max(4, min(8, int(math.ceil(duration / 6))))
    shot_duration = round(duration / count, 1)
    durations = [shot_duration] * count
    durations[-1] = round(duration - sum(durations[:-1]), 1)
    title = str(doc.get("title") or "Your video").strip()
    purpose = str(doc.get("purpose") or title).strip()
    subject = purpose if len(purpose) <= 92 else purpose[:89].rsplit(" ", 1)[0] + "…"
    scan = doc.get("scene_map") or {}
    scan_summary = str(scan.get("summary") or "").strip() if scan.get("ai_generated", True) else ""
    scene_elements: List[str] = []
    scene_positions: Dict[str, str] = {}
    if scan.get("ai_generated", True):
        scanned = scan.get("focus_elements") or []
        for item in scanned:
            name = item.get("name") if isinstance(item, dict) else item
            if isinstance(name, str) and name.strip():
                scene_elements.append(name.strip())
                if isinstance(item, dict) and item.get("position") in {"left", "center", "right", "foreground", "background"}:
                    scene_positions[name.strip()] = item["position"]
        for field in ("objects", "subjects"):
            values = scan.get(field) or []
            if isinstance(values, list):
                scene_elements.extend(name.strip() for name in values if isinstance(name, str) and name.strip())
        scene_elements = list(dict.fromkeys(scene_elements))[:5]
    scan_context = f"Use the scanned setting ({scan_summary}) as the visual anchor. " if scan_summary else "Use only details that are actually visible in the filming environment. "
    mood = (doc.get("mood") or doc.get("style") or "cinematic").strip()
    lower = f"{title} {purpose} {doc.get('shoot_type') or ''}".casefold()
    if any(word in lower for word in ("mehndi", "mehendi", "henna")):
        blueprints = [
            ("The mehndi setting", f"Introduce {subject} with the decorated setting and atmosphere that are actually visible.", "static", "wide", "Begin with a steady wide frame; include only the decor and people present."),
            ("Henna detail", "If henna is being applied, follow the pattern taking shape; otherwise frame a finished design that is visible.", "dolly_in", "close_up", "Move in slowly toward the visible henna detail and hold focus on the pattern."),
            ("Personal detail", "Capture a visible detail of clothing, jewelry, hands, or decor that supports this celebration.", "static", "extreme_close_up", "Choose one real detail in the scene, move close, and keep the phone still."),
            ("A human moment", "If guests are present, capture a natural shared moment; if not, stay with the celebration details in frame.", "tracking", "medium", "Follow a real moment gently; do not ask anyone to pose unless the creator wants that."),
            ("Celebration texture", "Use the scanned surroundings and the creator's notes to find a second distinctive celebration detail.", "tilt_down", "close_up", "Tilt slowly from the visible setting to one detail that makes this mehndi personal."),
            ("Closing memory", "End on the most expressive real detail from the mehndi, holding a calm final frame.", "reveal", "medium", "Make a small, smooth reveal and pause on the strongest detail before stopping."),
            ("Quiet beat", "Add a still moment that lets the henna design and celebration atmosphere register.", "static", "close_up", "Hold a steady close frame on a visible henna or decor detail."),
            ("Final frame", "Return to the clearest visible part of this celebration to complete its story.", "pan_right", "wide", "Pan gently across the scene and finish on the best-lit real detail."),
        ]
    elif any(word in lower for word in ("office", "showroom", "workspace", "workplace", "business", "real_estate", "salon", "clinic", "studio", "store", "shop")):
        scan_words = " ".join([scan_summary, *scene_elements]).casefold()
        opening = "Start at the visible doorway; glide forward to reveal the showroom." if any(
            word in scan_words for word in ("door", "entrance", "entry")
        ) else "Start with the widest clear view; glide forward to reveal the main space."
        blueprints = [
            ("The first impression", f"Reveal {subject} through the clearest real view of the office or showroom.", "reveal", "wide", opening),
            ("The signature area", "Show the part of the space that best explains what this business offers.", "pan_right", "wide", "Pan right from the entrance toward the most distinctive area."),
            ("A working moment", "Show genuine work or service only when a person is visibly doing it.", "tracking", "medium", "Move past the real activity at a calm, even pace."),
            ("A crafted detail", "Feature a distinctive finish, display, tool, or feature that is actually present.", "dolly_in", "close_up", "Start with the feature in context; move closer and hold on its detail."),
            ("The customer view", "Show how a visitor would naturally see and move through this space.", "pan_left", "wide", "Pan left across the clear path a visitor would follow."),
            ("The hero space", "End on the clearest view of the space that matches the creator's goal.", "dolly_out", "wide", "Start on the main feature; step back to reveal the full space."),
            ("One final detail", "Add a second real feature that gives the place its own character.", "tilt_down", "close_up", "Tilt down slowly and finish on the most distinctive visible detail."),
            ("A clean close", "Leave the viewer with a memorable, uncluttered view of the real space.", "static", "wide", "Frame the strongest view; hold steady for a clean final beat."),
        ]
    elif any(word in lower for word in ("wedding", "ceremony", "haldi", "engagement", "reception", "anniversary")):
        blueprints = [
            ("Before the moment", f"Establish the real setting and anticipation around {subject}.", "static", "wide", "Start wide on the actual setting; hold for a quiet opening beat."),
            ("A meaningful detail", "Show a real object or decoration that matters to this ceremony.", "dolly_in", "close_up", "Move slowly toward one meaningful visible detail and hold."),
            ("Getting ready", "Include preparation only if it is happening in the scene.", "tracking", "medium", "Follow one real preparation moment with a smooth, level move."),
            ("The connection", "Capture a genuine interaction when people are present; never stage a ritual.", "pan_right", "medium", "Pan gently toward a real interaction and hold on the shared moment."),
            ("The central moment", "Build toward the creator's named highlight, only if it is visible or described.", "reveal", "close_up", "Let the real highlight enter frame; stop moving once it is clear."),
            ("A lasting memory", "Finish on the strongest authentic detail or moment from this ceremony.", "dolly_out", "wide", "Ease back from the highlight to include its real surroundings."),
            ("A softer beat", "Add one calm detail that supports the feeling of this occasion.", "tilt_up", "close_up", "Tilt up from the detail and finish on its full context."),
            ("The final frame", "End on a clear image that feels personal to this event.", "static", "medium", "Frame the strongest real moment and hold still to finish."),
        ]
    elif any(word in lower for word in ("birthday", "anniversary", "celebration", "party")):
        blueprints = [
            ("Set the scene", f"Introduce {subject} through the actual location and decorations in view.", "static", "wide", "Start wide and let the viewer understand the real setting."),
            ("A detail to remember", "Move to a specific visible decoration, keepsake, or detail named by the creator.", "dolly_in", "close_up", "Approach one visible detail slowly and keep it centered."),
            ("The people", "If people are present, capture a natural interaction; otherwise stay with the details that are there.", "tracking", "medium", "Follow a genuine moment smoothly without staging one."),
            ("The highlight", "Give the creator's named highlight its own clear moment, only if it is present in the scene.", "static", "close_up", "Hold steady on the real highlight described for this video."),
            ("Atmosphere", "Show how the setting feels through a small movement across the visible space.", "pan_left", "wide", "Pan slowly across the actual room or gathering."),
            ("Closing memory", "End on the strongest visible moment that best expresses this celebration.", "reveal", "medium", "Ease into the strongest real detail and hold for a clean ending."),
            ("Small detail", "Add a close detail that makes this celebration distinct from a generic party video.", "tilt_down", "extreme_close_up", "Tilt gently toward a detail the creator mentioned or the camera can see."),
            ("Final frame", "Return to the celebration's main subject for a simple final image.", "static", "wide", "Reframe the main visible subject and hold still."),
        ]
    elif any(word in lower for word in ("food", "recipe", "dish", "cooking", "cafe", "restaurant")):
        blueprints = [
            ("The setting", f"Introduce {subject} with the real kitchen, table, or dining setting in view.", "static", "wide", "Start with a steady frame of the actual setting."),
            ("Texture close-up", "Show the most appetizing visible texture or ingredient mentioned by the creator.", "dolly_in", "extreme_close_up", "Move in slowly and hold on a real texture or ingredient."),
            ("Making moment", "If preparation is happening, follow one clear action; otherwise focus on the finished dish.", "tracking", "medium", "Track one real action smoothly, or hold on the plated food."),
            ("Final presentation", "Give the finished food or the creator's stated highlight a clean hero frame.", "reveal", "close_up", "Reveal the finished dish with one small, controlled move."),
            ("Second detail", "Capture another distinct, visible ingredient or serving detail for visual rhythm.", "tilt_down", "close_up", "Tilt gently to one detail that is actually present."),
            ("Closing frame", "Finish on the finished dish and leave a moment for the viewer to take it in.", "static", "medium", "Center the dish and hold the camera still for the last beat."),
            ("Atmosphere", "Show the real place and mood around the food without inventing a restaurant or a cook.", "pan_right", "wide", "Pan slowly across the available setting."),
            ("Last detail", "End with a tight frame on the dish detail the creator most wants viewers to notice.", "dolly_in", "close_up", "Ease into the selected detail and stop moving before the shot ends."),
        ]
    elif any(word in lower for word in ("product", "launch", "brand", "shop", "review", "unboxing")):
        blueprints = [
            ("Product introduction", f"Introduce {subject} using the actual product and setting available.", "static", "wide", "Start with a clean wide frame that keeps the product recognizable."),
            ("Signature detail", "Feature one real design detail or feature named by the creator.", "dolly_in", "close_up", "Move in slowly toward the named feature and keep it in focus."),
            ("In use", "If the product is being used, show that real use; otherwise reveal another visible angle.", "tracking", "medium", "Follow the actual use smoothly, or move around the product a little."),
            ("Material and finish", "Show the product's visible texture, finish, or packaging without adding claims.", "tilt_down", "extreme_close_up", "Tilt slowly over the real material or finish."),
            ("Hero view", "Give the product a clear hero frame with the background present in the scan.", "reveal", "medium", "Reveal the product with a small, steady movement."),
            ("Closing detail", "End on the product feature that best matches the creator's stated goal.", "static", "close_up", "Hold on that real feature long enough to read and recognize it."),
            ("Alternate angle", "Add one distinct angle so the edit does not repeat the opening composition.", "pan_left", "wide", "Pan gently to a second real angle of the product."),
            ("Final hero frame", "Return to the product for a simple, upload-ready final image.", "static", "medium", "Center the product and keep the phone still."),
        ]
    elif any(word in lower for word in ("travel", "trip", "holiday", "vacation", "visit")):
        blueprints = [
            ("Arrive in the scene", f"Introduce {subject} through the place and landscape actually visible.", "static", "wide", "Start wide and hold still so the viewer can read the location."),
            ("A place detail", "Move in on a visible landmark, texture, sign, or landscape detail relevant to the description.", "dolly_in", "close_up", "Approach one visible detail at a slow, even pace."),
            ("Move through it", "Show a safe, walkable part of the real environment from the creator's point of view.", "tracking", "medium", "Walk slowly and keep the phone level while following the path."),
            ("Look around", "Reveal a second angle of the scanned location to make the place feel specific.", "pan_right", "wide", "Pan gently across the real surroundings."),
            ("Small discovery", "Capture one smaller detail that a quick wide shot would miss.", "tilt_down", "close_up", "Tilt slowly to a detail that is actually in view."),
            ("Last look", "Finish with the clearest view of the actual place from the creator's description.", "reveal", "wide", "Ease into the strongest real view and hold the final frame."),
            ("Travel texture", "Add a close-up of a real color, surface, or object from this location.", "static", "extreme_close_up", "Frame a real texture and hold it steady."),
            ("Closing view", "Return to the main landmark or landscape and leave a quiet ending.", "static", "wide", "Settle on the best visible view and stop moving."),
        ]
    else:
        blueprints = [
            ("Opening context", f"Introduce {subject} through the real setting and details the creator described.", "static", "wide", "Start wide and show the actual environment before moving closer."),
            ("Named detail", f"Feature a specific detail connected to {subject}, using only what is visible or described.", "dolly_in", "close_up", "Move slowly toward one real detail from the creator's description."),
            ("A moment in motion", "Show the main action if it is happening; if not, reveal a second angle of the subject.", "tracking", "medium", "Follow the real action smoothly, or move gently to a new angle."),
            ("Texture and mood", f"Use framing and light to give {subject} the requested {mood} feel.", "tilt_up", "close_up", "Tilt slowly across a visible detail and keep the phone steady."),
            ("Second perspective", "Add a different composition that gives this specific idea more context.", "pan_left", "wide", "Pan across the actual setting without adding unseen objects."),
            ("Closing image", "Finish on the clearest real detail that expresses the creator's intended story.", "reveal", "medium", "Make one gentle reveal and hold the strongest visible image."),
            ("A quieter beat", "Leave a brief, steady moment on the subject or detail described by the creator.", "static", "close_up", "Hold still on the detail that best represents this video."),
            ("Final frame", "Return to the main subject for a clean ending that fits the requested platform.", "static", "wide", "Reframe the main subject and hold the phone steady."),
        ]

    shots = []
    scene_directions = {
        "static": "Frame {subject} within its setting; hold steady for a clean beat.",
        "pan_left": "Start beside {subject}; pan left slowly to reveal more of the setting.",
        "pan_right": "Start beside {subject}; pan right slowly to reveal more of the setting.",
        "tilt_up": "Start low on {subject}; tilt up slowly to reveal its full form.",
        "tilt_down": "Start above {subject}; tilt down slowly and settle on its key detail.",
        "dolly_in": "Start wide on {subject}; move closer slowly and hold on its detail.",
        "dolly_out": "Start close on {subject}; step back slowly to reveal its setting.",
        "tracking": "Move past {subject} slowly; keep it framed and the phone level.",
        "orbit": "Move in a short, steady arc around {subject}; keep it centered.",
        "reveal": "Let {subject} enter from frame right; stop once it is fully revealed.",
        "handheld": "Frame {subject} at chest height; move slowly without shaking.",
    }
    for index in range(count):
        title, description, movement, size, direction = blueprints[index]
        if index > 0 and scene_elements:
            element = scene_elements[(index - 1) % len(scene_elements)]
            visible_name = element if element.lower().startswith(("a ", "an ", "the ")) else f"the {element}"
            title = f"{title}: {element}"
            description = f"Feature {visible_name}, identified in the scene scan. {description}"
            direction = scene_directions.get(movement, "Frame {subject} clearly; move slowly and finish on its strongest detail.").format(subject=visible_name)
            position = scene_positions.get(element)
            if position in {"left", "center", "right"} and movement == "static":
                direction = f"Keep {visible_name} in the {position} third; hold steady for a clean beat."
        shots.append({
            "index": index,
            "title": f"{title} · {subject[:40]}",
            "description": f"{scan_context}{description} Keep the {mood} feeling consistent.",
            "camera_movement": movement,
            "shot_size": size,
            "duration_seconds": durations[index],
            "direction": direction,
            "status": "pending",
        })
    scene_line = f"Use the scanned setting, {scan_summary}, as the visual anchor." if scan_summary else "Build from the details the creator actually entered and the real setting on camera."
    platform = str(doc.get("platform") or "short-form video")
    audience = str(doc.get("audience") or "its intended audience")
    script = (f"Tell the story of {purpose} in a {mood} style for {platform}. "
              f"{scene_line} Move from the real context into the details that make this video personal, "
              f"then finish on a clear final image for {audience}.")
    return script, shots


@api.post("/projects/{pid}/storyboard")
async def generate_storyboard(pid: str, body: Optional[StoryboardRequest] = None, user=Depends(current_user)):
    doc = await fetch_project(pid, user["id"])
    if not doc:
        raise HTTPException(404, "Project not found")

    selected_code = str((body.language if body and body.language else doc.get("language")) or "en").lower()
    language = LANGUAGE_NAMES.get(selected_code, "English")
    if selected_code in LANGUAGE_NAMES:
        doc["language"] = selected_code
    scene_map = doc.get("scene_map") or {}
    scene_context = (
        json.dumps(scene_map, ensure_ascii=False)
        if scene_map and scene_map.get("ai_generated", True)
        else "No reliable AI environment scan was available. Use the creator's description and title only."
    )
    style_context = creator_style_prompt(user.get("creator_style_profile", {})) if doc.get("use_creator_style") else ""
    prompt = f"""Create a highly customized script and shot list in {language} for this video:
Title: {doc['title']}
Type: {doc['shoot_type']}
Creator's explanation of the video and desired story: {doc['purpose'] or 'No additional explanation was supplied; infer only from the title and type.'}
Mood: {doc['mood'] or 'cinematic'}
Style: {doc['style']}
Platform: {doc['platform']}
Target duration: {doc['duration_seconds']} seconds
Audience: {doc['audience'] or 'general'}
Selected language: {language}
Creator skill level: {user.get('creator_skill_level', 'beginner')}
{style_context}
Environment scan: {scene_context}

Use the title and creator's explanation as the source of truth. Notice cultural/event references and make the storytelling, shot ideas, props/details, and narration fit that occasion. Use the environment scan to choose actual subjects, positions, backgrounds, lighting, and safe feasible framing; never claim a person or object is present unless the scan supports it. Return the complete structured storyboard with title, concept, style, goal, totalDuration, hook, cta, and 4 to 8 shots whose durations add up close to {doc['duration_seconds']} seconds. Write `concept` as a warm, natural 2–4 sentence mini-script in {language}, with phrasing a real person could say aloud. Tell this creator's specific story from its opening to an emotional payoff; do not make it a plan summary, shot list, or generic promotional copy. Make each shot `description` conversational and explain why that moment matters, while keeping the practical camera `instruction` short and separate. Use specific supported details, natural sentence rhythm, and avoid clichés, filler, exaggerated claims, and repeated phrases. Add concise, speakable `voiceover` only when it improves this story; otherwise leave it empty. Keep on-screen text short and worth reading.
Make it practical to film on a phone and tailored to {doc['platform']}. Match the creator skill level in every instruction and use everyday words. Every instruction must name its target, starting composition, one camera action, and finishing composition in 12 words or fewer. Fill `cameraStart`, `cameraEnd`, and `subjectPosition` with matching concrete framing details. Choose a visual story arc for this exact idea: for an office/showroom, use an entrance reveal only when one is visible or described, then the hero space, distinctive features, authentic activity, and final view; for ceremonies, move from anticipation through meaningful details to a real emotional payoff; for travel, reveal the location, move through it, find a distinctive detail, then end on its strongest view. For all other ideas, invent a fresh sequence from the creator's explanation. Use the stored creator style only as a light preference when it fits this description and setting. Make every shot filmable and different from the previous one. Do not use generic directions or repeat one object across the reel. Without a scan, do not invent props, people, doors, or actions. Before returning, silently critique each shot and rewrite any vague, repetitive, unsafe, scan-inconsistent, or movement-mismatched direction."""

    ai_generated = True
    script = ""
    try:
        raw = await chat_once(STORYBOARD_SYSTEM, prompt)
        response_data = extract_json(raw)
        if isinstance(response_data, dict):
            shots = normalise_storyboard(response_data.get("shots"))
            script = str(response_data.get("concept") or response_data.get("script") or "").strip()
            if not script:
                raise ValueError("storyboard concept is missing")
            plan = {
                "title": str(response_data.get("title") or doc.get("title") or "").strip(),
                "concept": script,
                "style": str(response_data.get("style") or doc.get("style") or "cinematic"),
                "goal": str(response_data.get("goal") or doc.get("purpose") or ""),
                "totalDuration": round(sum(shot["duration_seconds"] for shot in shots), 1),
                "hook": str(response_data.get("hook") or shots[0]["description"]),
                "cta": str(response_data.get("cta") or shots[-1]["description"]),
            }
        else:
            shots = normalise_storyboard(response_data)
            script = str(doc.get("script") or doc.get("purpose") or "").strip()
            plan = {
                "title": doc.get("title", ""), "concept": script,
                "style": doc.get("style") or "cinematic", "goal": doc.get("purpose") or "",
                "totalDuration": round(sum(shot["duration_seconds"] for shot in shots), 1),
                "hook": shots[0]["description"], "cta": shots[-1]["description"],
            }
    except Exception as e:
        log.warning("storyboard generation unavailable or invalid: %s", e)
        if storyboard_is_valid(doc.get("storyboard")):
            return {
                "storyboard": doc["storyboard"], "script": doc.get("script", ""),
                "ai_generated": doc.get("storyboard_ai_generated", True), "preserved_existing": True,
            }
        ai_generated = False
        script, shots = fallback_storyboard(doc)
        shots = normalise_storyboard(shots)
        plan = {
            "title": doc.get("title", ""), "concept": script,
            "style": doc.get("style") or "cinematic", "goal": doc.get("purpose") or "",
            "totalDuration": round(sum(shot["duration_seconds"] for shot in shots), 1),
            "hook": shots[0]["description"], "cta": shots[-1]["description"],
        }

    existing_status_by_index = {
        int(previous.get("index", index)): previous.get("status")
        for index, previous in enumerate(doc.get("storyboard") or [])
        if isinstance(previous, dict)
    }
    for i, s in enumerate(shots):
        previous_status = existing_status_by_index.get(i)
        s["status"] = previous_status if previous_status in {"captured", "retake"} else "pending"

    doc.update({"storyboard": shots, "storyboard_plan": plan, "script": script, "status": "storyboarded",
                "storyboard_ai_generated": ai_generated,
                "storyboard_user_edited": False,
                "updated_at": datetime.now(timezone.utc).isoformat()})
    await save_project(doc, user["id"])
    return {"storyboard": shots, "storyboard_plan": plan, "script": script, "ai_generated": ai_generated}


# ---------------- AI: Environment Scanner (vision) ----------------
SCAN_SYSTEM = """You are an expert cinematographer analyzing several views of one filming environment.
Compare all supplied frames as one place, then return ONLY a compact JSON object with these keys:
- summary (1 short sentence describing the scene)
- location_type (short label), environment (indoor/outdoor/unclear), main_subject (short label)
- light_direction (left/right/front/back/overhead/diffuse/unclear), movement_space (limited/moderate/open)
- available_movements (array chosen from: push_in, pull_back, pan_left, pan_right, tilt_up, tilt_down, orbit, top_down, static)
- recommended_angles (array chosen from: wide, eye_level, 45_degree, close_up, top_down)
- visual_warnings (array of visible filming issues; empty when none)
- lighting (one of: natural_bright, natural_soft, natural_low, indoor_warm, indoor_cool, mixed, backlit)
- lighting_quality_score (0-100)
- composition_score (0-100)
- subjects (array of short strings, what/who is in view)
- objects (array of short strings, notable objects)
- focus_elements (array of up to 3 objects with `name` and `position` (left/center/right/foreground/background/unclear)); prefer distinctive visible elements that could make a personalized shot
- background (short string, e.g., "cluttered", "clean", "urban", "nature")
- best_time_of_day (string)
- recommended_style (one of: cinematic, luxury, minimal, action, editorial, warm)
- suggested_shots (array of 3 short strings, e.g., "Wide static of window light", "Close-up of hands", "Tracking shot along counter")
- tips (array of 3 short actionable tips)
No prose. No markdown."""


@api.post("/scan")
async def scan_environment(body: SceneScanIn, user=Depends(current_user)):
    frames = [frame for frame in (body.frames or []) if frame][:2]
    if not frames and body.image_base64:
        frames = [body.image_base64]
    if not frames:
        raise HTTPException(400, "image_base64 required")
    scan_started = time.perf_counter()
    stage_started = scan_started
    doc = await fetch_project(body.project_id, user["id"]) if body.project_id else None
    project_fetch_ms = round((time.perf_counter() - stage_started) * 1000)
    if body.project_id and not doc:
        raise HTTPException(404, "Project not found")
    selected_code = str(body.language or (doc or {}).get("language") or "en").lower()
    language = LANGUAGE_NAMES.get(selected_code, "English")
    context = ""
    if doc:
        context = f"""Planned video title: {doc.get('title')}
Creator's explanation: {doc.get('purpose') or 'not supplied'}
Shoot type: {doc.get('shoot_type') or 'general'}
Keep event and cultural context in mind, but describe only visual evidence in the frame."""
    try:
        stage_started = time.perf_counter()
        raw = await chat_once(
            SCAN_SYSTEM,
            f"Analyze these {len(frames)} views of the same filming environment for the user's planned video. Combine evidence across views, avoid guessing objects that are not visible, and return all descriptive text in {language}.\n{context}",
            frames,
            model=GEMINI_SCAN_MODEL, max_output_tokens=512,
            thinking_level="minimal", max_attempts=1, timeout=(5, 8),
        )
        gemini_ms = round((time.perf_counter() - stage_started) * 1000)
        data = extract_json(raw)
        if not isinstance(data, dict):
            raise ValueError("bad scan json")
        data["ai_generated"] = True
    except Exception as e:
        log.exception("scan fail: %s", e)
        raise HTTPException(503, "AI scene analysis is temporarily unavailable. Please try again.") from e
    if doc:
        doc.update({"scene_map": data, "language": selected_code if selected_code in LANGUAGE_NAMES else doc.get("language", "en"),
                    "updated_at": datetime.now(timezone.utc).isoformat()})
        stage_started = time.perf_counter()
        await save_project(doc, user["id"])
        project_save_ms = round((time.perf_counter() - stage_started) * 1000)
    else:
        project_save_ms = 0
    log.info("scan timing project_fetch_ms=%s gemini_ms=%s project_save_ms=%s total_ms=%s frames=%s model=%s",
             project_fetch_ms, gemini_ms, project_save_ms,
             round((time.perf_counter() - scan_started) * 1000), len(frames), GEMINI_SCAN_MODEL)
    return data


# ---------------- AI: Director Instruction ----------------
DIRECTOR_SYSTEM = """You are a live film director giving one clear, practical instruction (up to 10 words)
to the person filming right now. Look at the current camera frame, the requested shot, and the scan of this exact place.
Return ONLY a compact JSON object:
- instruction (up to 10 words; name the visible target when possible and say where to stand or how to move, e.g. "Stand beside the statue; move closer" or "Frame the chair from its left side")
- arrow_direction (one of: none, up, down, left, right, forward, back, rotate_cw, rotate_ccw)
- ready (boolean, true if the frame already matches the desired shot well)
- confidence (0-100)
No prose. No markdown. Prefer a specific, scanned element that fits the requested story over generic camera advice. Use its scanned position when helpful. Only name an element that is supported by both the scan and the current frame; if the scan is empty, direct the user using only what is visible in the current frame. Give one instruction the user can act on immediately. Do not narrate the scan or repeat the shot description."""


@api.post("/director/instruct")
async def director_instruct(body: DirectorInstructionIn, user=Depends(current_user)):
    doc = await fetch_project(body.project_id, user["id"])
    if not doc or not doc.get("storyboard"):
        raise HTTPException(404, "Project or storyboard not found")
    if body.shot_index < 0 or body.shot_index >= len(doc["storyboard"]):
        raise HTTPException(400, "shot_index out of range")
    shot = doc["storyboard"][body.shot_index]
    selected_code = str(body.language or doc.get("language") or "en").lower()
    language = LANGUAGE_NAMES.get(selected_code, "English")
    prompt = f"""Desired shot:
Title: {shot['title']}
Description: {shot['description']}
Camera movement: {shot['camera_movement']}
Shot size: {shot['shot_size']}
Direction to person: {shot['direction']}
Creator's video purpose: {doc.get('purpose') or doc.get('title')}
Environment scan (visible subjects, objects and positions): {json.dumps(doc.get('scene_map') or {}, ensure_ascii=False)}
Reply in {language}.

Give the next short, scene-specific instruction. First choose the most relevant visible element from the scan and confirm it appears in this camera frame. Tell the person where to stand or how to frame/move so that element makes a strong shot. If no scanned element fits, name only an element clearly visible in the current frame."""
    try:
        images = [body.image_base64] if body.image_base64 else []
        raw = await chat_once(
            DIRECTOR_SYSTEM, prompt, images, max_output_tokens=128,
            thinking_level="minimal", max_attempts=1, timeout=(4, 8),
        )
        data = extract_json(raw)
        if not isinstance(data, dict):
            raise ValueError("bad instruct")
        data["personalized"] = True
    except Exception as e:
        log.warning("director fail: %s", e)
        data = {"instruction": shot["direction"][:40], "arrow_direction": "none",
                "ready": False, "confidence": 0, "personalized": False}
    return data


# ---------------- AI: Clip Quality ----------------
QUALITY_SYSTEM = """You are a QA cinematographer analyzing a still frame from a just-recorded clip.
Return ONLY a compact JSON object:
- overall_score (0-100)
- blur_score (0-100, higher = sharper)
- exposure_score (0-100)
- composition_score (0-100)
- stability_score (0-100, best guess)
- subject_visible (boolean)
- issues (array of short strings, max 3)
- recommendation (one of: keep, retake_optional, retake_required)
- reason (1 short sentence)
No prose. No markdown."""


@api.post("/clips/quality")
async def clip_quality(body: ClipQualityIn, user=Depends(current_user)):
    doc = await fetch_project(body.project_id, user["id"])
    if not doc:
        raise HTTPException(404, "Project not found")

    try:
        shot = (doc.get("storyboard") or [])[body.shot_index] if body.shot_index < len(doc.get("storyboard") or []) else {}
        selected_code = str(body.language or doc.get("language") or "en").lower()
        raw = await chat_once(
            QUALITY_SYSTEM,
            f"Duration: {body.duration_seconds:.1f}s. Planned shot: {json.dumps(shot, ensure_ascii=False)}. "
            f"The project is about: {doc.get('purpose') or doc.get('title')}. "
            f"Return all written feedback in {LANGUAGE_NAMES.get(selected_code, 'English')}. "
            "Rate whether this frame fits the requested shot, and give one actionable, kind suggestion.",
            [body.frame_base64],
        )
        data = extract_json(raw)
        if not isinstance(data, dict):
            raise ValueError("bad quality")
        data["review_available"] = True
    except Exception as e:
        log.warning("quality fail: %s", e)
        data = {"overall_score": None, "blur_score": None, "exposure_score": None, "composition_score": None,
                "stability_score": None, "subject_visible": None, "issues": [],
                "recommendation": "keep", "review_available": False,
                "reason": "Clip saved. Review this frame manually; automatic review is unavailable."}

    for storage_path in (body.frame_storage_path, body.video_storage_path):
        if storage_path and not storage_path.startswith(f"{user['id']}/{body.project_id}/"):
            raise HTTPException(400, "Media storage path must belong to this project")

    return data


# ---------------- AI video generation ----------------
@api.post("/projects/{pid}/ai-video")
async def start_ai_video(pid: str, body: AiVideoIn, user=Depends(current_user)):
    if not FAL_KEY:
        raise HTTPException(503, "AI video is not configured yet. Add FAL_KEY to the backend environment.")
    doc = await fetch_project(pid, user["id"])
    if not doc:
        raise HTTPException(404, "Project not found")
    shots = doc.get("storyboard") or []
    if body.shot_index < 0 or body.shot_index >= len(shots):
        raise HTTPException(400, "Choose a valid storyboard shot first.")
    if not body.prompt.strip() or len(body.prompt) > 1200:
        raise HTTPException(400, "Describe the video in 1 to 1200 characters.")
    if body.duration_seconds not in range(2, 16):
        raise HTTPException(400, "AI video clips must be 2 to 15 seconds long.")
    if body.aspect_ratio not in {"9:16", "1:1", "16:9", "4:3", "3:4"}:
        raise HTTPException(400, "Choose a supported aspect ratio.")
    if body.resolution not in {"720p", "1080p"}:
        raise HTTPException(400, "Choose 720p or 1080p.")

    jobs = doc.get("ai_video_jobs") or []
    if any(job.get("status") in {"IN_QUEUE", "IN_PROGRESS"} for job in jobs):
        raise HTTPException(409, "An AI video is already being generated for this project. Wait for it to finish first.")

    try:
        submitted = await provider_json(
            "POST", f"https://queue.fal.run/{FAL_VIDEO_MODEL}",
            {"Authorization": f"Key {FAL_KEY}", "Content-Type": "application/json"},
            {"prompt": body.prompt.strip(), "duration": body.duration_seconds,
             "aspect_ratio": body.aspect_ratio, "resolution": body.resolution,
             "enable_safety_checker": True},
        )
    except Exception as error:
        log.exception("fal video request could not be submitted")
        raise HTTPException(502, f"Could not start AI video generation: {error}")
    request_id = submitted.get("request_id")
    if not request_id or not re.fullmatch(r"[a-zA-Z0-9_-]{8,100}", str(request_id)):
        raise HTTPException(502, "The video provider returned an invalid job reference.")

    job_id = str(uuid.uuid4())
    job = {
        "id": job_id, "provider": "fal.ai", "provider_request_id": request_id,
        "status": "IN_QUEUE", "shot_index": body.shot_index,
        "prompt": body.prompt.strip(), "duration_seconds": body.duration_seconds,
        "aspect_ratio": body.aspect_ratio, "resolution": body.resolution,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    doc["ai_video_jobs"] = (jobs[-19:] + [job])
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await save_project(doc, user["id"])
    return {"job_id": job_id, "status": job["status"], "shot_index": body.shot_index}


@api.get("/projects/{pid}/ai-video/{job_id}")
async def get_ai_video_status(pid: str, job_id: str, user=Depends(current_user)):
    if not FAL_KEY:
        raise HTTPException(503, "AI video is not configured yet. Add FAL_KEY to the backend environment.")
    doc = await fetch_project(pid, user["id"])
    if not doc:
        raise HTTPException(404, "Project not found")
    jobs = doc.get("ai_video_jobs") or []
    job = next((item for item in jobs if item.get("id") == job_id), None)
    if not job:
        raise HTTPException(404, "AI video job not found")
    if job.get("status") in {"COMPLETED", "FAILED"}:
        return {"job_id": job_id, "status": job["status"], "error": job.get("error"),
                "shot_index": job.get("shot_index"), "video_storage_path": job.get("video_storage_path")}

    provider_id = str(job.get("provider_request_id") or "")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,100}", provider_id):
        raise HTTPException(502, "The saved video provider job reference is invalid.")
    auth = {"Authorization": f"Key {FAL_KEY}"}
    base = f"https://queue.fal.run/{FAL_VIDEO_MODEL}/requests/{provider_id}"
    try:
        status_data = await provider_json("GET", f"{base}/status", auth)
        status = str(status_data.get("status", "IN_PROGRESS")).upper()
        if status not in {"IN_QUEUE", "IN_PROGRESS", "COMPLETED"}:
            raise RuntimeError("The video provider returned an unknown job status")
        if status != "COMPLETED":
            job["status"] = status
            doc["updated_at"] = datetime.now(timezone.utc).isoformat()
            await save_project(doc, user["id"])
            return {"job_id": job_id, "status": status, "shot_index": job.get("shot_index"),
                    "queue_position": status_data.get("queue_position")}
        if status_data.get("error"):
            raise RuntimeError(str(status_data["error"])[:500])

        result = await provider_json("GET", base, auth)
        video_url = ((result.get("video") or {}).get("url") if isinstance(result, dict) else None)
        if not video_url:
            raise RuntimeError("The video provider completed without a video file")
        video_bytes = await download_remote_media(video_url, (".fal.media",))
        shot_index = int(job["shot_index"])
        storage_path = f"{user['id']}/{pid}/ai/{job_id}.mp4"
        await get_supabase().storage.from_("project-media").upload(
            storage_path, video_bytes, {"content-type": "video/mp4", "upsert": "false"},
        )
        previous_clips = [clip for clip in (doc.get("clips") or []) if clip.get("shot_index") == shot_index]
        clips = [clip for clip in (doc.get("clips") or []) if clip.get("shot_index") != shot_index]
        clips.append({
            "shot_index": shot_index, "duration_seconds": float(job.get("duration_seconds") or 5),
            "quality": {"review_available": False, "recommendation": "keep",
                        "reason": "AI-generated clip saved. Review it in the finished reel."},
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "video_storage_path": storage_path, "frame_storage_path": None,
            "ai_generated": True, "ai_provider": "fal.ai", "generation_job_id": job_id,
            "generated_prompt": job.get("prompt"),
        })
        clips.sort(key=lambda clip: clip.get("shot_index", 0))
        storyboard = doc.get("storyboard") or []
        if shot_index < len(storyboard):
            storyboard[shot_index]["status"] = "captured"
        job.update({"status": "COMPLETED", "video_storage_path": storage_path,
                    "completed_at": datetime.now(timezone.utc).isoformat()})
        doc.update({"clips": clips, "storyboard": storyboard, "ai_video_jobs": jobs,
                    "status": "shooting", "updated_at": datetime.now(timezone.utc).isoformat()})
        try:
            await save_project(doc, user["id"])
        except Exception:
            await get_supabase().storage.from_("project-media").remove([storage_path])
            raise
        old_paths = [clip.get("video_storage_path") for clip in previous_clips]
        old_paths += [clip.get("frame_storage_path") for clip in previous_clips]
        old_paths = [path for path in old_paths if path and path != storage_path]
        if old_paths:
            try:
                await get_supabase().storage.from_("project-media").remove(old_paths)
            except Exception:
                log.warning("unable to remove replaced shot media for %s", pid)
        return {"job_id": job_id, "status": "COMPLETED", "shot_index": shot_index,
                "video_storage_path": storage_path}
    except HTTPException:
        raise
    except Exception as error:
        log.exception("fal video generation failed")
        job.update({"status": "FAILED", "error": str(error)[:500]})
        doc.update({"ai_video_jobs": jobs, "updated_at": datetime.now(timezone.utc).isoformat()})
        try:
            await save_project(doc, user["id"])
        except Exception:
            log.exception("could not persist fal generation failure")
        raise HTTPException(502, f"AI video generation failed: {error}")


# ---------------- Export ----------------
async def signed_media_url(storage_path: str, expires_seconds: int = 7200) -> str:
    signed = await get_supabase().storage.from_("project-media").create_signed_url(storage_path, expires_seconds)
    url = signed.get("signedURL") or signed.get("signedUrl")
    if not url:
        raise RuntimeError("Supabase did not return a private media link")
    return url


async def start_creatomate_render(pid: str, doc: Dict[str, Any], clips: List[Dict[str, Any]],
                                  body: ExportIn, user_id: str, expected_prefix: str,
                                  width: int, height: int, editing_style: str,
                                  soundtrack_path: Optional[str], soundtrack: Dict[str, Any]) -> Dict[str, Any]:
    if not CREATOMATE_API_KEY:
        raise HTTPException(503, "Creatomate is not configured yet. Add CREATOMATE_API_KEY to the backend environment.")
    active = doc.get("creatomate_render_job") or {}
    if active.get("status") in {"planned", "waiting", "transcribing", "rendering", "FINALIZING"}:
        raise HTTPException(409, "A Creatomate render is already running for this project.")

    elements: List[Dict[str, Any]] = []
    cursor = 0.0
    for index, clip in enumerate(clips):
        duration = max(0.1, float(clip.get("duration_seconds") or 5))
        source = await signed_media_url(clip["video_storage_path"])
        video = {"name": f"Shot-{index + 1}", "type": "video", "track": 2,
                 "time": cursor, "duration": duration, "source": source, "fit": "cover"}
        if index:
            video["animations"] = [{"time": 0, "duration": 0.45, "transition": True,
                                    "type": "fade", "enable": "second-only"}]
        elements.append(video)
        if body.show_shot_titles:
            storyboard = doc.get("storyboard") or []
            shot_title = (storyboard[clip.get("shot_index", index)].get("title")
                          if clip.get("shot_index", index) < len(storyboard) else f"Shot {index + 1}")
            elements.append({
                "name": f"Shot-Title-{index + 1}", "type": "text", "track": 3,
                "time": cursor, "duration": min(duration, 2.8), "text": str(shot_title)[:90],
                "x": "7%", "y": "84%", "width": "86%", "height": "10%",
                "font_family": "Montserrat", "font_weight": "700", "font_size": "5 vmin",
                "fill_color": "#ffffff", "background_color": "rgba(0,0,0,0.55)",
                "background_x_padding": "8%", "background_y_padding": "15%",
            })
        cursor += duration
    if soundtrack_path:
        music_url = await signed_media_url(soundtrack_path)
        elements.append({"name": "Soundtrack", "type": "audio", "track": 1,
                         "time": 0, "duration": cursor, "source": music_url,
                         "loop": True, "volume": "30%", "audio_fade_in": 0.4,
                         "audio_fade_out": min(1.5, cursor / 4)})

    script = {"output_format": "mp4", "width": width, "height": height,
              "frame_rate": body.fps, "duration": cursor, "elements": elements}
    try:
        response = await provider_json(
            "POST", "https://api.creatomate.com/v2/renders",
            {"Authorization": f"Bearer {CREATOMATE_API_KEY}", "Content-Type": "application/json"},
            script,
        )
        render = response[0] if isinstance(response, list) and response else response
        render_id = str(render.get("id") or "") if isinstance(render, dict) else ""
        if not re.fullmatch(r"[a-zA-Z0-9_-]{8,120}", render_id):
            raise RuntimeError("Creatomate returned an invalid render reference")
    except Exception as error:
        log.exception("Creatomate render could not be submitted")
        raise HTTPException(502, f"Could not start Creatomate rendering: {error}")

    job_id = str(uuid.uuid4())
    doc["creatomate_render_job"] = {
        "id": job_id, "provider_render_id": render_id,
        "status": str(render.get("status") or "planned").lower(),
        "aspect_ratio": body.aspect_ratio, "resolution": body.resolution,
        "fps": body.fps, "editing_style": editing_style,
        "show_shot_titles": body.show_shot_titles,
        "duration_seconds": cursor,
        "music_title": soundtrack.get("title") if soundtrack_path else None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        await save_project(doc, user_id)
    except Exception as error:
        raise HTTPException(502, f"Creatomate started a render but the project could not save its status: {error}")
    return {"status": "processing", "job_id": job_id, "provider": "creatomate"}


@api.get("/projects/{pid}/creatomate-renders/{job_id}")
async def get_creatomate_render_status(pid: str, job_id: str, user=Depends(current_user)):
    if not CREATOMATE_API_KEY:
        raise HTTPException(503, "Creatomate is not configured yet. Add CREATOMATE_API_KEY to the backend environment.")
    doc = await fetch_project(pid, user["id"])
    if not doc:
        raise HTTPException(404, "Project not found")
    job = doc.get("creatomate_render_job") or {}
    if job.get("id") != job_id:
        raise HTTPException(404, "Creatomate render job not found")
    if job.get("status") == "COMPLETED":
        export = doc.get("export") or {}
        if export.get("storage_path"):
            export["url"] = await signed_media_url(export["storage_path"], 3600)
        return {"job_id": job_id, "status": "COMPLETED", "export": export}
    if job.get("status") == "FAILED":
        return {"job_id": job_id, "status": "FAILED", "error": job.get("error")}

    render_id = str(job.get("provider_render_id") or "")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,120}", render_id):
        raise HTTPException(502, "The saved Creatomate render reference is invalid.")
    headers = {"Authorization": f"Bearer {CREATOMATE_API_KEY}"}
    try:
        render = await provider_json("GET", f"https://api.creatomate.com/v2/renders/{render_id}", headers)
        status = str(render.get("status") or "planned").lower()
        if status == "failed":
            raise RuntimeError(str(render.get("error_message") or "Creatomate could not render this video")[:500])
        if status != "succeeded":
            job["status"] = status
            doc["updated_at"] = datetime.now(timezone.utc).isoformat()
            await save_project(doc, user["id"])
            return {"job_id": job_id, "status": status}

        output_url = str(render.get("url") or "")
        export_path = f"{user['id']}/{pid}/exports/{uuid.uuid4()}.mp4"
        rendered = await download_remote_media(output_url, (".creatomate.com",))
        job["status"] = "FINALIZING"
        doc["updated_at"] = datetime.now(timezone.utc).isoformat()
        await save_project(doc, user["id"])
        await get_supabase().storage.from_("project-media").upload(
            export_path, rendered, {"content-type": "video/mp4", "upsert": "false"},
        )
        url = await signed_media_url(export_path, 3600)
        style = job.get("editing_style") or doc.get("style", "cinematic")
        blurb = f"Your {style} reel '{doc.get('title', 'New reel')}' is ready to go viral."
        thumb = render.get("snapshot_url") or doc.get("thumbnail_url")
        export = {
            "url": url, "storage_path": export_path, "thumbnail_url": thumb,
            "aspect_ratio": job.get("aspect_ratio"), "resolution": job.get("resolution"),
            "fps": job.get("fps"), "duration_seconds": round(float(render.get("duration") or job.get("duration_seconds") or 0), 1),
            "size_mb": round(len(rendered) / (1024 * 1024), 1), "summary": blurb,
            "editing_style": style,
            "music": {"id": "uploaded-soundtrack", "title": job.get("music_title")} if job.get("music_title") else None,
            "captions": False, "shot_titles": bool(job.get("show_shot_titles")),
            "render_provider": "creatomate", "render_seconds": None,
            "exported_at": datetime.now(timezone.utc).isoformat(),
        }
        old_export_path = (doc.get("export") or {}).get("storage_path")
        job.update({"status": "COMPLETED", "completed_at": datetime.now(timezone.utc).isoformat()})
        doc.update({"status": "exported", "export": export, "export_url": url,
                    "thumbnail_url": thumb, "creatomate_render_job": job,
                    "updated_at": datetime.now(timezone.utc).isoformat()})
        try:
            await save_project(doc, user["id"])
        except Exception:
            await get_supabase().storage.from_("project-media").remove([export_path])
            raise
        if old_export_path and old_export_path != export_path:
            try:
                await get_supabase().storage.from_("project-media").remove([old_export_path])
            except Exception:
                log.warning("unable to remove replaced export %s", old_export_path)
        return {"job_id": job_id, "status": "COMPLETED", "export": export}
    except HTTPException:
        raise
    except Exception as error:
        log.exception("Creatomate render finalization failed")
        job.update({"status": "FAILED", "error": str(error)[:500]})
        doc.update({"creatomate_render_job": job, "updated_at": datetime.now(timezone.utc).isoformat()})
        try:
            await save_project(doc, user["id"])
        except Exception:
            log.exception("could not persist Creatomate render failure")
        raise HTTPException(502, f"Creatomate render failed: {error}")


@api.post("/projects/{pid}/export")
async def export_project(pid: str, body: ExportIn, user=Depends(current_user)):
    doc = await fetch_project(pid, user["id"])
    if not doc:
        raise HTTPException(404, "Project not found")

    clip_edits = {edit.shot_index: edit for edit in body.clip_edits}
    caption_edits = {edit.shot_index: edit for edit in body.caption_edits}
    clips = sorted(doc.get("clips", []), key=lambda clip: clip.get("shot_index", 0))
    clips = [clip for clip in clips if clip.get("video_storage_path")
             and clip_edits.get(int(clip.get("shot_index", -1)), ClipEditIn(
                 shot_index=int(clip.get("shot_index", -1)))).included]
    if not clips:
        raise HTTPException(400, "Record at least one video clip before exporting.")

    if body.clip_order:
        ordered_clips = []
        remaining = list(clips)
        for requested_shot in body.clip_order:
            match = next((clip for clip in remaining
                          if int(clip.get("shot_index", -1)) == requested_shot), None)
            if match is not None:
                ordered_clips.append(match)
                remaining.remove(match)
        clips = ordered_clips + remaining

    expected_prefix = f"{user['id']}/{pid}/"
    storyboard_by_shot = {
        index: shot for index, shot in enumerate(doc.get("storyboard") or []) if isinstance(shot, dict)
    }
    captions_applied = body.captions_enabled and any(
        str(storyboard_by_shot.get(int(clip.get("shot_index", -1)), {}).get("on_screen_text") or "").strip()
        for clip in clips
    )
    for clip in clips:
        if not clip["video_storage_path"].startswith(expected_prefix):
            raise HTTPException(400, "A clip is not stored in this project.")

    ratio_dimensions = {
        "9:16": (9, 16),
        "1:1": (1, 1),
        "16:9": (16, 9),
    }
    if body.aspect_ratio not in ratio_dimensions:
        raise HTTPException(400, "Choose 9:16, 1:1, or 16:9 for the export.")
    if body.resolution not in {"720p", "1080p"}:
        raise HTTPException(400, "Choose 720p or 1080p for the export.")
    if body.fps not in {24, 30, 60}:
        raise HTTPException(400, "Choose 24, 30, or 60 fps for the export.")
    if body.fit_mode not in {"fill", "fit"}:
        raise HTTPException(400, "Choose Fill frame or Fit whole clip for the export.")
    if body.render_provider not in {"ffmpeg", "creatomate"}:
        raise HTTPException(400, "Choose FFmpeg or Creatomate for rendering.")
    requested_style = body.editing_style or doc.get("style", "cinematic")
    supported_styles = {
        "original", "cinematic", "luxury", "minimal", "action", "editorial",
        "warm", "fast_pace", "mono", "vivid", "cool", "vintage", "soft",
    }
    if requested_style not in supported_styles:
        raise HTTPException(400, "Choose a supported visual style for the export.")

    supported_clip_filters = {"original", "warm", "cool", "mono", "vivid", "vintage", "soft"}
    normalized_edits: Dict[int, Dict[str, Any]] = {}
    normalized_captions: Dict[int, Dict[str, Any]] = {}
    for clip in clips:
        shot_index = int(clip.get("shot_index", -1))
        edit = clip_edits.get(shot_index, ClipEditIn(shot_index=shot_index))
        duration_seconds = max(0.0, float(clip.get("duration_seconds") or 0))
        trim_start = float(edit.trim_start_seconds or 0)
        trim_end = float(edit.trim_end_seconds) if edit.trim_end_seconds is not None else (duration_seconds or None)
        if not math.isfinite(trim_start) or trim_start < 0:
            raise HTTPException(400, f"Shot {shot_index + 1} has an invalid trim start.")
        if trim_end is not None and (not math.isfinite(trim_end) or trim_end <= trim_start + 0.1):
            raise HTTPException(400, f"Shot {shot_index + 1} needs at least 0.1 seconds between its in and out points.")
        if duration_seconds and trim_end is not None and trim_end > duration_seconds + 0.5:
            raise HTTPException(400, f"Shot {shot_index + 1} ends beyond the saved clip duration.")
        if edit.filter_preset not in supported_clip_filters:
            raise HTTPException(400, f"Shot {shot_index + 1} has an unsupported filter.")
        if not math.isfinite(float(edit.brightness)):
            raise HTTPException(400, f"Shot {shot_index + 1} has an invalid brightness value.")
        normalized_edits[shot_index] = {
            "trim_start_seconds": trim_start,
            "trim_end_seconds": trim_end,
            "filter_preset": edit.filter_preset,
            "brightness": max(-0.5, min(0.5, float(edit.brightness))),
        }

        caption = caption_edits.get(shot_index)
        trimmed_duration = max(0.15, (trim_end if trim_end is not None else duration_seconds) - trim_start)
        caption_start = float(caption.start_seconds) if caption else 0.0
        caption_end = float(caption.end_seconds) if caption and caption.end_seconds is not None else trimmed_duration
        position_x = float(caption.position_x) if caption else 50.0
        position_y = float(caption.position_y) if caption else 84.0
        caption_size = caption.size if caption else "medium"
        caption_font = caption.font if caption else "sans"
        if any(not math.isfinite(value) for value in (caption_start, caption_end, position_x, position_y)):
            raise HTTPException(400, f"Shot {shot_index + 1} has invalid caption settings.")
        if caption_start < 0 or caption_end <= caption_start or caption_end > trimmed_duration + 0.05:
            raise HTTPException(400, f"Shot {shot_index + 1} caption timing must fit inside its trimmed clip.")
        if not 0 <= position_x <= 100 or not 0 <= position_y <= 100:
            raise HTTPException(400, f"Shot {shot_index + 1} caption position is outside the video frame.")
        if caption_size not in {"small", "medium", "large"}:
            raise HTTPException(400, "Choose a supported caption size.")
        if caption_font not in {"sans", "serif", "mono", "bold", "condensed", "serif_bold"}:
            raise HTTPException(400, "Choose a supported caption font.")
        normalized_captions[shot_index] = {
            "start_seconds": caption_start,
            "end_seconds": min(trimmed_duration, caption_end),
            "position_x": position_x,
            "position_y": position_y,
            "size": caption_size,
            "font": caption_font,
        }

    if body.title_font not in {"sans", "serif", "mono", "bold", "condensed", "serif_bold"}:
        raise HTTPException(400, "Choose a supported title font.")
    if body.title_position not in {"top", "center", "bottom"}:
        raise HTTPException(400, "Choose a valid title position.")
    if body.title_color not in {"white", "gold", "pink", "black"}:
        raise HTTPException(400, "Choose a supported title color.")
    if body.title_size not in {"small", "medium", "large"}:
        raise HTTPException(400, "Choose a supported title size.")
    if (not 0 <= body.music_volume <= 1 or not 0 <= body.original_volume <= 1
            or not 0 <= body.voiceover_volume <= 1):
        raise HTTPException(400, "Audio levels must be between 0 and 100 percent.")
    title_text = re.sub(r"\s+", " ", body.title_text or "").strip()[:80]

    # Generate a short description. The finished media itself is rendered from
    # the actual recorded clips below; no demo video is substituted.
    style = doc.get("style", "cinematic")
    summary_prompt = f"""Write a 2-sentence exciting summary of a just-finished {style} short reel titled '{doc['title']}' for a creator. Return plain text only."""
    try:
        blurb = (await chat_once(
            "You are a hype copywriter for a viral reel app. Keep it under 40 words.",
            summary_prompt,
        )).strip()
    except Exception:
        blurb = f"Your {style} reel '{doc['title']}' is ready to go viral."

    thumb = TEMPLATES[0]["image"]
    for t in TEMPLATES:
        if t["id"] == doc.get("shoot_type"):
            thumb = t["image"]
            break

    width, height = ratio_dimensions[body.aspect_ratio]
    long_edge = 1080 if body.resolution == "1080p" else 720
    short_edge = long_edge
    ratio_short_edge = min(width, height)
    width = round(short_edge * width / ratio_short_edge)
    height = round(short_edge * height / ratio_short_edge)
    width -= width % 2
    height -= height % 2

    old_export_path = (doc.get("export") or {}).get("storage_path")
    soundtrack = doc.get("soundtrack") or {}
    soundtrack_path = soundtrack.get("storage_path")
    if soundtrack_path and not soundtrack_path.startswith(expected_prefix):
        raise HTTPException(400, "The soundtrack is not stored in this project.")
    voiceover = doc.get("voiceover") or {}
    voiceover_path = voiceover.get("storage_path")
    if voiceover_path and not voiceover_path.startswith(expected_prefix):
        raise HTTPException(400, "The voiceover is not stored in this project.")

    if body.render_provider == "creatomate":
        if voiceover_path:
            raise HTTPException(400, "Voiceover mixing is currently available with the built-in renderer.")
        return await start_creatomate_render(
            pid, doc, clips, body, user["id"], expected_prefix, width, height,
            requested_style, soundtrack_path, soundtrack,
        )

    started = time.monotonic()
    try:
        with tempfile.TemporaryDirectory(prefix="reeldirector-export-") as temp_dir:
            temp = Path(temp_dir)
            local_clips: List[Path] = []
            for index, clip in enumerate(clips):
                suffix = Path(str(clip["video_storage_path"])).suffix.lower()
                if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
                    suffix = ".mp4"
                source_clip = temp / f"source-{index}{suffix}"
                source_clip.write_bytes(await download_media(clip["video_storage_path"]))
                if not source_clip.stat().st_size:
                    raise RuntimeError("A saved video clip is empty")
                local_clip = temp / f"clip-{index}.mp4"
                clip_edit = normalized_edits.get(int(clip.get("shot_index", -1)), {})
                shot = storyboard_by_shot.get(int(clip.get("shot_index", -1)), {})
                caption_text = re.sub(r"\s+", " ", str(shot.get("on_screen_text") or "")).strip()[:180]
                caption_edit = normalized_captions.get(int(clip.get("shot_index", -1)), {})
                caption_file = None
                if body.captions_enabled and caption_text:
                    caption_file = temp / f"caption-{index}.txt"
                    caption_file.write_text(caption_text, encoding="utf-8")
                await asyncio.to_thread(
                    _normalize_video_clip, source_clip, local_clip, width, height, body.fps,
                    clip_edit.get("trim_start_seconds", 0), clip_edit.get("trim_end_seconds"),
                    clip_edit.get("filter_preset", "original"), body.fit_mode,
                    clip_edit.get("brightness", clip.get("brightness", 0)), caption_file,
                    caption_edit.get("start_seconds", 0), caption_edit.get("end_seconds"),
                    caption_edit.get("position_x", 50), caption_edit.get("position_y", 84),
                    caption_edit.get("size", "medium"), caption_edit.get("font", "sans"),
                )
                if not local_clip.stat().st_size:
                    raise RuntimeError("A saved video clip could not be normalized")
                local_clips.append(local_clip)

            concat_file = temp / "clips.txt"
            concat_file.write_text("".join(f"file '{path.name}'\n" for path in local_clips))
            output_file = temp / "render.mp4"
            local_soundtrack = None
            if soundtrack_path:
                local_soundtrack = temp / "soundtrack"
                local_soundtrack.write_bytes(await download_media(soundtrack_path))
                if not local_soundtrack.stat().st_size:
                    raise RuntimeError("The saved soundtrack is empty")
            local_voiceover = None
            if voiceover_path:
                local_voiceover = temp / "voiceover"
                local_voiceover.write_bytes(await download_media(voiceover_path))
                if not local_voiceover.stat().st_size:
                    raise RuntimeError("The saved voiceover is empty")

            await asyncio.to_thread(
                _run_video_render, concat_file, output_file, width, height,
                local_soundtrack, body.fps, requested_style, title_text, body.title_font,
                body.title_position, body.title_color, body.title_size,
                body.music_volume, body.original_volume, local_voiceover, body.voiceover_volume,
            )
            rendered = output_file.read_bytes()
    except HTTPException:
        raise
    except Exception as error:
        log.exception("video export failed")
        raise HTTPException(502, f"Could not render this video: {error}")

    export_path = f"{expected_prefix}exports/{uuid.uuid4()}.mp4"
    try:
        await get_supabase().storage.from_("project-media").upload(
            export_path, rendered, {"content-type": "video/mp4", "upsert": "false"},
        )
        signed = await get_supabase().storage.from_("project-media").create_signed_url(export_path, 3600)
        url = signed.get("signedURL") or signed.get("signedUrl")
        if not url:
            raise RuntimeError("Supabase did not return a download link")
    except Exception as error:
        log.exception("saving rendered video failed")
        raise HTTPException(502, f"Could not save the rendered video: {error}")

    duration = sum(
        max(0, (normalized_edits.get(int(clip.get("shot_index", -1)), {}).get("trim_end_seconds")
                or float(clip.get("duration_seconds") or 0))
             - normalized_edits.get(int(clip.get("shot_index", -1)), {}).get("trim_start_seconds", 0))
        for clip in clips
    )
    if requested_style == "fast_pace":
        duration *= 0.8
    export = {
        "url": url,
        "storage_path": export_path,
        "thumbnail_url": thumb,
        "aspect_ratio": body.aspect_ratio,
        "resolution": body.resolution,
        "fps": body.fps,
        "duration_seconds": round(duration, 1),
        "size_mb": round(len(rendered) / (1024 * 1024), 1),
        "summary": blurb,
        "editing_style": requested_style,
        "render_provider": "ffmpeg",
        "shot_titles": False,
        "title_overlay": bool(title_text),
        "title_text": title_text or None,
        "title_font": body.title_font if title_text else None,
        "title_position": body.title_position if title_text else None,
        "clip_order": [int(clip.get("shot_index", -1)) for clip in clips],
        "clip_edits": [
            {"shot_index": int(clip.get("shot_index", -1)), **normalized_edits.get(int(clip.get("shot_index", -1)), {})}
            for clip in clips
        ],
        "music_volume": body.music_volume,
        "original_volume": body.original_volume,
        "music": {"id": "uploaded-soundtrack", "title": soundtrack.get("title")} if soundtrack_path else None,
        "voiceover": {"title": voiceover.get("title")} if voiceover_path else None,
        "captions": captions_applied,
        "render_seconds": round(time.monotonic() - started, 1),
        "exported_at": datetime.now(timezone.utc).isoformat(),
    }

    doc.update({"status": "exported", "export": export, "edit_settings": body.dict(), "export_url": url,
                "thumbnail_url": thumb, "updated_at": datetime.now(timezone.utc).isoformat()})
    await save_project(doc, user["id"])
    if old_export_path and old_export_path != export_path:
        try:
            await get_supabase().storage.from_("project-media").remove([old_export_path])
        except Exception:
            log.warning("unable to remove old export %s", old_export_path)
    return export


# ---------------- Storyboard editing ----------------
@api.patch("/projects/{pid}/storyboard")
async def update_storyboard(pid: str, body: StoryboardPatch, user=Depends(current_user)):
    doc = await fetch_project(pid, user["id"])
    if not doc:
        raise HTTPException(404, "Project not found")
    # Reindex
    for i, s in enumerate(body.shots):
        s["index"] = i
        s.setdefault("status", "pending")
    doc.update({"storyboard": body.shots, "storyboard_user_edited": True,
                "updated_at": datetime.now(timezone.utc).isoformat()})
    await save_project(doc, user["id"])
    return {"storyboard": body.shots}


@api.post("/projects/{pid}/storyboard/regenerate")
async def regen_shot(pid: str, body: RegenShotIn, user=Depends(current_user)):
    doc = await fetch_project(pid, user["id"])
    if not doc or not doc.get("storyboard"):
        raise HTTPException(404, "Project or storyboard not found")
    shots = list(doc["storyboard"])
    if body.shot_index < 0 or body.shot_index >= len(shots):
        raise HTTPException(400, "shot_index out of range")

    existing = shots[body.shot_index]
    selected_code = str(body.language or doc.get("language") or "en").lower()
    language = LANGUAGE_NAMES.get(selected_code, "English")
    scan_context = doc.get("scene_map") or {}
    if scan_context.get("ai_generated") is False:
        scan_context = "No reliable AI environment scan was available. Use the creator's description and current shot only."
    style_context = creator_style_prompt(user.get("creator_style_profile", {})) if doc.get("use_creator_style") else ""
    prompt = f"""Regenerate shot #{body.shot_index + 1} for project '{doc['title']}' ({doc['shoot_type']}, {doc['style']}).
Creator's explanation: {doc.get('purpose') or 'not supplied'}
Selected language: {language}
Environment scan: {json.dumps(scan_context, ensure_ascii=False)}
Current shot: {json.dumps(existing)}
User notes: {body.notes or 'make it more cinematic'}
Creator skill level: {user.get('creator_skill_level', 'beginner')}
{style_context}
Return one shot object using the storyboard shot fields shotNumber, purpose, shotType, duration, cameraMovement, animationTemplate, subjectPosition, cameraStart, cameraEnd, instruction, voiceover, onScreenText, difficulty, title, and description. Keep all written fields in {language}. Make the description sound like a thoughtful human director explaining why this moment matters, not another command. Write any voiceover as a concise, natural spoken line that fits this exact video; leave it empty if it adds nothing. In 12 words or fewer, the separate camera instruction must name the real target, starting frame, one camera move, and ending frame. Make this shot advance the story and use a new composition; its animation, movement, start, and end must agree. Use only supported scan details, or only the creator's description when no reliable scan exists. Never use vague instructions such as “show the scene” or invent doors, people, objects, or actions. Silently check that the revised direction is specific, cinematic, practical to film, and distinct from adjacent shots."""
    try:
        raw = await chat_once("You are a culturally informed short-form film director. Return only one valid JSON shot object; do not include a storyboard wrapper or prose. Reject generic directions and require a named subject, purposeful composition, controlled camera move, and clear end frame.", prompt)
        newshot = extract_json(raw)
        if isinstance(newshot, list) and newshot:
            newshot = newshot[0]
        newshot = normalise_storyboard_shot(newshot, body.shot_index, len(shots))
        newshot["status"] = "pending"
        shots[body.shot_index] = newshot
    except Exception as e:
        log.warning("regen fail: %s", e)
        shots[body.shot_index] = {**existing, "status": "pending"}
    if selected_code in LANGUAGE_NAMES:
        doc["language"] = selected_code
    doc["storyboard"] = shots
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await save_project(doc, user["id"])
    return shots[body.shot_index]


@api.post("/projects/{pid}/clips/retake")
async def mark_retake(pid: str, body: RetakeIn, user=Depends(current_user)):
    """Mark a shot as pending retake and remove the last clip for that shot."""
    doc = await fetch_project(pid, user["id"])
    if not doc:
        raise HTTPException(404, "Project not found")
    clips = [c for c in doc.get("clips", []) if c.get("shot_index") != body.shot_index]
    storyboard = doc.get("storyboard") or []
    if 0 <= body.shot_index < len(storyboard):
        storyboard[body.shot_index]["status"] = "pending"
    doc.update({"clips": clips, "storyboard": storyboard,
                "updated_at": datetime.now(timezone.utc).isoformat()})
    await save_project(doc, user["id"])
    return {"ok": True, "shot_index": body.shot_index}


# ---------------- Mount ----------------
app.include_router(api)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    global supabase
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        log.warning("Supabase is not configured; authenticated routes will return 503")
        return
    supabase = await create_async_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


@app.on_event("shutdown")
async def _shutdown():
    if supabase is not None:
        await supabase.auth.close()
        if supabase._postgrest is not None:
            await supabase._postgrest.aclose()
        if supabase._storage is not None:
            await supabase._storage.aclose()
        await supabase.realtime.close()
