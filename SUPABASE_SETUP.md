# Supabase setup

The app uses Supabase Auth for sign-in, Postgres for project records, and a private Storage bucket for captured media. FastAPI remains the server for Gemini-powered directing and rendering features.

## 1. Create the Supabase resources

1. Create a Supabase project.
2. Open **SQL Editor**, paste and run [`supabase/setup.sql`](supabase/setup.sql).
3. In **Project Settings → API Keys**, copy the project URL and publishable key.
4. In **Authentication → URL Configuration**, set the local preview site URL to `http://localhost:8081` and add `http://localhost:8081/**` and `http://127.0.0.1:8081/**` to the allowed redirect URLs. Add `reeldirector://**` for native app redirects.

## 2. Configure the app and backend

Copy `frontend/.env.example` to `frontend/.env.local` and fill in the project URL and publishable key. The publishable key is intended for client apps; the database policies in `supabase/setup.sql` limit each signed-in user to their own projects and files.

Copy `backend/.env.example` to `backend/.env`. Add the same Supabase project URL, the project's **secret key**, and your Gemini API key as `GEMINI_API_KEY`. Create the Gemini key in [Google AI Studio](https://aistudio.google.com/app/apikey). `FAL_KEY` and `CREATOMATE_API_KEY` are optional provider keys for AI-generated video and Creatomate editing; the matching features stay disabled until configured. Keep all provider keys on the backend only. The backend checks project ownership on every request that reads or changes a project.

## 3. Run locally

Start the FastAPI service from `backend/`:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

Then start the app from `frontend/`:

```sh
npm install
npx expo start --web --clear
```

`REELDIRECTOR_API_URL` defaults to `http://127.0.0.1:8000` for the local browser preview and iOS simulator. Android emulator requests automatically translate that loopback address to `10.0.2.2`. For a physical phone or deployed app, set it to a backend URL reachable from that device; on the same Wi-Fi, use your Mac's LAN address instead of `127.0.0.1`.

New accounts may need to confirm their email before the first sign-in, depending on the project's Auth settings.

Gemini API access is separate from a Google AI Pro subscription. The Gemini API has its own [free tier and billing limits](https://ai.google.dev/gemini-api/docs/billing). On unpaid API usage, Google may use prompts and responses to improve its products, so avoid submitting sensitive or private footage ([Gemini API terms](https://ai.google.dev/gemini-api/terms)). The app's basic storyboard flow keeps working with fallback directions when the API key is missing; live vision features need the Gemini key.

AI video generation is a separate fal.ai service and uses fal.ai credits. Creatomate rendering is also separate and uses Creatomate account credits. The app asks for confirmation before either paid provider is used.

## Native video capture

The web preview can scan a camera view but cannot record video. On macOS with Xcode, run `npm run ios` from `frontend/`; for Android, run `npm run android` with Android Studio and an emulator or connected phone. These native builds request camera and microphone access, capture video with sound, and can save finished exports to the photo library.
