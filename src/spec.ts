import './style.css';
import { startSpecDemo } from './spec-demo.ts';
import { defaultSpecName, isSpecName, specNames, specs } from './specs.ts';

// Spec page: an rxjs marble test, run through the real TestScheduler and
// played back one frame per column. `?spec=<name>` picks the test.
const requested = new URLSearchParams(window.location.search).get('spec') ?? '';
const name = isSpecName(requested) ? requested : defaultSpecName;

const picker = document.getElementById('spec-picker');
if (picker) {
  specNames.forEach((specName) => {
    const link = document.createElement('a');
    link.href = `./spec.html?spec=${specName}`;
    link.textContent = specName;
    if (specName === name) link.className = 'is-current';
    picker.appendChild(link);
  });
}

startSpecDemo(specs[name]);
