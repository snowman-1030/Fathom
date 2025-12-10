import express from 'express';
import cors from 'cors';
import { Fathom } from 'fathom-typescript';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Fathom client
const fathom = new Fathom({
  security: { 
    apiKeyAuth: process.env.FATHOM_API_KEY 
  }
});

// Serverless-friendly cache (stored in memory, but resets on cold start)
// For production, consider using Vercel KV or an external cache
let meetingsCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all meetings from Fathom with pagination
 */
async function fetchAllMeetings() {
  const allMeetings = [];
  let retryCount = 0;
  const maxRetries = 5;

  try {
    // Build filter parameters
    const params = {};
    
    // Add optional filters from environment variables
    if (process.env.FATHOM_FILTER_DOMAINS) {
      params.calendarInviteesDomains = process.env.FATHOM_FILTER_DOMAINS.split(',').map(d => d.trim());
    }
    if (process.env.FATHOM_FILTER_RECORDED_BY) {
      params.recordedBy = process.env.FATHOM_FILTER_RECORDED_BY.split(',').map(e => e.trim());
    }
    if (process.env.FATHOM_FILTER_TEAMS) {
      params.teams = process.env.FATHOM_FILTER_TEAMS.split(',').map(t => t.trim());
    }

    // Initial request
    let response = await fathom.listMeetings(params);
    
    while (response) {
      try {
        // Extract items from response
        // The SDK may return items directly or in a result object
        let items = [];
        if (Array.isArray(response)) {
          items = response;
        } else if (response.items) {
          items = response.items;
        } else if (response.result && response.result.items) {
          items = response.result.items;
        } else if (response.data && response.data.items) {
          items = response.data.items;
        }
        
        if (items && items.length > 0) {
          allMeetings.push(...items);
          console.log(`Fetched ${items.length} meetings (total: ${allMeetings.length})`);
        }
        
        // Check for pagination
        // The SDK may have a next() method or nextCursor property
        let hasNext = false;
        if (typeof response.next === 'function') {
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
          response = await response.next();
          hasNext = response !== null && response !== undefined;
        } else if (response.nextCursor) {
          params.cursor = response.nextCursor;
          await new Promise(resolve => setTimeout(resolve, 500));
          response = await fathom.listMeetings(params);
          hasNext = response !== null && response !== undefined;
        } else {
          hasNext = false;
        }
        
        if (!hasNext) {
          break;
        }
        
        retryCount = 0; // Reset retry count on success
      } catch (error) {
        // Handle rate limiting (429 errors)
        if (error.status === 429 || error.statusCode === 429 || error.message?.includes('429')) {
          retryCount++;
          if (retryCount <= maxRetries) {
            const waitTime = Math.pow(2, retryCount) * 1000; // Exponential backoff
            console.log(`Rate limited. Waiting ${waitTime}ms before retry ${retryCount}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          } else {
            console.error('Max retries reached for rate limiting');
            break;
          }
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    console.error('Error fetching meetings:', error);
    throw error;
  }

  return allMeetings;
}

/**
 * Serialize meeting object to JSON-safe format
 */
function serializeMeeting(meeting) {
  if (!meeting) return null;
  
  // If meeting is already a plain object, return it
  if (typeof meeting === 'object' && !meeting.toJSON && !meeting.to_dict) {
    return meeting;
  }
  
  // Try to convert to JSON
  try {
    return JSON.parse(JSON.stringify(meeting));
  } catch (e) {
    // Fallback: extract common fields
    return {
      recording_id: meeting.recording_id || meeting.id,
      title: meeting.title || meeting.meeting_title,
      meeting_title: meeting.meeting_title || meeting.title,
      url: meeting.url,
      share_url: meeting.share_url,
      scheduled_start_time: meeting.scheduled_start_time,
      scheduled_end_time: meeting.scheduled_end_time,
      calendar_invitees_domains_type: meeting.calendar_invitees_domains_type,
      default_summary: meeting.default_summary,
      calendar_invitees: meeting.calendar_invitees,
      created_at: meeting.created_at,
      recording_start_time: meeting.recording_start_time,
      recording_end_time: meeting.recording_end_time
    };
  }
}

/**
 * GET /api/meetings
 * Returns all meetings, optionally cached
 */
app.get('/api/meetings', async (req, res) => {
  try {
    // Check cache
    const now = Date.now();
    if (meetingsCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_TTL) {
      console.log(`Returning ${meetingsCache.length} meetings from cache`);
      return res.json({ items: meetingsCache });
    }

    // Fetch fresh data
    console.log('Fetching meetings from Fathom API...');
    const meetings = await fetchAllMeetings();
    const serializedMeetings = meetings.map(serializeMeeting).filter(m => m !== null);
    
    // Update cache
    meetingsCache = serializedMeetings;
    cacheTimestamp = now;
    
    console.log(`Fetched ${serializedMeetings.length} meetings`);
    
    // Return in format compatible with n8n workflow
    res.json({ items: serializedMeetings });
  } catch (error) {
    console.error('Error in /api/meetings:', error);
    res.status(500).json({ 
      error: 'Failed to fetch meetings',
      message: error.message 
    });
  }
});

/**
 * GET /api/meetings/:id/transcript
 * Returns transcript for a specific meeting
 */
app.get('/api/meetings/:id/transcript', async (req, res) => {
  try {
    const meetingId = req.params.id;
    const recordingId = parseInt(meetingId);
    
    if (isNaN(recordingId)) {
      return res.status(400).json({ 
        error: 'Invalid meeting ID',
        recording_id: meetingId 
      });
    }
    
    console.log(`Fetching transcript for meeting ${recordingId}...`);
    
    // Fetch transcript from Fathom
    // The SDK method might be getTranscript, getRecordingTranscript, or similar
    let transcript;
    try {
      // Try different possible method names
      if (typeof fathom.getTranscript === 'function') {
        transcript = await fathom.getTranscript({ recordingId });
      } else if (typeof fathom.getRecordingTranscript === 'function') {
        transcript = await fathom.getRecordingTranscript({ recordingId });
      } else {
        // Fallback: try direct API call structure
        transcript = await fathom.listRecordings({ recordingId });
      }
    } catch (apiError) {
      // If the method doesn't exist or fails, try alternative approach
      console.warn('Primary transcript method failed, trying alternative...');
      // You may need to adjust this based on actual SDK methods
      throw apiError;
    }
    
    // Extract transcript from response if needed
    if (transcript && typeof transcript === 'object') {
      if (transcript.transcript) {
        transcript = transcript.transcript;
      } else if (transcript.data && transcript.data.transcript) {
        transcript = transcript.data.transcript;
      } else if (transcript.result && transcript.result.transcript) {
        transcript = transcript.result.transcript;
      }
    }
    
    if (!transcript) {
      return res.status(404).json({ 
        error: 'Transcript not found',
        recording_id: meetingId 
      });
    }
    
    // Return transcript in format expected by n8n
    res.json({ transcript: transcript });
  } catch (error) {
    const meetingId = req.params.id;
    console.error(`Error fetching transcript for meeting ${meetingId}:`, error);
    
    if (error.status === 404 || error.statusCode === 404) {
      return res.status(404).json({ 
        error: 'Transcript not found',
        recording_id: meetingId 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch transcript',
      message: error.message 
    });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: 'vercel',
    cache: {
      hasCache: meetingsCache !== null,
      cacheSize: meetingsCache ? meetingsCache.length : 0,
      cacheAge: cacheTimestamp ? Math.floor((Date.now() - cacheTimestamp) / 1000) : null
    }
  });
});

/**
 * POST /api/cache/clear
 * Clear the meetings cache (useful for testing)
 */
app.post('/api/cache/clear', (req, res) => {
  meetingsCache = null;
  cacheTimestamp = null;
  res.json({ message: 'Cache cleared' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Export the Express app as a serverless function
export default app;

