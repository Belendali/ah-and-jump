// Local volume-onset detection, not speech recognition. Silence rearms a sound.
export class VoiceGate {
  constructor(){this.threshold=.006;this.reset()}
  calibrate(levels){
    const sorted=levels.filter(Number.isFinite).sort((a,b)=>a-b);
    const floor=sorted[Math.floor(sorted.length*.2)]||.001;
    this.threshold=Math.min(.08,Math.max(.004,floor*2+.002));
  }
  reset(){this.armed=false;this.quietAt=null;this.loudAt=null;this.lastTrigger=-Infinity}
  update(level,now){
    if(level<this.threshold*.75){
      this.loudAt=null;
      this.quietAt??=now;
      if(now-this.quietAt>=130)this.armed=true;
    }else{
      this.quietAt=null;
      if(level>=this.threshold){
        this.loudAt??=now;
        if(this.armed&&now-this.loudAt>=30&&now-this.lastTrigger>=250){
          this.armed=false;this.lastTrigger=now;return true;
        }
      }else this.loudAt=null;
    }
    return false;
  }
}
