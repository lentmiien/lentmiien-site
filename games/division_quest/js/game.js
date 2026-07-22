(() => {
  'use strict';

  const AUDIO_BASE = 'assets/audio';
  const TRAINING_LENGTH = 6;

  const COPY = {
    en: {
      documentTitle: 'Divide & Shine · The Lantern Garden',
      metaDescription: 'A voice-guided division adventure for young learners, with animated models, gentle practice, and endless play.',
      skipLink: 'Skip to the learning game',
      backControlAria: 'Go back to all games',
      brandAria: 'Divide and Shine, The Lantern Garden',
      brandTitle: 'Divide & Shine',
      brandSubtitle: 'The Lantern Garden',
      gardenProgressAria: 'Garden lantern progress',
      replayAria: 'Hear the current guidance again',
      soundOffAria: 'Turn voice and sound off',
      soundOnAria: 'Turn voice and sound on',
      switchLanguageAria: 'Switch to Japanese',
      targetLanguageLabel: '日本語',
      introEyebrow: 'A voice-guided division adventure',
      introTitleHtml: '<span>Divide</span> &amp; Shine',
      introLede: 'Share the star-seeds fairly, discover four division tricks, and wake a garden of light.',
      introMethodsAria: 'Learn by sharing, grouping, hopping, and using fact families',
      methodShareShort: 'Share',
      methodGroupsShort: 'Group',
      methodHopsShort: 'Hop',
      methodFamilyShort: 'Connect',
      startAria: 'Start the voice-guided division adventure',
      startSmall: 'Tap to begin',
      startStrong: 'Start the adventure',
      headphoneNote: 'Every lesson and problem is spoken aloud.',
      guideMessage: 'Your garden guide',
      lessonGuideAria: 'Ask Lumi to repeat this lesson',
      lumiAlt: 'Lumi, the friendly lantern guide',
      lumiName: 'Lumi',
      guideRepeat: 'Tap me to hear it again',
      lessonPathAria: 'Four ways to divide',
      lessonStepShare: 'Sharing lesson',
      lessonStepGroups: 'Grouping lesson',
      lessonStepHops: 'Backward hops lesson',
      lessonStepFamily: 'Fact family lesson',
      hintGuideAria: 'Ask Lumi for a spoken and animated hint',
      needHint: 'Need a hint?',
      tapLumi: 'Tap Lumi',
      streakAria: 'Current answer streak',
      glowStreak: 'Glow streak',
      answerPrompt: 'Choose the answer',
      answerGridAria: 'Answer choices',
      hearAgain: 'Hear it again',
      showHint: 'Show a hint',
      keyboardNote: 'Keys 1–3 choose · H helps · R repeats',
      celebrationEyebrow: 'The garden is awake',
      celebrationTitle: 'You made every light shine!',
      celebrationBody: 'New division paths will keep growing for as long as you want to play.',
      endlessAria: 'Continue into endless division practice',
      endlessSmall: 'Endless garden',
      endlessStrong: 'Keep dividing',
      methodShareLabel: 'Share fairly',
      methodShareTitle: 'Share fairly',
      methodShareCaption: 'Give one star-seed to each lantern, again and again.',
      methodGroupsLabel: 'Make groups',
      methodGroupsTitle: 'Make equal groups',
      methodGroupsCaption: 'Choose a group size, then count how many groups you can make.',
      methodHopsLabel: 'Hop to zero',
      methodHopsTitle: 'Take equal hops',
      methodHopsCaption: 'Count equal steps along a number path.',
      methodFamilyLabel: 'Fact family',
      methodFamilyTitle: 'Connect multiplication',
      methodFamilyCaption: 'Use a multiplication fact you already know.',
      levelFirst: 'First Lights',
      levelGarden: 'Garden Glow',
      levelMoon: 'Moon Bridge',
      levelStar: 'Star Keeper',
      wayProgress: 'Way {current} of {total}',
      lessonEquationAria: '{dividend} divided by {divisor} equals {quotient}',
      nextIdea: 'Next idea',
      tryYourself: 'Try it yourself',
      lessonNextAria: 'Continue to the next division idea',
      lessonTryAria: 'Start the guided division practice',
      lessonSpeaking: 'Lumi is showing this division idea aloud.',
      lessonReady: 'Tap the glowing arrow when you are ready.',
      nextReadyAnnouncement: 'The next button is ready.',
      challengeEndlessTitle: 'Grow the endless garden',
      challengePracticeTitle: 'Light lantern {current} of {total}',
      guidedPractice: 'Guided practice',
      problemEquationAria: '{dividend} divided by {divisor}. Choose the answer.',
      shareProblemCaption: 'Share {dividend} star-seeds equally among {divisor} lanterns. How many go in each lantern?',
      groupsProblemCaption: 'Use {dividend} star-seeds. Make groups of {divisor}. How many equal groups can you make?',
      hopsProblemCaption: 'Start at {dividend} and hop back by {divisor}. How many equal hops reach zero?',
      familyProblemCaption: '{divisor} times what number makes {dividend}?',
      shareModelLabel: '{groups} equal lanterns',
      shareModelAria: '{dividend} glowing star-seeds shared into {groups} equal lanterns',
      groupsModelLabel: '{groups} equal groups',
      groupsModelPrompt: 'Count the groups',
      groupsModelAria: '{dividend} glowing star-seeds arranged in equal groups of {size}',
      hopsModelLabel: 'Equal hops',
      hopsModelAria: 'A number path from {dividend} down to zero in equal backward hops of {size}',
      familyModelAria: 'A fact family triangle connecting {dividend}, {divisor}, and the missing answer',
      answerChoiceAria: 'Answer {answer}. Choice {choice}.',
      successToast: 'Wonderful! {dividend} ÷ {divisor} = {quotient}',
      correctAnnouncement: 'Correct. The answer is {quotient}.',
      retryToast: 'Almost! Watch the lights, then try again.',
      retryAnnouncement: 'Not yet. Lumi is showing a hint. Try another answer.',
      hintToast: 'Lumi is showing the strategy.',
      hintAnnouncement: 'Hint shown. The picture now reveals the counting step.',
      celebrationAnnouncement: 'All six training lanterns are glowing. Endless practice is unlocked.',
      progressLearn: 'Learn',
      progressIdea: 'Idea {current} / {total}',
      progressGardenAwake: 'Garden awake',
      soundOffAnnouncement: 'Voice and sound are off.',
      soundOnAnnouncement: 'Voice and sound are on.',
    },
    ja: {
      documentTitle: 'わけて ひかろう・ランタンの庭',
      metaDescription: '絵と声でやさしく学べる、子ども向けのわり算アドベンチャー。練習のあとは何問でも遊べます。',
      skipLink: 'わり算ゲームへ移動',
      backControlAria: 'ゲーム一覧にもどる',
      brandAria: 'わけて ひかろう、ランタンの庭',
      brandTitle: 'わけて ひかろう',
      brandSubtitle: 'ランタンの庭',
      gardenProgressAria: '庭のランタンの進みぐあい',
      replayAria: 'いまの説明をもう一度聞く',
      soundOffAria: '声と音を消す',
      soundOnAria: '声と音を出す',
      switchLanguageAria: '英語に切り替える',
      targetLanguageLabel: 'EN',
      introEyebrow: '声で学べる わり算アドベンチャー',
      introTitleHtml: '<span>わけて</span> ひかろう',
      introLede: '星の種を同じ数ずつ分けて、4つのコツを見つけ、光の庭を目覚めさせよう。',
      introMethodsAria: '分ける、まとめる、ジャンプする、かけ算とつなぐ方法で学ぶ',
      methodShareShort: 'わける',
      methodGroupsShort: 'まとめる',
      methodHopsShort: 'とぶ',
      methodFamilyShort: 'つなぐ',
      startAria: '声で学べるわり算のぼうけんを始める',
      startSmall: 'タップして はじめよう',
      startStrong: 'ぼうけんを はじめる',
      headphoneNote: 'レッスンも問題も、ぜんぶ声で聞けるよ。',
      guideMessage: '庭のガイド',
      lessonGuideAria: 'ルミにこのレッスンをもう一度話してもらう',
      lumiAlt: 'やさしいランタンのガイド、ルミ',
      lumiName: 'ルミ',
      guideRepeat: 'タップでもう一度聞く',
      lessonPathAria: 'わり算の4つの考え方',
      lessonStepShare: '同じ数ずつ分けるレッスン',
      lessonStepGroups: '同じまとまりを作るレッスン',
      lessonStepHops: '後ろ向きにジャンプするレッスン',
      lessonStepFamily: 'かけ算とつなぐレッスン',
      hintGuideAria: 'ルミに声と動きのヒントを見せてもらう',
      needHint: 'ヒントがいる？',
      tapLumi: 'ルミをタップ',
      streakAria: 'いまの連続正解数',
      glowStreak: 'れんぞく正解',
      answerPrompt: '答えをえらぼう',
      answerGridAria: '答えの選択肢',
      hearAgain: 'もう一度聞く',
      showHint: 'ヒントを見る',
      keyboardNote: '1～3で答える・Hでヒント・Rでもう一度',
      celebrationEyebrow: '庭が目覚めたよ',
      celebrationTitle: 'ぜんぶの光がかがやいた！',
      celebrationBody: '遊びたいだけ、新しいわり算の道がどこまでも続くよ。',
      endlessAria: '終わりのないわり算れんしゅうへ進む',
      endlessSmall: 'どこまでも続く庭',
      endlessStrong: 'わり算をつづける',
      methodShareLabel: '同じ数ずつ分ける',
      methodShareTitle: '同じ数ずつ分けよう',
      methodShareCaption: '一つずつ、どのランタンにも同じように入れよう。',
      methodGroupsLabel: 'まとまりを作る',
      methodGroupsTitle: '同じまとまりを作ろう',
      methodGroupsCaption: '一つのまとまりの数を決めて、いくつできるか数えよう。',
      methodHopsLabel: '0までジャンプ',
      methodHopsTitle: '同じ大きさでジャンプ',
      methodHopsCaption: '数の道を、同じ数ずつ戻って数えよう。',
      methodFamilyLabel: 'かけ算のなかま',
      methodFamilyTitle: 'かけ算とつなげよう',
      methodFamilyCaption: '知っているかけ算を使って考えよう。',
      levelFirst: 'はじめの光',
      levelGarden: '庭のかがやき',
      levelMoon: '月の橋',
      levelStar: '星の守り人',
      wayProgress: 'わけ方 {current} / {total}',
      lessonEquationAria: '{dividend}わる{divisor}は{quotient}',
      nextIdea: '次のわけ方',
      tryYourself: 'やってみよう',
      lessonNextAria: '次のわり算の考え方へ進む',
      lessonTryAria: 'わり算のれんしゅうを始める',
      lessonSpeaking: 'ルミが声と絵で、このわり算を見せているよ。',
      lessonReady: '準備ができたら、光る矢印を押してね。',
      nextReadyAnnouncement: '次へ進むボタンを押せるよ。',
      challengeEndlessTitle: 'どこまでも庭を育てよう',
      challengePracticeTitle: 'ランタン {current} / {total} をともそう',
      guidedPractice: 'いっしょに れんしゅう',
      problemEquationAria: '{dividend}わる{divisor}。答えをえらんでね。',
      shareProblemCaption: '{dividend}この星の種を、{divisor}このランタンに同じ数ずつ分けよう。1こに何こ入る？',
      groupsProblemCaption: '{dividend}この星の種を、{divisor}こずつまとめよう。同じまとまりはいくつできる？',
      hopsProblemCaption: '{dividend}から{divisor}ずつ戻ろう。0まで何回ジャンプする？',
      familyProblemCaption: '{divisor}かけるいくつで、{dividend}になる？',
      shareModelLabel: '同じランタンが{groups}こ',
      shareModelAria: '{dividend}この光る星の種を、{groups}このランタンに同じ数ずつ分けた絵',
      groupsModelLabel: '同じまとまりが{groups}こ',
      groupsModelPrompt: 'まとまりを数えよう',
      groupsModelAria: '{dividend}この光る星の種を、{size}こずつの同じまとまりにした絵',
      hopsModelLabel: '同じジャンプ',
      hopsModelAria: '{dividend}から0まで、{size}ずつ後ろへジャンプする数の道',
      familyModelAria: '{dividend}と{divisor}と答えをつなぐ、かけ算とわり算の三角形',
      answerChoiceAria: '答えは{answer}。{choice}番目の選択肢。',
      successToast: 'すごい！ {dividend} ÷ {divisor} = {quotient}',
      correctAnnouncement: '正解。答えは{quotient}です。',
      retryToast: 'おしい！光をよく見て、もう一度やってみよう。',
      retryAnnouncement: 'もう少し。ルミがヒントを見せるよ。別の答えをえらんでね。',
      hintToast: 'ルミが考え方を見せているよ。',
      hintAnnouncement: 'ヒントを表示したよ。絵を見て数えてみよう。',
      celebrationAnnouncement: '6つのれんしゅうランタンが全部光ったよ。終わりのないれんしゅうが開いたよ。',
      progressLearn: 'まなぶ',
      progressIdea: 'わけ方 {current} / {total}',
      progressGardenAwake: '庭がめざめた',
      soundOffAnnouncement: '声と音を消したよ。',
      soundOnAnnouncement: '声と音を出したよ。',
    },
  };

  function getInitialLanguage() {
    try {
      const savedLanguage = window.localStorage.getItem('divisionQuestLanguage');
      if (savedLanguage === 'en' || savedLanguage === 'ja') return savedLanguage;
    } catch {
      // Local storage can be unavailable in private or embedded browsing contexts.
    }

    return navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  }

  const METHODS = {
    share: {
      labelKey: 'methodShareLabel',
      lessonTitleKey: 'methodShareTitle',
      captionKey: 'methodShareCaption',
      hintClip: 'hint-share',
    },
    groups: {
      labelKey: 'methodGroupsLabel',
      lessonTitleKey: 'methodGroupsTitle',
      captionKey: 'methodGroupsCaption',
      hintClip: 'hint-groups',
    },
    hops: {
      labelKey: 'methodHopsLabel',
      lessonTitleKey: 'methodHopsTitle',
      captionKey: 'methodHopsCaption',
      hintClip: 'hint-hops',
    },
    family: {
      labelKey: 'methodFamilyLabel',
      lessonTitleKey: 'methodFamilyTitle',
      captionKey: 'methodFamilyCaption',
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
      nameKey: 'levelFirst',
      threshold: 0,
      divisors: [2, 3],
      quotientMin: 1,
      quotientMax: 5,
      methods: ['share', 'groups'],
    },
    {
      nameKey: 'levelGarden',
      threshold: 6,
      divisors: [2, 3, 4, 5],
      quotientMin: 1,
      quotientMax: 7,
      methods: ['share', 'groups', 'hops'],
    },
    {
      nameKey: 'levelMoon',
      threshold: 18,
      divisors: [2, 3, 4, 5, 6, 7],
      quotientMin: 2,
      quotientMax: 9,
      methods: ['share', 'groups', 'hops', 'family'],
    },
    {
      nameKey: 'levelStar',
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
    languageButton: document.getElementById('languageButton'),
    languageLabel: document.getElementById('languageLabel'),
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
    metaDescription: document.querySelector('meta[name="description"]'),
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
    language: getInitialLanguage(),
  };

  function t(key, replacements = {}) {
    const template = COPY[state.language][key] ?? COPY.en[key] ?? key;

    return Object.entries(replacements).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, `${value}`),
      template,
    );
  }

  function applyStaticTranslations() {
    document.documentElement.lang = state.language;
    document.title = t('documentTitle');
    elements.metaDescription.setAttribute('content', t('metaDescription'));

    document.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });

    document.querySelectorAll('[data-i18n-html]').forEach((element) => {
      element.innerHTML = t(element.dataset.i18nHtml);
    });

    document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
      element.setAttribute('aria-label', t(element.dataset.i18nAria));
    });

    document.querySelectorAll('[data-i18n-alt]').forEach((element) => {
      element.setAttribute('alt', t(element.dataset.i18nAlt));
    });

    elements.languageLabel.textContent = t('targetLanguageLabel');
    elements.languageButton.setAttribute('aria-label', t('switchLanguageAria'));
    elements.languageButton.title = t('switchLanguageAria');
    elements.soundButton.setAttribute(
      'aria-label',
      state.soundEnabled ? t('soundOffAria') : t('soundOnAria'),
    );
  }

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
      const languagePath = state.language === 'ja' ? `${AUDIO_BASE}/ja` : AUDIO_BASE;
      elements.voiceAudio.src = `${languagePath}/${clipId}.mp3`;
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

  function renderLesson(index, includeWelcome = false, speak = true) {
    const lesson = LESSONS[index];
    const method = METHODS[lesson.id];
    state.lessonIndex = index;
    elements.lessonMethod.innerHTML = `<span aria-hidden="true">●</span> ${t('wayProgress', {
      current: index + 1,
      total: LESSONS.length,
    })}`;
    elements.lessonTitle.textContent = t(method.lessonTitleKey);
    elements.lessonCaption.textContent = t(method.captionKey);
    elements.lessonEquation.innerHTML = `<b>${lesson.dividend}</b><span>÷</span><b>${lesson.divisor}</b><span>=</span><em>${lesson.quotient}</em>`;
    elements.lessonEquation.setAttribute(
      'aria-label',
      t('lessonEquationAria', lesson),
    );
    const isLastLesson = index === LESSONS.length - 1;
    elements.nextLessonLabel.textContent = t(isLastLesson ? 'tryYourself' : 'nextIdea');
    elements.nextLessonButton.setAttribute(
      'aria-label',
      t(isLastLesson ? 'lessonTryAria' : 'lessonNextAria'),
    );
    updateLessonPath(index);
    updateProgress();
    renderVisual(elements.lessonVisual, lesson, true);
    if (speak) {
      narrateLesson(includeWelcome);
    }
  }

  function narrateLesson(includeWelcome = false) {
    const lesson = LESSONS[state.lessonIndex];
    elements.nextLessonButton.disabled = true;
    elements.nextLessonButton.classList.remove('is-ready');
    elements.lessonVoiceCaption.lastElementChild.textContent = t('lessonSpeaking');

    const clips = includeWelcome ? ['welcome', lesson.narration] : [lesson.narration];
    setReplayAction(() => narrateLesson(false));
    playVoice(clips, unlockLessonContinue);
  }

  function unlockLessonContinue() {
    if (state.phase !== 'lesson') return;
    elements.nextLessonButton.disabled = false;
    elements.nextLessonButton.classList.add('is-ready');
    elements.lessonVoiceCaption.lastElementChild.textContent = t('lessonReady');
    announce(t('nextReadyAnnouncement'));
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
    updateProblemPresentation(problem);
    renderAnswers(problem);
    setReplayAction(speakCurrentProblem);

    if (speak) {
      window.setTimeout(speakCurrentProblem, 260);
    }
  }

  function updateProblemPresentation(problem) {
    const method = METHODS[problem.method];
    const level = getCurrentLevel();
    const practiceNumber = state.answerLocked
      ? state.practiceIndex
      : state.practiceIndex + 1;

    elements.challengeMethod.innerHTML = `<span aria-hidden="true">●</span> ${t(method.labelKey)}`;
    elements.challengeTitle.textContent = state.phase === 'endless'
      ? t('challengeEndlessTitle')
      : t('challengePracticeTitle', {
        current: practiceNumber,
        total: TRAINING_LENGTH,
      });
    elements.levelChip.querySelector('span').textContent = state.phase === 'endless'
      ? t(level.nameKey)
      : t('guidedPractice');
    elements.problemEquation.innerHTML = `<strong>${problem.dividend}</strong><span>÷</span><strong>${problem.divisor}</strong><span>=</span><em>?</em>`;
    elements.problemEquation.setAttribute(
      'aria-label',
      t('problemEquationAria', problem),
    );
    elements.problemCaption.textContent = getProblemCaption(problem);
    renderVisual(elements.problemVisual, problem, false);
    Array.from(elements.answerGrid.children).forEach((button, index) => {
      button.setAttribute('aria-label', t('answerChoiceAria', {
        answer: button.dataset.answer,
        choice: index + 1,
      }));
    });
    updateProgress();
    updateStreak();
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
      return t('shareProblemCaption', problem);
    }

    if (problem.method === 'groups') {
      return t('groupsProblemCaption', problem);
    }

    if (problem.method === 'hops') {
      return t('hopsProblemCaption', problem);
    }

    return t('familyProblemCaption', problem);
  }

  function renderVisual(container, problem, lessonMode) {
    container.classList.remove('is-hinting');
    container.dataset.method = problem.method || problem.id;
    const method = problem.method || problem.id;

    if (method === 'share') {
      renderSharing(container, problem, lessonMode);
    } else if (method === 'groups') {
      renderGrouping(container, problem, lessonMode);
    } else if (method === 'hops') {
      renderHops(container, problem, lessonMode);
    } else {
      renderFactFamily(container, problem, lessonMode);
    }

    if (!lessonMode && state.hintShown) {
      revealCurrentVisual(container);
    }
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
      <span class="model-label">${t('shareModelLabel', { groups })}</span>`;
    container.setAttribute(
      'aria-label',
      t('shareModelAria', { dividend: problem.dividend, groups }),
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
    const groupsLabel = t('groupsModelLabel', { groups: numberOfGroups });
    const label = lessonMode
      ? groupsLabel
      : `<span data-reveal="${groupsLabel}">${t('groupsModelPrompt')}</span>`;

    container.innerHTML = `
      <div class="seed-model groups-model" style="--columns: ${Math.min(numberOfGroups, 6)}">
        ${groupMarkup}
      </div>
      <span class="model-label">${label}</span>`;
    container.setAttribute(
      'aria-label',
      t('groupsModelAria', { dividend: problem.dividend, size: groupSize }),
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
        <div class="hop-count"><span>${t('hopsModelLabel')}</span>${lessonMode ? `<strong>${count}</strong>` : count}</div>
      </div>`;
    container.setAttribute(
      'aria-label',
      t('hopsModelAria', { dividend: problem.dividend, size: problem.divisor }),
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
      t('familyModelAria', problem),
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
      button.setAttribute('aria-label', t('answerChoiceAria', {
        answer: choice,
        choice: index + 1,
      }));
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
    showToast(t('successToast', state.currentProblem), 'success');
    announce(t('correctAnnouncement', state.currentProblem));
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
    showToast(t('retryToast'), 'try-again');
    announce(t('retryAnnouncement'));
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

  function revealCurrentVisual(container = elements.problemVisual) {
    container.classList.add('is-hinting');
    container.querySelectorAll('[data-reveal]').forEach((item) => {
      item.textContent = item.dataset.reveal;
    });
  }

  function revealHint(speak = true) {
    if (state.answerLocked || !state.currentProblem) return;
    state.hintShown = true;
    revealCurrentVisual();

    if (speak) {
      stopVoice();
      showToast(t('hintToast'), 'try-again');
      announce(t('hintAnnouncement'));
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
    announce(t('celebrationAnnouncement'));
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
      elements.progressLabel.textContent = t('progressIdea', {
        current: state.lessonIndex + 1,
        total: LESSONS.length,
      });
    } else if (state.phase === 'practice') {
      litCount = state.practiceIndex;
      elements.progressLabel.textContent = `${state.practiceIndex} / ${TRAINING_LENGTH}`;
    } else if (['celebration', 'endless'].includes(state.phase)) {
      litCount = state.phase === 'celebration'
        ? TRAINING_LENGTH
        : (state.endlessCorrect === 0 ? 0 : ((state.endlessCorrect - 1) % TRAINING_LENGTH) + 1);
      elements.progressLabel.textContent = state.phase === 'endless'
        ? `${state.endlessCorrect} · ∞`
        : t('progressGardenAwake');
    } else {
      elements.progressLabel.textContent = t('progressLearn');
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

  function saveLanguagePreference() {
    try {
      window.localStorage.setItem('divisionQuestLanguage', state.language);
    } catch {
      // The game remains bilingual when storage is unavailable; it simply will not persist.
    }
  }

  function toggleLanguage() {
    stopVoice();
    state.language = state.language === 'en' ? 'ja' : 'en';
    saveLanguagePreference();
    applyStaticTranslations();
    hideToast();

    if (state.phase === 'lesson') {
      renderLesson(state.lessonIndex, false, false);
      narrateLesson(false);
      return;
    }

    if (['practice', 'endless'].includes(state.phase) && state.currentProblem) {
      updateProblemPresentation(state.currentProblem);

      if (state.answerLocked) {
        const feedbackClip = `correct-${((state.totalCorrect - 1) % 3) + 1}`;
        playVoice([feedbackClip], () => {
          window.setTimeout(advanceAfterCorrect, state.soundEnabled ? 260 : 650);
        });
      } else {
        speakCurrentProblem();
      }
      return;
    }

    updateProgress();

    if (state.phase === 'celebration') {
      setReplayAction(() => playVoice(['endless-unlocked']));
      playVoice(['endless-unlocked']);
    }
  }

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    elements.soundButton.setAttribute('aria-pressed', `${state.soundEnabled}`);
    elements.soundButton.setAttribute(
      'aria-label',
      state.soundEnabled ? t('soundOffAria') : t('soundOnAria'),
    );

    if (!state.soundEnabled) {
      stopVoice();
      if (state.phase === 'lesson') unlockLessonContinue();
      if (state.answerLocked && ['practice', 'endless'].includes(state.phase)) {
        window.setTimeout(advanceAfterCorrect, 650);
      }
      announce(t('soundOffAnnouncement'));
      return;
    }

    ensureAudioContext();
    announce(t('soundOnAnnouncement'));
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
  elements.languageButton.addEventListener('click', toggleLanguage);
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

  applyStaticTranslations();
  createMotes();
  updateProgress();
})();
