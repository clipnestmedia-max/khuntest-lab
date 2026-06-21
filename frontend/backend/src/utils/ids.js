
function makeCode(prefix) {
  return prefix + Date.now().toString().slice(-8) + Math.floor(Math.random() * 90 + 10);
}

module.exports = { makeCode };
