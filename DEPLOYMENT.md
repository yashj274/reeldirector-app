# Phone-ready HTTPS deployment

The web app can be installed from Safari or Chrome once it is served from an HTTPS address. HTTPS also allows the browser camera preview that is blocked on the local Wi-Fi preview.

## What this project is prepared to deploy

- `frontend/` builds a single-page web app and includes a Home Screen manifest and app icons.
- `render.yaml` describes the FastAPI video/AI backend. Render asks for its three secrets during setup; do not put them in Git.
- `frontend/vercel.json` builds the web app and routes app pages such as `/login` back to its single-page entry point.
- Supabase continues to hold accounts, projects, and private video files.

## Deployment steps

1. Put this project in a private GitHub repository. The root `.gitignore` excludes local `.env` files, dependency folders, and build output.
2. In Render, create a Blueprint from that repository and select `render.yaml`. Enter `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `GEMINI_API_KEY` in Render's secret fields. Keep every service key out of the frontend.
   - To enable the admin console, set `ADMIN_EMAILS` on the Render service to the comma-separated sign-in email addresses allowed to administer the app. Leave it empty to disable admin access. The backend checks this allowlist on every admin request; user-editable profile metadata cannot grant admin access.
3. Wait for the `reeldirector-api` service to deploy. Copy its HTTPS URL, usually `https://reeldirector-api.onrender.com`.
4. In Vercel, import the same repository and set the project root to `frontend/`. Add these build environment variables in Vercel:
   - `EXPO_PUBLIC_SUPABASE_URL` — the existing Supabase project URL.
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the existing Supabase publishable key.
   - `REELDIRECTOR_API_URL` — the Render HTTPS URL from step 3.
5. Deploy the Vercel project and copy its HTTPS address.
6. In Supabase **Authentication → URL Configuration**, set the Site URL to the Vercel address and allow redirects to `https://<your-vercel-domain>/**`.
7. Open the HTTPS app on the phone. On iPhone, use Safari's **Share → Add to Home Screen**. On Android, use Chrome's **Install app** option. Allow camera and microphone when prompted.

The current local `.local` preview and these deployment settings are separate. Deploying requires connecting the source to GitHub and signing in to the hosting dashboards. Free hosting plans may sleep or be resource-limited; large video renders can need a paid backend plan.

## Built-in video editing

The built-in FFmpeg renderer is the default. It handles clip order, trims, splits, speed, filters, real fonts, six title animations, timed and positioned captions, B-roll image overlays, original audio, music, voiceover, aspect ratio, resolution, and frame rate. It needs no video-provider account or per-render fee. Gemini is used for storyboards and scene direction; exports do not call Gemini.

Run `supabase/render_jobs.sql` in the existing Supabase project's SQL Editor before deploying this version. It creates a private queue and three functions available only to the backend service role. It does not change existing project or media access policies.

The updated app sends `async_export: true` to `POST /api/projects/{id}/export`, which validates the edit and returns a job ID immediately. The app polls `GET /api/projects/{id}/render-jobs/{job_id}` for status and downloads the completed MP4 from private Supabase storage. Reopening Export with the same edit resumes the existing job, or reuses its finished video. Export completion merges only the result into the project, preserving edits made during rendering. Older installed clients without this flag receive the finished result in their original request; rendering still runs in the worker, but these clients need an update to get background status and reconnection support.

By default the API supervises a separate worker process, which renders one reel at a time. The durable queue stays in Supabase across API/worker restarts. Jobs have a heartbeat and retry at most three times; crashed workers' jobs become claimable after 90 seconds. This uses the existing service and adds no Redis or provider subscription. Large media downloads and uploads stream through disk instead of loading the whole reel into memory.

For local use, start the backend normally; it starts its worker automatically. To run the worker on a separate machine later, set `RENDER_WORKER_AUTOSTART=0` on the API and run `python render_worker.py` on that machine with the same `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. No API key belongs in the frontend. The same secret files remain excluded from Git.

The first version bounds reels to 10 minutes, 100 clips, 20 B-roll images, 512 MB per source clip, 30 MB per audio file, and 2 GB of source clips per job. A user can have two active exports, and the global waiting queue is capped at 100. Finished job records expire after a week; the current video remains in project storage. Output size must also fit your Supabase bucket's upload limit.

The worker uses one FFmpeg encoding thread to limit contention. Running it as a process isolates render failures, but it still shares the machine's CPU and memory. A sleeping free host can delay jobs until it wakes; always-on hosting and heavier workloads can have infrastructure costs. Phone filter previews currently use simplified color overlays; web preview and FFmpeg use matching CSS filter values. Use exported output to judge exact colors on native devices.

Creatomate remains an optional renderer if `CREATOMATE_API_KEY` is configured. It is not needed for the default export path.
