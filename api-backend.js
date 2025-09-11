// Backend API client - replaces direct Sleeper API calls
const API_BASE = '';  // Empty for same-origin requests

// Global variables
let currentUser = null;
let currentLeague = null;
let currentWeek = null;
let isAutoRefreshEnabled = true;
let autoRefreshInterval = null;

// SSE connection for real-time updates
let eventSource = null;

// Cache management
const cache = new Map();

function clearCache() {
    cache.clear();
}

// User API
async function getUserByUsername(username) {
    try {
        const response = await fetch(`${API_BASE}/api/user/${username}`);
        if (!response.ok) throw new Error(`Failed to fetch user: ${response.status}`);
        return await response.json();
    } catch (error) {
        throw new Error(`Error fetching user ${username}: ${error.message}`);
    }
}

async function getUserLeagues(userId) {
    try {
        const currentSeason = new Date().getFullYear();
        const response = await fetch(`${API_BASE}/api/user/${userId}/leagues/${currentSeason}`);
        if (!response.ok) throw new Error(`Failed to fetch leagues: ${response.status}`);
        return await response.json();
    } catch (error) {
        throw new Error(`Error fetching leagues for user ${userId}: ${error.message}`);
    }
}

// League API
async function getLeague(leagueId) {
    try {
        const response = await fetch(`${API_BASE}/api/league/${leagueId}`);
        if (!response.ok) throw new Error(`Failed to fetch league: ${response.status}`);
        return await response.json();
    } catch (error) {
        throw new Error(`Error fetching league ${leagueId}: ${error.message}`);
    }
}

async function getMatchups(leagueId, week) {
    try {
        const response = await fetch(`${API_BASE}/api/league/${leagueId}/matchups/${week}`);
        if (!response.ok) throw new Error(`Failed to fetch matchups: ${response.status}`);
        return await response.json();
    } catch (error) {
        throw new Error(`Error fetching matchups for league ${leagueId} week ${week}: ${error.message}`);
    }
}

async function getLeagueRosters(leagueId) {
    try {
        const response = await fetch(`${API_BASE}/api/league/${leagueId}/rosters`);
        if (!response.ok) throw new Error(`Failed to fetch rosters: ${response.status}`);
        return await response.json();
    } catch (error) {
        throw new Error(`Error fetching rosters for league ${leagueId}: ${error.message}`);
    }
}

async function getLeagueUsers(leagueId) {
    try {
        const response = await fetch(`${API_BASE}/api/league/${leagueId}/users`);
        if (!response.ok) throw new Error(`Failed to fetch users: ${response.status}`);
        return await response.json();
    } catch (error) {
        throw new Error(`Error fetching users for league ${leagueId}: ${error.message}`);
    }
}

// Player API
async function getNFLPlayers() {
    const cacheKey = 'nfl-players';
    const cached = cache.get(cacheKey);
    
    // Use 5-minute cache for players data
    if (cached && Date.now() - cached.timestamp < 300000) {
        return cached.data;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/players/nfl`);
        if (!response.ok) throw new Error(`Failed to fetch players: ${response.status}`);
        const data = await response.json();
        
        cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    } catch (error) {
        // Return cached data if available, even if expired
        if (cached) {
            console.warn('Using cached player data due to API error:', error.message);
            return cached.data;
        }
        throw new Error(`Error fetching NFL players: ${error.message}`);
    }
}

// NFL Game Data API
async function getNFLScoreboard(week) {
    try {
        const response = await fetch(`${API_BASE}/api/nfl/scoreboard/${week}`);
        if (!response.ok) throw new Error(`Failed to fetch scoreboard: ${response.status}`);
        return await response.json();
    } catch (error) {
        throw new Error(`Error fetching NFL scoreboard for week ${week}: ${error.message}`);
    }
}

// SSE Connection Management
let ignoreFirstSSEUpdate = true; // Flag to ignore first SSE update to prevent initial duplication

function connectToMatchupStream(leagueId, week) {
    // Close existing connection
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    
    // Don't connect if no league/week
    if (!leagueId || !week) return;
    
    // Reset the ignore flag when establishing new connection
    ignoreFirstSSEUpdate = true;
    
    try {
        const streamUrl = `${API_BASE}/stream/matchup/${leagueId}/${week}`;
        eventSource = new EventSource(streamUrl);
        
        eventSource.onopen = () => {
            console.log('SSE connection established');
        };
        
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // Skip the first SSE update to prevent initial duplication
                if (ignoreFirstSSEUpdate) {
                    console.log('Ignoring first SSE update to prevent duplication');
                    ignoreFirstSSEUpdate = false;
                    return;
                }
                
                handleRealtimeUpdate(data);
            } catch (error) {
                console.error('Error parsing SSE data:', error);
            }
        };
        
        eventSource.onerror = (error) => {
            console.warn('SSE connection error, will retry automatically:', error);
        };
        
    } catch (error) {
        console.error('Failed to establish SSE connection:', error);
    }
}

function disconnectFromStream() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
        console.log('SSE connection closed');
    }
}

// Handle real-time updates from SSE
function handleRealtimeUpdate(data) {
    if (!data || !data.matchups) return;
    
    console.log('Received real-time update:', data.updatedAt);
    
    // Only update scores and points, never re-render rosters
    data.matchups.forEach(matchup => {
        updateMatchupDisplay(matchup);
    });
    
    // Update sidebar if it exists
    updateSidebarFromRealtimeData(data);
}

// Selective DOM updates
function updateMatchupDisplay(matchupData) {
    const { team1, team2 } = matchupData;
    
    // Update main team scores if this is the current user's matchup
    if (isCurrentUserMatchup(team1, team2)) {
        updateTeamScores(team1, team2);
        updatePlayerPoints(team1, team2);
    }
}

function isCurrentUserMatchup(team1, team2) {
    if (!currentUser) return false;
    return team1.userId === currentUser.user_id || team2.userId === currentUser.user_id;
}

function updateTeamScores(team1, team2) {
    const userScoreEl = document.getElementById('user-score');
    const opponentScoreEl = document.getElementById('opponent-score');
    
    if (!userScoreEl || !opponentScoreEl) return;
    
    // Determine which team is the user's team
    const isUserTeam1 = team1.userId === currentUser?.user_id;
    const userTeam = isUserTeam1 ? team1 : team2;
    const opponentTeam = isUserTeam1 ? team2 : team1;
    
    // Update scores with animation
    animateScoreUpdate(userScoreEl, userTeam.points);
    animateScoreUpdate(opponentScoreEl, opponentTeam.points);
}

function updatePlayerPoints(team1, team2) {
    const isUserTeam1 = team1.userId === currentUser?.user_id;
    const userTeam = isUserTeam1 ? team1 : team2;
    const opponentTeam = isUserTeam1 ? team2 : team1;
    
    // Update user team player points
    updateTeamPlayerPoints('user-roster', userTeam.playerPoints);
    // Update opponent team player points  
    updateTeamPlayerPoints('opponent-roster', opponentTeam.playerPoints);
}

function updateTeamPlayerPoints(containerId, playerPoints) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Find all player cards and update their points
    const playerCards = container.querySelectorAll('.player-card[data-player-id]');
    
    playerCards.forEach(card => {
        const playerId = card.dataset.playerId;
        if (playerId && playerPoints[playerId] !== undefined) {
            const pointsElement = card.querySelector('.player-points');
            if (pointsElement) {
                const newPoints = formatPoints(playerPoints[playerId]);
                const oldPoints = pointsElement.textContent;
                
                if (newPoints !== oldPoints) {
                    animatePointsUpdate(pointsElement, newPoints);
                }
            }
        }
    });
}

function updateSidebarFromRealtimeData(data) {
    const container = document.getElementById('other-matchups-list');
    if (!container) return;
    
    const matchupItems = container.querySelectorAll('.other-matchup-item');
    
    data.matchups.forEach((matchupData, index) => {
        if (index >= matchupItems.length) return;
        
        const item = matchupItems[index];
        const scoreElements = item.querySelectorAll('.other-matchup-score');
        
        if (scoreElements.length >= 2) {
            const team1Score = matchupData.team1.points;
            const team2Score = matchupData.team2.points;
            
            animateScoreUpdate(scoreElements[0], team1Score);
            animateScoreUpdate(scoreElements[1], team2Score);
            
            // Update winning class
            scoreElements[0].className = `other-matchup-score ${team1Score > team2Score ? 'winning' : ''}`;
            scoreElements[1].className = `other-matchup-score ${team2Score > team1Score ? 'winning' : ''}`;
        }
    });
}

// Animation helpers
function animateScoreUpdate(element, newScore) {
    const formattedScore = formatPoints(newScore);
    const oldScore = element.textContent;
    
    if (formattedScore !== oldScore) {
        element.style.transition = 'transform 0.2s ease, color 0.2s ease';
        element.style.transform = 'scale(1.1)';
        element.style.color = '#48bb78';
        
        setTimeout(() => {
            element.textContent = formattedScore;
            element.style.transform = 'scale(1)';
            element.style.color = '';
        }, 100);
        
        setTimeout(() => {
            element.style.transition = '';
        }, 300);
    }
}

function animatePointsUpdate(element, newPoints) {
    const oldPoints = element.textContent;
    
    if (newPoints !== oldPoints) {
        element.style.transition = 'background-color 0.3s ease';
        element.style.backgroundColor = 'rgba(72, 187, 120, 0.2)';
        element.textContent = newPoints;
        
        setTimeout(() => {
            element.style.backgroundColor = '';
            setTimeout(() => {
                element.style.transition = '';
            }, 300);
        }, 600);
    }
}

// Utility functions (kept from original)
function formatPoints(points) {
    if (points === null || points === undefined) return '0.0';
    return parseFloat(points).toFixed(1);
}

function getCurrentNFLWeek() {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentDate = now.getDate();
    
    if (currentMonth < 8) { // Before September
        return 1;
    } else if (currentMonth === 8) { // September
        if (currentDate < 7) return 1;
        if (currentDate < 14) return 2;
        if (currentDate < 21) return 3;
        if (currentDate < 28) return 4;
        return 5;
    } else if (currentMonth === 9) { // October
        if (currentDate < 5) return 5;
        if (currentDate < 12) return 6;
        if (currentDate < 19) return 7;
        if (currentDate < 26) return 8;
        return 9;
    } else if (currentMonth === 10) { // November
        if (currentDate < 2) return 9;
        if (currentDate < 9) return 10;
        if (currentDate < 16) return 11;
        if (currentDate < 23) return 12;
        if (currentDate < 30) return 13;
        return 14;
    } else if (currentMonth === 11) { // December
        if (currentDate < 7) return 14;
        if (currentDate < 14) return 15;
        if (currentDate < 21) return 16;
        if (currentDate < 28) return 17;
        return 18;
    } else { // After December
        return 18;
    }
}

// Legacy compatibility functions (simplified versions that delegate to backend)
async function findUserMatchup(leagueId, userId, week) {
    try {
        const [matchups, rosters, users] = await Promise.all([
            getMatchups(leagueId, week),
            getLeagueRosters(leagueId),
            getLeagueUsers(leagueId)
        ]);

        const userRoster = rosters.find(roster => roster.owner_id === userId);
        if (!userRoster) {
            throw new Error('User roster not found');
        }

        const userMatchup = matchups.find(matchup => matchup.roster_id === userRoster.roster_id);
        if (!userMatchup) {
            throw new Error('User matchup not found');
        }

        const opponentMatchup = matchups.find(matchup => 
            matchup.matchup_id === userMatchup.matchup_id && 
            matchup.roster_id !== userRoster.roster_id
        );

        if (!opponentMatchup) {
            throw new Error('Opponent matchup not found');
        }

        const opponentRoster = rosters.find(roster => roster.roster_id === opponentMatchup.roster_id);
        const opponentUser = users.find(user => user.user_id === opponentRoster?.owner_id);

        return {
            userMatchup,
            opponentMatchup,
            opponentUser,
            userRoster,
            opponentRoster,
            users
        };
    } catch (error) {
        throw new Error(`Failed to find user matchup: ${error.message}`);
    }
}

function calculateTeamScore(matchupData) {
    if (!matchupData.starters_points) return 0;
    return matchupData.starters_points.reduce((sum, points) => sum + (points || 0), 0);
}

// NFL Game Data with proper ESPN API integration
async function getTeamGameTime(team, week) {
    if (!team || team === 'FA' || team === 'N/A') {
        return {
            time: 'Free Agent',
            homeTeam: 'N/A',
            awayTeam: 'N/A',
            status: 'No Game This Week',
            isLive: false,
            isCompleted: false
        };
    }

    try {
        const scoreboard = await getNFLScoreboard(week);
        
        if (!scoreboard || !scoreboard.events) {
            return {
                time: 'Game Time TBD',
                homeTeam: team,
                awayTeam: 'TBD',
                status: 'Upcoming',
                isLive: false,
                isCompleted: false
            };
        }

        // Find the game for this team
        for (const event of scoreboard.events) {
            if (!event.competitions || !event.competitions[0]) continue;
            
            const competition = event.competitions[0];
            const competitors = competition.competitors;
            
            if (!competitors || competitors.length !== 2) continue;
            
            const homeTeam = competitors.find(comp => comp.homeAway === 'home');
            const awayTeam = competitors.find(comp => comp.homeAway === 'away');
            
            if (!homeTeam || !awayTeam) continue;
            
            const homeAbbr = homeTeam.team?.abbreviation;
            const awayAbbr = awayTeam.team?.abbreviation;
            
            // Check if this game involves our team
            if (homeAbbr === team || awayAbbr === team) {
                const status = competition.status;
                const isCompleted = status?.type?.completed || false;
                const isLive = status?.type?.name === 'STATUS_IN_PROGRESS' || 
                              status?.type?.name === 'STATUS_HALFTIME' ||
                              (status?.type?.state === 'in' && !isCompleted);
                
                let gameTime = event.date;
                let gameStatus = status?.type?.shortDetail || 'TBD';
                
                // Parse game time
                if (gameTime) {
                    const date = new Date(gameTime);
                    const options = { 
                        weekday: 'long', 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true 
                    };
                    gameTime = date.toLocaleString('en-US', options);
                }
                
                // Get scores if available
                let homeScore = null;
                let awayScore = null;
                if (homeTeam.score) homeScore = parseInt(homeTeam.score);
                if (awayTeam.score) awayScore = parseInt(awayTeam.score);
                
                // Determine winner if completed
                let winnerTeam = null;
                if (isCompleted && homeScore !== null && awayScore !== null) {
                    winnerTeam = homeScore > awayScore ? homeAbbr : awayAbbr;
                }
                
                // Get clock and quarter info for live games
                let gameClock = null;
                let gameQuarter = null;
                if (isLive && status?.displayClock && status?.period) {
                    gameClock = status.displayClock;
                    gameQuarter = `Q${status.period}`;
                }
                
                return {
                    time: gameTime || 'TBD',
                    homeTeam: homeAbbr || 'TBD',
                    awayTeam: awayAbbr || 'TBD',
                    homeScore,
                    awayScore,
                    status: gameStatus,
                    isLive,
                    isCompleted,
                    gameClock,
                    gameQuarter,
                    winnerTeam
                };
            }
        }
        
        // Team not found in this week's games
        return {
            time: 'No Game This Week',
            homeTeam: team,
            awayTeam: 'N/A',
            status: 'No Game This Week',
            isLive: false,
            isCompleted: false
        };
        
    } catch (error) {
        console.error('Error fetching team game time:', error);
        return {
            time: 'Game Time TBD',
            homeTeam: team,
            awayTeam: 'TBD',
            status: 'Error loading game',
            isLive: false,
            isCompleted: false
        };
    }
}

async function getPlayerInfo(playerId, matchupData) {
    const players = await getNFLPlayers();
    const player = players[playerId];
    
    if (!player) {
        return {
            name: 'Unknown Player',
            position: 'N/A',
            team: 'N/A',
            points: 0
        };
    }
    
    // Find points for this player
    let points = 0;
    if (matchupData.starters && matchupData.starters_points) {
        const starterIndex = matchupData.starters.indexOf(playerId);
        if (starterIndex >= 0) {
            points = matchupData.starters_points[starterIndex] || 0;
        }
    }
    
    return {
        name: player.full_name || `${player.first_name} ${player.last_name}` || 'Unknown',
        position: player.position || 'N/A',
        team: player.team || 'FA',
        points: points
    };
}

// Enhanced team info with NFL team data
async function getTeamInfo(teamAbbr) {
    const teamData = {
        'ARI': { name: 'Arizona Cardinals', color: '97233F' },
        'ATL': { name: 'Atlanta Falcons', color: 'A71930' },
        'BAL': { name: 'Baltimore Ravens', color: '241773' },
        'BUF': { name: 'Buffalo Bills', color: '00338D' },
        'CAR': { name: 'Carolina Panthers', color: '0085CA' },
        'CHI': { name: 'Chicago Bears', color: 'C83803' },
        'CIN': { name: 'Cincinnati Bengals', color: 'FB4F14' },
        'CLE': { name: 'Cleveland Browns', color: '311D00' },
        'DAL': { name: 'Dallas Cowboys', color: '003594' },
        'DEN': { name: 'Denver Broncos', color: 'FB4F14' },
        'DET': { name: 'Detroit Lions', color: '0076B6' },
        'GB': { name: 'Green Bay Packers', color: '203731' },
        'HOU': { name: 'Houston Texans', color: '03202F' },
        'IND': { name: 'Indianapolis Colts', color: '002C5F' },
        'JAX': { name: 'Jacksonville Jaguars', color: '006778' },
        'KC': { name: 'Kansas City Chiefs', color: 'E31837' },
        'LV': { name: 'Las Vegas Raiders', color: '000000' },
        'LAC': { name: 'Los Angeles Chargers', color: '0080C6' },
        'LAR': { name: 'Los Angeles Rams', color: '003594' },
        'MIA': { name: 'Miami Dolphins', color: '008E97' },
        'MIN': { name: 'Minnesota Vikings', color: '4F2683' },
        'NE': { name: 'New England Patriots', color: '002244' },
        'NO': { name: 'New Orleans Saints', color: 'D3BC8D' },
        'NYG': { name: 'New York Giants', color: '0B2265' },
        'NYJ': { name: 'New York Jets', color: '125740' },
        'PHI': { name: 'Philadelphia Eagles', color: '004C54' },
        'PIT': { name: 'Pittsburgh Steelers', color: 'FFB612' },
        'SF': { name: 'San Francisco 49ers', color: 'AA0000' },
        'SEA': { name: 'Seattle Seahawks', color: '002244' },
        'TB': { name: 'Tampa Bay Buccaneers', color: 'D50A0A' },
        'TEN': { name: 'Tennessee Titans', color: '0C2340' },
        'WAS': { name: 'Washington Commanders', color: '773141' }
    };
    
    const team = teamData[teamAbbr] || { name: teamAbbr, color: '667eea' };
    
    return {
        name: team.name,
        abbreviation: teamAbbr,
        logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${teamAbbr.toLowerCase()}.png`,
        logoSmall: `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${teamAbbr.toLowerCase()}.png`,
        color: team.color
    };
}


// Helper function to create pale colors for game backgrounds
function makePaleColor(hexColor, opacity = 0.15) {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    disconnectFromStream();
});

// Auto-connect when page becomes visible
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentLeague && currentWeek && !eventSource) {
        connectToMatchupStream(currentLeague.league_id, currentWeek);
    }
});
