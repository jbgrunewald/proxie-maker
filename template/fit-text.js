// Step font sizes down until text fits its box. Returns the sizes used so the
// renderer can log which cards are running tight.
window.fitText = () => {
  const rules = document.querySelector('.text-box-inner');
  let rulesSize = 30;
  rules.style.fontSize = rulesSize + 'px';
  while (rules.scrollHeight > rules.clientHeight && rulesSize > 14) {
    rulesSize -= 1;
    rules.style.fontSize = rulesSize + 'px';
  }

  const name = document.querySelector('.card-name');
  const bar = name.parentElement;
  const cost = document.querySelector('.mana-cost');
  let nameSize = 33;
  const fits = () => name.scrollWidth + cost.offsetWidth <= bar.clientWidth - 44;
  while (!fits() && nameSize > 18) {
    nameSize -= 1;
    name.style.fontSize = nameSize + 'px';
  }

  return { rulesSize, nameSize };
};
