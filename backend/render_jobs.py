"""Durable Supabase queue shared by the API and a single-process FFmpeg worker."""
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import HTTPException


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def public_job(job: Dict[str, Any]) -> Dict[str, Any]:
    return {"job_id": job["id"], "provider": "ffmpeg", "status": job["status"].upper(),
            "progress": job.get("progress", 0), "phase": job.get("phase", "Preparing your reel"),
            "error": job.get("error")}


async def enqueue(client, project: Dict[str, Any], options: Dict[str, Any]) -> Dict[str, Any]:
    render_fields = ("title", "clips", "storyboard", "style", "soundtrack", "voiceover", "edit_json")
    fingerprint = hashlib.sha256(json.dumps({"options": {key: value for key, value in options.items() if key != "async_export"}, **{
        key: project.get(key) for key in render_fields
    }}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    try:
        result = await client.rpc("enqueue_render_job", {
            "p_project_id": project["id"], "p_user_id": project["user_id"],
            "p_fingerprint": fingerprint, "p_payload": {"project": project, "options": options},
        }).execute()
    except Exception as error:
        message = str(getattr(error, "message", error))
        if any(value in message for value in ("already running", "two exports", "queue is full")):
            raise HTTPException(409, message)
        if "enqueue_render_job" in message or "render_jobs" in message:
            raise HTTPException(503, "The export queue needs its database setup. Run supabase/render_jobs.sql, then retry.")
        raise HTTPException(503, "Could not queue your export. Your clips are safe; please retry shortly.")
    return public_job(result.data)


async def report(client, job: Dict[str, Any], progress: int, phase: str) -> None:
    result = await client.table("render_jobs").update({
        "progress": max(0, min(99, progress)), "phase": phase, "heartbeat_at": now(), "updated_at": now(),
    }).eq("id", job["id"]).eq("worker_id", job["worker_id"]).eq("status", "running").execute()
    if not result.data:
        raise RuntimeError("The export lease was lost or the project was deleted")
