exports.insertCharAt = (str, index, char) => {
  if (index > str.length) {
    return str;
  }

  let firstPart = str.slice(0, index);
  let secondPart = str.slice(index);
  return firstPart + char + secondPart;
}