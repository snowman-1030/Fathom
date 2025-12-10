# Deploying to Vercel

This guide will help you deploy the Fathom Meetings Server to Vercel.

## Prerequisites

1. A Vercel account (sign up at [vercel.com](https://vercel.com))
2. Vercel CLI installed (optional, for CLI deployment):
   ```bash
   npm i -g vercel
   ```

## Deployment Steps

### Option 1: Deploy via Vercel Dashboard

1. **Push your code to GitHub/GitLab/Bitbucket**
   - Make sure the `server/` directory is in your repository

2. **Import project in Vercel**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your repository
   - Set the **Root Directory** to `server` (important!)
   - Framework Preset: **Other**
   - Build Command: Leave empty or use `npm run vercel-build`
   - Output Directory: Leave empty
   - Install Command: `npm install`

3. **Configure Environment Variables**
   - In your Vercel project settings, go to **Environment Variables**
   - Add the following:
     - `FATHOM_API_KEY` - Your Fathom API key
     - `FATHOM_FILTER_DOMAINS` (optional) - Comma-separated domains
     - `FATHOM_FILTER_RECORDED_BY` (optional) - Comma-separated emails
     - `FATHOM_FILTER_TEAMS` (optional) - Comma-separated teams

4. **Deploy**
   - Click **Deploy**
   - Wait for deployment to complete

### Option 2: Deploy via Vercel CLI

1. **Navigate to server directory**
   ```bash
   cd server
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   vercel
   ```
   
   Follow the prompts:
   - Set up and deploy? **Yes**
   - Which scope? (Select your account/team)
   - Link to existing project? **No** (first time) or **Yes** (subsequent deployments)
   - Project name: `fathom-meetings-server` (or your preferred name)
   - Directory: `./` (current directory)
   - Override settings? **No**

4. **Set Environment Variables**
   ```bash
   vercel env add FATHOM_API_KEY
   # Paste your API key when prompted
   
   # Optional: Add filters
   vercel env add FATHOM_FILTER_DOMAINS
   vercel env add FATHOM_FILTER_RECORDED_BY
   vercel env add FATHOM_FILTER_TEAMS
   ```

5. **Redeploy with environment variables**
   ```bash
   vercel --prod
   ```

## Configuration

### Environment Variables in Vercel

Go to your project → Settings → Environment Variables and add:

| Variable | Required | Description |
|----------|----------|-------------|
| `FATHOM_API_KEY` | Yes | Your Fathom API key |
| `FATHOM_FILTER_DOMAINS` | No | Comma-separated list of domains |
| `FATHOM_FILTER_RECORDED_BY` | No | Comma-separated list of emails |
| `FATHOM_FILTER_TEAMS` | No | Comma-separated list of teams |

### Important Notes

1. **Root Directory**: Make sure Vercel is configured to use the `server/` directory as the root
2. **Node Version**: Vercel uses Node 18.x by default (configured in `package.json`)
3. **Function Timeout**: Vercel has a 10-second timeout for Hobby plan, 60 seconds for Pro. For 2000+ meetings, you may need Pro plan or optimize the endpoint
4. **Cache**: In-memory cache resets on cold starts (serverless functions). Consider using Vercel KV for persistent caching

## API Endpoints

After deployment, your endpoints will be:
- `https://your-project.vercel.app/api/meetings`
- `https://your-project.vercel.app/api/meetings/:id/transcript`
- `https://your-project.vercel.app/api/health`

## Update n8n Workflow

In your n8n workflow, update the environment variable:
```
MEETINGS_SERVER_URL=https://your-project.vercel.app
```

## Troubleshooting

### Timeout Issues
If you're getting timeout errors when fetching 2000+ meetings:
- Upgrade to Vercel Pro plan (60s timeout)
- Or implement pagination in the client (n8n workflow)
- Or use Vercel KV to cache meetings

### Cold Start Performance
Serverless functions have cold starts. To improve:
- Use Vercel KV for caching
- Consider Vercel Pro plan for better performance
- Implement edge caching headers

### Environment Variables Not Working
- Make sure variables are set for the correct environment (Production, Preview, Development)
- Redeploy after adding environment variables
- Check variable names match exactly (case-sensitive)

## Monitoring

- Check Vercel dashboard for function logs
- Monitor function execution time
- Set up alerts for errors

## Production Recommendations

1. **Use Vercel KV** for persistent caching (instead of in-memory)
2. **Add authentication** if exposing publicly
3. **Set up monitoring** and alerts
4. **Use custom domain** for better reliability
5. **Enable Vercel Analytics** for performance insights

