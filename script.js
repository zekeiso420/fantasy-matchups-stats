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
    
    // Add event listeners for dropdowns
    leagueSelect.addEventListener('change', selectLeague);
    weekSelect.addEventListener('change', selectWeek);
    
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
        
        // Display user info
        userInfoDiv.innerHTML = `
            <p><strong>User:</strong> ${currentUser.display_name || currentUser.username}</p>
            <p><strong>User ID:</strong> ${currentUser.user_id}</p>
        `;
        userInfoDiv.classList.remove('hidden');
        
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
        
        // Display league info
        leagueInfoDiv.innerHTML = `
            <p><strong>League:</strong> ${currentLeague.name}</p>
            <p><strong>Season:</strong> ${currentLeague.season}</p>
            <p><strong>Teams:</strong> ${currentLeague.total_rosters}</p>
        `;
        leagueInfoDiv.classList.remove('hidden');
        
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
    
    // Display rosters
    await displayRoster('user-roster', userMatchup, userRoster);
    await displayRoster('opponent-roster', opponentMatchup, opponentRoster);
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

// Tab switching functionality
function switchTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.add('hidden');
    });
    
    // Remove active class from all tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab content
    document.getElementById(tabName).classList.remove('hidden');
    
    // Add active class to clicked button
    event.target.classList.add('active');
    
    // If switching to game view, populate it
    if (tabName === 'game-view') {
        displayGameView();
    }
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
        
        // Check if games are Thursday games
        const isThursdayA = dataA.time && dataA.time.toLowerCase().includes('thursday');
        const isThursdayB = dataB.time && dataB.time.toLowerCase().includes('thursday');
        
        // Force Thursday games to appear right above Free Agents (but below all other games)
        if (isThursdayA && !isThursdayB) return 1;
        if (!isThursdayA && isThursdayB) return -1;
        
        const statusA = getGameStatus(dataA.status);
        const statusB = getGameStatus(dataB.status);
        
        // Priority order: live games first, then upcoming (soonest first), then completed (most recently finished first), then Thursday games, then Free Agents
        
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
        
        // If both are live, sort by most recently started (earlier start time first)
        if (statusA === 'live' && statusB === 'live') {
            if (validDateA && validDateB) {
                return dateA - dateB;
            }
            return dataA.time.localeCompare(dataB.time);
        }
        
        // If both are upcoming, sort by soonest first
        if (statusA === 'upcoming' && statusB === 'upcoming') {
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

// Display game slots in the container
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
        
        // Get team info for logos and colors
        const awayTeamInfo = await getTeamInfo(data.awayTeam);
        const homeTeamInfo = await getTeamInfo(data.homeTeam);
        
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
        
        // Create the new compact header design
        let headerContent = '';
        if (data.isCompleted && data.homeScore && data.awayScore) {
            // Completed game with score
            headerContent = `
                <div class="compact-game-header">
                    <div class="game-time-status">
                        <span class="game-time">${data.time}</span>
                    </div>
                    <div class="team-matchup-with-score">
                        ${awayTeamInfo?.logo ? `<img src="${awayTeamInfo.logo}" alt="${data.awayTeam}" class="team-logo">` : ''}
                        <span class="team-abbr">${data.awayTeam}</span>
                        <span class="vs-text">@</span>
                        <span class="team-abbr">${data.homeTeam}</span>
                        ${homeTeamInfo?.logo ? `<img src="${homeTeamInfo.logo}" alt="${data.homeTeam}" class="team-logo">` : ''}
                    </div>
                    <div class="final-status">Final</div>
                </div>
                <div class="large-score">${data.awayScore} - ${data.homeScore}</div>
            `;
        } else if (data.isLive && data.homeScore && data.awayScore) {
            // Live game with current score and clock
            const clockDisplay = data.gameClock && data.gameQuarter ? 
                `${data.gameQuarter} - ${data.gameClock}` : '';
            
            headerContent = `
                <div class="compact-game-header">
                    <div class="game-time-status">
                        <span class="game-time">${data.time}</span>
                    </div>
                    <div class="team-matchup-with-score">
                        ${awayTeamInfo?.logo ? `<img src="${awayTeamInfo.logo}" alt="${data.awayTeam}" class="team-logo">` : ''}
                        <span class="team-abbr">${data.awayTeam}</span>
                        <span class="vs-text">@</span>
                        <span class="team-abbr">${data.homeTeam}</span>
                        ${homeTeamInfo?.logo ? `<img src="${homeTeamInfo.logo}" alt="${data.homeTeam}" class="team-logo">` : ''}
                    </div>
                    <div class="live-status-container">
                        <div class="live-status">LIVE</div>
                        ${clockDisplay ? `<div class="live-clock">${clockDisplay}</div>` : ''}
                    </div>
                </div>
                <div class="large-score live-score">${data.awayScore} - ${data.homeScore}</div>
            `;
        } else {
            // Upcoming game
            headerContent = `
                <div class="compact-game-header">
                    <div class="game-time-status">
                        <span class="game-time">${data.time}</span>
                    </div>
                    <div class="team-matchup-with-score">
                        ${awayTeamInfo?.logo ? `<img src="${awayTeamInfo.logo}" alt="${data.awayTeam}" class="team-logo">` : ''}
                        <span class="team-abbr">${data.awayTeam}</span>
                        <span class="vs-text">@</span>
                        <span class="team-abbr">${data.homeTeam}</span>
                        ${homeTeamInfo?.logo ? `<img src="${homeTeamInfo.logo}" alt="${data.homeTeam}" class="team-logo">` : ''}
                    </div>
                    <div class="game-status">${data.status}</div>
                </div>
            `;
        }
        
        // Use the correct team names - either from current matchup context or fallback to currentUser
        const leftTeamName = userTeamName || (currentUser.display_name || currentUser.username);
        const opponentName = opponentUser?.display_name || 
                            opponentUser?.username || 
                            'Opponent';
        
        gameDiv.innerHTML = `
            ${headerContent}
            <div class="game-players">
                <div class="game-team">
                    <div class="game-team-header">${leftTeamName}</div>
                    <div class="game-team-players" id="user-players-${safeId}"></div>
                </div>
                <div class="game-team">
                    <div class="game-team-header">${opponentName}</div>
                    <div class="game-team-players" id="opponent-players-${safeId}"></div>
                </div>
            </div>
        `;
        
        container.appendChild(gameDiv);
        
        // Populate user players for this game using consolidated function
        const userPlayersContainer = document.getElementById(`user-players-${safeId}`);
        if (data.userPlayers.length > 0) {
            for (const player of data.userPlayers) {
                const playerDiv = await createPlayerCard(player, false); // false for game view
                userPlayersContainer.appendChild(playerDiv);
            }
        } else {
            userPlayersContainer.innerHTML = '<div class="no-players">No players in this game</div>';
        }
        
        // Populate opponent players for this game using consolidated function
        const opponentPlayersContainer = document.getElementById(`opponent-players-${safeId}`);
        if (data.opponentPlayers.length > 0) {
            for (const player of data.opponentPlayers) {
                const playerDiv = await createPlayerCard(player, false); // false for game view
                opponentPlayersContainer.appendChild(playerDiv);
            }
        } else {
            opponentPlayersContainer.innerHTML = '<div class="no-players">No players in this game</div>';
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
        
        // Display rosters for the selected matchup (force update)
        await displayRoster('user-roster', team1, roster1, true);
        await displayRoster('opponent-roster', team2, roster2, true);
        
        // Update sidebar to highlight the active matchup
        updateSidebarActiveState();
        
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

// Helper function to create pale colors for game backgrounds  
function makePaleColor(hexColor, opacity = 0.15) {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
});
