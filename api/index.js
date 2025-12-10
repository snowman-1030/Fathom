import express from 'express';
import cors from 'cors';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Fathom API base URL (configurable via environment variable)
const FATHOM_API_BASE = process.env.FATHOM_API_BASE || 'https://api.fathom.video/v1';

/**
 * Make a request to the Fathom API
 */
async function fathomRequest(endpoint, options = {}) {
  const apiKey = process.env.FATHOM_API_KEY;
  if (!apiKey) {
    throw new Error('FATHOM_API_KEY is not set');
  }

  const url = `${FATHOM_API_BASE}${endpoint}`;
  
  try {
    console.log(`Making request to: ${url}`);
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch (e) {
        // Ignore error reading body
      }
      
      const error = new Error(`Fathom API error: ${response.status} ${response.statusText}. ${errorBody}`);
      error.status = response.status;
      error.statusCode = response.status;
      error.body = errorBody;
      throw error;
    }

    return response.json();
  } catch (error) {
    // Enhance error with more details
    if (error.message && !error.message.includes('Fathom API error')) {
      console.error(`Fetch error details:`, {
        message: error.message,
        stack: error.stack,
        url: url,
        code: error.code,
        cause: error.cause
      });
      
      // Re-throw with more context
      const enhancedError = new Error(`Failed to fetch from Fathom API: ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.url = url;
      enhancedError.code = error.code;
      throw enhancedError;
    }
    throw error;
  }
}

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

    // Build query string
    const queryParams = new URLSearchParams();
    if (params.calendarInviteesDomains) {
      params.calendarInviteesDomains.forEach(domain => {
        queryParams.append('calendar_invitees_domains', domain);
      });
    }
    if (params.recordedBy) {
      params.recordedBy.forEach(email => {
        queryParams.append('recorded_by', email);
      });
    }
    if (params.teams) {
      params.teams.forEach(team => {
        queryParams.append('teams', team);
      });
    }
    if (params.cursor) {
      queryParams.append('cursor', params.cursor);
    }

    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      try {
        // Add cursor to query if we have one
        const query = queryParams.toString();
        const endpoint = `/recordings${query ? `?${query}` : ''}`;
        
        const response = await fathomRequest(endpoint);
        
        // Extract items from response
        let items = [];
        if (Array.isArray(response)) {
          items = response;
        } else if (response.items) {
          items = response.items;
        } else if (response.data && Array.isArray(response.data)) {
          items = response.data;
        } else if (response.data && response.data.items) {
          items = response.data.items;
        }
        
        if (items && items.length > 0) {
          allMeetings.push(...items);
          console.log(`Fetched ${items.length} meetings (total: ${allMeetings.length})`);
        }
        
        // Check for pagination
        cursor = response.next_cursor || response.cursor || response.pagination?.next_cursor || null;
        hasMore = cursor !== null && cursor !== undefined;
        
        if (hasMore) {
          queryParams.set('cursor', cursor);
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
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
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      statusCode: error.statusCode,
      url: error.url,
      code: error.code,
      stack: error.stack
    });
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
    console.error('Full error details:', {
      message: error.message,
      status: error.status,
      statusCode: error.statusCode,
      url: error.url,
      code: error.code,
      stack: error.stack
    });
    
    // Return more detailed error information
    const errorResponse = {
      error: 'Failed to fetch meetings',
      message: error.message
    };
    
    // Include additional details in development/preview
    if (process.env.VERCEL_ENV !== 'production') {
      errorResponse.details = {
        status: error.status || error.statusCode,
        url: error.url,
        code: error.code
      };
    }
    
    res.status(error.status || error.statusCode || 500).json(errorResponse);
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
    
    // Fetch transcript from Fathom API
    let transcript;
    try {
      const response = await fathomRequest(`/recordings/${recordingId}/transcript`);
      
      // Extract transcript from response
      if (response.transcript) {
        transcript = response.transcript;
      } else if (response.data && response.data.transcript) {
        transcript = response.data.transcript;
      } else if (response.result && response.result.transcript) {
        transcript = response.result.transcript;
      } else if (typeof response === 'string') {
        transcript = response;
      } else {
        transcript = response;
      }
    } catch (apiError) {
      console.warn('Primary transcript method failed, trying alternative...');
      throw apiError;
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
    environment: process.env.VERCEL_ENV || 'development',
    apiKeySet: !!process.env.FATHOM_API_KEY,
    apiBaseUrl: FATHOM_API_BASE,
    cache: {
      hasCache: meetingsCache !== null,
      cacheSize: meetingsCache ? meetingsCache.length : 0,
      cacheAge: cacheTimestamp ? Math.floor((Date.now() - cacheTimestamp) / 1000) : null
    }
  });
});

/**
 * GET /api/test-connection
 * Test endpoint to verify Fathom API connectivity
 */
app.get('/api/test-connection', async (req, res) => {
  try {
    const apiKey = process.env.FATHOM_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'FATHOM_API_KEY is not set',
        message: 'Please set FATHOM_API_KEY in your environment variables'
      });
    }

    const testUrl = `${FATHOM_API_BASE}/recordings?limit=1`;
    console.log(`Testing connection to: ${testUrl}`);
    
    try {
      const response = await fetch(testUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const responseText = await response.text();
      
      return res.json({
        status: 'connection_test',
        apiBaseUrl: FATHOM_API_BASE,
        testUrl: testUrl,
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responsePreview: responseText.substring(0, 200),
        headers: Object.fromEntries(response.headers.entries())
      });
    } catch (fetchError) {
      return res.status(500).json({
        error: 'Fetch failed',
        message: fetchError.message,
        code: fetchError.code,
        cause: fetchError.cause?.message,
        stack: process.env.VERCEL_ENV !== 'production' ? fetchError.stack : undefined
      });
    }
  } catch (error) {
    return res.status(500).json({
      error: 'Test failed',
      message: error.message,
      stack: process.env.VERCEL_ENV !== 'production' ? error.stack : undefined
    });
  }
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

