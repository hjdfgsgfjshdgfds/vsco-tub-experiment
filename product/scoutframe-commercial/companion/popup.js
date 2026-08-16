const status = document.querySelector('#status');
const label = status.querySelector('b');

chrome.runtime.sendMessage({ action: 'scoutframe.health' }, response => {
  if (chrome.runtime.lastError || !response?.ok) {
    status.classList.add('bad');
    label.textContent = 'Companion error — reload the extension';
    return;
  }
  status.classList.add(response.authenticated ? 'ok' : 'bad');
  label.textContent = response.authenticated ? 'VSCO session detected' : 'Sign in to VSCO in this profile';
});

document.querySelector('#open-app').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://127.0.0.1:4177/' });
});
