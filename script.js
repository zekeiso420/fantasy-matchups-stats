// DOM elements
const usernameInput = document.getElementById('username');
const fetchUserBtn = document.getElementById('fetch-user');
const userInfoDiv = document.getElementById('user-info');
const leagueSelectionSection = document.getElementById('league-selection');
const leagueSelect = document.getElementById('league-select');
const leagueInfoDiv = document.getElementById('league-info');
const weekSelectionSection = document.getElementById('week-selection');
const weekSelect = document.getElementById('week-select');
const matchupDisplaySection = document.getElementById('matchup-display');
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const errorMessage = document.getElementById('error-message');

// Theme management
let currentTheme = 'auto';

// Global matchup data storage
let allMatchupsData = [];
let currentViewingMatchup = null;

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    // Allow Enter key to trigger user fetch
    usernameInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            fetchUser();
        }
    });
    
    // Add event listener for the Get Leagues button
    fetchUserBtn.addEventListener('click', fetchUser);
    
    // Add event listeners for dropdowns
    leagueSelect.addEventListener('change', selectLeague);
    weekSelect.addEventListener('change', selectWeek);
    
    // Set up event-safe tab switchers
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.currentTarget.dataset.tab, e.currentTarget));
    });
    
    // Set up week options (1-18 for regular season)
    populateWeekSelect();
    
    // Initialize theme
    initializeTheme();
});

// Initialize theme based on system preference or saved preference
function initializeTheme() {
    const savedTheme = localStorage.getItem('fantasy-tracker-theme') || 'auto';
    setTheme(savedTheme);
}

// Set theme
function setTheme(theme) {
    currentTheme = theme;
    localStorage.setItem('fantasy-tracker-theme', theme);
    
    const body = document.body;
    const themeToggle = document.getElementById('theme-toggle');
    
    // Remove existing theme classes
    body.classList.remove('light-theme', 'dark-theme');
    
    if (theme === 'light') {
        body.classList.add('light-theme');
        if (themeToggle) themeToggle.checked = false;
    } else if (theme === 'dark') {
        body.classList.add('dark-theme');
        if (themeToggle) themeToggle.checked = true;
    } else {
        // Auto mode - use system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            body.classList.add('dark-theme');
            if (themeToggle) themeToggle.checked = true;
        } else {
            body.classList.add('light-theme');
            if (themeToggle) themeToggle.checked = false;
        }
    }
}

// Toggle theme
function toggleTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle && themeToggle.checked) {
        setTheme('dark');
    } else {
        setTheme('light');
    }
}

// Show/hide loading indicator
function showLoading(show) {
    if (show) {
        loadingDiv.classList.remove('hidden');
    } else {
        loadingDiv.classList.add('hidden');
    }
}

// Show error message
function showError(message) {
    errorMessage.textContent = message;
    errorDiv.classList.remove('hidden');
    
    // Auto-hide error after 5 seconds
    setTimeout(() => {
        clearError();
    }, 5000);
}

// Clear error message
function clearError() {
    errorDiv.classList.add('hidden');
}

// Shorten player name for mobile display (e.g., "Lamar Jackson" -> "L. Jackson")
function shortenPlayerName(fullName) {
    if (!fullName || typeof fullName !== 'string') {
        return 'Unknown';
    }
    
    const nameParts = fullName.trim().split(' ');
    
    if (nameParts.length < 2) {
        return fullName; // Return as-is if only one name part
    }
    
    // For names like "D/ST", "DST", keep them as-is
    if (fullName.includes('/') || fullName.length <= 3) {
        return fullName;
    }
    
    // Take first initial and last name
    const firstInitial = nameParts[0].charAt(0).toUpperCase();
    const lastName = nameParts[nameParts.length - 1];
    
    return `${firstInitial}. ${lastName}`;
}

// Populate week selection dropdown
function populateWeekSelect() {
    weekSelect.innerHTML = '<option value="">Choose a week...</option>';
    
    for (let week = 1; week <= 18; week++) {
        const option = document.createElement('option');
        option.value = week;
        option.textContent = `Week ${week}`;
        weekSelect.appendChild(option);
    }
    
    // Set current week as default
    const currentWeek = getCurrentNFLWeek();
    weekSelect.value = currentWeek;
}

// Fetch user information
async function fetchUser() {
    const username = usernameInput.value.trim();
    
    if (!username) {
        showError('Please enter a username');
        return;
    }
    
    try {
        showLoading(true);
        currentUser = await getUserByUsername(username);
        
        // Hide user info div - keep it clean
        userInfoDiv.classList.add('hidden');
        
        // Collapse the user input section
        document.getElementById('user-input').classList.add('collapsed');
        
        // Fetch user's leagues
        await fetchUserLeagues();
        
        showLoading(false);
    } catch (error) {
        showLoading(false);
        showError(`Failed to fetch user: ${error.message}`);
    }
}

// Fetch user's leagues
async function fetchUserLeagues() {
    try {
        const leagues = await getUserLeagues(currentUser.user_id);
        
        if (!leagues || leagues.length === 0) {
            showError('No NFL leagues found for 2025 season');
            return;
        }
        
        // Populate league dropdown
        leagueSelect.innerHTML = '<option value="">Choose a league...</option>';
        
        leagues.forEach(league => {
            const option = document.createElement('option');
            option.value = league.league_id;
            // Truncate league name if longer than 24 characters
            const displayName = league.name.length > 24 
                ? league.name.substring(0, 24) + '...' 
                : league.name;
            option.textContent = displayName;
            leagueSelect.appendChild(option);
        });
        
        // Show league selection
        leagueSelectionSection.classList.remove('hidden');
        
    } catch (error) {
        showError(`Failed to fetch leagues: ${error.message}`);
    }
}

// Handle league selection
async function selectLeague() {
    const leagueId = leagueSelect.value;
    
    if (!leagueId) {
        weekSelectionSection.classList.add('hidden');
        matchupDisplaySection.classList.add('hidden');
        // Remove collapsed state if no league selected
        leagueSelectionSection.classList.remove('collapsed');
        return;
    }
    
    try {
        showLoading(true);
        currentLeague = await getLeague(leagueId);
        
        // Hide league info div - keep it clean
        leagueInfoDiv.classList.add('hidden');
        
        // Collapse the league selection section
        leagueSelectionSection.classList.add('collapsed');
        
        // Show week selection
        weekSelectionSection.classList.remove('hidden');
        
        // If current week is already selected, load matchup
        if (weekSelect.value) {
            await selectWeek();
        }
        
        showLoading(false);
    } catch (error) {
        showLoading(false);
        showError(`Failed to fetch league: ${error.message}`);
    }
}

// Handle week selection
async function selectWeek() {
    const week = weekSelect.value;
    
    if (!week || !currentLeague) {
        matchupDisplaySection.classList.add('hidden');
        // Remove collapsed state if no week selected
        weekSelectionSection.classList.remove('collapsed');
        return;
    }
    
    currentWeek = parseInt(week);
    
    try {
        // Collapse the week selection section
        weekSelectionSection.classList.add('collapsed');
        
        await loadMatchup();
    } catch (error) {
        showError(`Failed to load matchup: ${error.message}`);
    }
}

// Load and display matchup
async function loadMatchup() {
    if (!currentUser || !currentLeague || !currentWeek) return;
    
    try {
        showLoading(true);
        
        const matchupData = await findUserMatchup(
            currentLeague.league_id, 
            currentUser.user_id, 
            currentWeek
        );
        
        await displayMatchup(matchupData);
        
        // Show matchup section
        matchupDisplaySection.classList.remove('hidden');
        
        // Load other matchups for sidebar
        await loadOtherMatchups();
        
        // Start auto-refresh if games are active
        setupAutoRefresh();
        
        showLoading(false);
    } catch (error) {
        showLoading(false);
        showError(`Failed to load matchup: ${error.message}`);
    }
}

// Display matchup information
async function displayMatchup(matchupData) {
    const { userMatchup, opponentMatchup, opponentUser, userRoster, opponentRoster, users } = matchupData;
    
    // Resolve opponent user using consolidated function
    const actualOpponentUser = resolveOpponentUser(opponentUser, opponentRoster, users);
    
    // Update team names using consolidated function
    const userTeamName = resolveUserDisplayName(currentUser);
    const opponentTeamName = resolveUserDisplayName(actualOpponentUser, 'Team', opponentRoster?.roster_id || 'Unknown');
    
    // Update scores
    const userScore = calculateTeamScore(userMatchup);
    const opponentScore = calculateTeamScore(opponentMatchup);
    
    // Use consolidated display update function
    updateTeamDisplay(userTeamName, opponentTeamName, userScore, opponentScore);
    
    // Auto-populate Position View since it's the default active tab
    await displayPositionView();
}

// Track roster rendering to prevent duplicates
const rosterRenderingStates = new Map();

// Display team roster
async function displayRoster(containerId, matchupData, rosterData, forceUpdate = false) {
    const container = document.getElementById(containerId);
    
    // Stronger duplication protection with rendering state tracking
    const isCurrentlyRendering = rosterRenderingStates.get(containerId);
    const hasContent = container.children.length > 0;
    
    if (!forceUpdate && (isCurrentlyRendering || hasContent)) {
        console.log(`Roster ${containerId} already rendered or rendering, skipping duplicate unless forced`);
        return;
    }
    
    // Mark as currently rendering
    rosterRenderingStates.set(containerId, true);
    
    container.innerHTML = '';
    
    if (!matchupData.starters || !rosterData.players) {
        container.innerHTML = '<p>No roster data available</p>';
        return;
    }
    
    // Check if this is for Team View (main roster display)
    const isTeamView = containerId === 'user-roster' || containerId === 'opponent-roster';
    
    // Use consolidated roster processing function
    const { starters, bench } = await processRosterPlayers(matchupData, rosterData);
    
    if (isTeamView) {
        // Create separate sections for Team View
        if (starters.length > 0) {
            const startersSection = document.createElement('div');
            startersSection.className = 'roster-section';
            
            const startersHeader = document.createElement('div');
            startersHeader.className = 'roster-section-header';
            startersHeader.textContent = 'Starting Lineup';
            startersSection.appendChild(startersHeader);
            
            const startersContainer = document.createElement('div');
            startersContainer.className = 'roster-section-players';
            
            for (const player of starters) {
                const playerDiv = await createPlayerCard(player);
                startersContainer.appendChild(playerDiv);
            }
            
            startersSection.appendChild(startersContainer);
            container.appendChild(startersSection);
        }
        
        if (bench.length > 0) {
            const benchSection = document.createElement('div');
            benchSection.className = 'roster-section';
            
            const benchHeader = document.createElement('div');
            benchHeader.className = 'roster-section-header';
            benchHeader.textContent = 'Bench';
            benchSection.appendChild(benchHeader);
            
            const benchContainer = document.createElement('div');
            benchContainer.className = 'roster-section-players';
            
            for (const player of bench) {
                const playerDiv = await createPlayerCard(player);
                benchContainer.appendChild(playerDiv);
            }
            
            benchSection.appendChild(benchContainer);
            container.appendChild(benchSection);
        }
    } else {
        // For By Game Time view, keep original behavior (all players together)
        const allPlayers = [...starters, ...bench];
        
        for (const player of allPlayers) {
            const playerDiv = await createPlayerCard(player);
            container.appendChild(playerDiv);
        }
    }
    
    // Clear rendering state when complete
    rosterRenderingStates.set(containerId, false);
}

// Setup real-time updates via SSE
function setupAutoRefresh() {
    if (!currentLeague || !currentWeek) return;
    
    // Connect to SSE stream for real-time updates
    connectToMatchupStream(currentLeague.league_id, currentWeek);
    console.log('Connected to real-time updates');
}

// Manual refresh
async function refreshMatchup() {
    if (!currentUser || !currentLeague || !currentWeek) {
        showError('Please select a user, league, and week first');
        return;
    }
    
    try {
        // Clear any cached data to ensure fresh API calls
        clearCache();
        await refreshCurrentMatchup();
    } catch (error) {
        showError(`Failed to refresh: ${error.message}`);
    }
}

// Tab switching functionality - Event-safe version
function switchTab(tabName, el) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    document.getElementById(tabName).classList.remove('hidden');
    el?.classList.add('active');

    if (tabName === 'game-view') displayGameView();
    else if (tabName === 'position-view') displayPositionView();
}

// Display matchups organized by game time
async function displayGameView() {
    const container = document.getElementById('games-by-time');
    container.innerHTML = '<p>Loading game schedule...</p>';
    
    if (!currentUser || !currentLeague || !currentWeek) {
        container.innerHTML = '<p>Please select a user, league, and week first.</p>';
        return;
    }
    
    try {
        // Check if we're viewing a different matchup than the original user's
        if (currentViewingMatchup && !currentViewingMatchup.isUserMatchup) {
            // Use the currently selected matchup data
            const { matchupData } = currentViewingMatchup;
            const { team1, team2, roster1, roster2, user1, user2 } = matchupData;
            
            const displayData = {
                userMatchup: team1,
                opponentMatchup: team2,
                userRoster: roster1,
                opponentRoster: roster2,
                opponentUser: user2,
                users: [user1, user2]
            };
            
            await displaySelectedMatchupGameView(displayData);
        } else {
            // Use original user's matchup (default behavior)
            const matchupData = await findUserMatchup(
                currentLeague.league_id, 
                currentUser.user_id, 
                currentWeek
            );
            
            // Use consolidated opponent user resolution function
            const { opponentUser, opponentRoster, users } = matchupData;
            const actualOpponentUser = resolveOpponentUser(opponentUser, opponentRoster, users);
            
            // Group players by their NFL team's actual game time
            const gameSlots = await groupPlayersByActualGameTime(matchupData);
            
            // Display the grouped games with the properly resolved opponent user
            await displayGameSlots(gameSlots, container, actualOpponentUser);
        }
        
    } catch (error) {
        container.innerHTML = `<p>Error loading game view: ${error.message}</p>`;
    }
}

// Group players by their actual NFL game times using ESPN API
async function groupPlayersByActualGameTime(matchupData) {
    const { userMatchup, opponentMatchup, userRoster, opponentRoster } = matchupData;
    const players = await getNFLPlayers();
    const gameSlots = {};
    
    // Get all user players (starters and bench)
    const allUserPlayers = [...userMatchup.starters, ...userRoster.players.filter(p => !userMatchup.starters.includes(p))];
    const allOpponentPlayers = [...opponentMatchup.starters, ...opponentRoster.players.filter(p => !opponentMatchup.starters.includes(p))];
    
    // Process user players
    for (const playerId of allUserPlayers) {
        if (playerId && players[playerId]) {
            const player = players[playerId];
            const playerInfo = await getPlayerInfo(playerId, userMatchup);
            const isStarted = userMatchup.starters.includes(playerId);
            
            // Get actual game time for this player's team
            const gameInfo = await getTeamGameTime(player.team, currentWeek);
            
            // Create a consistent game key - handle free agents specially
            let gameKey;
            if (!player.team || player.team === 'N/A' || player.team === '') {
                gameKey = 'Free Agent - Free Agents vs ';
            } else {
                gameKey = `${gameInfo.time} - ${gameInfo.homeTeam} vs ${gameInfo.awayTeam}`;
            }
            
            if (!gameSlots[gameKey]) {
                gameSlots[gameKey] = {
                    time: gameInfo.time,
                    homeTeam: gameInfo.homeTeam,
                    awayTeam: gameInfo.awayTeam,
                    homeScore: gameInfo.homeScore,
                    awayScore: gameInfo.awayScore,
                    status: gameInfo.status,
                    isCompleted: gameInfo.isCompleted,
                    isLive: gameInfo.isLive,
                    gameClock: gameInfo.gameClock,
                    gameQuarter: gameInfo.gameQuarter,
                    winnerTeam: gameInfo.winnerTeam,
                    userPlayers: [],
                    opponentPlayers: []
                };
            }
            
            gameSlots[gameKey].userPlayers.push({
                ...playerInfo,
                id: playerId,
                isStarted: isStarted
            });
        }
    }
    
    // Process opponent players
    for (const playerId of allOpponentPlayers) {
        if (playerId && players[playerId]) {
            const player = players[playerId];
            const playerInfo = await getPlayerInfo(playerId, opponentMatchup);
            const isStarted = opponentMatchup.starters.includes(playerId);
            
            // Get actual game time for this player's team
            const gameInfo = await getTeamGameTime(player.team, currentWeek);
            
            // Create a consistent game key - handle free agents specially
            let gameKey;
            if (!player.team || player.team === 'N/A' || player.team === '') {
                gameKey = 'Free Agent - Free Agents vs ';
            } else {
                gameKey = `${gameInfo.time} - ${gameInfo.homeTeam} vs ${gameInfo.awayTeam}`;
            }
            
            if (!gameSlots[gameKey]) {
                gameSlots[gameKey] = {
                    time: gameInfo.time,
                    homeTeam: gameInfo.homeTeam,
                    awayTeam: gameInfo.awayTeam,
                    homeScore: gameInfo.homeScore,
                    awayScore: gameInfo.awayScore,
                    status: gameInfo.status,
                    isCompleted: gameInfo.isCompleted,
                    isLive: gameInfo.isLive,
                    gameClock: gameInfo.gameClock,
                    gameQuarter: gameInfo.gameQuarter,
                    winnerTeam: gameInfo.winnerTeam,
                    userPlayers: [],
                    opponentPlayers: []
                };
            }
            
            gameSlots[gameKey].opponentPlayers.push({
                ...playerInfo,
                id: playerId,
                isStarted: isStarted
            });
        }
    }
    
    return gameSlots;
}

// Get game status based on ESPN data
function getGameStatus(status) {
    if (!status) return 'upcoming';
    
    const statusLower = status.toLowerCase();
    
    // Live/In Progress states - comprehensive list
    if (statusLower.includes('in progress') || 
        statusLower.includes('1st quarter') || 
        statusLower.includes('2nd quarter') || 
        statusLower.includes('3rd quarter') || 
        statusLower.includes('4th quarter') || 
        statusLower.includes('overtime') || 
        statusLower.includes('halftime') ||
        statusLower.includes('1st') ||
        statusLower.includes('2nd') ||
        statusLower.includes('3rd') ||
        statusLower.includes('4th') ||
        statusLower.includes('ot') ||
        statusLower.includes('half') ||
        statusLower.includes('live') ||
        statusLower.includes('active')) {
        return 'live';
    }
    
    // Completed states
    if (statusLower.includes('final') || 
        statusLower.includes('completed') ||
        statusLower.includes('ended')) {
        return 'completed';
    }
    
    // Default to upcoming
    return 'upcoming';
}

// Smart sorting for games based on status and time
function sortGamesByPriority(gameSlots) {
    const now = new Date();
    
    return Object.entries(gameSlots).sort(([keyA, dataA], [keyB, dataB]) => {
        // Always put Free Agents at the bottom
        const isKeyAFreeAgent = keyA.includes('Free Agent');
        const isKeyBFreeAgent = keyB.includes('Free Agent');
        
        if (isKeyAFreeAgent && !isKeyBFreeAgent) return 1;
        if (!isKeyAFreeAgent && isKeyBFreeAgent) return -1;
        if (isKeyAFreeAgent && isKeyBFreeAgent) return 0; // Both are free agents, keep same order
        
        const statusA = getGameStatus(dataA.status);
        const statusB = getGameStatus(dataB.status);
        
        // Priority order: live games first, then upcoming (by day: Thu, Fri, Sun, Mon), then completed (most recently finished first), then Free Agents
        
        // If one is live and other isn't, live comes first
        if (statusA === 'live' && statusB !== 'live') return -1;
        if (statusB === 'live' && statusA !== 'live') return 1;
        
        // If one is upcoming and other is completed, upcoming comes first
        if (statusA === 'upcoming' && statusB === 'completed') return -1;
        if (statusB === 'upcoming' && statusA === 'completed') return 1;
        
        // Parse dates more carefully
        let dateA, dateB;
        let validDateA = false, validDateB = false;
        
        try {
            dateA = new Date(dataA.time);
            validDateA = !isNaN(dateA.getTime());
        } catch (e) {
            validDateA = false;
        }
        
        try {
            dateB = new Date(dataB.time);
            validDateB = !isNaN(dateB.getTime());
        } catch (e) {
            validDateB = false;
        }
        
        // If both are live, sort by earliest start time first (games that started earlier appear at the top)
        if (statusA === 'live' && statusB === 'live') {
            if (validDateA && validDateB) {
                return dateA - dateB; // Earlier start times (smaller dates) come first
            }
            // Fallback to string comparison for consistent ordering
            return dataA.time.localeCompare(dataB.time);
        }
        
        // If both are upcoming, sort by preferred day order: Thursday, Friday, Sunday, Monday
        if (statusA === 'upcoming' && statusB === 'upcoming') {
            const dayOrderA = getDayOrderPriority(dataA.time);
            const dayOrderB = getDayOrderPriority(dataB.time);
            
            // If different day priorities, sort by day order
            if (dayOrderA !== dayOrderB) {
                return dayOrderA - dayOrderB;
            }
            
            // If same day or no day info, sort by time
            if (validDateA && validDateB) {
                return dateA - dateB;
            }
            return dataA.time.localeCompare(dataB.time);
        }
        
        // If both are completed, sort by most recently finished first
        if (statusA === 'completed' && statusB === 'completed') {
            if (validDateA && validDateB) {
                // Most recently finished first (later dates first) - Monday > Sunday > Thursday
                return dateB - dateA;
            } else {
                // Fallback to string comparison (reverse alphabetical for most recent first)
                return dataB.time.localeCompare(dataA.time);
            }
        }
        
        // Default sorting
        if (validDateA && validDateB) {
            return dateA - dateB;
        }
        
        return keyA.localeCompare(keyB);
    });
}

// Get day order priority for scheduled games (Thursday=0, Friday=1, Sunday=2, Monday=3, others=999)
function getDayOrderPriority(timeString) {
    if (!timeString) return 999;
    
    const timeLower = timeString.toLowerCase();
    
    if (timeLower.includes('thursday')) return 0;
    if (timeLower.includes('friday')) return 1;
    if (timeLower.includes('sunday')) return 2;
    if (timeLower.includes('monday')) return 3;
    
    // For dates without day names, try to parse the date and get the day
    try {
        const date = new Date(timeString);
        if (!isNaN(date.getTime())) {
            const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, ..., 4=Thursday, 5=Friday
            switch (dayOfWeek) {
                case 4: return 0; // Thursday
                case 5: return 1; // Friday
                case 0: return 2; // Sunday
                case 1: return 3; // Monday
                default: return 999; // Other days
            }
        }
    } catch (e) {
        // If parsing fails, return high priority (will be sorted last)
    }
    
    return 999; // Unknown days go last
}

// Display game slots in the container with enhanced design system
async function displayGameSlots(gameSlots, container, opponentUser, userTeamName = null) {
    container.innerHTML = '';
    
    // Sort games using smart priority logic
    const sortedGames = sortGamesByPriority(gameSlots);
    
    for (const [gameKey, data] of sortedGames) {
        const hasPlayers = data.userPlayers.length > 0 || data.opponentPlayers.length > 0;
        
        if (!hasPlayers) continue; // Skip empty games
        
        const gameDiv = document.createElement('div');
        const gameStatus = getGameStatus(data.status);
        gameDiv.className = `game-slot ${gameStatus}`;
        
        const safeId = gameKey.replace(/[^a-zA-Z0-9]/g, '');
        
        // Get team info for logos and colors using cached lookups
        const awayTeamInfo = await getTeamInfoCached(data.awayTeam);
        const homeTeamInfo = await getTeamInfoCached(data.homeTeam);
        
        // Apply winning team background color if game is completed
        let gameBackgroundStyle = '';
        if (data.isCompleted && data.winnerTeam) {
            const winnerTeamInfo = data.winnerTeam === data.homeTeam ? homeTeamInfo : awayTeamInfo;
            if (winnerTeamInfo?.color) {
                const paleColor = makePaleColor(winnerTeamInfo.color, 0.15);
                gameBackgroundStyle = `background: ${paleColor}; border-left: 4px solid #${winnerTeamInfo.color};`;
            }
        }
        
        // Apply the background styling if there is one
        if (gameBackgroundStyle) {
            gameDiv.style.cssText = gameBackgroundStyle;
        }
        
        // Use the correct team names - either from current matchup context or fallback to currentUser
        const leftTeamName = userTeamName || (currentUser.display_name || currentUser.username);
        const opponentName = opponentUser?.display_name || 
                            opponentUser?.username || 
                            'Opponent';
        
        // Calculate advantage for this game
        const userTotalPoints = data.userPlayers.reduce((sum, player) => sum + (player.points || 0), 0);
        const opponentTotalPoints = data.opponentPlayers.reduce((sum, player) => sum + (player.points || 0), 0);
        const totalPoints = Math.max(userTotalPoints + opponentTotalPoints, 0.001);
        const userAdvantagePercent = Math.round((userTotalPoints / totalPoints) * 100);
        const pointsDiff = (userTotalPoints - opponentTotalPoints).toFixed(1);
        
        // Create the enhanced game capsule header
        let headerContent = '';
        const isLive = data.isLive;
        const headerClass = isLive ? 'game-capsule-header live' : 'game-capsule-header';
        
        if (data.isCompleted && data.homeScore && data.awayScore) {
            // Completed game with score
            headerContent = `
                <div class="${headerClass}">
                    <div class="kickoff-info">
                        <div class="kickoff-time">${formatGameTime(data.time)}</div>
                        <div class="kickoff-date">Final</div>
                    </div>
                    <div class="matchup-display">
                        <div class="team-matchup-info">
                            ${awayTeamInfo?.logo ? `<img src="${awayTeamInfo.logo}" alt="${data.awayTeam}" class="nfl-team-logo">` : ''}
                            <span class="nfl-team-code">${data.awayTeam}</span>
                        </div>
                        <span class="matchup-separator">@</span>
                        <div class="team-matchup-info">
                            <span class="nfl-team-code">${data.homeTeam}</span>
                            ${homeTeamInfo?.logo ? `<img src="${homeTeamInfo.logo}" alt="${data.homeTeam}" class="nfl-team-logo">` : ''}
                        </div>
                    </div>
                    <div class="game-status-display">
                        <div class="status-primary final">Final</div>
                    </div>
                </div>
                <div class="game-score-display">
                    <div class="score-team">
                        <div class="score-team-name">${data.awayTeam}</div>
                        <div class="score-value">${data.awayScore}</div>
                    </div>
                    <div class="score-separator">-</div>
                    <div class="score-team">
                        <div class="score-value">${data.homeScore}</div>
                        <div class="score-team-name">${data.homeTeam}</div>
                    </div>
                </div>
            `;
        } else if (isLive && data.homeScore && data.awayScore) {
            // Live game with current score and clock
            const clockDisplay = data.gameClock && data.gameQuarter ? 
                `${data.gameQuarter} - ${data.gameClock}` : '';
            
            headerContent = `
                <div class="${headerClass}">
                    <div class="kickoff-info">
                        <div class="kickoff-time">${formatGameTime(data.time)}</div>
                        <div class="kickoff-date">Live</div>
                    </div>
                    <div class="matchup-display">
                        <div class="team-matchup-info">
                            ${awayTeamInfo?.logo ? `<img src="${awayTeamInfo.logo}" alt="${data.awayTeam}" class="nfl-team-logo">` : ''}
                            <span class="nfl-team-code">${data.awayTeam}</span>
                        </div>
                        <span class="matchup-separator">@</span>
                        <div class="team-matchup-info">
                            <span class="nfl-team-code">${data.homeTeam}</span>
                            ${homeTeamInfo?.logo ? `<img src="${homeTeamInfo.logo}" alt="${data.homeTeam}" class="nfl-team-logo">` : ''}
                        </div>
                    </div>
                    <div class="game-status-display">
                        <div class="status-primary live">Live</div>
                        ${clockDisplay ? `<div class="status-secondary">${clockDisplay}</div>` : ''}
                    </div>
                </div>
                <div class="game-score-display live">
                    <div class="score-team">
                        <div class="score-team-name">${data.awayTeam}</div>
                        <div class="score-value live">${data.awayScore}</div>
                    </div>
                    <div class="score-separator">-</div>
                    <div class="score-team">
                        <div class="score-value live">${data.homeScore}</div>
                        <div class="score-team-name">${data.homeTeam}</div>
                    </div>
                </div>
            `;
        } else {
            // Upcoming game
            headerContent = `
                <div class="${headerClass}">
                    <div class="kickoff-info">
                        <div class="kickoff-time">${formatGameTime(data.time)}</div>
                        <div class="kickoff-date">${formatGameDate(data.time)}</div>
                    </div>
                    <div class="matchup-display">
                        <div class="team-matchup-info">
                            ${awayTeamInfo?.logo ? `<img src="${awayTeamInfo.logo}" alt="${data.awayTeam}" class="nfl-team-logo">` : ''}
                            <span class="nfl-team-code">${data.awayTeam}</span>
                        </div>
                        <span class="matchup-separator">@</span>
                        <div class="team-matchup-info">
                            <span class="nfl-team-code">${data.homeTeam}</span>
                            ${homeTeamInfo?.logo ? `<img src="${homeTeamInfo.logo}" alt="${data.homeTeam}" class="nfl-team-logo">` : ''}
                        </div>
                    </div>
                    <div class="game-status-display">
                        <div class="status-primary upcoming">${data.status}</div>
                    </div>
                </div>
            `;
        }
        
        // Create the enhanced two-stack layout
        gameDiv.innerHTML = `
            ${headerContent}
            <div class="game-two-stack">
                <div class="stack-team left">
                    <div class="stack-header">
                        <div class="stack-team-name">${leftTeamName}</div>
                        <div class="player-count-chip">${data.userPlayers.length}</div>
                    </div>
                    <div class="stack-players" id="user-players-${safeId}"></div>
                </div>
                <div class="vs-gutter">
                    <div class="vs-label">VS</div>
                    <div class="game-advantage-bar">
                        <div class="advantage-fill-game" style="width: ${userAdvantagePercent}%"></div>
                    </div>
                    <div class="points-advantage ${pointsDiff > 0 ? 'positive' : pointsDiff < 0 ? 'negative' : 'neutral'}">
                        ${pointsDiff > 0 ? `+${pointsDiff}` : pointsDiff}
                    </div>
                </div>
                <div class="stack-team right">
                    <div class="stack-header">
                        <div class="stack-team-name">${opponentName}</div>
                        <div class="player-count-chip">${data.opponentPlayers.length}</div>
                    </div>
                    <div class="stack-players" id="opponent-players-${safeId}"></div>
                </div>
            </div>
        `;
        
        container.appendChild(gameDiv);
        
        // Populate user players for this game using enhanced function
        const userPlayersContainer = document.getElementById(`user-players-${safeId}`);
        if (data.userPlayers.length > 0) {
            for (const player of data.userPlayers) {
                const playerDiv = await createGamePlayerCard(player, 'left');
                userPlayersContainer.appendChild(playerDiv);
            }
        } else {
            userPlayersContainer.innerHTML = '<div class="empty-slot">No players in this game</div>';
        }
        
        // Populate opponent players for this game using enhanced function
        const opponentPlayersContainer = document.getElementById(`opponent-players-${safeId}`);
        if (data.opponentPlayers.length > 0) {
            for (const player of data.opponentPlayers) {
                const playerDiv = await createGamePlayerCard(player, 'right');
                opponentPlayersContainer.appendChild(playerDiv);
            }
        } else {
            opponentPlayersContainer.innerHTML = '<div class="empty-slot">No players in this game</div>';
        }
    }
    
    if (container.innerHTML === '') {
        container.innerHTML = '<div class="no-players">No games found for this week.</div>';
    }
}

// Load other matchups for the sidebar
async function loadOtherMatchups() {
    if (!currentLeague || !currentWeek) return;
    
    try {
        const [matchups, rosters, users] = await Promise.all([
            getMatchups(currentLeague.league_id, currentWeek),
            getLeagueRosters(currentLeague.league_id),
            getLeagueUsers(currentLeague.league_id)
        ]);
        
        // Group matchups by matchup_id
        const matchupGroups = {};
        matchups.forEach(matchup => {
            if (!matchupGroups[matchup.matchup_id]) {
                matchupGroups[matchup.matchup_id] = [];
            }
            matchupGroups[matchup.matchup_id].push(matchup);
        });
        
        const otherMatchups = [];
        
        // Process each matchup pair (including user's own matchup)
        Object.values(matchupGroups).forEach(group => {
            if (group.length === 2) {
                const [team1, team2] = group;
                
                // Get roster and user info for each team
                const roster1 = rosters.find(r => r.roster_id === team1.roster_id);
                const roster2 = rosters.find(r => r.roster_id === team2.roster_id);
                const user1 = users.find(u => u.user_id === roster1?.owner_id);
                const user2 = users.find(u => u.user_id === roster2?.owner_id);
                
                const team1Score = calculateTeamScore(team1);
                const team2Score = calculateTeamScore(team2);
                
                // Include user's own matchup but mark it differently
                const isUserMatchup = roster1?.owner_id === currentUser.user_id || roster2?.owner_id === currentUser.user_id;
                
                otherMatchups.push({
                    team1: {
                        name: user1?.display_name || user1?.username || `Team ${team1.roster_id}`,
                        score: team1Score,
                        rosterId: team1.roster_id,
                        userId: user1?.user_id
                    },
                    team2: {
                        name: user2?.display_name || user2?.username || `Team ${team2.roster_id}`,
                        score: team2Score,
                        rosterId: team2.roster_id,
                        userId: user2?.user_id
                    },
                    isUserMatchup: isUserMatchup,
                    matchupData: { team1, team2, roster1, roster2, user1, user2 }
                });
            }
        });
        
        // Store all matchups data for click functionality
        allMatchupsData = otherMatchups;
        
        // Set the current user's matchup as the active viewing matchup if not already set
        if (!currentViewingMatchup) {
            currentViewingMatchup = otherMatchups.find(matchup => matchup.isUserMatchup);
        }
        
        // Display other matchups in sidebar
        displayOtherMatchups(otherMatchups);
        
        // Show the sidebar
        const sidebar = document.getElementById('other-matchups-sidebar');
        if (sidebar && otherMatchups.length > 0) {
            sidebar.classList.remove('hidden');
        }
        
    } catch (error) {
        console.error('Failed to load other matchups:', error);
    }
}

// Display other matchups in the sidebar
function displayOtherMatchups(matchups) {
    const container = document.getElementById('other-matchups-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (matchups.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 12px;">No other matchups found</p>';
        return;
    }
    
    matchups.forEach((matchup, index) => {
        const matchupDiv = document.createElement('div');
        matchupDiv.className = 'other-matchup-item';
        
        // Add active class if this is the currently viewing matchup
        if (currentViewingMatchup && 
            ((currentViewingMatchup.team1.rosterId === matchup.team1.rosterId && 
              currentViewingMatchup.team2.rosterId === matchup.team2.rosterId) ||
             (currentViewingMatchup.team1.rosterId === matchup.team2.rosterId && 
              currentViewingMatchup.team2.rosterId === matchup.team1.rosterId))) {
            matchupDiv.classList.add('active');
        }
        
        const team1Score = parseFloat(matchup.team1.score);
        const team2Score = parseFloat(matchup.team2.score);
        
        matchupDiv.innerHTML = `
            <div class="other-matchup-teams">
                <div class="other-matchup-team">${matchup.team1.name}</div>
                <div class="other-matchup-vs">VS</div>
                <div class="other-matchup-team">${matchup.team2.name}</div>
            </div>
            <div class="other-matchup-scores">
                <div class="other-matchup-score ${team1Score > team2Score ? 'winning' : ''}">${formatPoints(team1Score)}</div>
                <div class="other-matchup-score ${team2Score > team1Score ? 'winning' : ''}">${formatPoints(team2Score)}</div>
            </div>
        `;
        
        // Add click handler to switch to this matchup
        matchupDiv.addEventListener('click', () => {
            switchToMatchup(index);
        });
        
        // Add data attributes for easier identification
        matchupDiv.setAttribute('data-matchup-index', index);
        
        container.appendChild(matchupDiv);
    });
}

// Switch to viewing a different matchup
async function switchToMatchup(matchupIndex) {
    if (!allMatchupsData || !allMatchupsData[matchupIndex]) {
        showError('Matchup data not found');
        return;
    }
    
    const selectedMatchup = allMatchupsData[matchupIndex];
    currentViewingMatchup = selectedMatchup;
    
    try {
        showLoading(true);
        
        // Create matchup data structure similar to findUserMatchup format
        const { matchupData } = selectedMatchup;
        const { team1, team2, roster1, roster2, user1, user2 } = matchupData;
        
        // Structure the data for displayMatchup function
        const displayData = {
            userMatchup: team1,
            opponentMatchup: team2,
            userRoster: roster1,
            opponentRoster: roster2,
            opponentUser: user2,
            users: [user1, user2] // Include users array for fallback logic
        };
        
        // Update the display names for this matchup
        document.getElementById('user-team-name').textContent = selectedMatchup.team1.name;
        document.getElementById('opponent-team-name').textContent = selectedMatchup.team2.name;
        
        // Update scores
        document.getElementById('user-score').textContent = formatPoints(selectedMatchup.team1.score);
        document.getElementById('opponent-score').textContent = formatPoints(selectedMatchup.team2.score);
        
        // No longer displaying traditional rosters - Position View will handle display
        
        // Update sidebar to highlight the active matchup
        updateSidebarActiveState();
        
        // Update position view if it's currently active
        const positionViewTab = document.getElementById('position-view');
        if (positionViewTab && !positionViewTab.classList.contains('hidden')) {
            await displayPositionView(true); // Force update when switching matchups
        }
        
        // Update game view if it's currently active
        const gameViewTab = document.getElementById('game-view');
        if (gameViewTab && !gameViewTab.classList.contains('hidden')) {
            await displaySelectedMatchupGameView(displayData);
        }
        
        showLoading(false);
        
    } catch (error) {
        showLoading(false);
        showError(`Failed to switch matchup: ${error.message}`);
    }
}

// Update the sidebar to show which matchup is currently active
function updateSidebarActiveState() {
    const matchupItems = document.querySelectorAll('.other-matchup-item');
    
    matchupItems.forEach((item, index) => {
        item.classList.remove('active');
        
        if (currentViewingMatchup && allMatchupsData[index]) {
            const matchup = allMatchupsData[index];
            // Check if this is the currently viewing matchup
            if ((currentViewingMatchup.team1.rosterId === matchup.team1.rosterId && 
                 currentViewingMatchup.team2.rosterId === matchup.team2.rosterId) ||
                (currentViewingMatchup.team1.rosterId === matchup.team2.rosterId && 
                 currentViewingMatchup.team2.rosterId === matchup.team1.rosterId)) {
                item.classList.add('active');
            }
        }
    });
}

// Display game view for the selected matchup
async function displaySelectedMatchupGameView(matchupData) {
    const container = document.getElementById('games-by-time');
    container.innerHTML = '<p>Loading game schedule...</p>';
    
    try {
        // Get opponent user data with fallback logic
        const { userMatchup, opponentUser, opponentRoster, users } = matchupData;
        let actualOpponentUser = opponentUser;
        if (!actualOpponentUser && opponentRoster?.owner_id && users) {
            actualOpponentUser = users.find(user => user.user_id === opponentRoster.owner_id);
        }
        
        // Get the user info for the selected matchup
        const userRoster = matchupData.userRoster;
        const selectedUser = users?.find(user => user.user_id === userRoster?.owner_id);
        const userTeamName = selectedUser?.display_name || selectedUser?.username || 'Team 1';
        
        // Group players by their NFL team's actual game time
        const gameSlots = await groupPlayersByActualGameTime(matchupData);
        
        // Display the grouped games with the properly resolved opponent user and correct team name
        await displayGameSlots(gameSlots, container, actualOpponentUser, userTeamName);
        
    } catch (error) {
        container.innerHTML = `<p>Error loading game view: ${error.message}</p>`;
    }
}

// Get starters maintaining exact slot order from API (don't sort by position)
async function getStartersInSlotOrder(matchupData, rosterData) {
    const starters = [];
    
    // Process each starter ID in the exact order from the API
    for (let i = 0; i < matchupData.starters.length; i++) {
        const playerId = matchupData.starters[i];
        if (playerId && rosterData.players.includes(playerId)) {
            const playerInfo = await getPlayerInfo(playerId, matchupData);
            starters.push({
                ...playerInfo,
                id: playerId,
                isStarted: true,
                slotIndex: i // Track the original slot index
            });
        } else {
            // Handle empty slots (shouldn't normally happen but good to be safe)
            starters.push(null);
        }
    }
    
    return starters;
}

// Position Lanes System - Using constants from utils.js
// SLOT_ORDER and POSITION_MAPPINGS are now defined in utils.js

// Track position view rendering state to prevent duplicates
let isPositionViewRendering = false;

// Display Position View with lane-based layout
async function displayPositionView(forceUpdate = false) {
    const container = document.getElementById('position-lanes');
    
    // Prevent duplicate rendering
    if (isPositionViewRendering) {
        console.log('Position view already rendering, skipping duplicate call');
        return;
    }
    
    // Check if container already has content (avoid unnecessary re-renders)
    // Only skip if not forcing update and content exists
    const hasContent = container.children.length > 0 && !container.textContent.includes('Loading');
    if (!forceUpdate && hasContent) {
        console.log('Position view already has content, skipping duplicate render');
        return;
    }
    
    isPositionViewRendering = true;
    container.innerHTML = '<p>Loading position matchups...</p>';
    
    if (!currentUser || !currentLeague || !currentWeek) {
        container.innerHTML = '<p>Please select a user, league, and week first.</p>';
        isPositionViewRendering = false;
        return;
    }
    
    try {
        let matchupData;
        let userTeamName, opponentTeamName;
        
        // Check if we're viewing a different matchup than the original user's
        if (currentViewingMatchup && !currentViewingMatchup.isUserMatchup) {
            const { matchupData: selectedMatchupData } = currentViewingMatchup;
            const { team1, team2, roster1, roster2, user1, user2 } = selectedMatchupData;
            
            matchupData = {
                userMatchup: team1,
                opponentMatchup: team2,
                userRoster: roster1,
                opponentRoster: roster2,
                opponentUser: user2,
                users: [user1, user2]
            };
            
            userTeamName = currentViewingMatchup.team1.name;
            opponentTeamName = currentViewingMatchup.team2.name;
        } else {
            // Use original user's matchup (default behavior)
            matchupData = await findUserMatchup(
                currentLeague.league_id, 
                currentUser.user_id, 
                currentWeek
            );
            
            const { opponentUser, opponentRoster, users } = matchupData;
            const actualOpponentUser = resolveOpponentUser(opponentUser, opponentRoster, users);
            
            userTeamName = resolveUserDisplayName(currentUser);
            opponentTeamName = resolveUserDisplayName(actualOpponentUser, 'Team', opponentRoster?.roster_id || 'Unknown');
        }
        
        // Update position view header
        document.getElementById('position-user-team-name').textContent = userTeamName;
        document.getElementById('position-opponent-team-name').textContent = opponentTeamName;
        document.getElementById('position-user-score').textContent = formatPoints(calculateTeamScore(matchupData.userMatchup));
        document.getElementById('position-opponent-score').textContent = formatPoints(calculateTeamScore(matchupData.opponentMatchup));
        
        // Use league's roster positions instead of hardcoded SLOT_ORDER
        const slotLabels = startingSlotsFromLeague(currentLeague);
        const userStarters = await getStartersInSlotOrder(matchupData.userMatchup, matchupData.userRoster);
        const opponentStarters = await getStartersInSlotOrder(matchupData.opponentMatchup, matchupData.opponentRoster);
        
        // Pair by index using the league's slot labels
        const lanes = pairBySlot(slotLabels, userStarters, opponentStarters);
        await displayPositionLanes(lanes, container);
        
    } catch (error) {
        container.innerHTML = `<p>Error loading position view: ${error.message}</p>`;
        console.error('Position view error:', error);
    } finally {
        isPositionViewRendering = false;
    }
}

// Pair players by slot labels and index - matches league's exact slot configuration
function pairBySlot(slotLabels, leftPlayers, rightPlayers) {
    return slotLabels.map((slot, i) => ({
        slot,
        left: leftPlayers[i] ?? null,
        right: rightPlayers[i] ?? null
    }));
}

// Display position lanes with 3-column grid layout
async function displayPositionLanes(lanes, container) {
    // Ensure container is completely cleared first
    container.innerHTML = '';
    
    // Add a small delay to prevent race conditions
    await new Promise(resolve => setTimeout(resolve, 10));
    
    for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i];
        if (lane) {  // Make sure lane exists
            const laneRow = await createLaneRow(lane, i);
            container.appendChild(laneRow);
        }
    }
}

// Create a single lane row with left player, center gutter, right player
async function createLaneRow(lane, index) {
    const left = lane.left;
    const right = lane.right;
    const leftProj = left?.points ?? 0;
    const rightProj = right?.points ?? 0;
    const total = Math.max(leftProj + rightProj, 0.001);
    const leftPct = Math.round((leftProj / total) * 100);
    const diff = (leftProj - rightProj).toFixed(1);
    
    // Create lane row container
    const laneRow = document.createElement('div');
    laneRow.className = `position-lane ${index % 2 === 1 ? 'zebra' : ''}`;
    
    // Create the three-column layout
    laneRow.innerHTML = `
        <div class="lane-player left" id="lane-left-${index}"></div>
        <div class="lane-center">
            <div class="position-label">${lane.slot}</div>
            <div class="advantage-bar">
                <div class="advantage-fill" style="width: ${leftPct}%"></div>
            </div>
            <div class="points-diff ${diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral'}">
                ${diff > 0 ? `+${diff}` : diff}
            </div>
        </div>
        <div class="lane-player right" id="lane-right-${index}"></div>
    `;
    
    // Populate player cells
    const leftContainer = laneRow.querySelector(`#lane-left-${index}`);
    const rightContainer = laneRow.querySelector(`#lane-right-${index}`);
    
    if (left) {
        const leftPlayerCell = await createPlayerCell(left, 'left', lane.slot);
        leftContainer.appendChild(leftPlayerCell);
    } else {
        leftContainer.innerHTML = '<div class="empty-player">—</div>';
    }
    
    if (right) {
        const rightPlayerCell = await createPlayerCell(right, 'right', lane.slot);
        rightContainer.appendChild(rightPlayerCell);
    } else {
        rightContainer.innerHTML = '<div class="empty-player">—</div>';
    }
    
    return laneRow;
}

// Create a player cell for position lanes
async function createPlayerCell(player, side, slot) {
    const playerCell = document.createElement('div');
    playerCell.className = `player-cell ${side}`;
    
    // Get team info for logos
    const teamInfo = await getTeamInfo(player.team);
    
    // Get game time information for this player
    const gameInfo = await getTeamGameTime(player.team, currentWeek);
    
    // Format game time display
    let gameTimeDisplay = 'Game TBD';
    if (gameInfo) {
        const gameDate = formatGameDate(gameInfo.time);
        const gameTime = formatGameTime(gameInfo.time);
        const fullGameTime = `${gameDate} ${gameTime}`;
        
        if (gameInfo.homeTeam === player.team) {
            // Home game
            gameTimeDisplay = `${fullGameTime} vs ${gameInfo.awayTeam}`;
        } else if (gameInfo.awayTeam === player.team) {
            // Away game  
            gameTimeDisplay = `${fullGameTime} @ ${gameInfo.homeTeam}`;
        } else if (gameInfo.time === 'Free Agent') {
            gameTimeDisplay = 'Free Agent';
        } else {
            gameTimeDisplay = fullGameTime;
        }
    }
    
    // Create initials for immediate display
    const initials = player.name.split(' ').map(n => n[0]).join('');
    
    // Create different layouts for left vs right sides
    if (side === 'left') {
        // Team 1 (left): Name first, then position/team, then game info
        playerCell.innerHTML = `
            <div class="player-avatar">
                <div class="player-initials">${initials}</div>
                <img class="player-headshot" style="display: none;" alt="${player.name}">
                ${teamInfo?.logoSmall ? `<img src="${teamInfo.logoSmall}" alt="${player.team}" class="team-logo-overlay">` : ''}
            </div>
            <div class="player-info">
                <div class="player-name">${player.name} <span class="player-team-pos">${player.position} - ${player.team}</span></div>
                <div class="player-game-info">${gameTimeDisplay}</div>
            </div>
            <div class="player-points">
                <div class="current-points">${formatPoints(player.points)}</div>
            </div>
        `;
    } else {
        // Team 2 (right): Position/team first, then name, then game info - mirrored layout
        playerCell.innerHTML = `
            <div class="player-points">
                <div class="current-points">${formatPoints(player.points)}</div>
            </div>
            <div class="player-info right-align">
                <div class="player-name"><span class="player-team-pos">${player.position} - ${player.team}</span> ${player.name}</div>
                <div class="player-game-info">${gameTimeDisplay}</div>
            </div>
            <div class="player-avatar right">
                <div class="player-initials">${initials}</div>
                <img class="player-headshot" style="display: none;" alt="${player.name}">
                ${teamInfo?.logoSmall ? `<img src="${teamInfo.logoSmall}" alt="${player.team}" class="team-logo-overlay">` : ''}
            </div>
        `;
    }
    
    // Load headshot asynchronously in the background (non-blocking) using utils.js function
    loadPlayerHeadshotAsync(playerCell, player.id, player.name);
    
    return playerCell;
}


// Format game time for display (e.g., "Sunday 1:00 PM" -> "1:00 PM")
function formatGameTime(gameTimeString) {
    if (!gameTimeString) return 'TBD';
    
    try {
        // Handle different time formats
        if (gameTimeString.includes('PM') || gameTimeString.includes('AM')) {
            // Extract time portion if it contains day name
            const timeMatch = gameTimeString.match(/(\d{1,2}:\d{2}\s?(AM|PM))/i);
            if (timeMatch) {
                return timeMatch[1];
            }
        }
        
        // Try to parse as date and format
        const date = new Date(gameTimeString);
        if (!isNaN(date.getTime())) {
            return date.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            });
        }
        
        // Fallback to original string
        return gameTimeString;
    } catch (error) {
        return gameTimeString || 'TBD';
    }
}

// Format game date for display (e.g., "Sunday, Sep 10")
function formatGameDate(gameTimeString) {
    if (!gameTimeString) return 'TBD';
    
    try {
        const date = new Date(gameTimeString);
        if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('en-US', { 
                weekday: 'short', 
                month: 'short',
                day: 'numeric'
            });
        }
        
        // Extract day name if present and convert to abbreviated form
        const dayMatch = gameTimeString.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
        if (dayMatch) {
            const fullDay = dayMatch[1].toLowerCase();
            const dayAbbreviations = {
                'monday': 'Mon',
                'tuesday': 'Tue', 
                'wednesday': 'Wed',
                'thursday': 'Thu',
                'friday': 'Fri',
                'saturday': 'Sat',
                'sunday': 'Sun'
            };
            return dayAbbreviations[fullDay] || dayMatch[1];
        }
        
        return 'Game Day';
    } catch (error) {
        return 'Game Day';
    }
}

// Create enhanced player card for game view with compact design
async function createGamePlayerCard(player, side = 'left') {
    const playerCard = document.createElement('div');
    const cardClass = player.isStarted ? 'game-player-card started' : 'game-player-card benched';
    playerCard.className = cardClass;
    
    // Get team info for logos
    const teamInfo = await getTeamInfo(player.team);
    
    // Create initials for immediate display
    const initials = player.name.split(' ').map(n => n[0]).join('');
    
    // Create different layouts for left vs right sides
    if (side === 'left') {
        // Team 1 (left): Standard layout
        playerCard.innerHTML = `
            <div class="compact-avatar">
                <div class="compact-initials">${initials}</div>
                <img class="compact-headshot" style="display: none;" alt="${player.name}">
                ${teamInfo?.logoSmall ? `<img src="${teamInfo.logoSmall}" alt="${player.team}" class="compact-team-logo">` : ''}
            </div>
            <div class="compact-player-info">
                <div class="compact-player-name">${player.name}</div>
                <div class="compact-player-details">
                    <span class="compact-position">${player.position}</span>
                    <span class="compact-team">${player.team}</span>
                </div>
            </div>
            <div class="compact-points">
                <div class="compact-score">${formatPoints(player.points)}</div>
            </div>
        `;
    } else {
        // Team 2 (right): Mirrored layout
        playerCard.innerHTML = `
            <div class="compact-points">
                <div class="compact-score">${formatPoints(player.points)}</div>
            </div>
            <div class="compact-player-info right-align">
                <div class="compact-player-name">${player.name}</div>
                <div class="compact-player-details">
                    <span class="compact-position">${player.position}</span>
                    <span class="compact-team">${player.team}</span>
                </div>
            </div>
            <div class="compact-avatar">
                <div class="compact-initials">${initials}</div>
                <img class="compact-headshot" style="display: none;" alt="${player.name}">
                ${teamInfo?.logoSmall ? `<img src="${teamInfo.logoSmall}" alt="${player.team}" class="compact-team-logo">` : ''}
            </div>
        `;
    }
    
    // Load headshot asynchronously in the background using utils.js function
    loadPlayerHeadshotAsync(playerCard, player.id, player.name, true); // true for compact mode
    
    return playerCard;
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
});
