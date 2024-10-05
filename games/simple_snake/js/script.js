const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game Constants
const gridSize = 20; // Size of each square
const tileCount = canvas.width / gridSize;

// Game Variables
let snake = [{ x: 10, y: 10 }]; // Starting position
let direction = { x: 0, y: 0 };
let food = null;//randomFoodPosition();
let specialFood = null;
let specialFoodCounter = 0;
let purpleFood = null; // Added for purple food
let purpleFoodCounter = 0; // Counter for purple food
let score = 0;
let moveInterval = 1250; // 1.25 seconds per move (double speed)
let lastMoveTime = 0;
let gamePaused = false;
let gameOver = false;
food = randomFoodPosition();

// Variables to track food eaten
let redFoodEaten = 0;
let orangeFoodEaten = 0;
let purpleFoodEaten = 0;

// Game Loop
function gameLoop(currentTime) {
  if (gameOver) {
    drawGame(); // Draw the last game state
    displayGameOver();
    return;
  }

  requestAnimationFrame(gameLoop);

  if (!lastMoveTime) {
    lastMoveTime = currentTime;
  }

  const timeSinceLastMove = currentTime - lastMoveTime;

  if (timeSinceLastMove > moveInterval) {
    lastMoveTime = currentTime;
    if (!gamePaused) {
      updateGame();
    }
    drawGame();
  }
}

requestAnimationFrame(gameLoop);

// Update Game State
function updateGame() {
  const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

  // Check collisions
  if (isCollision(head)) {
    direction = { x: 0, y: 0 };
    gamePaused = true;
    if (isSurrounded(snake[0])) {
      gameOver = true;
    }
    return;
  }

  snake.unshift(head); // Add new head position

  // Check for food consumption
  if (food && head.x === food.x && head.y === food.y) {
    score += 1;
    redFoodEaten += 1; // Increment red food counter
    food = randomFoodPosition();
  } else if (specialFood && head.x === specialFood.x && head.y === specialFood.y) {
    score += 3;
    orangeFoodEaten += 1; // Increment orange food counter
    specialFood = null;
    specialFoodCounter = 0;
  } else if (purpleFood && head.x === purpleFood.x && head.y === purpleFood.y) {
    score -= 1;
    purpleFoodEaten += 1; // Increment purple food counter
    purpleFood = null;
    purpleFoodCounter = 0;

    // Remove 3 segments from the tail
    for (let i = 0; i < 3; i++) {
      if (snake.length > 1) {
        snake.pop();
      } else {
        // If snake length is less than or equal to 1, trigger game over
        gameOver = true;
        return;
      }
    }

    // Check if score is less than 0 or snake length is less than or equal to 3
    if (score < 0) {
      gameOver = true;
      return;
    }
  } else {
    snake.pop(); // Remove tail if no food eaten
  }

  // Handle special food spawning
  handleSpecialFood();
  // Handle purple food spawning
  handlePurpleFood();
}

// Draw Game State
function drawGame() {
  // Clear canvas
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw snake
  ctx.fillStyle = 'green';
  snake.forEach(segment => {
    ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize, gridSize);
  });

  // Draw food
  if (food) {
    ctx.fillStyle = 'red';
    ctx.fillRect(food.x * gridSize, food.y * gridSize, gridSize, gridSize);
  }

  // Draw special food
  if (specialFood) {
    ctx.fillStyle = 'orange';
    ctx.fillRect(specialFood.x * gridSize, specialFood.y * gridSize, gridSize, gridSize);
  }

  // Draw purple food
  if (purpleFood) {
    ctx.fillStyle = 'purple';
    ctx.fillRect(purpleFood.x * gridSize, purpleFood.y * gridSize, gridSize, gridSize);
  }

  // Draw score
  ctx.fillStyle = '#fff';
  ctx.font = '16px Arial';
  ctx.fillText('Score: ' + score, 10, 20);
}

// Handle User Input
document.addEventListener('keydown', e => {
  if (gameOver) {
    restartGame();
    return;
  }

  switch (e.key) {
    case 'ArrowUp':
      if (direction.y === 0) {
        direction = { x: 0, y: -1 };
        gamePaused = false;
      }
      break;
    case 'ArrowDown':
      if (direction.y === 0) {
        direction = { x: 0, y: 1 };
        gamePaused = false;
      }
      break;
    case 'ArrowLeft':
      if (direction.x === 0) {
        direction = { x: -1, y: 0 };
        gamePaused = false;
      }
      break;
    case 'ArrowRight':
      if (direction.x === 0) {
        direction = { x: 1, y: 0 };
        gamePaused = false;
      }
      break;
  }
});

// Generate Random Food Position
function randomFoodPosition() {
  let position;
  while (true) {
    position = {
      x: Math.floor(Math.random() * tileCount),
      y: Math.floor(Math.random() * tileCount)
    };
    if (
      !snake.some(segment => segment.x === position.x && segment.y === position.y) &&
      (!food || position.x !== food.x || position.y !== food.y) &&
      (!specialFood || position.x !== specialFood.x || position.y !== specialFood.y) &&
      (!purpleFood || position.x !== purpleFood.x || position.y !== purpleFood.y)
    ) {
      break;
    }
  }
  return position;
}

// Check Collision with Walls or Self
function isCollision(position) {
  // Wall collision
  if (
    position.x < 0 ||
    position.x >= tileCount ||
    position.y < 0 ||
    position.y >= tileCount
  ) {
    return true;
  }
  // Self collision
  return snake.some(segment => segment.x === position.x && segment.y === position.y);
}

// Check if Snake is Completely Surrounded
function isSurrounded(head) {
  const moves = [
    { x: head.x + 1, y: head.y },
    { x: head.x - 1, y: head.y },
    { x: head.x, y: head.y + 1 },
    { x: head.x, y: head.y - 1 }
  ];
  return moves.every(move => isCollision(move));
}

// Handle Special Food Spawning and Timing
function handleSpecialFood() {
  if (specialFoodCounter > 0) {
    specialFoodCounter -= moveInterval;
    if (specialFoodCounter <= 0) {
      specialFood = null;
    }
  } else if (!specialFood && Math.random() < 0.1) { // 10% chance
    specialFood = randomFoodPosition();
    specialFoodCounter = 10000; // Special food lasts for 10 seconds
  }
}

// Handle Purple Food Spawning and Timing
function handlePurpleFood() {
  if (purpleFoodCounter > 0) {
    purpleFoodCounter -= moveInterval;
    if (purpleFoodCounter <= 0) {
      purpleFood = null;
    }
  } else if (!purpleFood && Math.random() < 0.1) { // 10% chance
    purpleFood = randomFoodPosition();
    purpleFoodCounter = 20000; // Purple food lasts for 20 seconds (double the time)
  }
}

// Display Game Over Screen
function displayGameOver() {
  ctx.fillStyle = '#fff';
  ctx.font = '40px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Game Over', canvas.width / 2, canvas.height / 2 - 80);
  ctx.font = '20px Arial';
  ctx.fillText('Score: ' + score, canvas.width / 2, canvas.height / 2 - 40);

  // Display number of each food eaten
  ctx.fillText('Red Food Eaten: ' + redFoodEaten, canvas.width / 2, canvas.height / 2);
  ctx.fillText('Orange Food Eaten: ' + orangeFoodEaten, canvas.width / 2, canvas.height / 2 + 30);
  ctx.fillText('Purple Food Eaten: ' + purpleFoodEaten, canvas.width / 2, canvas.height / 2 + 60);

  ctx.fillText('Press any key to restart', canvas.width / 2, canvas.height / 2 + 100);
}

// Restart the Game
function restartGame() {
  snake = [{ x: 10, y: 10 }];
  direction = { x: 0, y: 0 };
  food = randomFoodPosition();
  specialFood = null;
  specialFoodCounter = 0;
  purpleFood = null;
  purpleFoodCounter = 0;
  score = 0;
  redFoodEaten = 0;
  orangeFoodEaten = 0;
  purpleFoodEaten = 0;
  lastMoveTime = 0;
  gamePaused = false;
  gameOver = false;
}