// Utility functions to consolidate shared logic across tabs and components

// Team and User Name Resolution
function resolveUserDisplayName(user, fallbackPrefix = 'Team', fallbackId = 'Unknown') {
    if (!user) {
        return `${fallbackPrefix} ${fallbackId}`;
    }
    return user.display_name || user.username || `${fallbackPrefix} ${user.user_id || fallbackId}`;
}

function resolveOpponentUser(opponentUser, opponentRoster, users) {
    let actualOpponentUser = opponentUser;
    if (!actualOpponentUser && opponentRoster?.owner_id && users) {
        actualOpponentUser = users.find(user => user.user_id === opponentRoster.owner_id);
    }
    return actualOpponentUser;
}

// Game Status and Time Parsing
function parseGameStatus(gameInfo) {
    let gameStatus = '';
    let gameTime = '';
    let gameStatusClass = '';
    
    if (gameInfo.isLive) {
        gameStatus = `${gameInfo.gameClock && gameInfo.gameQuarter ? `${gameInfo.gameQuarter} - ${gameInfo.gameClock}` : 'LIVE'}`;
        const isHomeGame = gameInfo.playerTeam === gameInfo.homeTeam;
        const opponent = isHomeGame ? gameInfo.awayTeam : gameInfo.homeTeam;
        gameTime = `${isHomeGame ? 'VS' : '@'} ${opponent}`;
    } else if (gameInfo.isCompleted) {
        const isWin = gameInfo.winnerTeam === gameInfo.playerTeam;
        gameStatus = `${isWin ? 'W' : 'L'} ${gameInfo.awayScore}-${gameInfo.homeScore}`;
        const isHomeGame = gameInfo.playerTeam === gameInfo.homeTeam;
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
        const isHomeGame = gameInfo.playerTeam === gameInfo.homeTeam;
        const opponent = isHomeGame ? gameInfo.awayTeam : gameInfo.homeTeam;
        gameTime = `${isHomeGame ? 'VS' : '@'} ${opponent}`;
    } else {
        gameStatus = gameInfo.status;
        gameTime = 'Yet to play';
    }
    
    return { gameStatus, gameTime, gameStatusClass };
}

// Player Card Creation - Fast loading with async headshot loading
async function createPlayerCard(player, isTeamView = true) {
    // Get team info and game info quickly (cached)
    const playerTeamInfo = await getTeamInfo(player.team);
    const gameInfo = await getTeamGameTime(player.team, currentWeek);
    gameInfo.playerTeam = player.team; // Add player team for status parsing
    
    const { gameStatus, gameTime, gameStatusClass } = parseGameStatus(gameInfo);
    
    const playerDiv = document.createElement('div');
    playerDiv.className = `player-card ${player.isStarted ? 'started' : 'benched'}${isTeamView ? '' : ' game-view'}`;
    
    const playerNameClass = isTeamView ? 'player-name' : 'player-name';
    const showBothNames = isTeamView;
    
    // Add data attribute for silent refresh identification
    playerDiv.dataset.playerId = player.id;
    
    // Create initials for immediate display
    const initials = player.name.split(' ').map(n => n[0]).join('');
    
    // Create the player card HTML immediately with initials, no headshot blocking
    playerDiv.innerHTML = `
        <div class="player-avatar">
            <div class="player-initials">${initials}</div>
            <img class="player-headshot" style="display: none;" alt="${player.name}">
            ${playerTeamInfo?.logoSmall ? `<img src="${playerTeamInfo.logoSmall}" alt="${player.team}" class="team-logo-overlay" onerror="this.style.display='none';">` : ''}
        </div>
        <div class="player-details">
            <div class="player-header">
                ${showBothNames ? `
                    <span class="player-name player-name-full">${player.name}</span>
                    <span class="player-name player-name-short">${shortenPlayerName(player.name)}</span>
                ` : `
                    <span class="player-name ${playerNameClass}">${player.name}</span>
                    ${!isTeamView ? `<span class="player-position">${player.position} - ${player.team}</span>` : ''}
                `}
            </div>
            <div class="game-info">
                <div class="game-time ${gameStatusClass}">${gameStatus}</div>
                <div class="game-opponent">${gameTime}</div>
            </div>
        </div>
        <div class="player-stats">
            ${isTeamView ? `<div class="player-position">${player.position} - ${player.team}</div>` : ''}
            <div class="player-points">${formatPoints(player.points)}</div>
        </div>
    `;
    
    // Load headshot asynchronously in the background (non-blocking)
    loadPlayerHeadshotAsync(playerDiv, player.id, player.name);
    
    return playerDiv;
}

// Async headshot loading function with comprehensive ESPN player mapping
async function loadPlayerHeadshotAsync(playerDiv, playerId, playerName) {
    if (!playerId) return;
    
    try {
        // Get player data from cached Sleeper data
        const players = await getNFLPlayers();
        const player = players[playerId];
        
        if (!player) return;
        
        let espnId = player.espn_id;
        let headshotUrl = null;
        
        // If no ESPN ID in Sleeper data, use comprehensive ESPN mapping
        if (!espnId || espnId === null) {
            const espnPlayer = await getESPNPlayerMapping(playerName, player.team);
            if (espnPlayer) {
                espnId = espnPlayer.espnId;
                headshotUrl = espnPlayer.headshot; // Use direct headshot URL if available
            }
        }
        
        if (!espnId) return; // Could not find ESPN ID
        
        // Construct ESPN headshot URL if we don't have direct URL
        if (!headshotUrl) {
            headshotUrl = `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
        }
        
        const headshotImg = playerDiv.querySelector('.player-headshot');
        const initialsDiv = playerDiv.querySelector('.player-initials');
        
        if (headshotImg && initialsDiv) {
            headshotImg.onload = function() {
                // Hide initials and show headshot when loaded
                initialsDiv.style.display = 'none';
                headshotImg.style.display = 'block';
            };
            
            headshotImg.onerror = function() {
                // Keep showing initials if headshot fails
                headshotImg.style.display = 'none';
                initialsDiv.style.display = 'flex';
            };
            
            headshotImg.src = headshotUrl; // This triggers loading
        }
    } catch (error) {
        // Silently fail - keep showing initials
        console.debug(`Failed to load headshot for ${playerName}:`, error);
    }
}

// Get ESPN player data from comprehensive mapping
async function getESPNPlayerMapping(playerName, team) {
    if (!playerName || !team || team === 'FA') {
        return null;
    }
    
    try {
        const response = await fetch('/api/espn/player-mapping');
        if (!response.ok) return null;
        
        const data = await response.json();
        const playerMapping = data.playerMapping;
        
        if (!playerMapping) return null;
        
        // Team name mapping (Sleeper -> ESPN)
        const teamMappings = {
            'WAS': 'WSH',  // Washington Commanders
            // Add other team mappings if needed
        };
        
        // Try multiple team variations
        const teamsToTry = [team];
        if (teamMappings[team]) {
            teamsToTry.push(teamMappings[team]);
        }
        
        // Try multiple name variations
        const baseNameKey = playerName.toLowerCase().replace(/[^a-z\s]/g, '');
        const nameVariations = [
            baseNameKey,
            baseNameKey + ' jr',
            baseNameKey + ' sr', 
            baseNameKey + ' ii',
            baseNameKey + ' iii',
            baseNameKey.replace(' jr', ''),
            baseNameKey.replace(' sr', ''),
            baseNameKey.replace(' ii', ''),
            baseNameKey.replace(' iii', '')
        ];
        
        // Try all combinations of name variations and teams
        for (const teamToTry of teamsToTry) {
            for (const nameVariation of nameVariations) {
                const mappingKey = `${nameVariation}|${teamToTry}`;
                if (playerMapping[mappingKey]) {
                    return playerMapping[mappingKey];
                }
            }
        }
        
        return null;
        
    } catch (error) {
        console.debug(`Error getting ESPN player mapping:`, error);
        return null;
    }
}

// Team Display Updates
function updateTeamDisplay(userTeamName, opponentTeamName, userScore, opponentScore) {
    document.getElementById('user-team-name').textContent = userTeamName;
    document.getElementById('opponent-team-name').textContent = opponentTeamName;
    document.getElementById('user-score').textContent = formatPoints(userScore);
    document.getElementById('opponent-score').textContent = formatPoints(opponentScore);
}

// Position Priority for Sorting
const POSITION_PRIORITY = {
    'QB': 1,
    'RB': 2,
    'WR': 3,
    'TE': 4,
    'K': 5,
    'DEF': 6,
    'D/ST': 6,
    'DST': 6
};

function sortPlayersByPosition(players) {
    return players.sort((a, b) => {
        const aPriority = POSITION_PRIORITY[a.position] || 99;
        const bPriority = POSITION_PRIORITY[b.position] || 99;
        
        if (aPriority !== bPriority) {
            return aPriority - bPriority;
        }
        
        return a.name.localeCompare(b.name);
    });
}

// Shared roster processing logic
async function processRosterPlayers(matchupData, rosterData) {
    if (!matchupData.starters || !rosterData.players) {
        return { starters: [], bench: [] };
    }
    
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
    
    return {
        starters: sortPlayersByPosition(starters),
        bench: sortPlayersByPosition(bench)
    };
}
