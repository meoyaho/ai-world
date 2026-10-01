const frame = document.querySelector('.game__frame');
const options = [...document.querySelectorAll('.choice')];
const targets = [...options, ...document.querySelectorAll('.character[data-choice]')];
const desktop = window.matchMedia('(min-width: 701px)');

let selected = null;
let preview = null;

function renderReaction() {
  frame.dataset.active = preview || selected || '';
  for (const option of options) {
    option.setAttribute('aria-pressed', String(option.dataset.choice === selected));
  }
}

for (const target of targets) {
  const choice = target.dataset.choice;

  target.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    preview = choice;
    renderReaction();
  });

  target.addEventListener('pointerleave', () => {
    if (preview !== choice) return;
    preview = null;
    renderReaction();
  });

  target.addEventListener('click', () => {
    if (desktop.matches) return;
    selected = selected === choice ? null : choice;
    renderReaction();
  });
}

desktop.addEventListener('change', () => {
  selected = null;
  preview = null;
  renderReaction();
});
