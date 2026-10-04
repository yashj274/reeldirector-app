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
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
FAL_KEY = os.environ.get("FAL_KEY", "")
FAL_VIDEO_MODEL = "fal-ai/wan/v2.7/text-to-video"
CREATOMATE_API_KEY = os.environ.get("CREATOMATE_API_KEY", "")
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
    image_base64: str  # jpeg base64 without header
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
    title_text: str = ""
    title_font: str = "sans"
    title_position: str = "bottom"
    title_color: str = "white"
    title_size: str = "medium"
    music_volume: float = 0.25
    original_volume: float = 0.8


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
    return {
        "id": str(account.id),
        "email": account.email,
        "name": metadata.get("name") or metadata.get("full_name") or "Director",
        "plan": metadata.get("plan", "free"),
    }

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
    }
    candidates = font_candidates.get(font_name, font_candidates["sans"])
    return next((path for path in candidates if path.is_file()),
                ROOT_DIR / "assets/fonts/SpaceMono-Regular.ttf")


def _escape_filter_path(path: Path) -> str:
    return path.as_posix().replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def _ffmpeg_executable() -> str:
    return shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()


def _run_video_render(concat_file: Path, output_file: Path, width: int, height: int,
                      soundtrack_file: Optional[Path], fps: int, editing_style: str,
                      title_text: str = "", title_font: str = "sans",
                      title_position: str = "bottom", title_color: str = "white",
                      title_size: str = "medium", music_volume: float = 0.25,
                      original_volume: float = 0.8) -> None:
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
    has_original_audio = False
    if soundtrack_file:
        first_entry = next((line for line in concat_file.read_text().splitlines() if line.startswith("file ")), "")
        first_name = first_entry[5:].strip().strip("'").strip('"')
        first_clip = Path(first_name)
        if not first_clip.is_absolute():
            first_clip = concat_file.parent / first_clip
        probe = subprocess.run(
            [ffmpeg, "-i", str(first_clip)],
            check=False, capture_output=True, text=True, timeout=30,
        )
        has_original_audio = "Audio:" in probe.stderr
        command.extend(["-stream_loop", "-1", "-i", str(soundtrack_file)])
    command.extend(["-vf", video_filter, "-map", "0:v:0"])
    if soundtrack_file and has_original_audio:
        command.extend([
            "-filter_complex",
            f"[0:a]{'atempo=1.25,' if editing_style == 'fast_pace' else ''}volume={max(0.0, min(1.0, original_volume))}[original];"
            f"[1:a]volume={max(0.0, min(1.0, music_volume))}[music];"
            "[original][music]amix=inputs=2:duration=first:dropout_transition=2[aout]",
            "-map", "[aout]",
        ])
    elif soundtrack_file:
        command.extend(["-map", "1:a:0", "-filter:a", f"volume={max(0.0, min(1.0, music_volume))}"])
    else:
        command.extend(["-map", "0:a?"])
        if editing_style == "fast_pace":
            command.extend(["-filter:a", f"atempo=1.25,volume={max(0.0, min(1.0, original_volume))}"])
        else:
            command.extend(["-filter:a", f"volume={max(0.0, min(1.0, original_volume))}"])
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
                          brightness: float = 0.0) -> None:
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
def _send_gemini_response(system: str, prompt: str, images: Optional[List[str]] = None) -> str:
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

    request_url = GEMINI_GENERATE_CONTENT_URL.format(model=GEMINI_MODEL)
    request_headers = {
        "x-goog-api-key": GEMINI_API_KEY,
        "Content-Type": "application/json",
    }
    request_body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"maxOutputTokens": 2048},
    }
    retryable_statuses = {408, 429, 500, 502, 503, 504}
    max_attempts = 3
    response = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = requests.post(
                request_url, headers=request_headers, json=request_body, timeout=(10, 45),
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


async def chat_once(system: str, prompt: str, images: Optional[List[str]] = None) -> str:
    """Run the blocking HTTP client outside the async event loop."""
    return await asyncio.to_thread(_send_gemini_response, system, prompt, images)

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
    "purpose_placeholder": "Example: Prachi's mehndi ceremony — show henna details, family moments, and the joyful rituals.",
    "purpose_required": "Add a little more detail so the AI can plan your story (at least 10 characters).",
    "target_audience": "Target audience (optional)", "create_project": "Create project",
    "custom_script": "Your custom script", "scene_scan_label": "AI environment scan",
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
    "shoot_type_cinematic": "Cinematic", "mood_cinematic": "Cinematic", "mood_emotional": "Emotional",
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
    "move_guide": "Movement guide", "flashlight": "Flashlight", "brightness": "Brightness",
    "zoom": "Zoom", "zoom_unavailable": "This camera cannot change zoom right now.",
    "brightness_up": "Increase brightness", "brightness_down": "Decrease brightness",
    "blur": "Blur", "exposure": "Exposure", "framing": "Framing", "stability": "Stability",
    "clip_saved": "Clip saved", "great_shot": "Great shot!", "retake_suggested": "Retake suggested",
    "retake_required": "Retake required", "your_shot": "Your shot · watch it back", "retake": "Retake",
    "next_shot": "Next shot", "finish_edit": "Finish & edit", "camera_movement_unavailable": "This browser cannot control the flashlight on this device.",
    "translation_loading": "Preparing your language…", "translation_failed": "Some labels may remain in English while offline.",
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
Return ONLY one JSON object with keys `script` (a concise, coherent 2-4 sentence concept or voiceover in the requested language) and `shots` (an array of 4 to 8 shots). Each shot object has these keys:
- index (int, starting 0)
- title (short, e.g., "Opening Wide Shot")
- description (1 sentence directing what appears on screen)
- narration (a short optional spoken line in the requested language; use an empty string when voiceover would feel unnatural)
- on_screen_text (a short optional caption in the requested language)
- camera_movement (one of: static, pan_left, pan_right, tilt_up, tilt_down, dolly_in, dolly_out, tracking, orbit, reveal, handheld)
- shot_size (one of: extreme_wide, wide, medium, close_up, extreme_close_up)
- duration_seconds (float, 1.5 to 12.0)
- direction (1 sentence telling the person holding the phone what to do physically, e.g., "Stand 6 feet back, hold phone at chest height, slowly walk forward.")
No prose outside the JSON. Keep all script, shot titles, descriptions, narration, captions, and physical directions in the requested language. Be specific to the user's purpose and audience. Infer cultural meaning from clear event names (for example, a mehndi is commonly a South Asian pre-wedding celebration centered on henna art, close family moments, music, and ritual); use that understanding respectfully, adapt details to the supplied scene scan, and never invent people or rituals that the user did not describe or the image does not support. Do not replace the user's event with a generic template."""


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
    for index in range(count):
        title, description, movement, size, direction = blueprints[index]
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
Environment scan: {scene_context}

Use the title and creator's explanation as the source of truth. Notice cultural/event references and make the storytelling, shot ideas, props/details, and narration fit that occasion. Use the environment scan to choose subjects, backgrounds, lighting, and feasible framing; never claim a person or object is present unless the scan supports it. Return the script plus 4 to 8 shots that sum to approximately {doc['duration_seconds']} seconds.
Use durations between 1.5 and 12 seconds so the complete storyboard matches the target duration.
Make it cinematic, practical to film on a phone, and tailored to {doc['platform']}."""

    ai_generated = True
    script = ""
    try:
        raw = await chat_once(STORYBOARD_SYSTEM, prompt)
        response_data = extract_json(raw)
        if isinstance(response_data, dict):
            shots = response_data.get("shots")
            script = str(response_data.get("script") or "").strip()
        else:
            shots = response_data
        if not isinstance(shots, list) or not shots:
            raise ValueError("bad storyboard")
    except Exception as e:
        log.warning("storyboard generation unavailable; using local fallback: %s", e)
        ai_generated = False
        script, shots = fallback_storyboard(doc)

    existing_status_by_index = {
        int(previous.get("index", index)): previous.get("status")
        for index, previous in enumerate(doc.get("storyboard") or [])
        if isinstance(previous, dict)
    }
    for i, s in enumerate(shots):
        s["index"] = i
        previous_status = existing_status_by_index.get(i)
        s["status"] = previous_status if previous_status in {"captured", "retake"} else "pending"

    doc.update({"storyboard": shots, "script": script, "status": "storyboarded",
                "storyboard_ai_generated": ai_generated,
                "updated_at": datetime.now(timezone.utc).isoformat()})
    await save_project(doc, user["id"])
    return {"storyboard": shots, "ai_generated": ai_generated}


# ---------------- AI: Environment Scanner (vision) ----------------
SCAN_SYSTEM = """You are an expert cinematographer analyzing a live camera view.
Look at the image and return ONLY a compact JSON object with these keys:
- summary (1 short sentence describing the scene)
- lighting (one of: natural_bright, natural_soft, natural_low, indoor_warm, indoor_cool, mixed, backlit)
- lighting_quality_score (0-100)
- composition_score (0-100)
- subjects (array of short strings, what/who is in view)
- objects (array of short strings, notable objects)
- background (short string, e.g., "cluttered", "clean", "urban", "nature")
- best_time_of_day (string)
- recommended_style (one of: cinematic, luxury, minimal, action, editorial, warm)
- suggested_shots (array of 3 short strings, e.g., "Wide static of window light", "Close-up of hands", "Tracking shot along counter")
- tips (array of 3 short actionable tips)
No prose. No markdown."""


@api.post("/scan")
async def scan_environment(body: SceneScanIn, user=Depends(current_user)):
    if not body.image_base64:
        raise HTTPException(400, "image_base64 required")
    doc = await fetch_project(body.project_id, user["id"]) if body.project_id else None
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
        raw = await chat_once(
            SCAN_SYSTEM,
            f"Analyze this camera view for the user's planned video. Return all descriptive text in {language}.\n{context}",
            [body.image_base64],
        )
        data = extract_json(raw)
        if not isinstance(data, dict):
            raise ValueError("bad scan json")
        data["ai_generated"] = True
    except Exception as e:
        log.exception("scan fail: %s", e)
        data = {
            "summary": "Scene analyzed",
            "lighting": "natural_soft",
            "lighting_quality_score": 72,
            "composition_score": 68,
            "subjects": ["subject"],
            "objects": [],
            "background": "clean",
            "best_time_of_day": "golden hour",
            "recommended_style": "cinematic",
            "suggested_shots": ["Wide establishing", "Medium tracking", "Close-up detail"],
            "tips": ["Move toward natural light", "Keep background simple", "Steady both hands"],
            "ai_generated": False,
        }
    if doc:
        doc.update({"scene_map": data, "language": selected_code if selected_code in LANGUAGE_NAMES else doc.get("language", "en"),
                    "updated_at": datetime.now(timezone.utc).isoformat()})
        await save_project(doc, user["id"])
    return data


# ---------------- AI: Director Instruction ----------------
DIRECTOR_SYSTEM = """You are a live film director giving a single, ultra-short instruction (max 6 words)
to the person filming right now. Look at the current camera frame and the requested shot.
Return ONLY a compact JSON object:
- instruction (max 6 words, like "Step left, tilt phone up")
- arrow_direction (one of: none, up, down, left, right, forward, back, rotate_cw, rotate_ccw)
- ready (boolean, true if the frame already matches the desired shot well)
- confidence (0-100)
No prose. No markdown."""


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
Environment scan: {json.dumps(doc.get('scene_map') or {}, ensure_ascii=False)}
Reply in {language}.

Give the next short instruction."""
    try:
        images = [body.image_base64] if body.image_base64 else []
        raw = await chat_once(DIRECTOR_SYSTEM, prompt, images)
        data = extract_json(raw)
        if not isinstance(data, dict):
            raise ValueError("bad instruct")
    except Exception as e:
        log.warning("director fail: %s", e)
        data = {"instruction": shot["direction"][:40], "arrow_direction": "none",
                "ready": False, "confidence": 0}
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

    if body.title_font not in {"sans", "serif", "mono"}:
        raise HTTPException(400, "Choose Sans, Serif, or Space Mono for title text.")
    if body.title_position not in {"top", "center", "bottom"}:
        raise HTTPException(400, "Choose a valid title position.")
    if body.title_color not in {"white", "gold", "pink", "black"}:
        raise HTTPException(400, "Choose a supported title color.")
    if body.title_size not in {"small", "medium", "large"}:
        raise HTTPException(400, "Choose a supported title size.")
    if not 0 <= body.music_volume <= 1 or not 0 <= body.original_volume <= 1:
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

    if body.render_provider == "creatomate":
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
                await asyncio.to_thread(
                    _normalize_video_clip, source_clip, local_clip, width, height, body.fps,
                    clip_edit.get("trim_start_seconds", 0), clip_edit.get("trim_end_seconds"),
                    clip_edit.get("filter_preset", "original"), body.fit_mode,
                    clip_edit.get("brightness", clip.get("brightness", 0)),
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

            await asyncio.to_thread(
                _run_video_render, concat_file, output_file, width, height,
                local_soundtrack, body.fps, requested_style, title_text, body.title_font,
                body.title_position, body.title_color, body.title_size,
                body.music_volume, body.original_volume,
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
        "captions": False,
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
    doc.update({"storyboard": body.shots, "updated_at": datetime.now(timezone.utc).isoformat()})
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
    prompt = f"""Regenerate shot #{body.shot_index + 1} for project '{doc['title']}' ({doc['shoot_type']}, {doc['style']}).
Creator's explanation: {doc.get('purpose') or 'not supplied'}
Selected language: {language}
Environment scan: {json.dumps(scan_context, ensure_ascii=False)}
Current shot: {json.dumps(existing)}
User notes: {body.notes or 'make it more cinematic'}
Return ONLY one JSON object matching the same keys (index, title, description, camera_movement, shot_size, duration_seconds, direction). Keep all written fields in {language} and fit the project context and actual scanned environment."""
    try:
        raw = await chat_once(
            STORYBOARD_SYSTEM.replace("array of shots", "single shot object"), prompt
        )
        newshot = extract_json(raw)
        if isinstance(newshot, list) and newshot:
            newshot = newshot[0]
        if not isinstance(newshot, dict):
            raise ValueError("bad regen")
        newshot["index"] = body.shot_index
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
