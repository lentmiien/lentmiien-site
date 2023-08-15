exports.insertCharAt = (str, index, char) => {
  if (index > str.length) {
    return str;
  }

  let firstPart = str.slice(0, index);
  let secondPart = str.slice(index);
  return firstPart + char + secondPart;
}

exports.estimateTokens = (text) => {
  const wordCount = text.split(/\s+/).length;
  const charCount = text.length;

  // Here, we're assuming on average a word is roughly 4 characters long.
  // So, for every word that's more than 4 characters, we assume it takes an extra token.
  // Additionally, for every character, we assume there's a fraction of a token.
  const estimate = wordCount + (charCount - wordCount * 4) * 0.25;

  return Math.round(estimate);
}