# ReelDirector

ReelDirector helps creators plan and film short videos. Create a project, generate a storyboard, scan a scene, get live filming directions, capture video with microphone audio, choose a soundtrack, and render a finished reel.

## Project layout

- `frontend/` — React Native app for iOS, Android, and web.
- `backend/` — FastAPI service for AI direction and video rendering.
- `supabase/` — database, authentication, and private media-storage setup.

## Configure Supabase

1. Create a Supabase project.
2. Run `supabase/setup.sql` in its SQL Editor.
3. Copy `frontend/.env.example` to `frontend/.env.local` and set the project URL and publishable key.
4. Copy `backend/.env.example` to `backend/.env` and set the project URL, secret key, and Gemini API key.

Keep the Supabase secret key and Gemini key in the backend environment only. See [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) for details.

For an HTTPS phone version with Home Screen installation and live camera access, see [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Run the backend

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

## Run the web preview

```sh
cd frontend
npm ci
npx expo start --web --clear
```

On macOS, install Watchman if Expo reports that it has run out of file watchers (`brew install watchman`).

The web preview supports project planning, email sign-in, storyboard guidance, camera capture with microphone audio on secure browser origins, and export. On a phone using the local HTTP preview, use **Record or choose a video** to capture and upload a clip. Live camera preview and real-time framing need HTTPS or localhost.

## Open the web preview on a phone

1. Put the phone and computer on the same Wi-Fi network.
2. Find the computer's local IPv4 address in System Settings → Network.
3. Start the backend and web preview using the commands above.
4. On the phone, open `http://<computer-ip>:8081/dashboard` in Safari or Chrome.
5. Sign in on the phone. Each device and browser keeps its own sign-in session.

A downloadable iOS or Android app requires a signed platform build. The app uses the `reeldirector://auth/callback` scheme for standalone authentication; the Supabase Auth redirect allowlist must include `reeldirector://auth/callback` and the web callback `https://reeldirector-web.vercel.app/auth/callback`.

## Build native apps

The same Expo Router app targets iOS, Android, and web. EAS Build profiles are in `frontend/eas.json`; `preview` creates an installable Android APK and internal iOS build, while `production` creates store builds.

1. Install the EAS CLI and sign in with the Expo account that will own the builds.
2. From `frontend/`, run `eas build:configure` once to link this app to an EAS project.
3. Add these build environment variables to the EAS `production` environment: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `REELDIRECTOR_API_URL=https://reeldirector-api.onrender.com`. The Supabase publishable key is included in the client app; never add the Supabase secret key or Gemini key to EAS or the mobile bundle.
4. Run `eas build --platform all --profile production` to create the iOS and Android store binaries, or use `--profile preview` for private device testing.
5. Submit store builds with `eas submit --platform ios` and `eas submit --platform android` after connecting the Apple Developer and Google Play Console accounts.

An Apple Developer membership is required for iOS device distribution and App Store release; a Google Play Console account is required to publish on Google Play. Builds need the Expo account, app signing, and production environment variables before they can be generated. Web deployment remains on Vercel.

## AI and media

AI requests use Gemini 3.8 Flash for text and camera-frame analysis. Temporary Gemini failures use built-in storyboard guidance; live directions and automatic quality review still require a working Gemini API. Export requires one or more recorded clips and renders those files with FFmpeg; optional audio is mixed with the audio recorded by the camera. Captions are not generated yet.
