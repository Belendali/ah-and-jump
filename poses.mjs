// Visual poses only: jump height, airtime and collision timing stay unchanged.
export const POSE_COUNT=4;
export function nextPose(previous,random=Math.random){return (previous+1+Math.floor(random()*(POSE_COUNT-1)))%POSE_COUNT}
export function jumpPose(kind,progress){
 const p=Math.max(0,Math.min(1,progress)),a=Math.sin(Math.PI*p);
 const pose={rotation:0,sx:1,sy:1,offsetX:0,legs:0,head:0};
 if(kind===0){pose.legs=a*.7;pose.head=-a*.12;}
 if(kind===1){pose.rotation=Math.sin(p*Math.PI*2)*.16;pose.offsetX=Math.sin(p*Math.PI*2)*10;pose.head=-pose.rotation*.8;}
 if(kind===2){pose.sx=1+a*.16;pose.sy=1-a*.18;pose.legs=-a*.25;pose.head=Math.sin(p*Math.PI*3)*.12;}
 if(kind===3){pose.sx=Math.cos(p*Math.PI*2);pose.rotation=Math.sin(p*Math.PI*2)*.07;pose.head=a*.12;}
 return pose;
}
