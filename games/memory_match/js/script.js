'use strict';

const DIFFICULTIES = Object.freeze([
  { level: 1, pairs: 3, name: 'Warm-up', board: '3 × 2 board', columnLayouts: [3] },
  { level: 2, pairs: 6, name: 'Easy', board: '4 × 3 board', columnLayouts: [4, 3] },
  { level: 3, pairs: 9, name: 'Medium', board: '6 × 3 board', columnLayouts: [6, 3] },
  { level: 4, pairs: 12, name: 'Tricky', board: '6 × 4 board', columnLayouts: [6, 4] },
  { level: 5, pairs: 15, name: 'Expert', board: '6 × 5 board', columnLayouts: [6, 5] },
]);

const DISTRIBUTION_ATTEMPTS = 1200;
const MISMATCH_DELAY_MS = 850;
const FACT_VISIBLE_MS = 6500;
const FINAL_AUDIO_GAP_MS = 750;

let images = [];
let shuffledCards = [];
let currentDifficulty = null;
let firstCard = null;
let secondCard = null;
let lockBoard = false;
let matchesFound = 0;
let movesMade = 0;
let roundId = 0;
let turnTimeout = null;
let factTimeout = null;
let activeAudioPlayback = null;

function shuffle(array, random = Math.random) {
  const shuffled = [...array];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

function getCardName(card) {
  return typeof card === 'string' ? card : card.name;
}

function getGridDistance(firstIndex, secondIndex, columns) {
  const firstRow = Math.floor(firstIndex / columns);
  const secondRow = Math.floor(secondIndex / columns);
  const firstColumn = firstIndex % columns;
  const secondColumn = secondIndex % columns;
  return Math.abs(firstRow - secondRow) + Math.abs(firstColumn - secondColumn);
}

function measureDeckDistribution(deck, columnLayouts) {
  const layouts = Array.isArray(columnLayouts) ? columnLayouts : [columnLayouts];
  const primaryColumns = layouts[0];
  const cardPositions = new Map();

  deck.forEach((card, index) => {
    const name = getCardName(card);
    const positions = cardPositions.get(name) || [];
    positions.push(index);
    cardPositions.set(name, positions);
  });

  const metrics = {
    adjacentPairs: 0,
    nearbyPairs: 0,
    minPairDistance: Number.POSITIVE_INFINITY,
    totalDistance: 0,
  };

  cardPositions.forEach((positions) => {
    if (positions.length !== 2) return;

    const [firstIndex, secondIndex] = positions;
    const primaryDistance = getGridDistance(firstIndex, secondIndex, primaryColumns);
    const closestResponsiveDistance = Math.min(
      ...layouts.map(columns => getGridDistance(firstIndex, secondIndex, columns))
    );

    if (closestResponsiveDistance <= 1) metrics.adjacentPairs += 1;
    if (primaryDistance <= 2) metrics.nearbyPairs += 1;
    metrics.minPairDistance = Math.min(metrics.minPairDistance, primaryDistance);
    metrics.totalDistance += primaryDistance;
  });

  if (!Number.isFinite(metrics.minPairDistance)) metrics.minPairDistance = 0;
  return metrics;
}

function isBetterDistribution(candidate, currentBest) {
  if (!currentBest) return true;
  if (candidate.adjacentPairs !== currentBest.adjacentPairs) {
    return candidate.adjacentPairs < currentBest.adjacentPairs;
  }
  if (candidate.nearbyPairs !== currentBest.nearbyPairs) {
    return candidate.nearbyPairs < currentBest.nearbyPairs;
  }
  if (candidate.minPairDistance !== currentBest.minPairDistance) {
    return candidate.minPairDistance > currentBest.minPairDistance;
  }
  return candidate.totalDistance > currentBest.totalDistance;
}

function cloneCard(card) {
  return typeof card === 'object' && card !== null ? { ...card } : card;
}

function createDistributedDeck(
  selectedImages,
  columnLayouts,
  random = Math.random,
  attempts = DISTRIBUTION_ATTEMPTS
) {
  const pairedCards = selectedImages.flatMap(card => [cloneCard(card), cloneCard(card)]);
  const attemptCount = Math.max(1, attempts);
  let bestDeck = [];
  let bestMetrics = null;

  for (let attempt = 0; attempt < attemptCount; attempt += 1) {
    const candidate = shuffle(pairedCards, random);
    const metrics = measureDeckDistribution(candidate, columnLayouts);

    if (isBetterDistribution(metrics, bestMetrics)) {
      bestDeck = candidate;
      bestMetrics = metrics;
    }
  }

  return bestDeck;
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function runCompletionSequence(
  matchAudioFinished,
  wait = delay,
  playWin = playWinningMessage
) {
  try {
    await matchAudioFinished;
  } catch (_error) {
    // A missing or blocked fact clip should not prevent the game from finishing.
  }

  await wait(FINAL_AUDIO_GAP_MS);
  return playWin();
}

async function loadImagesAndFacts() {
  const difficultyOptions = document.getElementById('difficulty-options');
  difficultyOptions.setAttribute('aria-busy', 'true');

  try {
    const response = await fetch('data/facts.json');
    if (!response.ok) throw new Error(`Fact data returned ${response.status}`);

    const data = await response.json();
    if (!Array.isArray(data) || data.length < DIFFICULTIES.at(-1).pairs) {
      throw new Error('Fact data does not contain enough card sets');
    }

    images = data;
    setupDifficultyOptions();
  } catch (error) {
    console.error('Error loading images and facts:', error);
    showLoadError();
  } finally {
    difficultyOptions.setAttribute('aria-busy', 'false');
  }
}

function showLoadError() {
  const difficultyOptions = document.getElementById('difficulty-options');
  const errorPanel = document.createElement('div');
  const errorTitle = document.createElement('strong');
  const errorMessage = document.createElement('span');
  const retryButton = document.createElement('button');

  errorPanel.className = 'load-error';
  errorTitle.textContent = 'The cards could not be loaded.';
  errorMessage.textContent = 'Check your connection, then try once more.';
  retryButton.type = 'button';
  retryButton.textContent = 'Try again';
  retryButton.addEventListener('click', loadImagesAndFacts, { once: true });
  errorPanel.append(errorTitle, errorMessage, retryButton);
  difficultyOptions.replaceChildren(errorPanel);
}

function setupDifficultyOptions() {
  const difficultyOptions = document.getElementById('difficulty-options');
  const fragment = document.createDocumentFragment();

  DIFFICULTIES.forEach((difficulty) => {
    const button = document.createElement('button');
    const levelNumber = document.createElement('span');
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    const board = document.createElement('small');
    const meta = document.createElement('span');

    button.type = 'button';
    button.className = 'difficulty-button';
    button.setAttribute(
      'aria-label',
      `Level ${difficulty.level}, ${difficulty.name}, ${difficulty.pairs} pairs`
    );

    levelNumber.className = 'level-number';
    levelNumber.textContent = String(difficulty.level).padStart(2, '0');

    copy.className = 'difficulty-copy';
    name.textContent = difficulty.name;
    board.textContent = difficulty.board;
    copy.append(name, board);

    meta.className = 'difficulty-meta';
    meta.innerHTML = `
      <span>${difficulty.pairs} pairs</span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14m-6-6 6 6-6 6"></path>
      </svg>
    `;

    button.append(levelNumber, copy, meta);
    button.addEventListener('click', () => startGame(difficulty));
    fragment.appendChild(button);
  });

  difficultyOptions.replaceChildren(fragment);
}

function startGame(difficulty) {
  currentDifficulty = typeof difficulty === 'number'
    ? DIFFICULTIES.find(option => option.pairs === difficulty)
    : difficulty;

  if (!currentDifficulty) return;

  roundId += 1;
  cancelRoundActivity();
  resetGameData();
  selectRandomImages();
  updateRoundHeader();
  createBoard();
  updateProgress();
  showGameScreen();
}

function cancelRoundActivity() {
  if (turnTimeout) {
    clearTimeout(turnTimeout);
    turnTimeout = null;
  }
  if (factTimeout) {
    clearTimeout(factTimeout);
    factTimeout = null;
  }

  stopActiveAudio();
  hideFact();
}

function resetGameData() {
  shuffledCards = [];
  firstCard = null;
  secondCard = null;
  lockBoard = false;
  matchesFound = 0;
  movesMade = 0;
}

function selectRandomImages() {
  const selectedImages = shuffle(images).slice(0, currentDifficulty.pairs);
  shuffledCards = createDistributedDeck(
    selectedImages,
    currentDifficulty.columnLayouts
  );
}

function updateRoundHeader() {
  document.getElementById('round-eyebrow').textContent =
    `Level ${currentDifficulty.level} · ${currentDifficulty.name}`;
  document.getElementById('round-title').textContent =
    `Find all ${currentDifficulty.pairs} pairs`;
  document.getElementById('pairs-count').textContent = currentDifficulty.pairs;
}

function createBoard() {
  const gameBoard = document.getElementById('game-board');
  const fragment = document.createDocumentFragment();

  gameBoard.className = `game-board layout-${currentDifficulty.level}`;
  gameBoard.setAttribute(
    'aria-label',
    `Level ${currentDifficulty.level} memory board with ${shuffledCards.length} cards`
  );

  shuffledCards.forEach((item, index) => {
    const card = document.createElement('button');
    const cardInner = document.createElement('span');
    const cardFront = document.createElement('span');
    const cardBack = document.createElement('span');
    const frontImage = document.createElement('img');
    const cardLabel = document.createElement('span');
    const cardGlyph = document.createElement('span');
    const glyphSpark = document.createElement('b');
    const displayName = formatCardName(item.name);

    card.type = 'button';
    card.className = 'memory-card';
    card.dataset.name = item.name;
    card.dataset.displayName = displayName;
    card.setAttribute('aria-label', `Card ${index + 1} of ${shuffledCards.length}, face down`);
    card.setAttribute('aria-pressed', 'false');

    cardInner.className = 'card-inner';
    cardFront.className = 'card-front';
    cardBack.className = 'card-back';

    frontImage.src = `images/${item.image}`;
    frontImage.alt = '';
    frontImage.draggable = false;
    cardLabel.className = 'card-label';
    cardLabel.textContent = displayName;
    cardFront.append(frontImage, cardLabel);

    cardGlyph.className = 'card-glyph';
    glyphSpark.textContent = '✦';
    cardGlyph.appendChild(glyphSpark);
    cardBack.appendChild(cardGlyph);

    cardInner.append(cardFront, cardBack);
    card.appendChild(cardInner);
    card.addEventListener('click', flipCard);
    fragment.appendChild(card);
  });

  gameBoard.replaceChildren(fragment);
}

function formatCardName(name) {
  return name
    .split(/[-_ ]+/)
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function flipCard(event) {
  const card = event.currentTarget;
  if (lockBoard || card === firstCard || card.disabled) return;

  revealCard(card);

  if (!firstCard) {
    firstCard = card;
    return;
  }

  secondCard = card;
  lockBoard = true;
  movesMade += 1;
  updateProgress();
  checkForMatch();
}

function revealCard(card) {
  card.classList.add('is-flipped');
  card.setAttribute('aria-pressed', 'true');
  card.setAttribute('aria-label', `${card.dataset.displayName}, face up`);
}

function concealCard(card) {
  card.classList.remove('is-flipped');
  card.setAttribute('aria-pressed', 'false');
  const cardIndex = [...card.parentElement.children].indexOf(card);
  card.setAttribute(
    'aria-label',
    `Card ${cardIndex + 1} of ${shuffledCards.length}, face down`
  );
}

function checkForMatch() {
  const isMatch = firstCard.dataset.name === secondCard.dataset.name;
  if (isMatch) {
    keepMatchedCards();
  } else {
    unflipCards();
  }
}

function keepMatchedCards() {
  const matchedCards = [firstCard, secondCard];
  const matchedName = firstCard.dataset.name;

  matchedCards.forEach((card) => {
    card.classList.add('is-matched');
    card.disabled = true;
    card.setAttribute('aria-label', `${card.dataset.displayName}, matched`);
  });

  matchesFound += 1;
  updateProgress();
  const factAudioFinished = playRandomFactAndAudio(matchedName);
  const isFinalMatch = matchesFound === currentDifficulty.pairs;
  const completedRoundId = roundId;

  resetBoard(isFinalMatch);

  if (isFinalMatch) {
    runCompletionSequence(factAudioFinished, delay, () => {
      if (completedRoundId !== roundId) return false;
      return playWinningMessage();
    });
  }
}

function unflipCards() {
  const unmatchedCards = [firstCard, secondCard];
  const activeRoundId = roundId;

  turnTimeout = setTimeout(() => {
    turnTimeout = null;
    if (activeRoundId !== roundId) return;

    unmatchedCards.forEach(concealCard);
    resetBoard(false);
  }, MISMATCH_DELAY_MS);
}

function resetBoard(keepLocked) {
  firstCard = null;
  secondCard = null;
  lockBoard = keepLocked;
}

function updateProgress() {
  document.getElementById('moves-count').textContent = movesMade;
  document.getElementById('matches-count').textContent = matchesFound;
  document.getElementById('board-progress-bar').style.width =
    `${(matchesFound / currentDifficulty.pairs) * 100}%`;
}

function playRandomFactAndAudio(imageName) {
  const imageData = images.find(item => item.name === imageName);
  if (!imageData || !imageData.facts.length || !imageData.audioFiles.length) {
    return Promise.resolve(false);
  }

  const availableFacts = Math.min(imageData.facts.length, imageData.audioFiles.length);
  const randomIndex = Math.floor(Math.random() * availableFacts);
  displayFact(imageData.facts[randomIndex]);
  return playAudio(`audio/${imageData.audioFiles[randomIndex]}`);
}

function displayFact(fact) {
  const factDisplay = document.getElementById('fact-display');
  document.getElementById('fact-text').textContent = fact;
  factDisplay.hidden = false;

  if (factTimeout) clearTimeout(factTimeout);
  factTimeout = setTimeout(() => {
    factTimeout = null;
    hideFact();
  }, FACT_VISIBLE_MS);
}

function hideFact() {
  const factDisplay = typeof document === 'undefined'
    ? null
    : document.getElementById('fact-display');
  if (factDisplay) factDisplay.hidden = true;
}

function stopActiveAudio() {
  if (!activeAudioPlayback) return;

  const playback = activeAudioPlayback;
  playback.audio.pause();
  playback.finish(false);
  playback.audio.removeAttribute('src');
  playback.audio.load();
}

function playAudio(audioSrc) {
  const audio = document.getElementById('game-audio');
  if (!audio) return Promise.resolve(false);

  stopActiveAudio();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (playedToEnd) => {
      if (settled) return;
      settled = true;
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      if (activeAudioPlayback && activeAudioPlayback.finish === finish) {
        activeAudioPlayback = null;
      }
      resolve(playedToEnd);
    };
    const handleEnded = () => finish(true);
    const handleError = () => finish(false);

    audio.addEventListener('ended', handleEnded, { once: true });
    audio.addEventListener('error', handleError, { once: true });
    activeAudioPlayback = { audio, finish };
    audio.src = audioSrc;
    audio.currentTime = 0;

    try {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => finish(false));
      }
    } catch (_error) {
      finish(false);
    }
  });
}

function playWinningMessage() {
  const messages = [
    'Great job!',
    'You did it!',
    'Fantastic memory!',
    'Excellent work!',
    'You’re amazing!',
  ];
  const randomIndex = Math.floor(Math.random() * messages.length);

  displayWinningMessage(messages[randomIndex]);
  return playAudio(`audio/win-${randomIndex + 1}.mp3`);
}

function displayWinningMessage(message) {
  hideFact();
  document.getElementById('winning-text').textContent = message;
  document.getElementById('final-moves-count').textContent = movesMade;
  document.getElementById('final-pairs-count').textContent = matchesFound;

  const winningMessage = document.getElementById('winning-message');
  winningMessage.hidden = false;
  document.body.classList.add('has-modal');
  window.requestAnimationFrame(() => {
    document.getElementById('play-again-button').focus();
  });
}

function showGameScreen() {
  document.body.classList.remove('has-modal');
  document.getElementById('difficulty-screen').hidden = true;
  document.getElementById('game-screen').hidden = false;
  document.getElementById('winning-message').hidden = true;
}

function showDifficultyScreen() {
  roundId += 1;
  cancelRoundActivity();
  document.body.classList.remove('has-modal');
  document.getElementById('difficulty-screen').hidden = false;
  document.getElementById('game-screen').hidden = true;
  document.getElementById('winning-message').hidden = true;
  document.querySelector('.difficulty-button')?.focus();
}

function initializeGame() {
  document.getElementById('change-level-button').addEventListener('click', showDifficultyScreen);
  document.getElementById('winning-change-level-button').addEventListener('click', showDifficultyScreen);
  document.getElementById('play-again-button').addEventListener('click', () => {
    startGame(currentDifficulty);
  });
  loadImagesAndFacts();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initializeGame);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIFFICULTIES,
    FINAL_AUDIO_GAP_MS,
    createDistributedDeck,
    measureDeckDistribution,
    runCompletionSequence,
    shuffle,
  };
}
