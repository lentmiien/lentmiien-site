const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let maze;
let player;
let treasures = [];
let score = 0;
let difficulty = 0; // Starts at 0
let mazeSize;
let cellSize = 40; // Size of each maze cell in pixels
let startTime;

const scoreMilestones = [
    { score: 500, message: "Congratulations, adventurer! Your journey begins to echo through the lands. The first steps of a legendary path have been taken." },
    { score: 1000, message: "Your name whispers in taverns and guild halls. Tales of your exploits inspire others to seek their own adventures." },
    { score: 1500, message: "You've braved challenges that would deter most. The maps you've charted are becoming invaluable to fellow explorers." },
    { score: 2000, message: "As you delve deeper, ancient secrets unfold. Your growing expertise uncovers mysteries long forgotten." },
    { score: 2500, message: "Renowned adventurer, your feats are sung by bards. Kingdoms invite you to explore their most perilous mazes." },
    { score: 3000, message: "Your skill transcends that of mere mortals. The artifacts you uncover hold powers beyond imagination." },
    { score: 3500, message: "Legends speak of your courage and cunning. Other adventurers seek your guidance to navigate the unknown." },
    { score: 4000, message: "The world recognizes you as a master explorer. Doors to realms unseen open at your approach." },
    { score: 4500, message: "You've touched the fringes of myth and reality. The greatest challenges now lie within your grasp." },
    { score: 5000, message: "Epic adventurer, your journey is the stuff of legends. You've reached the zenith of exploration, where few have ever dared tread." },
];

const difficultyMilestones = [
    { difficulty: 3, message: "You step into the **Whispering Woods**, where the trees murmur secrets and paths shift with the wind." },
    { difficulty: 6, message: "The **Shimmering Caverns** await, their walls gleaming with crystals that distort reality." },
    { difficulty: 9, message: "You brave the **Misty Marshlands**, where the fog obscures both dangers and treasures alike." },
    { difficulty: 12, message: "Entering the **Shadow Peaks**, you navigate mazes carved into mountains that pierce the heavens." },
    { difficulty: 15, message: "The **Haunted Catacombs** challenge your spirit, with echoes of the past haunting every corridor." },
    { difficulty: 18, message: "In the **Enchanted Labyrinth**, magic twists the pathways, and nothing is as it seems." },
    { difficulty: 21, message: "The **Frozen Wastes** test your endurance, where icy winds conceal the labyrinths beneath the snow." },
    { difficulty: 24, message: "Venturing into the **Volcanic Abyss**, molten rivers and fiery obstacles stand between you and glory." },
    { difficulty: 27, message: "The **Realm of Illusions** distorts your senses; trust in your instincts to find the true path." },
    { difficulty: 30, message: "You've reached the **Maze of Eternity**, a place where time and space entwine. Only the greatest adventurers can navigate its infinite corridors." },
];

let displayedScoreMilestones = new Set();
let displayedDifficultyMilestones = new Set();

function checkScoreMilestones() {
    scoreMilestones.forEach(milestone => {
        if (score >= milestone.score && !displayedScoreMilestones.has(milestone.score)) {
            displayedScoreMilestones.add(milestone.score);
            showDialog(milestone.message);
        }
    });
}

function checkDifficultyMilestones() {
    difficultyMilestones.forEach(milestone => {
        if (difficulty >= milestone.difficulty && !displayedDifficultyMilestones.has(milestone.difficulty)) {
            displayedDifficultyMilestones.add(milestone.difficulty);
            showDialog(milestone.message);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const splashScreen = document.getElementById('splashScreen');
    const enterGameButton = document.getElementById('enterGameButton');

    enterGameButton.addEventListener('click', () => {
        splashScreen.style.display = 'none';
        showIntroduction();
    });
});

function showIntroduction() {
    const introOverlay = document.getElementById('introOverlay');
    introOverlay.style.display = 'flex';
}

function showDialog(message) {
    // Create overlay elements
    const dialogOverlay = document.createElement('div');
    dialogOverlay.id = 'dialogOverlay';

    const dialogContent = document.createElement('div');
    dialogContent.id = 'dialogContent';

    const messageParagraph = document.createElement('p');
    messageParagraph.textContent = message;

    const closeButton = document.createElement('button');
    closeButton.textContent = 'Continue';
    closeButton.addEventListener('click', () => {
        document.body.removeChild(dialogOverlay);
    });

    dialogContent.appendChild(messageParagraph);
    dialogContent.appendChild(closeButton);
    dialogOverlay.appendChild(dialogContent);
    document.body.appendChild(dialogOverlay);
}


// Initialize the game
// initGame();

// Wait for the DOM to load
document.addEventListener('DOMContentLoaded', () => {
    const introOverlay = document.getElementById('introOverlay');
    const startButton = document.getElementById('startButton');

    startButton.addEventListener('click', () => {
        introOverlay.style.display = 'none';
        initGame(); // Start the game after closing the introduction
    });
});

function initGame() {
    // Prompt for difficulty
    let minDifficulty = Math.max(0, difficulty - 2);
    let maxDifficulty = difficulty + 2;
    let diffInput = prompt(`Select difficulty (${minDifficulty} to ${maxDifficulty}):`, difficulty);
    difficulty = parseInt(diffInput);
    if (isNaN(difficulty)) difficulty = 0;
    difficulty = Math.max(0, Math.min(difficulty, maxDifficulty));

    mazeSize = 5 + difficulty * 2; // Increase maze size with difficulty
    generateMaze();
    placePlayer();
    placeTreasures();
    startTime = Date.now();
    checkDifficultyMilestones();
    requestAnimationFrame(gameLoop);
}

function generateMaze() {
    maze = [];
    for (let x = 0; x < mazeSize; x++) {
        maze[x] = [];
        for (let y = 0; y < mazeSize; y++) {
            maze[x][y] = {
                visited: false,
                walls: [true, true, true, true] // Top, Right, Bottom, Left
            };
        }
    }

    // Start the maze generation from the top-left cell
    carvePassagesFrom(0, 0);
}

function carvePassagesFrom(cx, cy) {
    let directions = [0, 1, 2, 3];
    shuffle(directions);

    directions.forEach(direction => {
        const nx = cx + [0, 1, 0, -1][direction];
        const ny = cy + [-1, 0, 1, 0][direction];

        if (nx >= 0 && nx < mazeSize && ny >= 0 && ny < mazeSize && !maze[nx][ny].visited) {
            maze[cx][cy].walls[direction] = false;
            maze[nx][ny].walls[(direction + 2) % 4] = false;
            maze[nx][ny].visited = true;
            carvePassagesFrom(nx, ny);
        }
    });
}

function shuffle(array) {
    array.sort(() => Math.random() - 0.5);
}

function placePlayer() {
    player = {
        x: 0,
        y: 0
    };
}

function placeTreasures() {
    treasures = [];
    let treasureCount = Math.floor(Math.random() * 4) + difficulty; // 2 to 5 treasures
    while (treasures.length < treasureCount) {
        let tx = Math.floor(Math.random() * mazeSize);
        let ty = Math.floor(Math.random() * mazeSize);
        if ((tx !== 0 || ty !== 0) && !treasures.some(t => t.x === tx && t.y === ty)) {
            treasures.push({ x: tx, y: ty });
        }
    }
}

document.addEventListener('keydown', handleKeyDown);
document.addEventListener('keyup', handleKeyUp);

function handleKeyDown(e) {
    if (e.repeat) return; // Ignore auto-repeat keys

    let moved = false;
    let cell = maze[player.x][player.y];

    if ((e.key === 'ArrowUp' || e.key === 'w') && !cell.walls[0]) {
        player.y--;
        moved = true;
    }
    else if ((e.key === 'ArrowRight' || e.key === 'd') && !cell.walls[1]) {
        player.x++;
        moved = true;
    }
    else if ((e.key === 'ArrowDown' || e.key === 's') && !cell.walls[2]) {
        player.y++;
        moved = true;
    }
    else if ((e.key === 'ArrowLeft' || e.key === 'a') && !cell.walls[3]) {
        player.x--;
        moved = true;
    }

    if (moved) {
        // Keep player within bounds
        player.x = Math.max(0, Math.min(player.x, mazeSize - 1));
        player.y = Math.max(0, Math.min(player.y, mazeSize - 1));

        // Check for treasure collection
        checkTreasureCollection();

        // Check if player reached the goal
        checkGoalReached();
    }
}

function handleKeyUp(e) {
    // No action needed here for now
}

function checkTreasureCollection() {
    treasures = treasures.filter(t => {
        if (t.x === player.x && t.y === player.y) {
            score += 10; // Bonus points for collecting a treasure
            return false; // Remove the collected treasure
        }
        return true;
    });
}

function checkGoalReached() {
    if (player.x === mazeSize - 1 && player.y === mazeSize - 1) {
        // Calculate score based on time and difficulty
        let timeTaken = (Date.now() - startTime) / 1000;
        let maxPoints = 100 + difficulty * 20;
        let pointsEarned = Math.max(0, maxPoints - timeTaken);
        score += Math.floor(pointsEarned);
        checkScoreMilestones();

        alert(`Maze cleared! Your total score: ${score.toFixed(0)}`);

        initGame(); // Start a new maze
    }
}

function drawMaze() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate offset to keep player centered
    let offsetX = canvas.width / 2 - player.x * cellSize - cellSize / 2;
    let offsetY = canvas.height / 2 - player.y * cellSize - cellSize / 2;

    // Draw maze walls
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    for (let x = 0; x < mazeSize; x++) {
        for (let y = 0; y < mazeSize; y++) {
            let cell = maze[x][y];
            let sx = x * cellSize + offsetX;
            let sy = y * cellSize + offsetY;

            if (cell.walls[0]) {
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(sx + cellSize, sy);
                ctx.stroke();
            }
            if (cell.walls[1]) {
                ctx.beginPath();
                ctx.moveTo(sx + cellSize, sy);
                ctx.lineTo(sx + cellSize, sy + cellSize);
                ctx.stroke();
            }
            if (cell.walls[2]) {
                ctx.beginPath();
                ctx.moveTo(sx + cellSize, sy + cellSize);
                ctx.lineTo(sx, sy + cellSize);
                ctx.stroke();
            }
            if (cell.walls[3]) {
                ctx.beginPath();
                ctx.moveTo(sx, sy + cellSize);
                ctx.lineTo(sx, sy);
                ctx.stroke();
            }
        }
    }

    // Draw goal cell
    let goalX = (mazeSize - 1) * cellSize + offsetX;
    let goalY = (mazeSize - 1) * cellSize + offsetY;
    ctx.fillStyle = 'green';
    ctx.fillRect(goalX + 2, goalY + 2, cellSize - 4, cellSize - 4);

    // Draw treasures
    treasures.forEach(t => {
        ctx.fillStyle = 'gold';
        ctx.beginPath();
        ctx.arc(t.x * cellSize + cellSize / 2 + offsetX, t.y * cellSize + cellSize / 2 + offsetY, cellSize / 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw player
    ctx.fillStyle = 'blue';
    ctx.beginPath();
    ctx.arc(player.x * cellSize + cellSize / 2 + offsetX, player.y * cellSize + cellSize / 2 + offsetY, cellSize / 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw score
    ctx.fillStyle = 'black';
    ctx.font = '20px Arial';
    ctx.fillText(`Score: ${score.toFixed(0)}`, 10, 30);
}

function gameLoop() {
    //movePlayer();
    drawMaze();
    requestAnimationFrame(gameLoop);
}

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});
