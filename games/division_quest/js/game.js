(() => {
  'use strict';

  const AUDIO_BASE = 'assets/audio';
  const TRAINING_LENGTH = 6;

  const METHODS = {
    share: {
      label: 'Share fairly',
      lessonTitle: 'Share fairly',
      caption: 'Give one star-seed to each lantern, again and again.',
      hintClip: 'hint-share',
    },
    groups: {
      label: 'Make groups',
      lessonTitle: 'Make equal groups',
      caption: 'Choose a group size, then count how many groups you can make.',
      hintClip: 'hint-groups',
    },
    hops: {
      label: 'Hop to zero',
      lessonTitle: 'Take equal hops',
      caption: 'Count equal steps along a number path.',
      hintClip: 'hint-hops',
    },
    family: {
      label: 'Fact family',
      lessonTitle: 'Connect multiplication',
      caption: 'Use a multiplication fact you already know.',
      hintClip: 'hint-family',
    },
  };

  const LESSONS = [
    {
      id: 'share',
      narration: 'lesson-share',
      dividend: 12,
      divisor: 3,
      quotient: 4,
    },
    {
      id: 'groups',
      narration: 'lesson-groups',
      dividend: 12,
      divisor: 4,
      quotient: 3,
    },
    {
      id: 'hops',
      narration: 'lesson-hops',
      dividend: 12,
      divisor: 3,
      quotient: 4,
    },
    {
      id: 'family',
      narration: 'lesson-family',
      dividend: 12,
      divisor: 3,
      quotient: 4,
    },
  ];

  const TRAINING_PROBLEMS = [
    { dividend: 6, divisor: 2, quotient: 3, method: 'share' },
    { dividend: 8, divisor: 2, quotient: 4, method: 'groups' },
    { dividend: 10, divisor: 5, quotient: 2, method: 'share' },
    { dividend: 12, divisor: 3, quotient: 4, method: 'hops' },
    { dividend: 15, divisor: 5, quotient: 3, method: 'groups' },
    { dividend: 18, divisor: 3, quotient: 6, method: 'family' },
  ];

  const LEVELS = [
    {
      name: 'First Lights',
      threshold: 0,
      divisors: [2, 3],
      quotientMin: 1,
      quotientMax: 5,
      methods: ['share', 'groups'],
    },
    {
      name: 'Garden Glow',
      threshold: 6,
      divisors: [2, 3, 4, 5],
      quotientMin: 1,
      quotientMax: 7,
      methods: ['share', 'groups', 'hops'],
    },
    {
      name: 'Moon Bridge',
      threshold: 18,
      divisors: [2, 3, 4, 5, 6, 7],
      quotientMin: 2,
      quotientMax: 9,
      methods: ['share', 'groups', 'hops', 'family'],
    },
    {
      name: 'Star Keeper',
      threshold: 36,
      divisors: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      quotientMin: 2,
      quotientMax: 10,
      methods: ['share', 'groups', 'hops', 'family'],
    },
  ];

  const elements = {
    shell: document.getElementById('gameShell'),
    introScreen: document.getElementById('introScreen'),
    lessonScreen: document.getElementById('lessonScreen'),
    challengeScreen: document.getElementById('challengeScreen'),
    startButton: document.getElementById('startButton'),
    soundButton: document.getElementById('soundButton'),
    replayButton: document.getElementById('replayButton'),
    lessonGuideButton: document.getElementById('lessonGuideButton'),
    hintGuideButton: document.getElementById('hintGuideButton'),
    lessonPath: document.getElementById('lessonPath'),
    lessonMethod: document.getElementById('lessonMethod'),
    lessonTitle: document.getElementById('lessonTitle'),
    lessonCaption: document.getElementById('lessonCaption'),
    lessonEquation: document.getElementById('lessonEquation'),
    lessonVisual: document.getElementById('lessonVisual'),
    lessonVoiceCaption: document.getElementById('lessonVoiceCaption'),
    nextLessonButton: document.getElementById('nextLessonButton'),
    nextLessonLabel: document.getElementById('nextLessonLabel'),
    challengeCard: document.getElementById('challengeCard'),
    challengeMethod: document.getElementById('challengeMethod'),
    challengeTitle: document.getElementById('challengeTitle'),
    levelChip: document.getElementById('levelChip'),
    problemEquation: document.getElementById('problemEquation'),
    problemCaption: document.getElementById('problemCaption'),
    problemVisual: document.getElementById('problemVisual'),
    answerGrid: document.getElementById('answerGrid'),
    hearProblemButton: document.getElementById('hearProblemButton'),
    hintButton: document.getElementById('hintButton'),
    streakValue: document.getElementById('streakValue'),
    miniLanterns: Array.from(document.querySelectorAll('#miniLanterns i')),
    progressLabel: document.getElementById('progressLabel'),
    feedbackToast: document.getElementById('feedbackToast'),
    sparkleLayer: document.getElementById('sparkleLayer'),
    celebration: document.getElementById('celebration'),
    endlessButton: document.getElementById('endlessButton'),
    statusAnnouncer: document.getElementById('statusAnnouncer'),
    moteField: document.getElementById('moteField'),
    voiceAudio: document.getElementById('voiceAudio'),
  };

  const state = {
    phase: 'intro',
    lessonIndex: 0,
    practiceIndex: 0,
    endlessCorrect: 0,
    totalCorrect: 0,
    streak: 0,
    bestStreak: 0,
    currentProblem: null,
    currentChoices: [],
    answerLocked: false,
    hintShown: false,
    soundEnabled: true,
    replayAction: null,
    recentProblemKeys: [],
    voiceRun: 0,
    toastTimer: null,
    audioContext: null,
  };

  function showScreen(activeScreen) {
    [elements.introScreen, elements.lessonScreen, elements.challengeScreen].forEach((screen) => {
      const active = screen === activeScreen;
      screen.hidden = !active;
      screen.classList.toggle('is-active', active);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function announce(message) {
    elements.statusAnnouncer.textContent = '';
    window.setTimeout(() => {
      elements.statusAnnouncer.textContent = message;
    }, 30);
  }

  function setSpeaking(speaking) {
    elements.shell.classList.toggle('is-speaking', speaking);
  }

  function stopVoice() {
    state.voiceRun += 1;
    elements.voiceAudio.pause();
    elements.voiceAudio.removeAttribute('src');
    elements.voiceAudio.load();
    setSpeaking(false);
  }

  function playVoice(clipIds, onComplete) {
    state.voiceRun += 1;
    const run = state.voiceRun;
    elements.voiceAudio.pause();

    if (!state.soundEnabled || !clipIds.length) {
      setSpeaking(false);
      window.setTimeout(() => onComplete?.(), 0);
      return;
    }

    let clipIndex = 0;
    setSpeaking(true);

    const finish = () => {
      if (run !== state.voiceRun) return;
      setSpeaking(false);
      elements.voiceAudio.onended = null;
      elements.voiceAudio.onerror = null;
      onComplete?.();
    };

    const playNext = () => {
      if (run !== state.voiceRun) return;
      if (clipIndex >= clipIds.length) {
        finish();
        return;
      }

      const clipId = clipIds[clipIndex];
      clipIndex += 1;
      let advanced = false;

      const advance = () => {
        if (advanced || run !== state.voiceRun) return;
        advanced = true;
        playNext();
      };

      elements.voiceAudio.onended = advance;
      elements.voiceAudio.onerror = advance;
      elements.voiceAudio.src = `${AUDIO_BASE}/${clipId}.mp3`;
      elements.voiceAudio.load();

      const playPromise = elements.voiceAudio.play();
      if (playPromise) {
        playPromise.catch(advance);
      }
    };

    playNext();
  }

  function ensureAudioContext() {
    if (state.audioContext) {
      if (state.audioContext.state === 'suspended') {
        state.audioContext.resume().catch(() => {});
      }
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    try {
      state.audioContext = new AudioContext();
    } catch {
      state.audioContext = null;
    }
  }

  function playTone(kind) {
    if (!state.soundEnabled) return;
    ensureAudioContext();
    const context = state.audioContext;
    if (!context) return;

    const now = context.currentTime;
    const notes = kind === 'correct'
      ? [523.25, 659.25, 783.99]
      : [246.94, 220];

    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * (kind === 'correct' ? 0.08 : 0.1);
      const duration = kind === 'correct' ? 0.28 : 0.2;

      oscillator.type = kind === 'correct' ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(kind === 'correct' ? 0.12 : 0.06, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    });
  }

  function setReplayAction(action) {
    state.replayAction = action;
    elements.replayButton.disabled = !action;
  }

  function createMotes() {
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < 24; index += 1) {
      const mote = document.createElement('i');
      mote.className = 'mote';
      mote.style.left = `${3 + Math.random() * 94}%`;
      mote.style.setProperty('--size', `${3 + Math.random() * 5}px`);
      mote.style.setProperty('--duration', `${9 + Math.random() * 10}s`);
      mote.style.setProperty('--delay', `${-Math.random() * 18}s`);
      mote.style.setProperty('--drift', `${-45 + Math.random() * 90}px`);
      fragment.appendChild(mote);
    }

    elements.moteField.appendChild(fragment);
  }

  function startAdventure() {
    if (state.phase !== 'intro') return;

    ensureAudioContext();
    state.phase = 'lesson';
    state.lessonIndex = 0;
    elements.shell.dataset.phase = 'lesson';
    showScreen(elements.lessonScreen);
    renderLesson(0, true);
  }

  function updateLessonPath(index) {
    Array.from(elements.lessonPath.children).forEach((step, stepIndex) => {
      step.classList.toggle('is-current', stepIndex === index);
      step.classList.toggle('is-complete', stepIndex < index);
    });
  }

  function renderLesson(index, includeWelcome = false) {
    const lesson = LESSONS[index];
    const method = METHODS[lesson.id];
    state.lessonIndex = index;
    elements.lessonMethod.innerHTML = `<span aria-hidden="true">●</span> Way ${index + 1} of ${LESSONS.length}`;
    elements.lessonTitle.textContent = method.lessonTitle;
    elements.lessonCaption.textContent = method.caption;
    elements.lessonEquation.innerHTML = `<b>${lesson.dividend}</b><span>÷</span><b>${lesson.divisor}</b><span>=</span><em>${lesson.quotient}</em>`;
    elements.lessonEquation.setAttribute(
      'aria-label',
      `${lesson.dividend} divided by ${lesson.divisor} equals ${lesson.quotient}`,
    );
    elements.nextLessonLabel.textContent = index === LESSONS.length - 1 ? 'Try it yourself' : 'Next idea';
    updateLessonPath(index);
    updateProgress();
    renderVisual(elements.lessonVisual, lesson, true);
    narrateLesson(includeWelcome);
  }

  function narrateLesson(includeWelcome = false) {
    const lesson = LESSONS[state.lessonIndex];
    elements.nextLessonButton.disabled = true;
    elements.nextLessonButton.classList.remove('is-ready');
    elements.lessonVoiceCaption.lastElementChild.textContent = 'Lumi is showing this division idea aloud.';

    const clips = includeWelcome ? ['welcome', lesson.narration] : [lesson.narration];
    setReplayAction(() => narrateLesson(false));
    playVoice(clips, unlockLessonContinue);
  }

  function unlockLessonContinue() {
    if (state.phase !== 'lesson') return;
    elements.nextLessonButton.disabled = false;
    elements.nextLessonButton.classList.add('is-ready');
    elements.lessonVoiceCaption.lastElementChild.textContent = 'Tap the glowing arrow when you are ready.';
    announce('The next button is ready.');
  }

  function nextLesson() {
    if (elements.nextLessonButton.disabled || state.phase !== 'lesson') return;
    stopVoice();

    if (state.lessonIndex < LESSONS.length - 1) {
      renderLesson(state.lessonIndex + 1);
      return;
    }

    beginPractice();
  }

  function beginPractice() {
    state.phase = 'practice';
    state.practiceIndex = 0;
    state.streak = 0;
    elements.shell.dataset.phase = 'practice';
    showScreen(elements.challengeScreen);
    renderProblem(TRAINING_PROBLEMS[0], false);
    updateProgress();
    playVoice(['practice-ready'], () => {
      if (state.phase === 'practice' && state.practiceIndex === 0) {
        speakCurrentProblem();
      }
    });
  }

  function renderProblem(problem, speak = true) {
    state.currentProblem = { ...problem };
    state.answerLocked = false;
    state.hintShown = false;
    elements.hearProblemButton.disabled = false;
    elements.hintButton.disabled = false;
    elements.hintGuideButton.disabled = false;
    const method = METHODS[problem.method];
    const level = getCurrentLevel();

    elements.challengeMethod.innerHTML = `<span aria-hidden="true">●</span> ${method.label}`;
    elements.challengeTitle.textContent = state.phase === 'endless'
      ? 'Grow the endless garden'
      : `Light lantern ${state.practiceIndex + 1} of ${TRAINING_LENGTH}`;
    elements.levelChip.querySelector('span').textContent = state.phase === 'endless'
      ? level.name
      : 'Guided practice';
    elements.problemEquation.innerHTML = `<strong>${problem.dividend}</strong><span>÷</span><strong>${problem.divisor}</strong><span>=</span><em>?</em>`;
    elements.problemEquation.setAttribute(
      'aria-label',
      `${problem.dividend} divided by ${problem.divisor}. Choose the answer.`,
    );
    elements.problemCaption.textContent = getProblemCaption(problem);
    renderVisual(elements.problemVisual, problem, false);
    renderAnswers(problem);
    updateProgress();
    updateStreak();
    setReplayAction(speakCurrentProblem);

    if (speak) {
      window.setTimeout(speakCurrentProblem, 260);
    }
  }

  function speakCurrentProblem() {
    if (state.answerLocked || !state.currentProblem || !['practice', 'endless'].includes(state.phase)) return;
    playVoice(getProblemClips(state.currentProblem));
  }

  function getProblemClips(problem) {
    const number = (value) => `number-${value}`;

    if (problem.method === 'share') {
      return [
        'prompt-share-start',
        number(problem.dividend),
        'prompt-share-middle',
        number(problem.divisor),
        'prompt-share-end',
      ];
    }

    if (problem.method === 'groups') {
      return [
        'prompt-groups-start',
        number(problem.dividend),
        'prompt-groups-middle',
        number(problem.divisor),
        'prompt-groups-end',
      ];
    }

    if (problem.method === 'hops') {
      return [
        'prompt-hops-start',
        number(problem.dividend),
        'prompt-hops-middle',
        number(problem.divisor),
        'prompt-hops-end',
      ];
    }

    return [
      'prompt-family-start',
      number(problem.divisor),
      'prompt-family-middle',
      number(problem.dividend),
      'prompt-family-end',
    ];
  }

  function getProblemCaption(problem) {
    if (problem.method === 'share') {
      return `Share ${problem.dividend} star-seeds equally among ${problem.divisor} lanterns. How many go in each lantern?`;
    }

    if (problem.method === 'groups') {
      return `Use ${problem.dividend} star-seeds. Make groups of ${problem.divisor}. How many equal groups can you make?`;
    }

    if (problem.method === 'hops') {
      return `Start at ${problem.dividend} and hop back by ${problem.divisor}. How many equal hops reach zero?`;
    }

    return `${problem.divisor} times what number makes ${problem.dividend}?`;
  }

  function renderVisual(container, problem, lessonMode) {
    container.classList.remove('is-hinting');
    container.dataset.method = problem.method || problem.id;
    const method = problem.method || problem.id;

    if (method === 'share') {
      renderSharing(container, problem, lessonMode);
      return;
    }

    if (method === 'groups') {
      renderGrouping(container, problem, lessonMode);
      return;
    }

    if (method === 'hops') {
      renderHops(container, problem, lessonMode);
      return;
    }

    renderFactFamily(container, problem, lessonMode);
  }

  function makeSeeds(count, delayForSeed) {
    return Array.from({ length: count }, (_, index) => (
      `<i class="seed" aria-hidden="true" style="--delay: ${delayForSeed(index)}ms"></i>`
    )).join('');
  }

  function renderSharing(container, problem, lessonMode) {
    const groups = problem.divisor;
    const inEachGroup = problem.quotient;
    const groupMarkup = Array.from({ length: groups }, (_, groupIndex) => {
      const seeds = makeSeeds(inEachGroup, (seedIndex) => ((seedIndex * groups) + groupIndex) * 135);
      const count = lessonMode
        ? `${inEachGroup}`
        : `<span data-reveal="${inEachGroup}">?</span>`;

      return `
        <div class="equal-group">
          <div class="seed-bed">${seeds}</div>
          <span class="group-count">${count}</span>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div class="seed-model share-model" style="--columns: ${groups}">
        ${groupMarkup}
      </div>
      <span class="model-label">${groups} equal lanterns</span>`;
    container.setAttribute(
      'aria-label',
      `${problem.dividend} glowing star-seeds shared into ${groups} equal lanterns`,
    );
  }

  function renderGrouping(container, problem, lessonMode) {
    const numberOfGroups = problem.quotient;
    const groupSize = problem.divisor;
    const groupMarkup = Array.from({ length: numberOfGroups }, (_, groupIndex) => {
      const seeds = makeSeeds(groupSize, (seedIndex) => ((groupIndex * groupSize) + seedIndex) * 100);
      return `
        <div class="equal-group">
          <div class="seed-bed">${seeds}</div>
          <span class="group-count">${groupSize}</span>
        </div>`;
    }).join('');
    const label = lessonMode
      ? `${numberOfGroups} equal groups`
      : `<span data-reveal="${numberOfGroups} equal groups">Count the groups</span>`;

    container.innerHTML = `
      <div class="seed-model groups-model" style="--columns: ${Math.min(numberOfGroups, 6)}">
        ${groupMarkup}
      </div>
      <span class="model-label">${label}</span>`;
    container.setAttribute(
      'aria-label',
      `${problem.dividend} glowing star-seeds arranged in equal groups of ${groupSize}`,
    );
  }

  function renderHops(container, problem, lessonMode) {
    const values = Array.from(
      { length: problem.quotient + 1 },
      (_, index) => problem.dividend - (index * problem.divisor),
    );
    const points = values.map((value, index) => `
      <span class="hop-point">
        <i class="hop-arc" aria-hidden="true" style="--delay: ${index * 230}ms"></i>
        <b class="hop-value">${value}</b>
      </span>`).join('');
    const count = lessonMode
      ? `${problem.quotient}`
      : `<strong data-reveal="${problem.quotient}">?</strong>`;

    container.innerHTML = `
      <div class="hops-model">
        <div class="hop-track">${points}</div>
        <div class="hop-count"><span>Equal hops</span>${lessonMode ? `<strong>${count}</strong>` : count}</div>
      </div>`;
    container.setAttribute(
      'aria-label',
      `A number path from ${problem.dividend} down to zero in equal backward hops of ${problem.divisor}`,
    );
  }

  function renderFactFamily(container, problem, lessonMode) {
    const quotient = lessonMode
      ? `${problem.quotient}`
      : `<span data-reveal="${problem.quotient}">?</span>`;

    container.innerHTML = `
      <div class="fact-model">
        <div class="fact-triangle">
          <b class="fact-node total">${problem.dividend}</b>
          <b class="fact-node factor-one">${problem.divisor}</b>
          <b class="fact-node factor-two ${lessonMode ? '' : 'question'}">${quotient}</b>
        </div>
        <div class="fact-equations">
          <span>${problem.divisor} × ${lessonMode ? problem.quotient : '?'} = ${problem.dividend}</span>
          <span>${problem.dividend} ÷ ${problem.divisor} = ${lessonMode ? problem.quotient : '?'}</span>
        </div>
      </div>`;
    container.setAttribute(
      'aria-label',
      `A fact family triangle connecting ${problem.dividend}, ${problem.divisor}, and the missing answer`,
    );
  }

  function makeChoices(problem) {
    const answer = problem.quotient;
    const options = new Set([answer]);
    const preferred = [
      answer - 1,
      answer + 1,
      answer + 2,
      answer - 2,
      problem.divisor,
      Math.max(1, Math.round(problem.dividend / Math.max(1, problem.divisor - 1))),
    ];

    preferred.forEach((candidate) => {
      if (options.size < 3 && candidate >= 1 && candidate <= 10) {
        options.add(candidate);
      }
    });

    while (options.size < 3) {
      options.add(1 + Math.floor(Math.random() * 10));
    }

    return shuffle(Array.from(options));
  }

  function shuffle(values) {
    const copy = [...values];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
  }

  function renderAnswers(problem) {
    state.currentChoices = makeChoices(problem);
    elements.answerGrid.innerHTML = '';

    state.currentChoices.forEach((choice, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-button';
      button.dataset.answer = `${choice}`;
      button.dataset.key = `${index + 1}`;
      button.setAttribute('aria-label', `Answer ${choice}. Choice ${index + 1}.`);
      button.textContent = `${choice}`;
      elements.answerGrid.appendChild(button);
    });
  }

  function chooseAnswer(button) {
    if (state.answerLocked || !state.currentProblem || button.disabled) return;
    const chosen = Number(button.dataset.answer);

    if (chosen === state.currentProblem.quotient) {
      handleCorrectAnswer(button);
      return;
    }

    handleWrongAnswer(button);
  }

  function handleCorrectAnswer(button) {
    state.answerLocked = true;
    stopVoice();
    elements.replayButton.disabled = true;
    elements.hearProblemButton.disabled = true;
    elements.hintButton.disabled = true;
    elements.hintGuideButton.disabled = true;
    button.classList.add('is-correct');
    Array.from(elements.answerGrid.children).forEach((answerButton) => {
      answerButton.disabled = true;
    });

    const oldLevelIndex = getLevelIndex(state.endlessCorrect);
    state.totalCorrect += 1;
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);

    if (state.phase === 'practice') {
      state.practiceIndex += 1;
    } else {
      state.endlessCorrect += 1;
    }

    const newLevelIndex = getLevelIndex(state.endlessCorrect);
    const feedbackClips = [`correct-${((state.totalCorrect - 1) % 3) + 1}`];

    if (state.streak === 3) {
      feedbackClips.push('streak-3');
    } else if (state.phase === 'endless' && state.endlessCorrect > 0 && state.endlessCorrect % 5 === 0) {
      feedbackClips.push('lantern-milestone');
    }

    if (state.phase === 'endless' && newLevelIndex > oldLevelIndex) {
      feedbackClips.push('level-up');
    }

    playTone('correct');
    createSparkles(button);
    showToast(`Wonderful! ${state.currentProblem.dividend} ÷ ${state.currentProblem.divisor} = ${state.currentProblem.quotient}`, 'success');
    announce(`Correct. The answer is ${state.currentProblem.quotient}.`);
    updateStreak();
    updateProgress();

    playVoice(feedbackClips, () => {
      window.setTimeout(advanceAfterCorrect, state.soundEnabled ? 260 : 850);
    });
  }

  function handleWrongAnswer(button) {
    stopVoice();
    state.streak = 0;
    button.classList.add('is-wrong');
    button.disabled = true;
    updateStreak();
    revealHint(false);
    playTone('try-again');
    showToast('Almost! Watch the lights, then try again.', 'try-again');
    announce('Not yet. Lumi is showing a hint. Try another answer.');
    playVoice(['retry', METHODS[state.currentProblem.method].hintClip]);
  }

  function advanceAfterCorrect() {
    if (!state.answerLocked) return;
    state.answerLocked = false;
    hideToast();

    if (state.phase === 'practice') {
      if (state.practiceIndex >= TRAINING_PROBLEMS.length) {
        showCelebration();
        return;
      }

      renderProblem(TRAINING_PROBLEMS[state.practiceIndex]);
      return;
    }

    if (state.phase === 'endless') {
      renderProblem(generateEndlessProblem());
    }
  }

  function revealHint(speak = true) {
    if (state.answerLocked || !state.currentProblem) return;
    state.hintShown = true;
    elements.problemVisual.classList.add('is-hinting');
    elements.problemVisual.querySelectorAll('[data-reveal]').forEach((item) => {
      item.textContent = item.dataset.reveal;
    });

    if (speak) {
      stopVoice();
      showToast('Lumi is showing the strategy.', 'try-again');
      announce('Hint shown. The picture now reveals the counting step.');
      playVoice([METHODS[state.currentProblem.method].hintClip]);
    }
  }

  function showCelebration() {
    stopVoice();
    state.phase = 'celebration';
    elements.shell.dataset.phase = 'celebration';
    elements.celebration.hidden = false;
    updateProgress();
    setReplayAction(() => playVoice(['endless-unlocked']));
    playVoice(['endless-unlocked'], () => {
      elements.endlessButton.focus({ preventScroll: true });
    });
    announce('All six training lanterns are glowing. Endless practice is unlocked.');
  }

  function enterEndlessMode() {
    stopVoice();
    state.phase = 'endless';
    state.endlessCorrect = 0;
    state.recentProblemKeys = [];
    elements.shell.dataset.phase = 'endless';
    elements.celebration.hidden = true;
    renderProblem(generateEndlessProblem());
  }

  function getLevelIndex(correctCount) {
    let selected = 0;
    LEVELS.forEach((level, index) => {
      if (correctCount >= level.threshold) selected = index;
    });
    return selected;
  }

  function getCurrentLevel() {
    return LEVELS[getLevelIndex(state.endlessCorrect)];
  }

  function randomFrom(values) {
    return values[Math.floor(Math.random() * values.length)];
  }

  function randomInteger(minimum, maximum) {
    return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
  }

  function generateEndlessProblem() {
    const level = getCurrentLevel();
    let problem;
    let key;
    let attempts = 0;

    do {
      const divisor = randomFrom(level.divisors);
      const quotient = randomInteger(level.quotientMin, level.quotientMax);
      problem = {
        dividend: divisor * quotient,
        divisor,
        quotient,
        method: randomFrom(level.methods),
      };
      key = `${problem.dividend}/${problem.divisor}/${problem.method}`;
      attempts += 1;
    } while (state.recentProblemKeys.includes(key) && attempts < 20);

    state.recentProblemKeys.push(key);
    if (state.recentProblemKeys.length > 6) {
      state.recentProblemKeys.shift();
    }

    return problem;
  }

  function updateProgress() {
    let litCount = 0;

    if (state.phase === 'lesson') {
      litCount = state.lessonIndex;
      elements.progressLabel.textContent = `Idea ${state.lessonIndex + 1} / 4`;
    } else if (state.phase === 'practice') {
      litCount = state.practiceIndex;
      elements.progressLabel.textContent = `${state.practiceIndex} / ${TRAINING_LENGTH}`;
    } else if (['celebration', 'endless'].includes(state.phase)) {
      litCount = state.phase === 'celebration'
        ? TRAINING_LENGTH
        : (state.endlessCorrect === 0 ? 0 : ((state.endlessCorrect - 1) % TRAINING_LENGTH) + 1);
      elements.progressLabel.textContent = state.phase === 'endless'
        ? `${state.endlessCorrect} · ∞`
        : 'Garden awake';
    }

    elements.miniLanterns.forEach((lantern, index) => {
      lantern.classList.toggle('is-lit', index < litCount);
    });
  }

  function updateStreak() {
    elements.streakValue.textContent = `${state.streak}`;
  }

  function showToast(message, kind) {
    window.clearTimeout(state.toastTimer);
    elements.feedbackToast.textContent = message;
    elements.feedbackToast.className = `feedback-toast is-visible is-${kind}`;
    state.toastTimer = window.setTimeout(hideToast, 4200);
  }

  function hideToast() {
    window.clearTimeout(state.toastTimer);
    elements.feedbackToast.className = 'feedback-toast';
  }

  function createSparkles(origin) {
    const bounds = origin.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const colors = ['#ffc247', '#ff6a1f', '#17c696', '#19e3e3', '#fff4b0'];

    for (let index = 0; index < 22; index += 1) {
      const sparkle = document.createElement('i');
      const angle = (Math.PI * 2 * index) / 22 + (Math.random() - 0.5) * 0.32;
      const distance = 65 + Math.random() * 145;
      sparkle.className = 'sparkle';
      sparkle.style.left = `${centerX}px`;
      sparkle.style.top = `${centerY}px`;
      sparkle.style.setProperty('--spark-size', `${5 + Math.random() * 8}px`);
      sparkle.style.setProperty('--spark-color', randomFrom(colors));
      sparkle.style.setProperty('--spark-x', `${Math.cos(angle) * distance}px`);
      sparkle.style.setProperty('--spark-y', `${Math.sin(angle) * distance}px`);
      elements.sparkleLayer.appendChild(sparkle);
      window.setTimeout(() => sparkle.remove(), 950);
    }
  }

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    elements.soundButton.setAttribute('aria-pressed', `${state.soundEnabled}`);
    elements.soundButton.setAttribute(
      'aria-label',
      state.soundEnabled ? 'Turn voice and sound off' : 'Turn voice and sound on',
    );

    if (!state.soundEnabled) {
      stopVoice();
      if (state.phase === 'lesson') unlockLessonContinue();
      if (state.answerLocked && ['practice', 'endless'].includes(state.phase)) {
        window.setTimeout(advanceAfterCorrect, 650);
      }
      announce('Voice and sound are off.');
      return;
    }

    ensureAudioContext();
    announce('Voice and sound are on.');
    state.replayAction?.();
  }

  function handleKeydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (['practice', 'endless'].includes(state.phase)) {
      if (['1', '2', '3'].includes(event.key)) {
        const button = elements.answerGrid.children[Number(event.key) - 1];
        if (button) {
          event.preventDefault();
          chooseAnswer(button);
        }
      } else if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        revealHint(true);
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        speakCurrentProblem();
      }
    }
  }

  elements.startButton.addEventListener('click', startAdventure);
  elements.nextLessonButton.addEventListener('click', nextLesson);
  elements.lessonGuideButton.addEventListener('click', () => narrateLesson(false));
  elements.soundButton.addEventListener('click', toggleSound);
  elements.replayButton.addEventListener('click', () => state.replayAction?.());
  elements.hearProblemButton.addEventListener('click', speakCurrentProblem);
  elements.hintButton.addEventListener('click', () => revealHint(true));
  elements.hintGuideButton.addEventListener('click', () => revealHint(true));
  elements.endlessButton.addEventListener('click', enterEndlessMode);
  elements.answerGrid.addEventListener('click', (event) => {
    const button = event.target.closest('.answer-button');
    if (button) chooseAnswer(button);
  });
  document.addEventListener('keydown', handleKeydown);

  createMotes();
  updateProgress();
})();
