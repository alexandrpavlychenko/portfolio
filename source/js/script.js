const swiperEl = document.querySelector('.swiper');

const swiper = new Swiper(swiperEl, {
  // Optional parameters
  loop: true,
  slidesPerView: 1,

  // Navigation arrows
  navigation: {
    nextEl: '.slider__control--next',
    prevEl: '.slider__control--prev',
  },
});
