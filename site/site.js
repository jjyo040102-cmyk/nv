const player = document.querySelector('#demo-video');
document.querySelectorAll('[data-time]').forEach((button) => {
  button.addEventListener('click', () => {
    player.currentTime = Number(button.dataset.time);
    player.scrollIntoView({ behavior: 'smooth', block: 'center' });
    player.play().catch(() => player.focus());
  });
});
