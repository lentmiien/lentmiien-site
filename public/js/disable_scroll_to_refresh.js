// Disable scroll to refresh
let lastTouchY = 0;
const preventPullToRefresh = (event) => {
  const touchY = event.touches[0].clientY;
  const bodyScrollTop = document.body.scrollTop || document.documentElement.scrollTop;
  
  if (bodyScrollTop === 0 && touchY > lastTouchY) {
    event.preventDefault();
  }
  
  lastTouchY = touchY;
};

document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;

  lastTouchY = e.touches[0].clientY;
}, { passive: false });

document.addEventListener('touchmove', preventPullToRefresh, { passive: false });