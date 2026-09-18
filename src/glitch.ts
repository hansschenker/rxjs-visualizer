import './style.css';
import { startDiamondDemo } from './demo.ts';

// Glitch page (work in progress): the same pipeline, but the sink uses
// `combineLatest`, so for source value 2 it emits 14 before 24.
startDiamondDemo({ sink: 'combineLatest' });
