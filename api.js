// Sleeper API base URL
const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

// Global variables to store app state
let currentUser = null;
let currentLeague = null;
let currentWeek = null;
let playersData = null;
let autoRefreshInterval = null;
let isAutoRefreshEnabled = true;

// Utility function to make API calls
async function makeApiCall(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        throw error;
    }
}

// Get user information by username
async function getUserByUsername(username) {
    const url = `${SLEEPER_API_BASE}/user/${username}`;
    return await makeApiCall(url);
}

// Get user's leagues for a specific sport and season
async function getUserLeagues(userId, sport = 'nfl', season = '2025') {
    const url = `${SLEEPER_API_BASE}/user/${userId}/leagues/${sport}/${season}`;
    return await makeApiCall(url);
}

// Get league information
async function getLeague(leagueId) {
    const url = `${SLEEPER_API_BASE}/league/${leagueId}`;
    return await makeApiCall(url);
}

// Get league rosters
async function getLeagueRosters(leagueId) {
    const url = `${SLEEPER_API_BASE}/league/${leagueId}/rosters`;
    return await makeApiCall(url);
}

// Get league users
async function getLeagueUsers(leagueId) {
    const url = `${SLEEPER_API_BASE}/league/${leagueId}/users`;
    return await makeApiCall(url);
}

// Get matchups for a specific week
async function getMatchups(leagueId, week) {
    const url = `${SLEEPER_API_BASE}/league/${leagueId}/matchups/${week}`;
    return await makeApiCall(url);
}

// Get all NFL players (cached for performance)
async function getNFLPlayers(forceRefresh = false) {
    if (playersData && !forceRefresh) {
        return playersData;
    }
    
    const url = `${SLEEPER_API_BASE}/players/nfl`;
    playersData = await makeApiCall(url);
    return playersData;
}

// Clear cached data to force fresh API calls
function clearCache() {
    playersData = null;
}

// Get current NFL week
function getCurrentNFLWeek() {
    // This is a simplified calculation - in a real app you'd want to use a more accurate method
    const now = new Date();
    const seasonStart = new Date('2025-09-04'); // Approximate NFL 2025 season start (first Thursday in September)
    const weeksSinceStart = Math.floor((now - seasonStart) / (7 * 24 * 60 * 60 * 1000)) + 1;
    
    // If we're before the season starts, default to week 1
    if (now < seasonStart) {
        return 1;
    }
    
    // NFL regular season is weeks 1-18, then playoffs
    if (weeksSinceStart < 1) return 1;
    if (weeksSinceStart > 18) return 18;
    return Math.min(Math.max(weeksSinceStart, 1), 18);
}

// Find user's matchup for a specific week
async function findUserMatchup(leagueId, userId, week) {
    try {
        const [matchups, rosters, users] = await Promise.all([
            getMatchups(leagueId, week),
            getLeagueRosters(leagueId),
            getLeagueUsers(leagueId)
        ]);

        // Find user's roster
        const userRoster = rosters.find(roster => roster.owner_id === userId);
        if (!userRoster) {
            throw new Error('User not found in this league');
        }

        // Find user's matchup
        const userMatchup = matchups.find(matchup => matchup.roster_id === userRoster.roster_id);
        if (!userMatchup) {
            throw new Error('No matchup found for this week');
        }

        // Find opponent's matchup (same matchup_id, different roster_id)
        const opponentMatchup = matchups.find(matchup => 
            matchup.matchup_id === userMatchup.matchup_id && 
            matchup.roster_id !== userMatchup.roster_id
        );

        if (!opponentMatchup) {
            throw new Error('Opponent matchup not found');
        }

        // Find opponent's roster and user info
        const opponentRoster = rosters.find(roster => roster.roster_id === opponentMatchup.roster_id);
        const opponentUser = users.find(user => user.user_id === opponentRoster.owner_id);

        return {
            userMatchup,
            opponentMatchup,
            userRoster,
            opponentRoster,
            opponentUser,
            users,
            rosters
        };
    } catch (error) {
        throw error;
    }
}

// Get player information with points
async function getPlayerInfo(playerId, matchupData) {
    const players = await getNFLPlayers();
    const player = players[playerId];
    
    if (!player) {
        return {
            name: 'Unknown Player',
            position: 'N/A',
            points: 0
        };
    }

    return {
        name: `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Unknown',
        position: player.position || 'N/A',
        team: player.team || 'N/A',
        points: matchupData?.players_points?.[playerId] || 0
    };
}

// Calculate total team score (only started players)
function calculateTeamScore(matchupData) {
    if (!matchupData?.players_points || !matchupData?.starters) return 0;
    
    // Only sum points from started players
    return matchupData.starters.reduce((total, playerId) => {
        const points = matchupData.players_points[playerId] || 0;
        return total + points;
    }, 0);
}

// Format player points for display
function formatPoints(points) {
    return typeof points === 'number' ? points.toFixed(2) : '0.00';
}

// Check if games are currently active (simplified logic)
function areGamesActive() {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const hour = now.getHours();
    
    // Simplified: assume games are active on Sunday 1PM-11PM ET and Monday 8PM-11PM ET
    if (day === 0 && hour >= 13 && hour <= 23) return true; // Sunday
    if (day === 1 && hour >= 20 && hour <= 23) return true; // Monday
    if (day === 4 && hour >= 20 && hour <= 23) return true; // Thursday
    
    return false;
}

// Get NFL teams data from ESPN API (cached)
let nflTeamsData = null;
async function getNFLTeams() {
    if (nflTeamsData) {
        return nflTeamsData;
    }
    
    try {
        const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams';
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        nflTeamsData = data.sports[0].leagues[0].teams || [];
        return nflTeamsData;
    } catch (error) {
        return [];
    }
}

// Get team info by abbreviation
async function getTeamInfo(teamAbbr) {
    if (!teamAbbr) return null;
    
    // Normalize team abbreviation for ESPN API compatibility
    const normalizedTeamAbbr = normalizeTeamAbbreviation(teamAbbr);
    
    const teams = await getNFLTeams();
    const team = teams.find(t => t.team.abbreviation === normalizedTeamAbbr);
    
    if (!team) return null;
    
    return {
        name: team.team.displayName,
        abbreviation: teamAbbr, // Use original abbreviation for display
        color: team.team.color || '#000000',
        alternateColor: team.team.alternateColor || '#ffffff',
        logo: team.team.logos?.[0]?.href || '',
        logoSmall: team.team.logos?.find(logo => logo.width <= 50)?.href || team.team.logos?.[0]?.href || '',
        id: team.team.id
    };
}

// Cache for player headshots
let playerHeadshotCache = {};

// Get player headshot from ESPN API
async function getPlayerHeadshot(playerName, teamAbbr) {
    if (!teamAbbr || teamAbbr === 'N/A') return null;
    
    // Create cache key
    const cacheKey = `${playerName}-${teamAbbr}`;
    if (playerHeadshotCache[cacheKey]) {
        return playerHeadshotCache[cacheKey];
    }
    
    try {
        const teamInfo = await getTeamInfo(teamAbbr);
        if (!teamInfo?.id) return null;
        
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamInfo.id}?enable=roster`;
        const response = await fetch(url);
        
        if (!response.ok) {
            return null;
        }
        
        const data = await response.json();
        const roster = data.team?.athletes || [];
        
        // Search for player by name (try different matching strategies)
        const nameParts = playerName.toLowerCase().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts[nameParts.length - 1];
        
        let player = roster.find(p => {
            const fullName = p.fullName?.toLowerCase() || '';
            const displayName = p.displayName?.toLowerCase() || '';
            return fullName.includes(playerName.toLowerCase()) || 
                   displayName.includes(playerName.toLowerCase());
        });
        
        // Try partial matching if exact match fails
        if (!player) {
            player = roster.find(p => {
                const fullName = p.fullName?.toLowerCase() || '';
                const displayName = p.displayName?.toLowerCase() || '';
                return (fullName.includes(firstName) && fullName.includes(lastName)) ||
                       (displayName.includes(firstName) && displayName.includes(lastName));
            });
        }
        
        const headshot = player?.headshot?.href || null;
        
        // Cache the result
        playerHeadshotCache[cacheKey] = headshot;
        return headshot;
        
    } catch (error) {
        return null;
    }
}

// Get NFL schedule from ESPN API
async function getNFLSchedule(week) {
    try {
        // ESPN API endpoint for NFL schedule
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data.events || [];
    } catch (error) {
        return [];
    }
}

// Map team abbreviations between Sleeper and ESPN APIs
function normalizeTeamAbbreviation(team) {
    const teamMappings = {
        // Sleeper -> ESPN mappings (only when ESPN uses different abbreviations)
        'WAS': 'WSH',  // Washington Commanders (Sleeper: WAS, ESPN: WSH)
        'JAC': 'JAX',  // Jacksonville Jaguars (Sleeper: JAC, ESPN: JAX)
        
        // ESPN -> Sleeper mappings (reverse)
        'WSH': 'WAS',  // Washington Commanders (ESPN: WSH, Sleeper: WAS)
        'JAX': 'JAC'   // Jacksonville Jaguars (ESPN: JAX, Sleeper: JAC)
        
        // Note: LAR (Rams) and LV (Raiders) use the same abbreviations in both APIs
    };
    
    return teamMappings[team] || team;
}

// Get game time for a specific NFL team in a given week
async function getTeamGameTime(team, week) {
    try {
        // Handle players without teams (free agents, etc.)
        if (!team || team === 'N/A' || team === '') {
            return {
                time: 'Free Agent',
                homeTeam: 'Free Agents',
                awayTeam: '',
                status: 'Free Agent'
            };
        }
        
        const schedule = await getNFLSchedule(week);
        
        // Try both the original team abbreviation and the normalized version
        const teamVariations = [team, normalizeTeamAbbreviation(team)];
        
        for (const game of schedule) {
            const homeTeam = game.competitions[0]?.competitors?.find(c => c.homeAway === 'home')?.team?.abbreviation;
            const awayTeam = game.competitions[0]?.competitors?.find(c => c.homeAway === 'away')?.team?.abbreviation;
            
            // Check if any team variation matches either home or away team
            const matchFound = teamVariations.some(teamVar => 
                homeTeam === teamVar || awayTeam === teamVar
            );
            
            if (matchFound) {
                const gameDate = new Date(game.date);
                const gameTime = gameDate.toLocaleString('en-US', {
                    weekday: 'long',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short'
                });
                
                // Get scores (for both completed and live games)
                const homeScore = game.competitions[0]?.competitors?.find(c => c.homeAway === 'home')?.score || '0';
                const awayScore = game.competitions[0]?.competitors?.find(c => c.homeAway === 'away')?.score || '0';
                const isCompleted = game.status?.type?.completed || false;
                
                // Enhanced live game detection
                const statusState = game.status?.type?.state;
                const statusName = game.status?.type?.name;
                const isLive = statusState === 'in' || 
                              statusName === 'STATUS_IN_PROGRESS' ||
                              (game.status?.type?.description && 
                               game.status.type.description.toLowerCase().includes('progress'));
                
                // Get game clock information for live games
                let gameClock = '';
                let gameQuarter = '';
                if (isLive) {
                    // Try multiple sources for clock information
                    gameClock = game.status?.displayClock || 
                               game.status?.clock || 
                               '';
                    
                    // Try multiple sources for quarter/period information
                    gameQuarter = game.status?.type?.shortDetail || 
                                 game.status?.period ? `Q${game.status.period}` : 
                                 game.status?.type?.detail || 
                                 '';
                }
                
                // Determine winner if game is completed
                let winnerTeam = null;
                if (isCompleted && homeScore !== awayScore) {
                    winnerTeam = parseInt(homeScore) > parseInt(awayScore) ? homeTeam : awayTeam;
                }
                
                // Normalize team abbreviations back to Sleeper format for consistent display
                const normalizedHomeTeam = normalizeTeamAbbreviation(homeTeam);
                const normalizedAwayTeam = normalizeTeamAbbreviation(awayTeam);
                const normalizedWinnerTeam = winnerTeam ? normalizeTeamAbbreviation(winnerTeam) : null;
                
                return {
                    time: gameTime,
                    homeTeam: normalizedHomeTeam,
                    awayTeam: normalizedAwayTeam,
                    homeScore,
                    awayScore,
                    status: game.status?.type?.description || 'Scheduled',
                    isCompleted,
                    isLive,
                    gameClock,
                    gameQuarter,
                    winnerTeam: normalizedWinnerTeam
                };
            }
        }
        
        // Default if team not found in schedule
        return {
            time: 'No Game This Week',
            homeTeam: team || 'Unknown',
            awayTeam: '',
            status: 'Bye Week'
        };
    } catch (error) {
        return {
            time: 'Sunday 1:00 PM EST',
            homeTeam: team || 'Unknown',
            awayTeam: '',
            status: 'Scheduled'
        };
    }
}

// Convert hex color to pale version (lighter opacity)
function makePaleColor(hexColor, opacity = 0.2) {
    if (!hexColor) return 'rgba(45, 55, 72, 0.1)'; // Default pale gray
    
    // Remove # if present
    const hex = hexColor.replace('#', '');
    
    // Convert hex to RGB
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Error handling wrapper
async function handleApiCall(apiFunction, ...args) {
    try {
        showLoading(true);
        const result = await apiFunction(...args);
        showLoading(false);
        return result;
    } catch (error) {
        showLoading(false);
        showError(`API Error: ${error.message}`);
        throw error;
    }
}
