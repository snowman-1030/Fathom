# Fathom Meetings Server

Node.js server that provides a REST API for Fathom meeting data, designed to work with the n8n workflow.

## Features

- **GET /api/meetings** - Returns all meetings from Fathom (with pagination support)
- **GET /api/meetings/:id/transcript** - Returns transcript for a specific meeting
- **In-memory caching** - Caches meetings for 5 minutes to reduce API calls
- **Rate limiting handling** - Automatic retry with exponential backoff
- **Error handling** - Proper error responses for API failures

## Setup

1. **Install dependencies:**
```bash
cd server
npm install
```

2. **Configure environment variables:**
```bash
cp env.example .env
```

Edit `.env` and add your Fathom API key:
```
FATHOM_API_KEY=your_api_key_here
PORT=3000
```

3. **Start the server:**
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000` (or your configured PORT).

## API Endpoints

### GET /api/meetings
Returns all meetings in the format:
```json
{
  "items": [
    {
      "recording_id": 123,
      "title": "Meeting Title",
      "meeting_title": "Meeting Title",
      "url": "https://fathom.video/...",
      "scheduled_start_time": "2025-01-01T10:00:00Z",
      ...
    }
  ]
}
```

### GET /api/meetings/:id/transcript
Returns transcript for a specific meeting:
```json
{
  "transcript": "..."
}
```

### GET /api/health
Health check endpoint with cache status

### POST /api/cache/clear
Clears the meetings cache (useful for testing)

## Configuration

### Environment Variables

- `FATHOM_API_KEY` (required) - Your Fathom API key
- `PORT` (optional) - Server port (default: 3000)
- `FATHOM_FILTER_DOMAINS` (optional) - Comma-separated list of domains to filter
- `FATHOM_FILTER_RECORDED_BY` (optional) - Comma-separated list of emails to filter
- `FATHOM_FILTER_TEAMS` (optional) - Comma-separated list of teams to filter

## n8n Integration

In your n8n workflow, set these environment variables:

- `MEETINGS_SERVER_URL` - Your server URL (e.g., `http://localhost:3000` or `https://your-server.com`)
- `MEETINGS_SERVER_API_KEY` - Optional API key if you add authentication (currently not required by default)

**Note:** The n8n workflow is already configured to use this server. Just update the `MEETINGS_SERVER_URL` environment variable in n8n to point to your server.

## Caching

The server caches meetings for 5 minutes to reduce API calls. To clear the cache:
- Call `POST /api/cache/clear`
- Or restart the server

## Error Handling

The server handles:
- Rate limiting (429 errors) with exponential backoff
- Missing transcripts (404 errors)
- API failures (500 errors)

## Troubleshooting

### Transcript Method Not Found
If you get an error about `getTranscript` not being a function, the Fathom TypeScript SDK might use a different method name. Check the SDK documentation and update line ~150 in `server.js` with the correct method name.

Common alternatives:
- `getRecordingTranscript`
- `listRecordings` with transcript parameter
- Direct API call using the SDK's HTTP client

### Rate Limiting
The server automatically handles rate limiting with exponential backoff. If you're still hitting limits:
- Increase the delay between requests (line ~80 in `server.js`)
- Reduce the number of meetings fetched
- Use caching more aggressively

## Deployment Options

### Vercel Deployment (Recommended for Serverless)

This server is configured for Vercel deployment. See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for detailed instructions.

Quick steps:
1. Push code to GitHub
2. Import project in Vercel (set root directory to `server/`)
3. Add environment variables in Vercel dashboard
4. Deploy

**Note:** For 2000+ meetings, consider Vercel Pro plan (60s timeout) or implement caching with Vercel KV.

### Traditional Server Deployment

For production on a traditional server, consider:
1. Adding authentication middleware
2. Using Redis for distributed caching
3. Adding request logging
4. Setting up monitoring/alerting
5. Using a process manager like PM2

Example PM2 setup:
```bash
npm install -g pm2
pm2 start server.js --name fathom-server
pm2 save
pm2 startup
```

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

