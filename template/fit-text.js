// Step font sizes down until text fits its box. Scoped to one card root so the
// gallery can fit many cards on a page. Returns the sizes used, plus whether
// anything is STILL overflowing at the floor — the renderer treats that as a
// failed card rather than printing clipped text.
window.fitText = (root = document) => {
  const rules = root.querySelector('.text-box-inner');
  let rulesSize = 30;
  rules.style.fontSize = rulesSize + 'px';
  while (rules.scrollHeight > rules.clientHeight && rulesSize > 14) {
    rulesSize -= 1;
    rules.style.fontSize = rulesSize + 'px';
  }

  const name = root.querySelector('.card-name');
  const bar = name.parentElement;
  const cost = root.querySelector('.mana-cost');
  let nameSize = 33;
  // Start from the full size every time, as the rules text above does. Without
  // this the title could only ever shrink: the first fit runs before the mana
  // font has loaded, so the cost measures wide and the name steps down to the
  // floor, and the refit that follows font loading then finds it already
  // fitting and leaves it there.
  name.style.fontSize = nameSize + 'px';
  const fits = () => name.scrollWidth + cost.offsetWidth <= bar.clientWidth - 44;
  while (!fits() && nameSize > 18) {
    nameSize -= 1;
    name.style.fontSize = nameSize + 'px';
  }

  return {
    rulesSize,
    nameSize,
    rulesOverflow: rules.scrollHeight > rules.clientHeight,
    nameOverflow: !fits(),
  };
};
