import './style.css';
import { startDiamondDemo } from './demo.ts';

// Main page: the diamond pipeline with a glitch-free `zip` sink.
startDiamondDemo({ sink: 'zip' });
