export const TAU=Math.PI*2;
export const DURATION=15;
export const GRAVITY=1680;
export const JUMP_VELOCITY=555;
export function ropeSpeed(t){
  if(t<7)return .64;
  if(t<9)return .64+(t-7)*.03;
  if(t<12)return .70;
  return .66;
}
export function jumpHeight(age){return Math.max(0,JUMP_VELOCITY*age-GRAVITY*age*age/2)}
export class GameEngine{
  constructor(onEvent=()=>{}){this.onEvent=onEvent;this.reset()}
  reset(){this.time=0;this.phase=Math.PI*.9;this.jumps=0;this.jumpAt=-10;this.state='ready';this.lastCross=0;this.landed=true}
  start(){this.reset();this.state='playing'}
  jump(){if(this.state!=='playing'||jumpHeight(this.time-this.jumpAt)>0)return false;this.jumpAt=this.time;this.landed=false;this.onEvent('jump');return true}
  step(dt){
    if(this.state!=='playing')return;
    let remaining=Math.min(Math.max(0,dt),.1);
    while(remaining>1e-8&&this.state==='playing'){
      const h=Math.min(remaining,1/240,DURATION-this.time);if(h<=0){this.time=DURATION;this.state='won';this.onEvent('win');break}
      const before=this.phase;const start=this.time;this.time+=h;this.phase+=TAU*ropeSpeed(this.time)*h;
      if(Math.floor(before/TAU)<Math.floor(this.phase/TAU)){
        const crossing=(Math.floor(before/TAU)+1)*TAU;
        const crossTime=start+(crossing-before)/(this.phase-before)*h;
        if(jumpHeight(crossTime-this.jumpAt)<14){this.time=crossTime;this.phase=crossing;this.state='fallen';this.onEvent('fall');break}
        this.jumps++;this.lastCross=this.time;this.onEvent('clear');
      }
      if(!this.landed&&this.time-this.jumpAt>=2*JUMP_VELOCITY/GRAVITY){this.landed=true;this.onEvent('land')}
      if(this.time>=DURATION-1e-9){this.time=DURATION;this.state='won';this.onEvent('win')}
      remaining-=h;
    }
  }
  get height(){return jumpHeight(this.time-this.jumpAt)}
}
export class BlinkGate{
  constructor(){this.closed=false;this.lastBlink=-1e9;this.openFrames=0}
  update(left,right,now){
    if(left<.28&&right<.28){this.openFrames++;if(this.openFrames>=2)this.closed=false}else this.openFrames=0;
    if(left>.46&&right>.46&&!this.closed&&now-this.lastBlink>260){this.closed=true;this.lastBlink=now;return true}return false;
  }
  reset(){this.closed=true;this.openFrames=0}
}
