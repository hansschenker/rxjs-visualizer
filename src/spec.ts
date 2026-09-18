import './style.css';
import { startSpecDemo } from './spec-demo.ts';
import { debounceTimeSpec } from './specs.ts';

// Spec page: an rxjs marble test, run through the real TestScheduler and
// played back one frame per column.
startSpecDemo(debounceTimeSpec);
