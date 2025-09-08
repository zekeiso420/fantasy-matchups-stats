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

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    // Allow Enter key to trigger user fetch
    usernameInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            fetchUser();
        }
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
    
    // Ensure we have opponent user data - if not, try to find it again
    let actualOpponentUser = opponentUser;
    if (!actualOpponentUser && opponentRoster?.owner_id && users) {
        actualOpponentUser = users.find(user => user.user_id === opponentRoster.owner_id);
    }
    
    // Update team names with better fallback logic
    document.getElementById('user-team-name').textContent = 
        currentUser.display_name || currentUser.username;
    
    const opponentName = actualOpponentUser?.display_name || 
                        actualOpponentUser?.username || 
                        `Team ${opponentRoster?.roster_id || 'Unknown'}`;
    document.getElementById('opponent-team-name').textContent = opponentName;
    
    // Update scores
    const userScore = calculateTeamScore(userMatchup);
    const opponentScore = calculateTeamScore(opponentMatchup);
    
    document.getElementById('user-score').textContent = formatPoints(userScore);
    document.getElementById('opponent-score').textContent = formatPoints(opponentScore);
    
    // Display rosters
    await displayRoster('user-roster', userMatchup, userRoster);
    await displayRoster('opponent-roster', opponentMatchup, opponentRoster);
}

// Display team roster
async function displayRoster(containerId, matchupData, rosterData) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    if (!matchupData.starters || !rosterData.players) {
        container.innerHTML = '<p>No roster data available</p>';
        return;
    }
    
    // Check if this is for Team View (main roster display)
    const isTeamView = containerId === 'user-roster' || containerId === 'opponent-roster';
    
    // Get all players with their info
    const starters = [];
    const bench = [];
    
    // Add starters first
    for (const playerId of matchupData.starters) {
        if (playerId && rosterData.players.includes(playerId)) {
            const playerInfo = await getPlayerInfo(playerId, matchupData);
            starters.push({
                ...playerInfo,
                id: playerId,
                isStarted: true
            });
        }
    }
    
    // Add bench players
    for (const playerId of rosterData.players) {
        if (playerId && !matchupData.starters.includes(playerId)) {
            const playerInfo = await getPlayerInfo(playerId, matchupData);
            bench.push({
                ...playerInfo,
                id: playerId,
                isStarted: false
            });
        }
    }
    
    // Define position priority order
    const positionPriority = {
        'QB': 1,
        'RB': 2,
        'WR': 3,
        'TE': 4,
        'K': 5,
        'DEF': 6,
        'D/ST': 6, // Alternative defense notation
        'DST': 6   // Alternative defense notation
    };
    
    // Sort function for players
    const sortPlayers = (players) => {
        return players.sort((a, b) => {
            // Get position priorities (default to 99 for unknown positions)
            const aPriority = positionPriority[a.position] || 99;
            const bPriority = positionPriority[b.position] || 99;
            
            if (aPriority !== bPriority) {
                return aPriority - bPriority;
            }
            
            // If same position, sort alphabetically by name
            return a.name.localeCompare(b.name);
        });
    };
    
    // Sort both arrays
    sortPlayers(starters);
    sortPlayers(bench);
    
    // Create player card HTML
    const createPlayerCard = async (player) => {
        // Get team info and player headshot
        const playerTeamInfo = await getTeamInfo(player.team);
        const headshot = await getPlayerHeadshot(player.name, player.team);
        
        // Get game info for this player's team
        const gameInfo = await getTeamGameTime(player.team, currentWeek);
        let gameStatus = '';
        let gameTime = '';
        let gameStatusClass = '';
        
        if (gameInfo.isLive) {
            gameStatus = `${gameInfo.gameClock && gameInfo.gameQuarter ? `${gameInfo.gameQuarter} - ${gameInfo.gameClock}` : 'LIVE'}`;
            const isHomeGame = player.team === gameInfo.homeTeam;
            const opponent = isHomeGame ? gameInfo.awayTeam : gameInfo.homeTeam;
            gameTime = `${isHomeGame ? 'VS' : '@'} ${opponent}`;
        } else if (gameInfo.isCompleted) {
            const isWin = gameInfo.winnerTeam === player.team;
            gameStatus = `${isWin ? 'W' : 'L'} ${gameInfo.awayScore}-${gameInfo.homeScore}`;
            const isHomeGame = player.team === gameInfo.homeTeam;
            const opponent = isHomeGame ? gameInfo.awayTeam : gameInfo.homeTeam;
            gameTime = `${isHomeGame ? 'VS' : '@'} ${opponent}`;
            gameStatusClass = isWin ? 'game-win' : 'game-loss';
        } else if (gameInfo.time !== 'Free Agent' && gameInfo.time !== 'No Game This Week') {
            // Parse the time to include day and time - try multiple formats
            let dayTimeMatch = gameInfo.time.match(/(\w+day)[,\s]+(\d{1,2}:\d{2}\s*[AP]M)/i);
            if (!dayTimeMatch) {
                // Try format like "Sunday 1:00 PM EST"
                dayTimeMatch = gameInfo.time.match(/(\w+day)\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
            }
            if (!dayTimeMatch) {
                // Try format with numeric date "Sunday, January 12, 1:00 PM EST"
                dayTimeMatch = gameInfo.time.match(/(\w+day)[^0-9]*(\d{1,2}:\d{2}\s*[AP]M)/i);
            }
            
            if (dayTimeMatch) {
                const dayAbbr = dayTimeMatch[1].substring(0, 3); // "Sunday" -> "Sun"
                gameStatus = `${dayAbbr} ${dayTimeMatch[2]}`;
            } else {
                // Enhanced fallback - try to extract time and show with original if possible
                const timeMatch = gameInfo.time.match(/\d{1,2}:\d{2}\s*[AP]M/i);
                if (timeMatch) {
                    // Try to extract day from start of string
                    const dayMatch = gameInfo.time.match(/^(\w+day)/i);
                    if (dayMatch) {
                        const dayAbbr = dayMatch[1].substring(0, 3);
                        gameStatus = `${dayAbbr} ${timeMatch[0]}`;
                    } else {
                        gameStatus = timeMatch[0];
                    }
                } else {
                    // Show original time as fallback
                    gameStatus = gameInfo.time;
                }
            }
            const isHomeGame = player.team === gameInfo.homeTeam;
            const opponent = isHomeGame ? gameInfo.awayTeam : gameInfo.homeTeam;
            gameTime = `${isHomeGame ? 'VS' : '@'} ${opponent}`;
        } else {
            gameStatus = gameInfo.status;
            gameTime = 'Yet to play';
        }
        
        const playerDiv = document.createElement('div');
        playerDiv.className = `player-card ${player.isStarted ? 'started' : 'benched'}`;
        
        playerDiv.innerHTML = `
            <div class="player-avatar">
                ${headshot ? 
                    `<img src="${headshot}" alt="${player.name}" class="player-headshot" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                     <div class="player-initials" style="display: none;">${player.name.split(' ').map(n => n[0]).join('')}</div>` :
                    `<div class="player-initials">${player.name.split(' ').map(n => n[0]).join('')}</div>`
                }
                ${playerTeamInfo?.logoSmall ? `<img src="${playerTeamInfo.logoSmall}" alt="${player.team}" class="team-logo-overlay">` : ''}
            </div>
            <div class="player-details">
                <div class="player-header">
                    <span class="player-name player-name-full">${player.name}</span>
                    <span class="player-name player-name-short">${shortenPlayerName(player.name)}</span>
                </div>
                <div class="game-info">
                    <div class="game-time ${gameStatusClass}">${gameStatus}</div>
                    <div class="game-opponent">${gameTime}</div>
                </div>
            </div>
            <div class="player-stats">
                <div class="player-position">${player.position} - ${player.team}</div>
                <div class="player-points">${formatPoints(player.points)}</div>
            </div>
        `;
        
        return playerDiv;
    };
    
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
}

// Setup auto-refresh functionality
function setupAutoRefresh() {
    // Clear existing interval
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    if (!isAutoRefreshEnabled) return;
    
    // Set up more frequent refresh interval for live games
    autoRefreshInterval = setInterval(async () => {
        try {
            // Always clear cache to ensure fresh data on auto-refresh
            clearCache();
            
            // Clear any cached NFL schedule data too
            if (window.nflScheduleCache) {
                delete window.nflScheduleCache;
            }
            
            await loadMatchup();
        } catch (error) {
            // Silent error handling for auto-refresh
        }
    }, 15000); // 15 seconds for more frequent updates
    
    updateRefreshStatus();
}

// Toggle auto-refresh
function toggleAutoRefresh() {
    isAutoRefreshEnabled = !isAutoRefreshEnabled;
    
    if (isAutoRefreshEnabled) {
        setupAutoRefresh();
    } else {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    }
    
    updateRefreshStatus();
}

// Update refresh status display
function updateRefreshStatus() {
    const statusSpan = document.getElementById('auto-refresh-status');
    const toggleBtn = document.getElementById('toggle-refresh');
    
    if (isAutoRefreshEnabled) {
        statusSpan.textContent = 'Auto-refresh: ON';
        toggleBtn.textContent = 'Turn Off';
    } else {
        statusSpan.textContent = 'Auto-refresh: OFF';
        toggleBtn.textContent = 'Turn On';
    }
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
        await loadMatchup();
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
        // Get current matchup data
        const matchupData = await findUserMatchup(
            currentLeague.league_id, 
            currentUser.user_id, 
            currentWeek
        );
        
        // Ensure we have opponent user data with fallback logic (same as displayMatchup)
        const { opponentUser, opponentRoster, users } = matchupData;
        let actualOpponentUser = opponentUser;
        if (!actualOpponentUser && opponentRoster?.owner_id && users) {
            actualOpponentUser = users.find(user => user.user_id === opponentRoster.owner_id);
        }
        
        // Group players by their NFL team's actual game time
        const gameSlots = await groupPlayersByActualGameTime(matchupData);
        
        // Display the grouped games with the properly resolved opponent user
        await displayGameSlots(gameSlots, container, actualOpponentUser);
        
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
async function displayGameSlots(gameSlots, container, opponentUser) {
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
        
        // Ensure we have opponent name with better fallback logic
        const opponentName = opponentUser?.display_name || 
                            opponentUser?.username || 
                            'Opponent';
        
        gameDiv.innerHTML = `
            ${headerContent}
            <div class="game-players">
                <div class="game-team">
                    <div class="game-team-header">${currentUser.display_name || currentUser.username}</div>
                    <div class="game-team-players" id="user-players-${safeId}"></div>
                </div>
                <div class="game-team">
                    <div class="game-team-header">${opponentName}</div>
                    <div class="game-team-players" id="opponent-players-${safeId}"></div>
                </div>
            </div>
        `;
        
        container.appendChild(gameDiv);
        
        // Populate user players for this game
        const userPlayersContainer = document.getElementById(`user-players-${safeId}`);
        if (data.userPlayers.length > 0) {
            for (const player of data.userPlayers) {
                const playerDiv = document.createElement('div');
                playerDiv.className = `player-card game-view ${player.isStarted ? 'started' : 'benched'}`;
                
                // Get team info and player headshot
                const playerTeamInfo = await getTeamInfo(player.team);
                const headshot = await getPlayerHeadshot(player.name, player.team);
                
                // Get game info for this player's team
                const gameInfo = await getTeamGameTime(player.team, currentWeek);
                let gameStatus = '';
                let gameTime = '';
                let gameStatusClass = '';
                
                if (gameInfo.isLive) {
                    gameStatus = `${gameInfo.gameClock && gameInfo.gameQuarter ? `${gameInfo.gameQuarter} - ${gameInfo.gameClock}` : 'LIVE'}`;
                    const isHomeGame = player.team === gameInfo.homeTeam;
                    const opponent = isHomeGame ? gameInfo.awayTeam : gameInfo.homeTeam;
                    gameTime = `${isHomeGame ? 'VS' : '@'} ${opponent}`;
                } else if (gameInfo.isCompleted) {
                    const isWin = gameInfo.winnerTeam === player.team;
                    gameStatus = `${isWin ? 'W' : 'L'} ${gameInfo.awayScore}-${gameInfo.homeScore}`;
                    const isHomeGame = player.team === gameInfo.homeTeam;
                    const opponent = isHomeGame ? gameInfo.awayTeam : gameInfo.homeTeam;
                    gameTime = `${isHomeGame ? 'VS' : '@'} ${opponent}`;
                    gameStatusClass = isWin ? 'game-win' : 'game-loss';
                } else if (gameInfo.time !== 'Free Agent' && gameInfo.time !== 'No Game This Week') {
                    // Parse the time to include day and time - try multiple formats
                    let dayTimeMatch = gameInfo.time.match(/(\w+day)[,\s]+(\d{1,2}:\d{2}\s*[AP]M)/i);
                    if (!dayTimeMatch) {
                        dayTimeMatch = gameInfo.time.match(/(\w+day)\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
                    }
                    if (!dayTimeMatch) {
                        dayTimeMatch = gameInfo.time.match(/(\w+day)[^0-9]*(\d{1,2}:\d{2}\s*[AP]M)/i);
                    }
                    
                    if (dayTimeMatch) {
                        const dayAbbr = dayTimeMatch[1].substring(0, 3);
                        gameStatus = `${dayAbbr} ${dayTimeMatch[2]}`;
                    } else {
                        const timeMatch = gameInfo.time.match(/\d{1,2}:\d{2}\s*[AP]M/i);
                        if (timeMatch) {
                            const dayMatch = gameInfo.time.match(/^(\w+day)/i);
                            if (dayMatch) {
                                const dayAbbr = dayMatch[1].substring(0, 3);
                                gameStatus = `${dayAbbr} ${timeMatch[0]}`;
                            } else {
                                gameStatus = timeMatch[0];
                            }
                        } else {
                            gameStatus = gameInfo.time;
                        }
                    }
                    const isHomeGame = player.team === gameInfo.homeTeam;
                    const opponent = isHomeGame ? gameInfo.awayTeam : gameInfo.homeTeam;
                    gameTime = `${isHomeGame ? 'VS' : '@'} ${opponent}`;
                } else {
                    gameStatus = gameInfo.status;
                    gameTime = 'Yet to play';
                }
                
                playerDiv.innerHTML = `
                    <div class="player-avatar">
                        ${headshot ? 
                            `<img src="${headshot}" alt="${player.name}" class="player-headshot" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                             <div class="player-initials" style="display: none;">${player.name.split(' ').map(n => n[0]).join('')}</div>` :
                            `<div class="player-initials">${player.name.split(' ').map(n => n[0]).join('')}</div>`
                        }
                        ${playerTeamInfo?.logoSmall ? `<img src="${playerTeamInfo.logoSmall}" alt="${player.team}" class="team-logo-overlay">` : ''}
                    </div>
                    <div class="player-details">
                        <div class="player-header">
                            <span class="player-name">${player.name}</span>
                            <span class="player-position">${player.position} - ${player.team}</span>
                        </div>
                        <div class="game-info">
                            <div class="game-time ${gameStatusClass}">${gameStatus}</div>
                            <div class="game-opponent">${gameTime}</div>
                        </div>
                    </div>
                    <div class="player-points">${formatPoints(player.points)}</div>
                `;
                
                userPlayersContainer.appendChild(playerDiv);
            }
        } else {
            userPlayersContainer.innerHTML = '<div class="no-players">No players in this game</div>';
        }
        
        // Populate opponent players for this game
        const opponentPlayersContainer = document.getElementById(`opponent-players-${safeId}`);
        if (data.opponentPlayers.length > 0) {
            for (const player of data.opponentPlayers) {
                const playerDiv = document.createElement('div');
                playerDiv.className = `player-card game-view ${player.isStarted ? 'started' : 'benched'}`;
                
                // Get team info and player headshot
                const playerTeamInfo = await getTeamInfo(player.team);
                const headshot = await getPlayerHeadshot(player.name, player.team);
                
                // Get game info for this player's team
                const gameInfo = await getTeamGameTime(player.team, currentWeek);
                let gameStatus = '';
                let gameTime = '';
                let gameStatusClass = '';
                
                if (gameInfo.isLive) {
                    gameStatus = `${gameInfo.gameClock && gameInfo.gameQuarter ? `${gameInfo.gameQuarter} - ${gameInfo.gameClock}` : 'LIVE'}`;
                    const isHomeGame = player.team === gameInfo.homeTeam;
                    const opponent = isHomeGame ? gameInfo.awayTeam : gameInfo.homeTeam;
                    gameTime = `${isHomeGame ? 'VS' : '@'} ${opponent}`;
                } else if (gameInfo.isCompleted) {
                    const isWin = gameInfo.winnerTeam === player.team;
                    gameStatus = `${isWin ? 'W' : 'L'} ${gameInfo.awayScore}-${gameInfo.homeScore}`;
                    const isHomeGame = player.team === gameInfo.homeTeam;
                    const opponent = isHomeGame ? gameInfo.awayTeam : gameInfo.homeTeam;
                    gameTime = `${isHomeGame ? 'VS' : '@'} ${opponent}`;
                    gameStatusClass = isWin ? 'game-win' : 'game-loss';
                } else if (gameInfo.time !== 'Free Agent' && gameInfo.time !== 'No Game This Week') {
                    // Parse the time to include day and time - try multiple formats
                    let dayTimeMatch = gameInfo.time.match(/(\w+day)[,\s]+(\d{1,2}:\d{2}\s*[AP]M)/i);
                    if (!dayTimeMatch) {
                        dayTimeMatch = gameInfo.time.match(/(\w+day)\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
                    }
                    if (!dayTimeMatch) {
                        dayTimeMatch = gameInfo.time.match(/(\w+day)[^0-9]*(\d{1,2}:\d{2}\s*[AP]M)/i);
                    }
                    
                    if (dayTimeMatch) {
                        const dayAbbr = dayTimeMatch[1].substring(0, 3);
                        gameStatus = `${dayAbbr} ${dayTimeMatch[2]}`;
                    } else {
                        const timeMatch = gameInfo.time.match(/\d{1,2}:\d{2}\s*[AP]M/i);
                        if (timeMatch) {
                            const dayMatch = gameInfo.time.match(/^(\w+day)/i);
                            if (dayMatch) {
                                const dayAbbr = dayMatch[1].substring(0, 3);
                                gameStatus = `${dayAbbr} ${timeMatch[0]}`;
                            } else {
                                gameStatus = timeMatch[0];
                            }
                        } else {
                            gameStatus = gameInfo.time;
                        }
                    }
                    const isHomeGame = player.team === gameInfo.homeTeam;
                    const opponent = isHomeGame ? gameInfo.awayTeam : gameInfo.homeTeam;
                    gameTime = `${isHomeGame ? 'VS' : '@'} ${opponent}`;
                } else {
                    gameStatus = gameInfo.status;
                    gameTime = 'Yet to play';
                }
                
                playerDiv.innerHTML = `
                    <div class="player-avatar">
                        ${headshot ? 
                            `<img src="${headshot}" alt="${player.name}" class="player-headshot" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                             <div class="player-initials" style="display: none;">${player.name.split(' ').map(n => n[0]).join('')}</div>` :
                            `<div class="player-initials">${player.name.split(' ').map(n => n[0]).join('')}</div>`
                        }
                        ${playerTeamInfo?.logoSmall ? `<img src="${playerTeamInfo.logoSmall}" alt="${player.team}" class="team-logo-overlay">` : ''}
                    </div>
                    <div class="player-details">
                        <div class="player-header">
                            <span class="player-name">${player.name}</span>
                            <span class="player-position">${player.position} - ${player.team}</span>
                        </div>
                        <div class="game-info">
                            <div class="game-time ${gameStatusClass}">${gameStatus}</div>
                            <div class="game-opponent">${gameTime}</div>
                        </div>
                    </div>
                    <div class="player-points">${formatPoints(player.points)}</div>
                `;
                
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

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
});
