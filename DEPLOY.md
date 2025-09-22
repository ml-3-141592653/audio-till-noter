# Deployment Guide

## Frontend Deployment (Netlify)

1. Sign up for a free Netlify account at https://netlify.com
2. Install Netlify CLI:
   ```bash
   npm install -g netlify-cli
   ```

3. Create a `netlify.toml` in your project root:
   ```toml
   [build]
   publish = "mywebbapp"
   command = "# Add build command if needed"

   [build.environment]
   API_BASE = "https://your-backend-url.onrender.com"  # Update this
   ```

4. Deploy:
   ```bash
   netlify deploy --prod
   ```

## Backend Deployment (Render)

1. Sign up for a free Render account at https://render.com

2. Create a new Web Service:
   - Connect your GitHub repository
   - Select the Python runtime
   - Set build command: `pip install -r requirements.txt`
   - Set start command: `uvicorn app:app --host 0.0.0.0 --port $PORT`

3. Add environment variables:
   - `ALLOWED_ORIGINS`: Your Netlify app URL (comma-separated if multiple)
   - `PORT`: Leave this to Render

4. Create `requirements.txt` if not exists:
   ```
   fastapi
   uvicorn
   python-multipart
   soundfile
   basic-pitch[tf]
   pretty-midi
   music21
   ```

## Alternative: Local Testing with ngrok

If you want to test on mobile devices without deploying:

1. Install ngrok:
   ```bash
   npm install -g ngrok   # or download from ngrok.com
   ```

2. Start your backend:
   ```bash
   uvicorn app:app --reload
   ```

3. Create tunnel:
   ```bash
   ngrok http 8000
   ```

4. Update `API_BASE` in frontend to use the ngrok URL

## Important Notes

1. Always use HTTPS in production for microphone access
2. Update CORS settings with your production domain
3. Consider adding rate limiting for production
4. Monitor server logs for errors
5. Consider adding error tracking (e.g., Sentry)