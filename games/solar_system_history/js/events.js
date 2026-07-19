export const CHAPTERS = {
  deepTime: {
    id: 'deep-time',
    label: 'Deep time',
    shortLabel: 'Solar system'
  },
  human: {
    id: 'human-story',
    label: 'The human story',
    shortLabel: 'Human story'
  },
  today: {
    id: 'today',
    label: 'Today',
    shortLabel: 'Today'
  },
  future: {
    id: 'future',
    label: 'Modelled futures',
    shortLabel: 'The future'
  }
};

export const TOUR_EVENTS = [
  {
    id: 'solar-nebula',
    chapter: CHAPTERS.deepTime.id,
    time: -4.567e9,
    date: 'About 4.567 billion years ago',
    title: 'A cloud becomes a system',
    eyebrow: '01 · The solar nebula',
    summary: 'A cold molecular cloud collapsed under gravity. Its center became the infant Sun, while the surrounding gas and dust flattened into a spinning protoplanetary disk.',
    context: 'The broad sequence is well supported. A nearby supernova may have helped trigger the collapse, but that detail is not established.',
    confidence: 'High confidence',
    scene: 'nebula',
    image: 'assets/images/solar-nebula.webp',
    imageAlt: 'Artist impression of a brilliant protostar forming inside a broad dusty protoplanetary disk.',
    dwell: 8200,
    sources: [
      ['NASA · Solar system formation', 'https://science.nasa.gov/astrobiology/learning-resources/alp/how-did-our-solar-system-form/']
    ]
  },
  {
    id: 'worlds-assemble',
    chapter: CHAPTERS.deepTime.id,
    time: -4.54e9,
    date: 'About 4.56–4.54 billion years ago',
    title: 'Dust assembles into worlds',
    eyebrow: '02 · Planet building',
    summary: 'Dust became pebbles, planetesimals, and planetary embryos. The giant planets formed quickly; repeated collisions built the hot, rocky worlds closer to the Sun.',
    context: 'Planet sizes, distances, and formation speeds are compressed in this visualization.',
    confidence: 'High confidence',
    scene: 'formation',
    dwell: 6800,
    sources: [
      ['NASA · Planetary systems', 'https://science.nasa.gov/universe/stars/planetary-system/'],
      ['USGS · Age of Earth', 'https://pubs.usgs.gov/gip/geotime/age.html']
    ]
  },
  {
    id: 'moon-forming-impact',
    chapter: CHAPTERS.deepTime.id,
    time: -4.507e9,
    date: 'About 4.51 billion years ago',
    title: 'An impact makes the Moon',
    eyebrow: '03 · Leading hypothesis',
    summary: 'A planetary-scale collision blasted molten and vaporized rock into orbit around the young Earth. That debris gathered into the Moon.',
    context: 'The giant-impact family of models leads the evidence, but the impactor, geometry, and number of collisions remain debated.',
    confidence: 'Leading model',
    scene: 'impact',
    image: 'assets/images/moon-forming-impact.webp',
    imageAlt: 'Artist impression of a glancing collision with the molten young Earth throwing incandescent debris into orbit.',
    dwell: 9000,
    sources: [
      ['NASA · Moon formation', 'https://science.nasa.gov/moon/formation/']
    ]
  },
  {
    id: 'first-oceans',
    chapter: CHAPTERS.deepTime.id,
    time: -4.4e9,
    date: 'As early as 4.4 billion years ago',
    title: 'The hot world begins to cool',
    eyebrow: '04 · Crust and water',
    summary: 'Ancient zircon crystals suggest that solid crust—and probably liquid water interacting with it—appeared surprisingly early on Earth.',
    context: 'The evidence is indirect, so the extent of these earliest oceans is uncertain.',
    confidence: 'Indirect evidence',
    scene: 'earth-young',
    image: 'assets/images/first-oceans.webp',
    imageAlt: 'Artist impression looking across a dark early ocean toward volcanic islands and mineral-rich hydrothermal vents.',
    dwell: 7600,
    sources: [
      ['NASA Earth Observatory · Ancient zircons', 'https://science.nasa.gov/earth/earth-observatory/ancient-crystals-suggest-earlier-ocean/']
    ]
  },
  {
    id: 'worlds-under-fire',
    chapter: CHAPTERS.deepTime.id,
    time: -3.9e9,
    date: 'Broadly 4.1–3.8 billion years ago',
    title: 'Worlds under fire',
    eyebrow: '05 · Leftover debris',
    summary: 'The inner worlds still crossed a storm of leftover debris. Immense impacts excavated basins on the Moon and repeatedly reshaped the young planets.',
    context: 'High early impact rates are secure; a single sharp “Late Heavy Bombardment” spike is disputed.',
    confidence: 'Timing uncertain',
    scene: 'bombardment',
    dwell: 7000,
    sources: [
      ['NASA · Lunar impact history', 'https://science.nasa.gov/lunar-science/focus-areas/impact-history/']
    ]
  },
  {
    id: 'life-emerges',
    chapter: CHAPTERS.deepTime.id,
    time: -3.5e9,
    date: 'At least 3.5 billion years ago',
    title: 'Chemistry begins to evolve',
    eyebrow: '06 · Life emerges',
    summary: 'Somewhere in Earth’s waters, chemistry crossed a profound threshold: matter began copying, evolving, and building living ecosystems.',
    context: 'Life was firmly established by about 3.5 billion years ago. Its exact birthplace and earlier history remain open questions.',
    confidence: 'Evidence from ancient rocks',
    scene: 'earth-ocean',
    image: 'assets/images/first-oceans.webp',
    imageAlt: 'Artist impression of an early ocean and porous hydrothermal vent towers, one plausible setting for prebiotic chemistry.',
    dwell: 8200,
    sources: [
      ['NASA Astrobiology · Early life evidence', 'https://astrobiology.nasa.gov/news/oldest-evidence-for-early-life-on-earth-dated-to-at-least-377-billion-years/']
    ]
  },
  {
    id: 'great-oxidation',
    chapter: CHAPTERS.deepTime.id,
    time: -2.4e9,
    date: 'About 2.4 billion years ago',
    title: 'Oxygen transforms the planet',
    eyebrow: '07 · Great Oxidation',
    summary: 'Photosynthetic microbes had long released oxygen. Now it began accumulating persistently in the atmosphere, transforming oceans, minerals, climate, and the possibilities for life.',
    context: 'This was a prolonged and uneven transition, not a single moment.',
    confidence: 'High confidence',
    scene: 'earth-oxygen',
    dwell: 6800,
    sources: [
      ['Nature Geoscience · Oxygenation', 'https://www.nature.com/articles/s41561-022-00906-5']
    ]
  },
  {
    id: 'cambrian-radiation',
    chapter: CHAPTERS.deepTime.id,
    time: -5.3e8,
    date: 'Roughly 539–520 million years ago',
    title: 'Animal life diversifies',
    eyebrow: '08 · Cambrian radiation',
    summary: 'Across tens of millions of years, marine animals diversified into elaborate bodies, senses, armor, predators, and prey—the foundations of many later ecosystems.',
    context: 'The radiation had Precambrian roots; it was not an instantaneous explosion.',
    confidence: 'High confidence',
    scene: 'earth-life',
    image: 'assets/images/cambrian-radiation.webp',
    imageAlt: 'Artist impression of a diverse Cambrian seafloor with trilobites, sponges, and early swimming arthropods.',
    dwell: 7600,
    sources: [
      ['International Commission on Stratigraphy · Chart', 'https://stratigraphy.org/ICSchart/ChronostratChart2026-06.pdf']
    ]
  },
  {
    id: 'dinosaurs-rise',
    chapter: CHAPTERS.deepTime.id,
    time: -2.3e8,
    date: 'About 230 million years ago',
    title: 'Dinosaurs enter the story',
    eyebrow: '09 · Triassic Earth',
    summary: 'The first definitive dinosaurs appeared on Pangaea. They began as one modest group among many, then diversified across a changing planet for more than 160 million years.',
    context: 'Birds are the surviving dinosaur lineage.',
    confidence: 'High confidence',
    scene: 'earth-life',
    dwell: 6500,
    sources: [
      ['USGS · When dinosaurs lived', 'https://pubs.usgs.gov/gip/dinosaurs/when.html']
    ]
  },
  {
    id: 'chicxulub-impact',
    chapter: CHAPTERS.deepTime.id,
    time: -6.6043e7,
    date: '66.043 million years ago',
    title: 'A world changes in a day',
    eyebrow: '10 · Chicxulub impact',
    summary: 'An asteroid struck near today’s Yucatán Peninsula. Ejecta, darkness, cooling, fires, and collapsing food webs drove a global mass extinction.',
    context: 'Non-avian dinosaurs vanished. Birds—and many other lineages—survived.',
    confidence: 'High confidence',
    scene: 'asteroid',
    image: 'assets/images/chicxulub-impact.webp',
    imageAlt: 'Artist impression of the Chicxulub asteroid striking a shallow sea beneath a darkening sky.',
    dwell: 9000,
    sources: [
      ['Science · Impact and extinction chronology', 'https://pubmed.ncbi.nlm.nih.gov/23393261/']
    ]
  },
  {
    id: 'earliest-hominins',
    chapter: CHAPTERS.human.id,
    time: -6.5e6,
    date: 'Roughly 7–6 million years ago',
    title: 'A new branch begins',
    eyebrow: '11 · Earliest hominins',
    summary: 'In Africa, creatures near the base of the human family tree combined ape-like anatomy with traits that may record early upright movement.',
    context: 'These species are candidate early hominins, not necessarily our direct ancestors.',
    confidence: 'Interpretation debated',
    scene: 'earth-human',
    dwell: 6200,
    sources: [
      ['Smithsonian Human Origins · Sahelanthropus', 'https://humanorigins.si.edu/evidence/human-fossils/species/sahelanthropus-tchadensis']
    ]
  },
  {
    id: 'first-stone-technology',
    chapter: CHAPTERS.human.id,
    time: -3.3e6,
    date: 'About 3.3 million years ago',
    title: 'Technology enters the record',
    eyebrow: '12 · Stone tools',
    summary: 'Long before Homo sapiens—and probably before the genus Homo—hominins deliberately struck stone to create sharp tools.',
    context: 'We do not yet know which species made the oldest known tools.',
    confidence: 'Archaeological evidence',
    scene: 'earth-human',
    dwell: 6200,
    sources: [
      ['Nature · Lomekwi stone tools', 'https://www.nature.com/articles/nature14464']
    ]
  },
  {
    id: 'homo-erectus-disperses',
    chapter: CHAPTERS.human.id,
    time: -1.85e6,
    date: 'About 1.9–1.8 million years ago',
    title: 'Humans range farther',
    eyebrow: '13 · Homo erectus',
    summary: 'Homo erectus had a human-like walking body, a larger brain, and remarkable endurance. Early populations expanded beyond Africa into varied Asian environments.',
    context: 'Human expansion occurred in repeated movements, not one march across a map.',
    confidence: 'Fossil evidence',
    scene: 'earth-human',
    dwell: 6500,
    sources: [
      ['Smithsonian Human Origins · Homo erectus', 'https://humanorigins.si.edu/evidence/human-fossils/species/homo-erectus']
    ]
  },
  {
    id: 'controlled-fire',
    chapter: CHAPTERS.human.id,
    time: -790000,
    date: 'At least 790,000 years ago',
    title: 'Fire becomes a gathering place',
    eyebrow: '14 · Controlled fire',
    summary: 'Controlled hearths brought warmth, protection, cooked food, and a place to gather. Fire became both a technology and a center of social life.',
    context: 'Older fire claims exist, but their interpretation is less secure.',
    confidence: 'Conservative date',
    scene: 'earth-night',
    dwell: 6500,
    sources: [
      ['Smithsonian Human Origins · Hearths', 'https://humanorigins.si.edu/evidence/behavior/hearths-shelters']
    ]
  },
  {
    id: 'homo-sapiens',
    chapter: CHAPTERS.human.id,
    time: -300000,
    date: 'At least 300,000 years ago',
    title: 'Our species takes shape',
    eyebrow: '15 · Homo sapiens',
    summary: 'Our species emerged in Africa—not at one sharp moment or one isolated birthplace, but from interacting populations spread across the continent.',
    context: 'Human evolution is a branching network, not a ladder.',
    confidence: 'Strong fossil evidence',
    scene: 'earth-human',
    dwell: 6800,
    sources: [
      ['Smithsonian Human Origins · Our species', 'https://humanorigins.si.edu/research/whats-hot-human-origins/our-species-arose-least-300000-years-ago']
    ]
  },
  {
    id: 'people-cross-the-world',
    chapter: CHAPTERS.human.id,
    time: -40000,
    date: 'Across tens of thousands of years',
    title: 'A world of stories',
    eyebrow: '16 · Dispersal and expression',
    summary: 'Modern humans moved repeatedly beyond Africa, met and interbred with other human groups, and eventually inhabited nearly every major landmass.',
    context: 'Art and symbolic objects preserve only fragments of the stories people told beneath the same sky we see today.',
    confidence: 'Many lines of evidence',
    scene: 'earth-night',
    image: 'assets/images/first-stargazers.webp',
    imageAlt: 'Artist impression of Upper Paleolithic people sharing a fire and looking out from a rock shelter at the Milky Way.',
    dwell: 8000,
    sources: [
      ['Smithsonian Human Origins · Ancient DNA', 'https://humanorigins.si.edu/evidence/genetics/ancient-dna-and-neanderthals'],
      ['USGS · White Sands footprints', 'https://pubs.usgs.gov/publication/fs20253046/full']
    ]
  },
  {
    id: 'agriculture',
    chapter: CHAPTERS.human.id,
    time: -12000,
    date: 'Within the last 12,000 years',
    title: 'People reshape landscapes',
    eyebrow: '17 · Agriculture',
    summary: 'In several regions independently, people began cultivating plants and managing animals. Permanent settlements grew, landscapes changed, and populations expanded.',
    context: 'There was no single agricultural revolution shared by every society.',
    confidence: 'Archaeological evidence',
    scene: 'earth-human',
    dwell: 6500,
    sources: [
      ['Smithsonian Human Origins · Homo sapiens behavior', 'https://humanorigins.si.edu/evidence/human-fossils/species/homo-sapiens']
    ]
  },
  {
    id: 'writing-and-cities',
    chapter: CHAPTERS.human.id,
    time: -5200,
    date: 'Before 3200 BCE',
    title: 'Memory leaves the mind',
    eyebrow: '18 · Cities and writing',
    summary: 'Cities coordinated thousands of lives. Marks first used for accounts became writing, allowing information to outlive any speaker.',
    context: 'Cuneiform is the oldest writing currently known; writing later developed independently elsewhere.',
    confidence: 'Archaeological evidence',
    scene: 'earth-night',
    dwell: 6500,
    sources: [
      ['British Museum · Cuneiform', 'https://www.britishmuseum.org/blog/how-write-cuneiform']
    ]
  },
  {
    id: 'sun-centered-cosmos',
    chapter: CHAPTERS.human.id,
    time: -483,
    date: '1543–1610 CE',
    title: 'Earth moves from the center',
    eyebrow: '19 · A new cosmic model',
    summary: 'Copernicus published a Sun-centered planetary model. Galileo’s telescope then revealed mountains on the Moon and moons circling Jupiter.',
    context: 'Direct observation showed that not everything orbited Earth.',
    confidence: 'Recorded history',
    scene: 'orrery',
    dwell: 7000,
    sources: [
      ['NASA · History of planetary motion', 'https://science.nasa.gov/earth/earth-observatory/planetary-motion/'],
      ['NASA · Galileo’s observations', 'https://science.nasa.gov/solar-system/galileos-observations-of-the-moon-jupiter-venus-and-the-sun/']
    ]
  },
  {
    id: 'space-age',
    chapter: CHAPTERS.human.id,
    time: -69,
    date: '1957–1990 CE',
    title: 'The Solar System looks back',
    eyebrow: '20 · The Space Age',
    summary: 'Sputnik began the Space Age. Humans stood on the Moon in 1969. Voyager crossed the outer Solar System and photographed Earth as less than a pixel.',
    context: 'For the first time, life from Earth saw its home as one small world among many.',
    confidence: 'Recorded history',
    scene: 'moon',
    image: 'assets/images/moon-landing.webp',
    imageAlt: 'Artist impression of a 1969-era astronaut and lunar module on the Moon with a small Earth overhead.',
    dwell: 9000,
    sources: [
      ['NASA · Dawn of the Space Age', 'https://www.nasa.gov/history/dawn-of-the-space-age/'],
      ['NASA · Apollo 11 overview', 'https://www.nasa.gov/history/apollo-11-mission-overview/'],
      ['NASA · Pale Blue Dot', 'https://science.nasa.gov/photojournal/solar-system-portrait-earth-as-pale-blue-dot/']
    ]
  },
  {
    id: 'today',
    chapter: CHAPTERS.today.id,
    time: 0,
    date: 'Today · 2026 CE',
    title: 'You are here',
    eyebrow: '21 · The present moment',
    summary: 'Four and a half billion years after a cloud collapsed, one small world has produced a species able to reconstruct the story.',
    context: 'For the first time we know of, the Solar System is looking back at itself.',
    confidence: 'The journey pauses here',
    scene: 'today',
    dwell: 5000,
    sources: [
      ['NASA · Solar System facts', 'https://science.nasa.gov/solar-system/solar-system-facts/']
    ]
  },
  {
    id: 'habitability-fades',
    chapter: CHAPTERS.future.id,
    time: 1.5e9,
    date: 'Projected · roughly 1–2 billion years from now',
    title: 'The habitable world narrows',
    eyebrow: '22 · A brighter Sun',
    summary: 'The main-sequence Sun slowly brightens. Greater heat and changing carbon cycles progressively shrink the habitats available to complex life.',
    context: 'This is a broad modelled transition, not a single extinction date.',
    confidence: 'Model-based projection',
    scene: 'earth-warm',
    dwell: 7200,
    sources: [
      ['JGR Atmospheres · Long-term habitability', 'https://doi.org/10.1029/2025JD045586']
    ]
  },
  {
    id: 'oceans-lost',
    chapter: CHAPTERS.future.id,
    time: 2.3e9,
    date: 'Projected · roughly 1.5–3 billion years from now',
    title: 'The oceans leave Earth',
    eyebrow: '23 · Moist greenhouse',
    summary: 'Eventually, water vapor reaches the upper atmosphere. Sunlight breaks it apart and light hydrogen escapes to space, leaving a sterile, dry world.',
    context: 'Climate and atmospheric models disagree on the timing by more than a billion years.',
    confidence: 'Timing uncertain',
    scene: 'earth-scorched',
    dwell: 7200,
    sources: [
      ['Astrobiology review · Future habitability', 'https://pubmed.ncbi.nlm.nih.gov/22869797/']
    ]
  },
  {
    id: 'main-sequence-ends',
    chapter: CHAPTERS.future.id,
    time: 5e9,
    date: 'Projected · about 5 billion years from now',
    title: 'The Sun leaves its long middle age',
    eyebrow: '24 · Core hydrogen runs low',
    summary: 'The Sun exhausts hydrogen in its core. The core contracts, hydrogen burns in a surrounding shell, and the star begins swelling toward a red giant.',
    context: 'The change unfolds across immense spans of time, not as a sudden blast.',
    confidence: 'Stellar-evolution model',
    scene: 'sun-aging',
    dwell: 7000,
    sources: [
      ['NASA · Types of stars', 'https://science.nasa.gov/universe/stars/types/']
    ]
  },
  {
    id: 'red-giant-solar-system',
    chapter: CHAPTERS.future.id,
    time: 7e9,
    date: 'Projected · roughly 6–8 billion years from now',
    title: 'The Sun becomes a red giant',
    eyebrow: '25 · An unresolved fate',
    summary: 'Mercury and Venus are engulfed. Solar mass loss pushes surviving orbits outward, while tides pull inward. Earth’s final physical fate hangs between those effects.',
    context: 'A 2026 model favors a scorched Earth surviving in a wider orbit, but the uncertain rate of solar mass loss leaves engulfment possible.',
    confidence: 'Earth’s fate unresolved',
    scene: 'red-giant',
    image: 'assets/images/red-giant.webp',
    imageAlt: 'Artist impression of one possible outcome: a scorched Earth near the turbulent atmosphere of the future red-giant Sun.',
    dwell: 9400,
    sources: [
      ['Astronomy & Astrophysics · Future Earth', 'https://doi.org/10.1051/0004-6361/202660576'],
      ['NASA · Sun facts', 'https://science.nasa.gov/sun/facts/']
    ]
  },
  {
    id: 'helium-and-final-giant',
    chapter: CHAPTERS.future.id,
    time: 7.7e9,
    date: 'Projected · about 7–8 billion years from now',
    title: 'The Sun sheds its outer layers',
    eyebrow: '26 · Final giant phases',
    summary: 'After a period of helium fusion, the Sun expands again, pulses, and loses a large fraction of its mass in powerful stellar winds.',
    context: 'The surviving outer planets migrate into wider orbits as the Sun’s gravitational grip weakens.',
    confidence: 'Stellar-evolution model',
    scene: 'final-giant',
    dwell: 7600,
    sources: [
      ['NASA · Life and death of planetary systems', 'https://science.nasa.gov/exoplanets/resources/life-and-death/chapter-6/']
    ]
  },
  {
    id: 'white-dwarf',
    chapter: CHAPTERS.future.id,
    time: 8e9,
    date: 'Projected · around 8 billion years from now',
    title: 'After the Sun',
    eyebrow: '27 · White dwarf',
    summary: 'The Sun casts off its outer layers as a glowing planetary nebula. At the center remains an Earth-sized white dwarf: no fusion, only stored heat fading across immense ages.',
    context: 'Any surviving planets and debris continue around the remnant. The Sun does not become a supernova.',
    confidence: 'Stellar-evolution model',
    scene: 'white-dwarf',
    image: 'assets/images/white-dwarf.webp',
    imageAlt: 'Artist impression of a tiny white dwarf inside a broad translucent planetary nebula with a distant surviving planet.',
    dwell: 10000,
    sources: [
      ['NASA · Death and new life', 'https://science.nasa.gov/exoplanets/resources/life-and-death/chapter-7/']
    ]
  }
];

export const TODAY_INDEX = TOUR_EVENTS.findIndex((event) => event.id === 'today');

export function formatTimeOffset(years) {
  if (years === 0) return 'Today';

  const absolute = Math.abs(years);
  const direction = years < 0 ? 'ago' : 'from now';

  if (absolute >= 1e9) {
    const precision = absolute >= 4e9 ? 2 : 1;
    return `${(absolute / 1e9).toFixed(precision)} billion years ${direction}`;
  }

  if (absolute >= 1e6) {
    const precision = absolute >= 10e6 ? 1 : 2;
    return `${(absolute / 1e6).toFixed(precision)} million years ${direction}`;
  }

  if (absolute >= 1000) {
    return `${Math.round(absolute / 1000).toLocaleString()} thousand years ${direction}`;
  }

  return `${Math.round(absolute).toLocaleString()} years ${direction}`;
}
