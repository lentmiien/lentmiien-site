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

// Initialize the game
initGame();

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
    let treasureCount = Math.floor(Math.random() * 4) + 2; // 2 to 5 treasures
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

        alert(`Maze cleared! Your total score: ${score.toFixed(0)}`);

        initGame(); // Start a new maze
    }
}


/*
let keys = {};

document.addEventListener('keydown', (e) => {
    keys[e.key] = true;
});

document.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

function movePlayer() {
    let moved = false;
    let cell = maze[player.x][player.y];

    if ((keys['ArrowUp'] || keys['w']) && !cell.walls[0]) {
        player.y--;
        moved = true;
    }
    if ((keys['ArrowRight'] || keys['d']) && !cell.walls[1]) {
        player.x++;
        moved = true;
    }
    if ((keys['ArrowDown'] || keys['s']) && !cell.walls[2]) {
        player.y++;
        moved = true;
    }
    if ((keys['ArrowLeft'] || keys['a']) && !cell.walls[3]) {
        player.x--;
        moved = true;
    }

    // Keep player within bounds
    player.x = Math.max(0, Math.min(player.x, mazeSize - 1));
    player.y = Math.max(0, Math.min(player.y, mazeSize - 1));

    // Check for treasure collection
    treasures = treasures.filter(t => {
        if (t.x === player.x && t.y === player.y) {
            score += 10; // Bonus points for treasure
            return false;
        }
        return true;
    });

    // Check if player reached the end
    if (player.x === mazeSize - 1 && player.y === mazeSize - 1) {
        // Calculate score based on time and difficulty
        let timeTaken = (Date.now() - startTime) / 1000;
        let maxPoints = 100 + difficulty * 20;
        let pointsEarned = Math.max(0, maxPoints - timeTaken);
        score += Math.floor(pointsEarned);
        alert(`Maze cleared! Your score: ${score.toFixed(0)}`);
        initGame(); // Start a new game
    }
}
*/

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
