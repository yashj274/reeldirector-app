"""Run with `python render_worker.py`; no provider account or rendering fee required."""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

import render_jobs
import server

log = logging.getLogger("reeldirector.worker")


async def heartbeat(job):
    while True:
        await asyncio.sleep(20)
        result = await server.get_supabase().table("render_jobs").update({
            "heartbeat_at": render_jobs.now(),
        }).eq("id", job["id"]).eq("worker_id", job["worker_id"]).eq("status", "running").execute()
        if not result.data:
            raise RuntimeError("The export lease was lost or the project was deleted")


async def process(job):
    pulse = asyncio.create_task(heartbeat(job))
    render = asyncio.create_task(server._export_project(
        job["project_id"], server.ExportIn(**job["payload"]["options"]),
        {"id": job["user_id"]}, job=job,
    ))
    try:
        # A worker that loses its lease must not publish a second export.
        done, _ = await asyncio.wait({pulse, render}, return_when=asyncio.FIRST_COMPLETED)
        if pulse in done:
            await pulse
        result = await render
        response = await server.get_supabase().rpc("finish_render_job", {
            "p_job_id": job["id"], "p_worker_id": job["worker_id"], "p_result": result,
        }).execute()
        if not response.data:
            await server.get_supabase().storage.from_("project-media").remove([result["storage_path"]])
            return
        old_path = (job["payload"]["project"].get("export") or {}).get("storage_path")
        if old_path and old_path != result["storage_path"]:
            try:
                await server.get_supabase().storage.from_("project-media").remove([old_path])
            except Exception:
                log.warning("Could not remove the previous export for job %s", job["id"])
    except asyncio.CancelledError:
        raise
    except Exception as error:
        log.exception("Render job %s failed", job["id"])
        retry = job["attempts"] < 3 and getattr(error, "status_code", 502) >= 500
        message = (error.detail if isinstance(error, server.HTTPException) and error.status_code < 500
                   else "Could not finish this reel. Your clips are safe. Please retry Export.")
        await server.get_supabase().table("render_jobs").update({
            "status": "queued" if retry else "failed", "phase": "Retrying your export" if retry else "Export failed",
            "error": None if retry else message,
            "available_at": (datetime.now(timezone.utc) + timedelta(seconds=10 * job["attempts"])).isoformat(),
            "updated_at": render_jobs.now(),
        }).eq("id", job["id"]).eq("worker_id", job["worker_id"]).eq("status", "running").execute()
    finally:
        pulse.cancel()
        render.cancel()
        await asyncio.gather(pulse, render, return_exceptions=True)


async def main():
    if not server.SUPABASE_URL or not server.SUPABASE_SECRET_KEY:
        raise RuntimeError("Set SUPABASE_URL and SUPABASE_SECRET_KEY before starting the renderer")
    server.supabase = await server.create_async_client(server.SUPABASE_URL, server.SUPABASE_SECRET_KEY)
    worker_id = str(uuid.uuid4())
    try:
        while True:
            try:
                result = await server.get_supabase().rpc("claim_render_job", {"p_worker_id": worker_id}).execute()
                if result.data:
                    await process(result.data)
                else:
                    await asyncio.sleep(2)
            except Exception:
                log.exception("Renderer queue unavailable; retrying in 15 seconds")
                await asyncio.sleep(15)
    finally:
        await server._shutdown()


if __name__ == "__main__":
    asyncio.run(main())
