# Vercel Deployment Guide

This guide explains how to deploy your project to Vercel.

## Prerequisites

- Vercel account (https://vercel.com)
- GitHub, GitLab, or Bitbucket account with your code pushed
- Redis instance (for backend data persistence)

## Step-by-Step Deployment

### 1. Push Your Code to Git

Make sure your project is pushed to GitHub (or GitLab/Bitbucket):
```bash
git add .
git commit -m "Add Vercel deployment configuration"
git push origin main
```

### 2. Connect Your Repository to Vercel

1. Go to https://vercel.com
2. Click **"Add New"** → **"Project"**
3. Select your Git provider (GitHub, GitLab, or Bitbucket)
4. Select your repository
5. Click **"Import"**

### 3. Configure Vercel Settings

#### Build & Development Settings

These should be auto-detected, but verify:
- **Framework Preset**: Vite
- **Build Command**: `cd frontend && npm install && npm run build`
- **Output Directory**: `frontend/dist`
- **Install Command**: `npm install` (if needed)

#### Environment Variables (IMPORTANT!)

Click **"Environment Variables"** and add the following:

| Variable | Value | Description |
|----------|-------|-------------|
| `REDIS_URL` | `redis://[user]:[password]@[host]:[port]` | Your Redis connection string. Get from your Redis provider (e.g., Redis Cloud, Upstash) |
| `PORT` | `3001` | Port for backend server (Vercel will assign automatically, but good to set) |
| `NODE_ENV` | `production` | Environment mode |

**How to get REDIS_URL:**
- **Redis Cloud**: https://app.redislabs.com → Create free database → Copy connection URL
- **Upstash**: https://upstash.com → Create free Redis → Copy Redis URL
- **Self-hosted**: `redis://localhost:6379` (if you have your own Redis server)

### 4. Deploy

1. After configuring environment variables, click **"Deploy"**
2. Vercel will build and deploy automatically
3. Wait for the deployment to complete
4. You'll get a URL like `https://your-project.vercel.app`

## Post-Deployment

### Testing Your Deployment

1. Visit your Vercel URL: `https://your-project.vercel.app`
2. Check the frontend loads correctly
3. Test backend API endpoints: `https://your-project.vercel.app/api/*`
4. Test WebSocket connections for real-time features

### Monitoring

- Check Vercel Dashboard for logs: https://vercel.com/dashboard
- Click your project → **"Deployments"** → Click deployment → **"Logs"**
- Scroll through build logs and runtime logs

### Common Issues & Solutions

**Issue**: "REDIS_URL is not defined"
- **Solution**: Make sure you added the `REDIS_URL` environment variable in Vercel project settings

**Issue**: Frontend builds but backend fails
- **Solution**: Check Node.js dependencies in `backend/package.json` are installed correctly

**Issue**: WebSocket connections fail
- **Solution**: Vercel's serverless functions have limitations. Consider deploying backend separately to Heroku or Railway

## Optional: Deploy Backend Separately

If Socket.io/WebSocket keeps timing out, deploy backend separately:

1. **Heroku**: https://www.heroku.com
2. **Railway**: https://railway.app
3. **Render**: https://render.com

Then update frontend API URLs to point to your separate backend:
- In `frontend/src/store.js` or API client, change:
  - FROM: `/api/...` or `localhost:3001`
  - TO: `https://your-backend.herokuapp.com` or your deployed backend URL

## Environment Variables Summary

```
REDIS_URL=redis://default:password@host:port
PORT=3001
NODE_ENV=production
```

## Files Involved

- `vercel.json` - Vercel configuration
- `backend/server.js` - Express server
- `frontend/vite.config.js` - Frontend build config
- `backend/package.json` - Backend dependencies
- `frontend/package.json` - Frontend dependencies

## Need Help?

- Vercel Docs: https://vercel.com/docs
- Redis Setup: https://redis.com/cloud/
- Socket.io on Vercel: Check for serverless function limitations
