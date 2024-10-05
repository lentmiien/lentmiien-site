// Global Variables
let totalPairs;
let images = []; // Array to store image data (name, facts)
let shuffledCards = []; // Array to store shuffled card data
let firstCard, secondCard;
let lockBoard = false;
let matchesFound = 0;

// Fetch images and facts from facts.json
async function loadImagesAndFacts() {
  try {
    const response = await fetch('data/facts.json');
    const data = await response.json();
    images = data;
    setupDifficultyOptions();
  } catch (error) {
    console.error('Error loading images and facts:', error);
  }
}

// Setup Difficulty Options
function setupDifficultyOptions() {
  const options = [
    { level: 1, pairs: 3 },
    { level: 2, pairs: 6 },
    { level: 3, pairs: 9 },
    { level: 4, pairs: 12 },
    { level: 5, pairs: 15 }
  ];
  const difficultyOptions = document.getElementById('difficulty-options');
  difficultyOptions.innerHTML = '';

  options.forEach(option => {
    const button = document.createElement('button');
    button.textContent = `Level ${option.level}`;
    button.addEventListener('click', () => startGame(option.pairs));
    difficultyOptions.appendChild(button);
  });
}

// Start Game Function
function startGame(pairs) {
  totalPairs = pairs;
  resetGameData();
  selectRandomImages();
  createBoard();
  hideDifficultyScreen();
}

// Reset Game Data
function resetGameData() {
  shuffledCards = [];
  firstCard = null;
  secondCard = null;
  lockBoard = false;
  matchesFound = 0;
}

// Select Random Images and Prepare Card Data
function selectRandomImages() {
  // Shuffle the images array and select the required number of images
  const selectedImages = images.sort(() => 0.5 - Math.random()).slice(0, totalPairs);

  // Prepare the cards array
  const cardData = [];
  selectedImages.forEach(item => {
    const cardInfo = {
      name: item.name,
      image: item.image,
      facts: item.facts,
      audioFiles: item.audioFiles
    };
    cardData.push({ ...cardInfo });
    cardData.push({ ...cardInfo }); // Duplicate for the pair
  });

  // Shuffle the cards
  shuffle(cardData);

  // Store the shuffled cards
  shuffledCards = cardData;
}

// Shuffle Function
function shuffle(array) {
  array.sort(() => Math.random() - 0.5);
}

// Create the Game Board
function createBoard() {
  const gameBoard = document.getElementById('game-board');
  gameBoard.innerHTML = ''; // Clear the previous board

  // Adjust grid class based on the number of cards
  gameBoard.className = ''; // Reset classes
  if (totalPairs <= 3) {
    gameBoard.classList.add('small-grid');
  } else if (totalPairs <= 8) {
    gameBoard.classList.add('medium-grid');
  } else {
    gameBoard.classList.add('large-grid');
  }

  shuffledCards.forEach(item => {
    // Create card element
    const cardElement = document.createElement('div');
    cardElement.classList.add('card');
    cardElement.dataset.name = item.name;

    // Inner card structure
    const cardInner = document.createElement('div');
    cardInner.classList.add('card-inner');

    const cardFront = document.createElement('div');
    cardFront.classList.add('card-front');
    const frontImage = document.createElement('img');
    frontImage.src = `images/${item.image}`;
    frontImage.alt = item.name;
    cardFront.appendChild(frontImage);

    const cardBack = document.createElement('div');
    cardBack.classList.add('card-back');
    const backImage = document.createElement('img');
    backImage.src = 'images/card-back.jpg';
    backImage.alt = 'Card Back';
    cardBack.appendChild(backImage);

    cardInner.appendChild(cardFront);
    cardInner.appendChild(cardBack);
    cardElement.appendChild(cardInner);

    // Event Listener for card click
    cardElement.addEventListener('click', flipCard);

    gameBoard.appendChild(cardElement);
  });
}

// Adjust Grid Layout
function adjustGridLayout(cardCount) {
  const gameBoard = document.getElementById('game-board');
  gameBoard.className = ''; // Reset classes

  if (cardCount <= 6) {
    gameBoard.classList.add('grid-3x2');
  } else if (cardCount <= 12) {
    gameBoard.classList.add('grid-4x3');
  } else if (cardCount <= 18) {
    gameBoard.classList.add('grid-6x3');
  } else if (cardCount <= 24) {
    gameBoard.classList.add('grid-6x4');
  } else {
    gameBoard.classList.add('grid-6x5');
  }
}

// Flip Card Function
function flipCard() {
  if (lockBoard) return;
  if (this === firstCard) return;

  this.classList.add('flip');

  if (!firstCard) {
    // First card clicked
    firstCard = this;
    return;
  }

  // Second card clicked
  secondCard = this;
  checkForMatch();
}

// Check for Match
function checkForMatch() {
  const isMatch = firstCard.dataset.name === secondCard.dataset.name;
  isMatch ? disableCards() : unflipCards();
}

// Disable Cards on Match
function disableCards() {
  // Remove event listeners
  firstCard.removeEventListener('click', flipCard);
  secondCard.removeEventListener('click', flipCard);

  // Play random fact and audio
  playRandomFactAndAudio(firstCard.dataset.name);

  matchesFound++;
  if (matchesFound === totalPairs) {
    // All pairs found
    setTimeout(() => {
      playWinningMessage();
    }, 1000);
  }

  resetBoard();
}

// Unflip Cards on Mismatch
function unflipCards() {
  lockBoard = true;
  setTimeout(() => {
    firstCard.classList.remove('flip');
    secondCard.classList.remove('flip');
    resetBoard();
  }, 1000);
}

// Reset Board
function resetBoard() {
  [firstCard, secondCard, lockBoard] = [null, null, false];
}

// Play Random Fact and Audio
function playRandomFactAndAudio(imageName) {
  // Find the image data
  const imageData = images.find(item => item.name === imageName);
  if (imageData) {
    // Select a random fact and corresponding audio file
    const randomIndex = Math.floor(Math.random() * imageData.facts.length);
    const fact = imageData.facts[randomIndex];
    const audioFile = imageData.audioFiles[randomIndex];

    // Display the fact (You can display it in a modal or overlay)
    displayFact(fact);

    // Play the audio
    playAudio(`audio/${audioFile}`);
  }
}

// Display Fact Function
function displayFact(fact) {
  const factDisplay = document.getElementById('fact-display');
  factDisplay.textContent = fact;
  factDisplay.classList.remove('hidden');

  // Hide the fact after a few seconds
  setTimeout(() => {
    factDisplay.classList.add('hidden');
  }, 4000);
}

// Play Audio Function
function playAudio(audioSrc) {
  const audio = new Audio(audioSrc);
  audio.play();
}

// Play Winning Message
function playWinningMessage() {
  const messages = [
    "Great job!",
    "You did it!",
    "Fantastic memory!",
    "Excellent work!",
    "You're amazing!"
  ];
  const randomIndex = Math.floor(Math.random() * messages.length);
  const message = messages[randomIndex];

  // Display the winning message
  displayWinningMessage(message);

  // Play the corresponding audio file
  playAudio(`audio/win-${randomIndex + 1}.mp3`);
}

// Display Winning Message
function displayWinningMessage(message) {
  const winningMessageElement = document.getElementById('winning-message');
  const winningText = document.getElementById('winning-text');
  winningText.textContent = message;
  winningMessageElement.classList.remove('hidden');

  // Add event listener for play again button
  const playAgainButton = document.getElementById('play-again-button');
  playAgainButton.addEventListener('click', () => {
    winningMessageElement.classList.add('hidden');
    showDifficultyScreen();
  });
}

// Show and Hide Difficulty Screen
function showDifficultyScreen() {
  document.getElementById('difficulty-screen').classList.remove('hidden');
  document.getElementById('game-board').classList.add('hidden');
}

function hideDifficultyScreen() {
  document.getElementById('difficulty-screen').classList.add('hidden');
  document.getElementById('game-board').classList.remove('hidden');
}

// Initialize the Game on Page Load
document.addEventListener('DOMContentLoaded', () => {
  loadImagesAndFacts();
});