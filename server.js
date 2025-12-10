import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Simple cache
let meetingsCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Simple Fathom API client that mimics the SDK behavior
 */
class Fathom {
  constructor({ security }) {
    this.apiKey = security.apiKeyAuth;
    this.baseUrl = process.env.FATHOM_API_BASE || 'https://api.fathom.video/v1';
  }

  async listMeetings(params = {}) {
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

    const url = `${this.baseUrl}/recordings${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Fathom API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Return an async iterable to match SDK behavior
    const self = this;
    return {
      async *[Symbol.asyncIterator]() {
        let currentData = data;
        let cursor = null;
        
        while (currentData) {
          yield currentData;
          
          // Check for pagination
          cursor = currentData.next_cursor || currentData.cursor || currentData.pagination?.next_cursor;
          if (!cursor) break;
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Fetch next page
          const nextUrl = `${self.baseUrl}/recordings?cursor=${cursor}`;
          const nextResponse = await fetch(nextUrl, {
            headers: {
              'Authorization': `Bearer ${self.apiKey}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (!nextResponse.ok) break;
          currentData = await nextResponse.json();
        }
      }
    };
  }
}

/**
 * Get all meetings using the SDK-like approach
 */
async function getAllMeetings() {
  const fathom = new Fathom({
    security: {
      apiKeyAuth: process.env.FATHOM_API_KEY
    }
  });

  const result = await fathom.listMeetings({});
  const allMeetings = [];

  for await (const page of result) {
    if (page.items) {
      allMeetings.push(...page.items);
    } else if (Array.isArray(page)) {
      allMeetings.push(...page);
    } else if (page.data && Array.isArray(page.data)) {
      allMeetings.push(...page.data);
    } else if (page.data && page.data.items) {
      allMeetings.push(...page.data.items);
    }
  }

  console.log(`Total meetings: ${allMeetings.length}`);
  return allMeetings;
}

/**
 * GET /api/meetings
 */
app.get('/api/meetings', async (req, res) => {
  try {
    // Check cache
    const now = Date.now();
    if (meetingsCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_TTL) {
      return res.json({ items: meetingsCache });
    }

    // Fetch fresh data
    const meetings = await getAllMeetings();
    
    // Update cache
    meetingsCache = meetings;
    cacheTimestamp = now;
    
    res.json({ items: meetings });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ 
      error: 'Failed to fetch meetings',
      message: error.message 
    });
  }
});

/**
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    apiKeySet: !!process.env.FATHOM_API_KEY
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Fathom Meetings Server running on port ${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  GET  /api/meetings - List all meetings`);
  console.log(`  GET  /api/health - Health check`);
  
  if (!process.env.FATHOM_API_KEY) {
    console.warn('⚠️  WARNING: FATHOM_API_KEY not set in environment variables');
  }
});
