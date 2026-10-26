import { bearing } from './config.js';

export class BoatProbe {
  constructor(field) { this.field = field; this.x = 0; this.y = 180; this.tack = 'starboard'; }
  sample(time) {
    const wind = this.field.sample(this.x, this.y, time);
    return { ...wind, heading: bearing(wind.direction + (this.tack === 'starboard' ? -45 : 45)), tack: this.tack };
  }
  toggleTack() { this.tack = this.tack === 'starboard' ? 'port' : 'starboard'; }
}
