(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TreeGrowth = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const MAX_AGE = 3000;
  const MIN_SPEED = 0.1;
  const MAX_SPEED = 200;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const smooth = (min, max, value) => { const t = clamp((value - min) / (max - min), 0, 1); return t * t * (3 - 2 * t); };

  function heightAt(age) {
    // An illustrative lifetime curve: keep adding visible height in old age,
    // instead of reaching almost the final silhouette in the first centuries.
    return 92 * Math.log1p(Math.max(0, age - 0.04) / 45) / Math.log1p((MAX_AGE - 0.04) / 45);
  }

  function branchBirth(index, count) {
    const fraction = clamp(finite(index) / Math.max(1, finite(count, 120) - 1), 0, 1);
    const age = .18 + 3 * Math.expm1(fraction * Math.log1p((MAX_AGE * .94 - .18) / 3));
    // Wood laid down at the leader stays at this height as the tip grows on.
    return { age, height: Math.max(.002, heightAt(age) * .994 - .006) };
  }

  function branchGrowth(birth, age) {
    return 1 - Math.exp(-Math.max(0, finite(age) - birth.age) / (.15 + birth.age * .035));
  }

  // Leave headroom, then hold the view still so growth has a visible reference.
  // Only pull back when the tree outgrows that space; never track its height 1:1.
  class GrowthFraming {
    constructor() {
      this.span = .018;
      this.focus = .002;
      this.locked = false;
      this.height = 0;
    }
    update(value, reset = false) {
      const height = clamp(finite(value), 0, 92);
      if (!this.locked && (reset || height < this.height || height > this.span * .86)) {
        this.span = [.018, .035, .065, .12, .22, .4, .75, 1.4, 3, 5, 9, 16, 32, 64, 112].find(span => height <= span * .86) || 112;
        this.focus = this.span === .018 ? .002 : this.span;
      }
      this.height = height;
    }
    fit(height) {
      this.locked = false;
      this.update(height, true);
    }
  }

  function properties(value) {
    const age = clamp(finite(value), 0, MAX_AGE);
    const height = heightAt(age);
    const diameter = age <= 0.04 ? 0 : 0.003 + 10.8 * Math.pow(1 - Math.exp(-(age - 0.04) / 1100), 0.92);
    const maturity = smooth(40, 1000, age);
    const crownBase = 0.08 + maturity * 0.39;
    const crownRadius = height * (0.235 - maturity * 0.063);
    const woodVolume = Math.PI * (diameter / 2) ** 2 * height * 0.28;
    const stage = age < 0.04 ? 'Seed' : age < 2 ? 'Seedling' : age < 35 ? 'Sapling' : age < 300 ? 'Young tree' : age < 1200 ? 'Mature tree' : 'Ancient giant';
    return {
      age, height, diameter, maturity, crownBase, crownRadius, stage,
      crownSpan: crownRadius * 2,
      carbon: woodVolume * 420 * 0.5,
      rings: Math.floor(age),
      growthRate: age < 0.04 ? 0 : (heightAt(age + 0.05) - heightAt(Math.max(0, age - 0.05))) / 0.1,
      progress: age / MAX_AGE,
    };
  }

  // Logarithmic scrubbing leaves useful space for the seed and first few years.
  const ageFromTimeline = value => {
    const fraction = clamp(finite(value), 0, 1);
    return fraction === 1 ? MAX_AGE : Math.expm1(fraction * Math.log1p(MAX_AGE));
  };
  const timelineFromAge = age => Math.log1p(clamp(finite(age), 0, MAX_AGE)) / Math.log1p(MAX_AGE);
  const speedFromSlider = value => MIN_SPEED * Math.pow(MAX_SPEED / MIN_SPEED, clamp(finite(value), 0, 1));
  const sliderFromSpeed = speed => Math.log(clamp(finite(speed, 1), MIN_SPEED, MAX_SPEED) / MIN_SPEED) / Math.log(MAX_SPEED / MIN_SPEED);

  function random(seed = 92371) {
    let state = seed >>> 0;
    return function () {
      state += 0x6D2B79F5;
      let n = state;
      n = Math.imul(n ^ n >>> 15, n | 1);
      n ^= n + Math.imul(n ^ n >>> 7, n | 61);
      return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
  }

  class Simulation {
    constructor() {
      this.age = 0;
      this.speed = 1;
      this.playing = false;
    }
    setAge(value) {
      this.age = clamp(finite(value, this.age), 0, MAX_AGE);
      if (this.age >= MAX_AGE) this.playing = false;
      return this.age;
    }
    setSpeed(value) {
      this.speed = clamp(finite(value, this.speed), MIN_SPEED, MAX_SPEED);
      return this.speed;
    }
    toggle() {
      if (this.age >= MAX_AGE) return false;
      this.playing = !this.playing;
      return this.playing;
    }
    tick(seconds, hidden = false) {
      if (this.playing && !hidden) this.setAge(this.age + clamp(finite(seconds), 0, 0.1) * this.speed);
      return this.age;
    }
    reset() {
      this.age = 0;
      this.playing = false;
    }
    get tree() { return properties(this.age); }
  }

  return { MAX_AGE, MIN_SPEED, MAX_SPEED, clamp, finite, smooth, properties, branchBirth, branchGrowth, GrowthFraming, ageFromTimeline, timelineFromAge, speedFromSlider, sliderFromSpeed, random, Simulation };
});
