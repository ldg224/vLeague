// Cross-fades the football photos in .photos every few seconds (holds still for reduced motion).
export function startPhotos(every = 7000) {
  const imgs = [...document.querySelectorAll('.photos img')];
  if (imgs.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let i = imgs.findIndex(img => img.classList.contains('on'));
  setInterval(() => {
    if (document.hidden) return;
    imgs[i].classList.remove('on');
    i = (i + 1) % imgs.length;
    imgs[i].classList.add('on');
  }, every);
}
