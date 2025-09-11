import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// SSE client management
const clients = new Set();
let lastETag = null;
let cache = null;
let currentLeagueData = new Map(); // Store current league data keyed by leagueId-week

// Cache for API responses
const apiCache = new Map();
const CACHE_DURATION = 30000; // 30 seconds

// Helper function to get cached or fresh API data
async function getCachedData(key, fetchFunction, duration = CACHE_DURATION) {
    const cached = apiCache.get(key);
    if (cached && Date.now() - cached.timestamp < duration) {
        return cached.data;
    }
    
    try {
        const data = await fetchFunction();
        apiCache.set(key, { data, timestamp: Date.now() });
        return data;
    } catch (error) {
        // Return cached data if available, even if expired
        if (cached) {
            console.warn(`API error for ${key}, using cached data:`, error.message);
            return cached.data;
        }
        throw error;
    }
}

// Fantasy API endpoints (moved from frontend)
app.get('/api/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const data = await getCachedData(
            `user-${username}`,
            () => fetch(`https://api.sleeper.app/v1/user/${username}`).then(r => r.json())
        );
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user/:userId/leagues/:season', async (req, res) => {
    try {
        const { userId, season } = req.params;
        const data = await getCachedData(
            `leagues-${userId}-${season}`,
            () => fetch(`https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${season}`).then(r => r.json())
        );
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/league/:leagueId', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const data = await getCachedData(
            `league-${leagueId}`,
            () => fetch(`https://api.sleeper.app/v1/league/${leagueId}`).then(r => r.json())
        );
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/league/:leagueId/matchups/:week', async (req, res) => {
    try {
        const { leagueId, week } = req.params;
        const data = await getCachedData(
            `matchups-${leagueId}-${week}`,
            () => fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`).then(r => r.json()),
            10000 // 10 second cache for matchups (more frequent updates)
        );
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/league/:leagueId/rosters', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const data = await getCachedData(
            `rosters-${leagueId}`,
            () => fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json())
        );
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/league/:leagueId/users', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const data = await getCachedData(
            `users-${leagueId}`,
            () => fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`).then(r => r.json())
        );
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/players/nfl', async (req, res) => {
    try {
        const data = await getCachedData(
            'nfl-players',
            () => fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json()),
            300000 // 5 minute cache for players (rarely changes)
        );
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ESPN API endpoints (for game data)
app.get('/api/nfl/scoreboard/:week', async (req, res) => {
    try {
        const { week } = req.params;
        const year = new Date().getFullYear();
        const data = await getCachedData(
            `nfl-scoreboard-${week}`,
            () => fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${year}&seasontype=2&week=${week}`).then(r => r.json()),
            30000 // 30 second cache for live game data
        );
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ESPN Player ID mapping endpoint - builds comprehensive mapping from all team rosters
app.get('/api/espn/player-mapping', async (req, res) => {
    try {
        const data = await getCachedData(
            'espn-player-mapping',
            async () => {
                const playerMapping = {};
                
                // All 32 NFL team IDs (ESPN team IDs)
                const nflTeamIds = [
                    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
                    17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 33, 34
                ];
                
                console.log('Building ESPN player mapping from all team rosters...');
                
                // Fetch all team rosters in parallel
                const rosterPromises = nflTeamIds.map(async (teamId) => {
                    try {
                        const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`);
                        if (!response.ok) return null;
                        
                        const rosterData = await response.json();
                        const teamAbbr = rosterData.team?.abbreviation;
                        
                        if (rosterData.athletes && teamAbbr) {
                            // Process each position group
                            rosterData.athletes.forEach(positionGroup => {
                                if (positionGroup.items) {
                                    positionGroup.items.forEach(athlete => {
                                        if (athlete.id && athlete.displayName) {
                                            // Create mapping key from name and team
                                            const nameKey = athlete.displayName.toLowerCase().replace(/[^a-z\s]/g, '');
                                            const mappingKey = `${nameKey}|${teamAbbr}`;
                                            
                                            playerMapping[mappingKey] = {
                                                espnId: athlete.id,
                                                name: athlete.displayName,
                                                team: teamAbbr,
                                                headshot: athlete.headshot?.href
                                            };
                                        }
                                    });
                                }
                            });
                        }
                        
                        return { teamId, teamAbbr, playerCount: rosterData.athletes?.reduce((sum, group) => sum + (group.items?.length || 0), 0) || 0 };
                    } catch (error) {
                        console.warn(`Failed to fetch roster for team ${teamId}:`, error.message);
                        return null;
                    }
                });
                
                const results = await Promise.all(rosterPromises);
                const successfulFetches = results.filter(r => r !== null);
                
                console.log(`Successfully built ESPN player mapping from ${successfulFetches.length}/32 teams`);
                console.log(`Total players mapped: ${Object.keys(playerMapping).length}`);
                
                return {
                    playerMapping,
                    metadata: {
                        totalPlayers: Object.keys(playerMapping).length,
                        successfulTeams: successfulFetches.length,
                        teams: successfulFetches,
                        lastUpdated: new Date().toISOString()
                    }
                };
            },
            3600000 // 1 hour cache - player rosters don't change often
        );
        
        res.json(data);
    } catch (error) {
        console.error('Error building ESPN player mapping:', error);
        res.status(500).json({ error: error.message });
    }
});


// SSE endpoint for real-time updates
app.get('/stream/matchup/:leagueId/:week', (req, res) => {
    const { leagueId, week } = req.params;
    const streamKey = `${leagueId}-${week}`;
    
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
    });
    res.flushHeaders();

    const clientInfo = { res, leagueId, week, streamKey };
    clients.add(clientInfo);
    
    // Send current snapshot immediately if available
    const currentData = currentLeagueData.get(streamKey);
    if (currentData) {
        res.write(`data: ${JSON.stringify(currentData)}\n\n`);
    }

    req.on('close', () => {
        clients.delete(clientInfo);
    });
});

// Function to compute selective update payload
async function computeMatchupUpdate(leagueId, week) {
    try {
        const streamKey = `${leagueId}-${week}`;
        
        // Fetch all required data
        const [matchups, rosters, users, players] = await Promise.all([
            getCachedData(
                `matchups-${leagueId}-${week}`,
                () => fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`).then(r => r.json()),
                5000 // 5 second cache for live updates
            ),
            getCachedData(
                `rosters-${leagueId}`,
                () => fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json())
            ),
            getCachedData(
                `users-${leagueId}`,
                () => fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`).then(r => r.json())
            ),
            getCachedData(
                'nfl-players',
                () => fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json())
            )
        ]);

        // Compute minimal update payload
        const payload = {
            leagueId,
            week: parseInt(week),
            updatedAt: new Date().toISOString(),
            matchups: []
        };

        // Group matchups by matchup_id
        const matchupGroups = {};
        matchups.forEach(matchup => {
            if (!matchupGroups[matchup.matchup_id]) {
                matchupGroups[matchup.matchup_id] = [];
            }
            matchupGroups[matchup.matchup_id].push(matchup);
        });

        // Process each matchup pair
        Object.values(matchupGroups).forEach(group => {
            if (group.length === 2) {
                const [team1, team2] = group;
                
                const roster1 = rosters.find(r => r.roster_id === team1.roster_id);
                const roster2 = rosters.find(r => r.roster_id === team2.roster_id);
                const user1 = users.find(u => u.user_id === roster1?.owner_id);
                const user2 = users.find(u => u.user_id === roster2?.owner_id);

                // Calculate team scores
                const team1Score = team1.starters_points?.reduce((sum, pts) => sum + (pts || 0), 0) || 0;
                const team2Score = team2.starters_points?.reduce((sum, pts) => sum + (pts || 0), 0) || 0;

                // Create player points maps
                const team1PlayerPoints = {};
                const team2PlayerPoints = {};
                
                if (team1.starters && team1.starters_points) {
                    team1.starters.forEach((playerId, index) => {
                        if (playerId) {
                            team1PlayerPoints[playerId] = team1.starters_points[index] || 0;
                        }
                    });
                }
                
                if (team2.starters && team2.starters_points) {
                    team2.starters.forEach((playerId, index) => {
                        if (playerId) {
                            team2PlayerPoints[playerId] = team2.starters_points[index] || 0;
                        }
                    });
                }

                payload.matchups.push({
                    matchupId: team1.matchup_id,
                    team1: {
                        rosterId: team1.roster_id,
                        userId: user1?.user_id,
                        teamName: user1?.display_name || user1?.username || `Team ${team1.roster_id}`,
                        points: team1Score,
                        playerPoints: team1PlayerPoints
                    },
                    team2: {
                        rosterId: team2.roster_id,
                        userId: user2?.user_id,
                        teamName: user2?.display_name || user2?.username || `Team ${team2.roster_id}`,
                        points: team2Score,
                        playerPoints: team2PlayerPoints
                    }
                });
            }
        });

        return payload;
    } catch (error) {
        console.error('Error computing matchup update:', error);
        return null;
    }
}

// Polling function to check for updates and broadcast to SSE clients
async function pollAndBroadcast() {
    const activeStreams = new Set();
    
    // Collect unique league-week combinations from active clients
    clients.forEach(client => {
        activeStreams.add(client.streamKey);
    });

    // Process each active stream
    for (const streamKey of activeStreams) {
        const [leagueId, week] = streamKey.split('-');
        
        try {
            const newData = await computeMatchupUpdate(leagueId, week);
            if (!newData) continue;

            const currentData = currentLeagueData.get(streamKey);
            const newDataString = JSON.stringify(newData);
            
            // Check if data has changed
            if (!currentData || JSON.stringify(currentData) !== newDataString) {
                currentLeagueData.set(streamKey, newData);
                
                // Broadcast to all clients subscribed to this stream
                const message = `data: ${newDataString}\n\n`;
                clients.forEach(client => {
                    if (client.streamKey === streamKey) {
                        try {
                            client.res.write(message);
                        } catch (error) {
                            clients.delete(client);
                        }
                    }
                });
                
                console.log(`Updated ${streamKey} - broadcasted to ${Array.from(clients).filter(c => c.streamKey === streamKey).length} clients`);
            }
        } catch (error) {
            console.error(`Error polling ${streamKey}:`, error);
        }
    }
}

// Start polling - adjust interval based on game activity
let pollInterval;
function startPolling() {
    clearInterval(pollInterval);
    
    // More aggressive polling during potential game times
    const currentHour = new Date().getHours();
    const isGameDay = [0, 1, 4].includes(new Date().getDay()); // Sunday, Monday, Thursday
    const isGameTime = isGameDay && (currentHour >= 13 && currentHour <= 23); // 1 PM - 11 PM
    
    const interval = isGameTime ? 3000 : 10000; // 3s during games, 10s otherwise
    pollInterval = setInterval(pollAndBroadcast, interval);
    
    console.log(`Polling started with ${interval}ms interval (game time: ${isGameTime})`);
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        clients: clients.size,
        cacheSize: apiCache.size,
        activeStreams: currentLeagueData.size 
    });
});

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Fantasy Matchups server running on port ${PORT}`);
    startPolling();
    
    // Restart polling every hour to adjust for game times
    setInterval(startPolling, 3600000); // 1 hour
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    clearInterval(pollInterval);
    clients.forEach(client => {
        try {
            client.res.end();
        } catch (error) {
            // Client already disconnected
        }
    });
    process.exit(0);
});
