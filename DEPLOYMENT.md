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

The built-in FFmpeg renderer handles clip order, trims, per-clip filters, titles, audio balance, aspect ratio, resolution, and frame rate. It does not require a fal.ai or Creatomate account. Gemini remains separate and is used for storyboards and scene direction.
